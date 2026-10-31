import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import type { AiUsageEstimateInput, AiUsageIntent } from "../src/integrations/ai/ai-usage.types.js";

describe("persistent real-AI budget and exact per-call approvals", () => {
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

  it("starts with the protected development allocation and never authorizes a call from an estimate alone", async () => {
    const intent = await store.estimate(input());
    expect(intent).toMatchObject({ approvedAt: null, consumedAt: null, inputPriceMicrosPerMillion: 1_250_000, outputPriceMicrosPerMillion: 4_250_000 });
    expect(Date.parse(intent.expiresAt) - now).toBe(15 * 60_000);
    await expect(store.reserve(intent.id, auth(intent))).rejects.toMatchObject({ code: "AI_APPROVAL_REQUIRED" });
    expect(await store.status()).toMatchObject({ development: { budgetMicros: 2_000_000, dailyMicros: 500_000, maxCalls: 10, calls: 0, chargedMicros: 0 }, demo: { authorization: null, chargedMicros: 0 }, activeAttemptId: null, halted: false });
  });

  it("reserves the maximum before dispatch and allows exactly one use of an approved request", async () => {
    const intent = await approved();
    const reservation = await store.reserve(intent.id, auth(intent));
    expect(reservation.intent).toMatchObject({ approvedBy: "administrator-hash", consumedAt: new Date(now).toISOString() });
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

  it("reserves against the UTC daily limit and preserves cumulative usage after midnight", async () => {
    await settledFailure({ reserveMicros: 400_000 });
    now += 61_000;
    await expect(store.estimate(input({ reserveMicros: 100_001 }))).rejects.toMatchObject({ code: "AI_DAILY_BUDGET" });
    now = Date.parse("2026-11-01T00:00:00.000Z");
    expect(await store.status()).toMatchObject({ development: { chargedMicros: 400_000, todayChargedMicros: 0, calls: 1 } });
    await settledFailure({ reserveMicros: 200_000 });
    expect(await store.status()).toMatchObject({ development: { chargedMicros: 600_000, todayChargedMicros: 200_000, calls: 2 } });
  });

  it("never resets or increases the two-dollar cumulative development allocation", async () => {
    for (let day = 0; day < 4; day++) {
      now = Date.parse("2026-10-31T12:00:00.000Z") + day * 24 * 60 * 60_000;
      await settledFailure({ reserveMicros: 500_000 });
    }
    now += 24 * 60 * 60_000;
    await expect(makeStore().estimate(input())).rejects.toMatchObject({ code: "AI_DEVELOPMENT_BUDGET" });
    expect(await store.status()).toMatchObject({ development: { chargedMicros: 2_000_000, calls: 4 } });
  });

  it("limits all initial development attempts to ten including failed requests", async () => {
    for (let call = 0; call < 10; call++) { now += 60_000; await settledFailure(); }
    now += 24 * 60 * 60_000;
    await expect(store.estimate(input())).rejects.toMatchObject({ code: "AI_REQUEST_LIMIT" });
    expect((await makeStore().status()).development.calls).toBe(10);
  });

  it("allows stricter configured limits but never automatically increases them on later requests", async () => {
    const intent = await approved();
    const reserved = await store.reserve(intent.id, auth(intent), { budgetMicros: 1000, dailyMicros: 1000, maxCalls: 2 });
    await store.settle(reserved.id, { status: "failed" });
    now += 60_000;
    expect(await makeStore().status()).toMatchObject({ development: { budgetMicros: 1000, dailyMicros: 1000, maxCalls: 2, chargedMicros: 550 } });
    await expect(store.estimate(input())).rejects.toMatchObject({ code: "AI_DEVELOPMENT_BUDGET" });
  });

  it("keeps a stricter limit even when the reservation that supplied it is rejected", async () => {
    const intent = await approved();
    await expect(store.reserve(intent.id, auth(intent), { budgetMicros: 100, dailyMicros: 100, maxCalls: 1 })).rejects.toMatchObject({ code: "AI_DEVELOPMENT_BUDGET" });
    expect(await makeStore().status()).toMatchObject({ development: { budgetMicros: 100, dailyMicros: 100, maxCalls: 1, calls: 0 } });
    await expect(store.reserve(intent.id, auth(intent), { budgetMicros: 2_000_000, dailyMicros: 500_000, maxCalls: 10 })).rejects.toMatchObject({ code: "AI_DEVELOPMENT_BUDGET" });
  });

  it("rejects any policy attempt to raise the hard development caps", async () => {
    const intent = await approved();
    await expect(store.reserve(intent.id, auth(intent), { budgetMicros: 2_000_001, dailyMicros: 500_000, maxCalls: 10 })).rejects.toMatchObject({ code: "AI_BUDGET_POLICY_INVALID" });
    expect((await store.readIntent(intent.id)).consumedAt).toBeNull();
  });

  it("requires separate bounded demo authorization and never borrows from its reserve during development", async () => {
    await expect(store.estimate(input({ mode: "demo" }))).rejects.toMatchObject({ code: "AI_DEMO_APPROVAL_REQUIRED" });
    await expect(store.authorizeDemo("admin", { budgetMicros: 148_000_001, dailyMicros: 500_000, maxCalls: 1 })).rejects.toMatchObject({ code: "AI_DEMO_APPROVAL_REQUIRED" });
    const authorization = await store.authorizeDemo("admin", { budgetMicros: 10_000_000, dailyMicros: 1_000_000, maxCalls: 3 });
    const intent = await approved({ mode: "demo" });
    expect(intent.demoAuthorizationId).toBe(authorization.id);
    await expect(store.reserve(intent.id, auth(intent), { budgetMicros: 11_000_000, dailyMicros: 1_000_000, maxCalls: 3 })).rejects.toMatchObject({ code: "AI_DEMO_APPROVAL_REQUIRED" });
    const reserved = await store.reserve(intent.id, auth(intent), authorization);
    await store.settle(reserved.id, { status: "failed" });
    expect(await store.status()).toMatchObject({ development: { chargedMicros: 0, calls: 0 }, demo: { chargedMicros: 550, calls: 1 } });
  });

  it("validates estimates, rate snapshots and proof-of-concept reasons before any usage", async () => {
    for (const patch of [{ reserveMicros: 1 }, { inputPriceMicrosPerMillion: 1 }, { outputPriceMicrosPerMillion: 1 }, { reason: "" }, { maxOutputTokens: 1501 }, { mode: "mock" }, { model: "expensive-model" }])
      await expect(store.estimate(input(patch as Partial<AiUsageEstimateInput>))).rejects.toMatchObject({ code: "AI_ESTIMATE_INVALID" });
    expect((await store.status()).development.calls).toBe(0);
  });

  it("serializes competing connections so only one approved request reserves capacity", async () => {
    const first = await approved();
    const second = await approved();
    const other = makeStore();
    const outcomes = await Promise.allSettled([store.reserve(first.id, auth(first)), other.reserve(second.id, auth(second))]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
    expect(await store.status()).toMatchObject({ development: { calls: 1, chargedMicros: 550 } });
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
    expect(migrated.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
    migrated.close();
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
