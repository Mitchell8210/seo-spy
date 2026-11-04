import { withHistoricalAiPolicy, historicalTestingLimits } from "./fixtures/historical-ai-policy.js";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import type { AiUsageEstimateInput } from "../src/integrations/ai/ai-usage.types.js";
import { MUSE_TESTING_POLICY_HASH, type TestingReceipt } from "../src/integrations/ai/muse-testing-ledger.js";

const actor = "a".repeat(64), businessId = "offline-testing-business", assessmentId = "1b4a366f-a53c-40f5-b5bd-407046131529";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const firstHash = hash("first exact offline fixture request");
const metadata = { assessmentId, businessId, inputHash: hash("input"), sourceManifestHash: hash("sources"), analysisCacheKey: hash("cache"), reasoning: "minimal" as const,
  promptVersion: "assessment-muse-prompt-v3", outputSchemaVersion: "assessment-muse-output-v3" as const };
const input = (requestHash = firstHash, reserveMicros = 10000): AiUsageEstimateInput => ({ actor, requestHash, cacheKey: requestHash, scope: `assessment:${businessId}:${assessmentId}`, mode: "poc",
  model: "muse-spark-1.3", maxInputTokens: 100, maxOutputTokens: 1500, reserveMicros, priceVersion: "offline-standard-price", reason: JSON.stringify({ purpose: "controlled-testing-v1", inputHash: metadata.inputHash }) });

describe("historical controlled Muse allocation compatibility in disposable SQLite only", () => {
  let directory: string, ledger: AiUsageStore;
  const tick = () => jest.setSystemTime(Date.now() + 61000);
  beforeEach(async () => {
    jest.useFakeTimers({ now: Date.parse("2026-11-01T10:00:00.000Z") });
    directory = await mkdtemp(join(tmpdir(), "seo-spy-testing-ledger-"));
    ledger = new AiUsageStore(new ConfigService({ AI_USAGE_DB: join(directory, "usage.sqlite") }));
    for (const [index, reserve] of [131460, 6544, 6544, 8196].entries()) {
      const estimate = await ledger.estimate({ ...input(hash(`historical-${index}`), reserve), maxInputTokens: 10, maxOutputTokens: 128, actor: "historical-operator" });
      await ledger.approve(estimate.id, "historical-administrator");
      const attempt = await ledger.reserve(estimate.id, { actor: estimate.actor, requestHash: estimate.requestHash, mode: "poc" });
      await ledger.settle(attempt.id, index === 3 ? { status: "success", inputTokens: 10, outputTokens: 105, actualMicros: 460, requestId: "historical-success" }
        : { status: "failed", errorCode: "AI_PROVIDER_FAILED", requestId: `historical-failure-${index}` });
      tick();
    }
    expect((await ledger.status()).development).toMatchObject({ budgetMicros: 25000000, chargedMicros: 145008, calls: 4 });
  });
  afterEach(async () => {
    ledger.onModuleDestroy(); jest.useRealTimers();
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    await rm(directory, { recursive: true });
  });
  const activate = (maximumMicros = 10000) => withHistoricalAiPolicy(join(directory, "usage.sqlite"), historicalTestingLimits, () => ledger.activateTestingAllocation(actor, { confirmed: true, policyHash: MUSE_TESTING_POLICY_HASH, requestHash: firstHash, maximumMicros }));
  const estimate = (requestHash = firstHash, reserveMicros = 10000) => ledger.estimateTesting(input(requestHash, reserveMicros), metadata);
  const settleAndReceipt = async (intentId: string, status: "success" | "failed" | "unknown" = "success") => {
    const intent = await ledger.readIntent(intentId), attempt = await ledger.testingAttempt(intentId);
    expect(attempt).not.toBeNull();
    await ledger.settle(String(attempt!.id), { status, inputTokens: 0, outputTokens: 0, actualMicros: 0, requestId: "safe-fixture-request", ...(status !== "success" ? { errorCode: "AI_OFFLINE_FIXTURE" } : {}) });
    const saved = await ledger.testingAttempt(intentId);
    const receipt: TestingReceipt = { assessmentId, inputHash: metadata.inputHash, requestHash: intent.requestHash, model: "muse-spark-1.3", reasoning: "minimal", inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
      estimatedTokenMicros: 0, reservedMicros: intent.reserveMicros, ledgerChargeMicros: Number(saved!.charged_micros), attemptId: String(saved!.id), requestId: "safe-fixture-request", httpStatus: status === "success" ? 200 : null,
      completionStatus: status === "success" ? "completed" : null, incompletionReason: null, failureCategory: status === "success" ? null : "AI_OFFLINE_FIXTURE", providerError: null,
      schemaValid: status === "success", idsValid: status === "success", persisted: status === "success", analysisId: status === "success" ? randomUUID() : null, cacheHit: false,
      selectedIds: status === "success" ? { strengths: [], weaknesses: [], recommendations: [] } : null };
    return { receipt, saved };
  };
  const complete = async (requestHash: string, reserve = 10000) => {
    const intent = await estimate(requestHash, reserve); await ledger.approve(intent.id, actor);
    const reserved = await ledger.reserve(intent.id, { actor, requestHash, mode: "poc" });
    const { receipt } = await settleAndReceipt(intent.id); await ledger.completeTestingReceipt(actor, intent.id, receipt); tick();
    return { intent, reserved, receipt };
  };
  it("is inactive by default and cannot estimate, approve or dispatch testing work", async () => {
    const before = await ledger.status(); expect(before.testing).toBeUndefined();
    await expect(estimate()).rejects.toBeDefined(); expect(await ledger.status()).toEqual(before);
    expect(await ledger.testingReceipts()).toEqual([]);
  });
  it.each(["actor", "confirmation", "policy", "hash", "cost", "baseline"])("rejects allocation mismatch %s without activating or changing historical accounting", async kind => {
    if (kind === "baseline") {
      ledger.onModuleDestroy(); const db = new DatabaseSync(join(directory, "usage.sqlite"));
      try { db.prepare("UPDATE attempts SET charged_micros=charged_micros-1 WHERE rowid=1").run(); } finally { db.close(); }
    }
    const before = await ledger.status();
    await expect(withHistoricalAiPolicy(join(directory, "usage.sqlite"), historicalTestingLimits, () => ledger.activateTestingAllocation(kind === "actor" ? "bad-actor" : actor, { confirmed: kind !== "confirmation", policyHash: kind === "policy" ? hash("wrong-policy") : MUSE_TESTING_POLICY_HASH,
      requestHash: kind === "hash" ? "invalid" : firstHash, maximumMicros: kind === "cost" ? 500001 : 10000 }))).rejects.toBeDefined();
    expect(await ledger.status()).toEqual(before);
  });
  it("keeps the original cap, attempts, receipts and demo allocation unchanged while accounting testing separately", async () => {
    const before = await ledger.status(), oldIntents = await Promise.all(before.recentAttempts.map(row => ledger.readIntent(row.intentId)));
    const allocation = await activate(); expect(allocation.fundedMicros).toBe(1854992);
    await complete(firstHash);
    const after = await ledger.status(); expect(after.development.calls).toBe(before.development.calls + 1);
    expect(after.development.budgetMicros).toBe(25000000); expect(after.demo).toEqual(before.demo);
    expect(after.recentAttempts.slice(1)).toEqual(before.recentAttempts);
    expect(await Promise.all(before.recentAttempts.map(row => ledger.readIntent(row.intentId)))).toEqual(oldIntents);
    expect(after.testing).toMatchObject({ calls: 1, chargedMicros: 0, dailyReservedMicros: 10000, incompleteReceipts: 0 });
    await expect(activate()).rejects.toMatchObject({ code: "AI_TESTING_ALREADY_ACTIVATED" });
  });
  it("binds first request hash and administrator, rejects incompatible scope/model and reservations above fifty cents", async () => {
    await activate();
    await expect(estimate(hash("different-first"))).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    await expect(ledger.estimateTesting({ ...input(), actor: "b".repeat(64) }, metadata)).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    await expect(ledger.estimateTesting({ ...input(), scope: "assessment:another-business:wrong" }, metadata)).rejects.toBeDefined();
    await expect(ledger.estimateTesting({ ...input(), model: "muse-spark-1.2" }, metadata)).rejects.toBeDefined();
    await expect(estimate(firstHash, 500001)).rejects.toMatchObject({ code: "AI_TESTING_LIMIT" });
  });
  it("binds the first maximum reservation to the exact activation approval", async () => {
    await activate(10000);
    await expect(estimate(firstHash, 10001)).rejects.toBeDefined();
  });
  it("validates legacy intent approval, reserves once under parallel calls, and blocks replay", async () => {
    await activate(); const intent = await estimate(); const authorization = { actor, requestHash: firstHash, mode: "poc" as const };
    await expect(ledger.reserve(intent.id, authorization)).rejects.toMatchObject({ code: "AI_APPROVAL_REQUIRED" });
    await ledger.approve(intent.id, actor);
    await expect(ledger.reserve(intent.id, { ...authorization, actor: "wrong" })).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    const results = await Promise.allSettled([ledger.reserve(intent.id, authorization), ledger.reserve(intent.id, authorization)]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    await expect(ledger.reserve(intent.id, authorization)).rejects.toBeDefined();
    const { receipt } = await settleAndReceipt(intent.id); await ledger.completeTestingReceipt(actor, intent.id, receipt);
    expect((await ledger.status()).testing?.calls).toBe(1);
  });
  it("requires a finalized receipt before another estimate and permits finalization without another budget check", async () => {
    await activate(); const intent = await estimate(); await ledger.approve(intent.id, actor);
    await ledger.reserve(intent.id, { actor, requestHash: firstHash, mode: "poc" });
    const { receipt } = await settleAndReceipt(intent.id);
    await expect(estimate(hash("next"))).rejects.toMatchObject({ code: "AI_TESTING_REVIEW_REQUIRED" });
    await ledger.completeTestingReceipt(actor, intent.id, receipt); tick();
    await expect(estimate(hash("next"))).resolves.toMatchObject({ actor });
  });
  it("allows only one active reservation even when two different requests were separately approved", async () => {
    await activate(); await complete(firstHash);
    const first = await estimate(hash("parallel-a")), second = await estimate(hash("parallel-b"));
    await ledger.approve(first.id, actor); await ledger.approve(second.id, actor);
    const results = await Promise.allSettled([first, second].map(intent => ledger.reserve(intent.id, { actor, requestHash: intent.requestHash, mode: "poc" })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await ledger.status()).testing?.calls).toBe(2);
    expect((await ledger.status()).activeAttemptId).not.toBeNull();
  });
  it("counts daily reservations rather than settled charges and preserves them across successful settlements", async () => {
    await activate(500000);
    for (let index = 0; index < 4; index++) await complete(index === 0 ? firstHash : hash(`daily-${index}`), 500000);
    expect((await ledger.status()).testing).toMatchObject({ calls: 4, chargedMicros: 0, dailyReservedMicros: 2000000 });
    await expect(estimate(hash("daily-overflow"), 10000)).rejects.toMatchObject({ code: "AI_TESTING_LIMIT" });
    jest.setSystemTime(Date.now() + 86400000);
    await expect(estimate(hash("next-day"), 10000)).resolves.toBeDefined();
  });
  it("permits at most ten additional attempts even across different UTC days", async () => {
    await activate();
    for (let index = 0; index < 10; index++) {
      if (index === 5) jest.setSystemTime(Date.now() + 86400000);
      await complete(index === 0 ? firstHash : hash(`attempt-${index}`));
    }
    expect((await ledger.status()).testing?.calls).toBe(10);
    await expect(estimate(hash("eleventh"))).rejects.toMatchObject({ code: "AI_TESTING_LIMIT" });
  });
  it("retains failed reservations and stops at the unprotected funded amount", async () => {
    await activate(500000);
    for (let index = 0; index < 3; index++) {
      const intent = await estimate(index === 0 ? firstHash : hash(`failed-${index}`), 500000); await ledger.approve(intent.id, actor);
      await ledger.reserve(intent.id, { actor, requestHash: intent.requestHash, mode: "poc" });
      const { receipt } = await settleAndReceipt(intent.id, "failed"); await ledger.completeTestingReceipt(actor, intent.id, receipt); tick();
    }
    expect((await ledger.status()).testing).toMatchObject({ calls: 3, chargedMicros: 1500000, dailyReservedMicros: 1500000 });
    await expect(estimate(hash("cannot-borrow-demo"), 500000)).rejects.toMatchObject({ code: "AI_TESTING_LIMIT" });
    expect((await ledger.status()).demo).toMatchObject({ calls: 0, chargedMicros: 0, authorization: null });
  });
  it("retains uncertain outcomes and the global halt without allowing another reservation", async () => {
    await activate(); const intent = await estimate(); await ledger.approve(intent.id, actor);
    await ledger.reserve(intent.id, { actor, requestHash: firstHash, mode: "poc" });
    const { receipt } = await settleAndReceipt(intent.id, "unknown"); await ledger.completeTestingReceipt(actor, intent.id, receipt); tick();
    const next = await estimate(hash("after-uncertain")); await ledger.approve(next.id, actor);
    await expect(ledger.reserve(next.id, { actor, requestHash: next.requestHash, mode: "poc" })).rejects.toMatchObject({ code: "AI_USAGE_HALTED" });
    expect((await ledger.status()).halted).toBe(true);
  });
  it("checks immutable receipt bindings, ownership and checksums without storing unfiltered provider data", async () => {
    await activate(); const { intent, receipt } = await complete(firstHash);
    expect(await ledger.testingReceipts()).toEqual([receipt]);
    await expect(ledger.completeTestingReceipt("wrong-actor", intent.id, receipt)).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    await expect(ledger.completeTestingReceipt(actor, intent.id, { ...receipt, ledgerChargeMicros: 1 })).rejects.toBeDefined();
    await expect(ledger.completeTestingReceipt(actor, intent.id, { ...receipt, rawResponse: "must not persist" })).rejects.toBeDefined();
    await expect(ledger.completeTestingReceipt(actor, intent.id, receipt)).rejects.toBeDefined();
    ledger.onModuleDestroy(); const db = new DatabaseSync(join(directory, "usage.sqlite"));
    try { db.prepare("UPDATE muse_testing_receipts SET checksum=? WHERE intent_id=?").run("0".repeat(64), intent.id); } finally { db.close(); }
    await expect(ledger.testingReceipts()).rejects.toBeDefined();
  });
});
