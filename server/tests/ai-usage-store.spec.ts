import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { activateTesting, MUSE_TESTING_POLICY_HASH } from "../src/integrations/ai/muse-testing-ledger.js";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import type { AiUsageEstimateInput, AiUsageIntent } from "../src/integrations/ai/ai-usage.types.js";

describe("shared cumulative AI allowance and protected dispatch", () => {
  let directory: string;
  let path: string;
  let store: AiUsageStore;
  let stores: AiUsageStore[];
  let now: number;
  const makeStore = () => {
    const current = new AiUsageStore(new ConfigService({ AI_USAGE_DB: path }));
    stores.push(current);
    return current;
  };
  const input = (patch: Partial<AiUsageEstimateInput> = {}): AiUsageEstimateInput => ({
    actor: "operator-hash", scope: "business/example/report/1", requestHash: "a".repeat(64), cacheKey: "b".repeat(64),
    mode: "poc", model: "muse-spark-1.3", maxInputTokens: 100, maxOutputTokens: 100, reserveMicros: 550,
    priceVersion: "meta-standard-2026-10-31", reason: "Validate the response schema once with exact saved evidence.", ...patch,
  });
  const auth = (intent: AiUsageIntent) => ({ actor: intent.actor, requestHash: intent.requestHash, mode: intent.mode, scope: intent.scope, model: intent.model, maxInputTokens: intent.maxInputTokens, maxOutputTokens: intent.maxOutputTokens, reserveMicros: intent.reserveMicros, priceVersion: intent.priceVersion, cacheKey: intent.cacheKey, inputPriceMicrosPerMillion: intent.inputPriceMicrosPerMillion, outputPriceMicrosPerMillion: intent.outputPriceMicrosPerMillion });
  const approved = async (patch: Partial<AiUsageEstimateInput> = {}) => {
    const intent = await store.estimate(input(patch));
    await store.approve(intent.id, "administrator-hash");
    return intent;
  };
  const settledFailure = async (patch: Partial<AiUsageEstimateInput> = {}) => {
    const intent = await approved(patch);
    const reserved = await store.reserve(intent.id, auth(intent));
    await store.settle(reserved.id, { status: "failed", errorCode: "AI_PROVIDER_FAILED" });
    return reserved;
  };
  it("uses one shared allowance regardless of legacy demo grants", async () => {
    const intent = await store.estimate(input({ mode: "demo" }));
    await store.authorizeDemo("administrator", { budgetMicros: 100000, dailyMicros: 50000, maxCalls: 1 });
    await store.reserve(intent.id, auth(intent));
    expect((await store.status()).development.chargedMicros).toBe(550);
  });
  it("ignores obsolete per-request capacity configuration across restart", async () => {
    await store.estimate(input(), { budgetMicros: 0, dailyMicros: 0, maxCalls: 0 });
    expect((await makeStore().status()).development.budgetMicros).toBe(25000000);
  });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-ai-usage-"));
    path = join(directory, "usage.sqlite");
    now = Date.parse("2026-10-31T12:00:00.000Z");
    jest.spyOn(Date, "now").mockImplementation(() => now);
    stores = [];
    store = makeStore();
  });
  afterEach(async () => {
    for (const current of stores) current.onModuleDestroy();
    jest.restoreAllMocks();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-ai-usage-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });

  it("automatically authorizes accounting for an authenticated initiating operation", async () => {
    const intent = await store.estimate(input());
    expect(intent.approvedAt).toBeTruthy();
    await store.reserve(intent.id, auth(intent));
    expect((await store.status()).development).toMatchObject({ budgetMicros: 25000000, chargedMicros: 550 });
  });
  it("reserves the maximum before dispatch and allows exactly one use of an approved request", async () => {
    const intent = await approved();
    const reservation = await store.reserve(intent.id, auth(intent));
    expect(reservation.intent).toMatchObject({ approvedBy: "operator-hash", consumedAt: new Date(now).toISOString() });
    expect(await store.status()).toMatchObject({ development: { calls: 1, chargedMicros: 550 }, activeAttemptId: reservation.id });
    await expect(store.reserve(intent.id, auth(intent))).rejects.toMatchObject({ code: "AI_APPROVAL_REQUIRED" });
    await expect(store.approve(intent.id, "administrator-hash")).rejects.toMatchObject({ code: "AI_APPROVAL_STALE" });
    await store.settle(reservation.id, { status: "success", inputTokens: 10, outputTokens: 10, actualMicros: 55 });
    expect(await store.status()).toMatchObject({ development: { calls: 1, chargedMicros: 55 }, activeAttemptId: null });
    await expect(store.settle(reservation.id, { status: "success", inputTokens: 0, outputTokens: 0, actualMicros: 0 })).rejects.toMatchObject({ code: "AI_USAGE_ALREADY_SETTLED" });
  });

  it.each([
    { actor: "other" }, { mode: "demo" }, { requestHash: "c".repeat(64) }, { scope: "other-business" }, { model: "muse-spark-1.2" },
    { maxInputTokens: 101 }, { maxOutputTokens: 101 }, { reserveMicros: 600 }, { priceVersion: "changed" }, { inputPriceMicrosPerMillion: 2_000_000 },
  ])("rejects altered approval binding %j without consuming it", async patch => {
    const intent = await approved();
    await expect(store.reserve(intent.id, { ...auth(intent), ...patch } as ReturnType<typeof auth>)).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    expect((await store.readIntent(intent.id)).consumedAt).toBeNull();
    expect((await store.status()).development.calls).toBe(0);
  });

  it("expires both unapproved previews and approved requests without refreshing them", async () => {
    const preview = await store.estimate(input());
    const intent = await approved();
    now += 15 * 60_000;
    await expect(store.approve(preview.id, "admin")).rejects.toMatchObject({ code: "AI_APPROVAL_STALE" });
    await expect(store.reserve(intent.id, auth(intent))).rejects.toMatchObject({ code: "AI_APPROVAL_REQUIRED" });
    expect((await store.status()).development.calls).toBe(0);
  });

  it("preserves active reservations and cumulative usage across database connections and restart", async () => {
    const intent = await approved();
    const reserved = await store.reserve(intent.id, auth(intent));
    const second = makeStore();
    expect(await second.status()).toMatchObject({ activeAttemptId: reserved.id, development: { chargedMicros: 550, calls: 1 } });
    const otherIntent = await second.estimate(input());
    await second.approve(otherIntent.id, "admin");
    await expect(second.reserve(otherIntent.id, auth(otherIntent))).rejects.toMatchObject({ code: "AI_REAL_REQUEST_ACTIVE" });
    store.onModuleDestroy();
    store = makeStore();
    expect(await store.status()).toMatchObject({ activeAttemptId: reserved.id, development: { chargedMicros: 550, calls: 1 } });
  });

  it("consumes failures without refund and enforces one request per minute across connections", async () => {
    await settledFailure();
    const intent = await approved();
    const other = makeStore();
    await expect(other.reserve(intent.id, auth(intent))).rejects.toMatchObject({ code: "AI_RATE_LIMIT" });
    now += 59_999;
    await expect(other.reserve(intent.id, auth(intent))).rejects.toMatchObject({ code: "AI_RATE_LIMIT" });
    now += 1;
    await other.reserve(intent.id, auth(intent));
    expect(await store.status()).toMatchObject({ development: { calls: 2, chargedMicros: 1100 } });
  });

  it("holds unknown outcomes active and halts all later real calls without automatic recovery", async () => {
    const intent = await approved();
    const reserved = await store.reserve(intent.id, auth(intent));
    await store.settle(reserved.id, { status: "unknown", errorCode: "AI_TIMEOUT" });
    now += 24 * 60 * 60_000;
    const next = await approved();
    await expect(store.reserve(next.id, auth(next))).rejects.toMatchObject({ code: "AI_USAGE_HALTED" });
    expect(await makeStore().status()).toMatchObject({ halted: true, activeAttemptId: reserved.id, development: { calls: 1, chargedMicros: 550, todayChargedMicros: 0 } });
  });

  it.each([
    { status: "success" as const },
    { status: "success" as const, inputTokens: 101, outputTokens: 100, actualMicros: 552 },
    { status: "success" as const, inputTokens: 10, outputTokens: 10, actualMicros: 1 },
  ])("fails closed on missing, underestimated or over-limit usage %j", async outcome => {
    const intent = await approved();
    const reserved = await store.reserve(intent.id, auth(intent));
    await store.settle(reserved.id, outcome);
    expect(await store.status()).toMatchObject({ halted: true, activeAttemptId: reserved.id });
  });

  it("records known spending overruns instead of hiding them behind the reservation", async () => {
    const intent = await approved();
    const reserved = await store.reserve(intent.id, auth(intent));
    await store.settle(reserved.id, { status: "success", inputTokens: 100, outputTokens: 100, actualMicros: 999 });
    expect(await store.status()).toMatchObject({ halted: true, development: { chargedMicros: 999 }, recentAttempts: [{ status: "unknown", chargedMicros: 999 }] });
  });

  it("does not replenish cumulative headroom at midnight", async () => {
    await settledFailure({ reserveMicros: 24000000 });
    now += 61000;
    await expect(store.estimate(input({ reserveMicros: 1000001 }))).rejects.toMatchObject({ code: "AI_DEVELOPMENT_BUDGET" });
    now = Date.parse("2026-11-01T00:00:00Z");
    await expect(makeStore().estimate(input({ reserveMicros: 1000001 }))).rejects.toMatchObject({ code: "AI_DEVELOPMENT_BUDGET" });
    expect((await store.status()).development.chargedMicros).toBe(24000000);
  });
  it("never resets the twenty-five-dollar cumulative allowance", async () => {
    await settledFailure({ reserveMicros: 25000000 });
    now += 86400000;
    await expect(makeStore().estimate(input())).rejects.toMatchObject({ code: "AI_DEVELOPMENT_BUDGET" });
  });
  it("allows more than ten operations within the shared monetary budget", async () => {
    for (let call = 0; call < 11; call++) { now += 60000; await settledFailure(); }
    expect((await makeStore().status()).development.calls).toBe(11);
  });
  it("does not let obsolete configured limits disable the established grant", async () => {
    const intent = await approved();
    await store.reserve(intent.id, auth(intent), { budgetMicros: 0, dailyMicros: 0, maxCalls: 0 });
    expect((await makeStore().status()).development).toMatchObject({ budgetMicros: 25000000, chargedMicros: 550 });
  });
  it("preserves the grant after a mismatched reservation", async () => {
    const intent = await approved();
    await expect(store.reserve(intent.id, { ...auth(intent), actor: "wrong" }, { budgetMicros: 0, dailyMicros: 0, maxCalls: 0 })).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    expect((await makeStore().status()).development.budgetMicros).toBe(25000000);
  });
  it("rejects any policy attempt to raise the hard development caps", async () => {
    const intent = await approved({ reserveMicros: 25000000 });
    const attempt = await store.reserve(intent.id, auth(intent), { budgetMicros: 100000000, dailyMicros: 100000000, maxCalls: 100000 });
    await store.settle(attempt.id, { status: "failed" }); now += 61000;
    await expect(store.estimate(input())).rejects.toMatchObject({ code: "AI_DEVELOPMENT_BUDGET" });
  });
  it("counts all demo and development spending against the same ceiling", async () => {
    await settledFailure({ reserveMicros: 24999450, mode: "demo" }); now += 61000;
    await settledFailure(); now += 61000;
    await expect(store.estimate(input({ mode: "demo" }))).rejects.toMatchObject({ code: "AI_DEVELOPMENT_BUDGET" });
    expect((await store.status()).development.chargedMicros).toBe(25000000);
  });
  it("validates estimates, rate snapshots and proof-of-concept reasons before any usage", async () => {
    for (const patch of [{ reserveMicros: 1 }, { inputPriceMicrosPerMillion: 1 }, { outputPriceMicrosPerMillion: 1 }, { reason: "" }, { maxOutputTokens: 1501 }, { mode: "mock" }, { model: "expensive-model" }])
      await expect(store.estimate(input(patch as Partial<AiUsageEstimateInput>))).rejects.toMatchObject({ code: "AI_ESTIMATE_INVALID" });
    expect((await store.status()).development.calls).toBe(0);
  });

  it("serializes competing connections so only one approved request reserves capacity", async () => {
    await settledFailure({ reserveMicros: 24999450 }); now += 61000;
    const first = await approved();
    const second = await approved();
    const other = makeStore();
    const outcomes = await Promise.allSettled([store.reserve(first.id, auth(first)), other.reserve(second.id, auth(second))]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
    expect(await store.status()).toMatchObject({ development: { calls: 2, chargedMicros: 25000000 } });
    expect((await other.status()).activeAttemptId).not.toBeNull();
  });

  it("migrates old demo authorization metadata without resetting any spending or reservations", async () => {
    const reserved = await settledFailure();
    const authorization = await store.authorizeDemo("admin", { budgetMicros: 10_000_000, dailyMicros: 1_000_000, maxCalls: 3 }, "Final video recording was separately authorized.");
    store.onModuleDestroy();
    const database = new DatabaseSync(path);
    database.exec("ALTER TABLE demo_authorizations DROP COLUMN reason; PRAGMA user_version=1;");
    database.close();
    store = makeStore();
    expect(await store.status()).toMatchObject({ development: { chargedMicros: 550, calls: 1 }, demo: { authorization: { id: authorization.id } }, recentAttempts: [{ id: reserved.id }] });
    const migrated = new DatabaseSync(path);
    expect(migrated.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
    migrated.close();
  });

  it("upgrades a narrowed v2 policy once without changing receipts, charges or accounting halts", async () => {
    await settledFailure(); store.onModuleDestroy();
    const legacy = new DatabaseSync(path);
    const before = legacy.prepare("SELECT * FROM attempts").all();
    legacy.exec("UPDATE policy SET budget=550,daily=550,calls=1,halted=1; PRAGMA user_version=2;");
    legacy.close();
    const upgraded = makeStore();
    expect(await upgraded.status()).toMatchObject({ halted: true, development: { budgetMicros: 25000000, chargedMicros: 550, calls: 1 } });
    const inspected = new DatabaseSync(path);
    expect(inspected.prepare("SELECT * FROM attempts").all()).toEqual(before);
    expect(inspected.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
    inspected.close(); upgraded.onModuleDestroy();
    const restarted = makeStore(), intent = await restarted.estimate(input());
    await expect(restarted.reserve(intent.id, auth(intent))).rejects.toMatchObject({ code: "AI_USAGE_HALTED" });
  });

  it("keeps legacy testing receipt fingerprints verifiable after the shared-policy upgrade", async () => {
    for (const [index, reserveMicros] of [131460, 6544, 6544, 8196].entries()) {
      const intent = await store.estimate(input({ reserveMicros, maxInputTokens: 10, maxOutputTokens: 128 }));
      const attempt = await store.reserve(intent.id, auth(intent));
      await store.settle(attempt.id, index === 3 ? { status: "success", inputTokens: 10, outputTokens: 105, actualMicros: 460 } : { status: "failed" });
      now += 61000;
    }
    store.onModuleDestroy();
    const legacy = new DatabaseSync(path);
    legacy.exec("DROP TABLE ai_policy_before_shared; UPDATE policy SET budget=152744,daily=152744,calls=4; PRAGMA user_version=2;");
    activateTesting(legacy, "a".repeat(64), { confirmed: true, policyHash: MUSE_TESTING_POLICY_HASH, requestHash: "c".repeat(64), maximumMicros: 10000 });
    const original = legacy.prepare("SELECT * FROM muse_testing_allocation").all();
    legacy.close();
    const upgraded = makeStore();
    expect(await upgraded.status()).toMatchObject({ development: { budgetMicros: 25000000, chargedMicros: 145008 }, testing: { calls: 0 } });
    const inspected = new DatabaseSync(path);
    expect(inspected.prepare("SELECT * FROM muse_testing_allocation").all()).toEqual(original);
    inspected.close();
  });

  it("rejects corrupt databases and never replaces them with a fresh budget", async () => {
    await writeFile(path, "secret-corrupted-database");
    await expect(store.status()).rejects.toMatchObject({ code: "AI_USAGE_UNAVAILABLE" });
    expect(await readFile(path, "utf8")).toBe("secret-corrupted-database");
  });

  it("blocks initialization if an existing ledger was removed instead of silently resetting limits", async () => {
    await settledFailure();
    store.onModuleDestroy();
    await unlink(path);
    await expect(makeStore().status()).rejects.toMatchObject({ code: "AI_USAGE_UNAVAILABLE" });
  });

  it("rejects modified estimate payloads and redacts arbitrary provider IDs/errors", async () => {
    const intent = await approved();
    const database = new DatabaseSync(path);
    database.prepare("UPDATE intents SET payload=? WHERE id=?").run(JSON.stringify(input({ requestHash: "c".repeat(64) })), intent.id);
    database.close();
    await expect(store.reserve(intent.id, auth(intent))).rejects.toMatchObject({ code: "AI_USAGE_UNAVAILABLE" });
    const fresh = await approved();
    const reserved = await store.reserve(fresh.id, auth(fresh));
    await store.settle(reserved.id, { status: "failed", requestId: "private raw secret", errorCode: "private raw secret" });
    const status = await store.status();
    expect(JSON.stringify(status)).not.toContain("private raw secret");
    expect(status.recentAttempts[0]).toMatchObject({ requestId: null, errorCode: null });
  });
});
