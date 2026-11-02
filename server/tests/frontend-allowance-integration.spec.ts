import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { MetaMuseProvider, type MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import { MUSE_TESTING_POLICY_HASH } from "../src/integrations/ai/muse-testing-ledger.js";

const admin = "a".repeat(64), actor = "b".repeat(64), businessId = "demo-guzman", siteUrl = "https://example.com/";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const modelInput = () => ({ instructions: "Return a strictly structured reviewed planner proposal.", reasoningEffort: "minimal" as const,
  input: { snapshot: { version: "planner-snapshot-v1", businessId, tasks: [] }, snapshotHash: hash("offline-snapshot") },
  schema: { type: "object", properties: { ready: { type: "boolean" } }, required: ["ready"], additionalProperties: false } });
const context = () => ({ actor, businessId, siteUrl, task: "planner" as const, resourceKey: randomUUID() });

describe("shared frontend allowance through the actual central ledger and mocked transport", () => {
  let directory: string, ledger: AiUsageStore, provider: MetaMuseProvider;
  const post = jest.fn<MetaMuseTransport["post"]>();
  const tick = () => jest.setSystemTime(Date.now() + 61000);
  beforeEach(async () => {
    jest.useFakeTimers({ now: Date.parse("2026-11-02T10:00:00Z") });
    directory = await mkdtemp(join(tmpdir(), "seo-spy-frontend-allowance-"));
    const config = new ConfigService({ AI_USAGE_DB: join(directory, "usage.sqlite"), MOCK_AI: true, AI_ENABLED: false, AI_MODE: "mock", MODEL_API_KEY: "offline-fixture-key" });
    ledger = new AiUsageStore(config);
    for (const [index, reserveMicros] of [131460, 6544, 6544, 8196].entries()) {
      const requestHash = hash(`historical-${index}`);
      const intent = await ledger.estimate({ actor: admin, scope: "offline-history", requestHash, cacheKey: requestHash, mode: "poc", model: "muse-spark-1.3",
        maxInputTokens: 10, maxOutputTokens: 128, reserveMicros, priceVersion: "offline-fixture", reason: "Disposable historical ledger fixture" });
      await ledger.approve(intent.id, admin);
      const attempt = await ledger.reserve(intent.id, { actor: admin, requestHash, mode: "poc" });
      await ledger.settle(attempt.id, index === 3 ? { status: "success", inputTokens: 10, outputTokens: 105, actualMicros: 460 } : { status: "failed", errorCode: "OFFLINE_FIXTURE" });
      tick();
    }
    await expect(ledger.estimate({ actor: admin, scope: "offline-history", requestHash: hash("narrow"), cacheKey: hash("narrow"), mode: "poc", model: "muse-spark-1.3",
      maxInputTokens: 1, maxOutputTokens: 16, reserveMicros: 1000, priceVersion: "fixture", reason: "Retain historical policy limits" },
    { budgetMicros: 152744, dailyMicros: 152744, maxCalls: 4 })).rejects.toBeDefined();
    await ledger.activateTestingAllocation(admin, { confirmed: true, policyHash: MUSE_TESTING_POLICY_HASH, requestHash: hash("allocation"), maximumMicros: 10000 });
    const scope = { actor, businessId, siteUrl, mediaIds: [5658] };
    const original = await ledger.prepareWordPressAllowance(admin, scope);
    await ledger.activateWordPressAllowance(admin, scope, { confirmed: true, policyHash: original.policyHash, fundingHash: original.fundingHash });
    post.mockReset().mockResolvedValue({ status: 200, requestId: "offline-frontend-response", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3",
      usage: { input_tokens: 100, output_tokens: 20 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ ready: true }) }] }] }) });
    provider = new MetaMuseProvider(config, { post } as unknown as MetaMuseTransport, ledger);
  });
  afterEach(async () => {
    ledger.onModuleDestroy(); jest.useRealTimers();
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    await rm(directory, { recursive: true });
  });
  async function broaden() {
    const preview = await ledger.prepareFrontendAllowance(admin);
    return ledger.activateFrontendAllowance(admin, { confirmed: true, policyHash: preview.policyHash, approvalHash: preview.approvalHash });
  }
  it("requires the additive scope approval, preserves historical allocation, then dispatches only through a scoped exact intent", async () => {
    await expect(provider.generateFrontend(modelInput(), context())).rejects.toBeDefined(); expect(post).not.toHaveBeenCalled();
    const before = await ledger.status(); await broaden(); const after = await ledger.status();
    expect(after.development).toEqual(before.development); expect(after.demo).toEqual(before.demo); expect(after.testing).toEqual(before.testing);
    expect(after.recentAttempts).toEqual(before.recentAttempts);
    const result = await provider.generateFrontend(modelInput(), context());
    expect(result).toMatchObject({ output: { ready: true }, model: "muse-spark-1.3" }); expect(result.attemptId).toBeTruthy(); expect(post).toHaveBeenCalledTimes(1);
    const status = await ledger.wordPressAllowanceStatus(actor, businessId, siteUrl, 5658);
    expect(status.remainingAttempts).toBe(2); expect(status.remainingMicros).toBeLessThan(150000);
    await expect(provider.generate(modelInput())).rejects.toMatchObject({ code: "AI_DISABLED" });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("binds the authenticated actor/site/business and keeps WordPress write scope at media 5658", async () => {
    await broaden();
    for (const scope of [{ ...context(), actor: admin }, { ...context(), businessId: "other-business" }, { ...context(), siteUrl: "https://other.test/" }])
      await expect(provider.generateFrontend(modelInput(), scope)).rejects.toBeDefined();
    expect(post).not.toHaveBeenCalled();
    expect(await ledger.wordPressAllowanceStatus(actor, businessId, siteUrl, 5659)).toMatchObject({ generationAuthorized: true, writeAuthorized: false });
  });
  it("rejects duplicate requests and keeps invalid chargeable responses accounted without retries", async () => {
    await broaden(); const source = modelInput(), scope = context();
    post.mockResolvedValueOnce({ status: 200, requestId: "offline-invalid", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3",
      usage: { input_tokens: 100, output_tokens: 20 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "not JSON" }] }] }) });
    await expect(provider.generateFrontend(source, scope)).rejects.toBeDefined(); expect(post).toHaveBeenCalledTimes(1);
    const charged = await ledger.wordPressAllowanceStatus(actor, businessId, siteUrl, 5658);
    expect(charged.remainingAttempts).toBe(2); expect(charged.remainingMicros).toBeLessThan(150000);
    await expect(provider.generateFrontend(source, scope)).rejects.toBeDefined(); expect(post).toHaveBeenCalledTimes(1);
    tick();
    await expect(provider.generateFrontend(source, scope)).rejects.toBeDefined(); expect(post).toHaveBeenCalledTimes(1);
    await expect(provider.generateFrontend({ ...source, instructions: source.instructions + " New explicit request." }, context())).resolves.toMatchObject({ output: { ready: true } });
    expect(post).toHaveBeenCalledTimes(2);
    expect((await ledger.status()).testing?.incompleteReceipts).toBe(0);
  });
  it("retains uncertain reservations and blocks further calls without a retry", async () => {
    await broaden(); post.mockResolvedValueOnce({ status: 200, requestId: "offline-uncertain", body: "not JSON" });
    await expect(provider.generateFrontend(modelInput(), context())).rejects.toBeDefined();
    expect(await ledger.wordPressAllowanceStatus(actor, businessId, siteUrl, 5658)).toMatchObject({ status: "blocked", writeAuthorized: false });
    tick(); await expect(provider.generateFrontend(modelInput(), context())).rejects.toBeDefined();
    expect(post).toHaveBeenCalledTimes(1); expect((await ledger.status()).recentAttempts[0].status).toBe("unknown");
  });
  it("reserves at most one concurrent frontend dispatch", async () => {
    await broaden();
    let release!: (value: Awaited<ReturnType<MetaMuseTransport["post"]>>) => void, started!: () => void;
    const dispatched = new Promise<void>(resolve => { started = resolve; });
    post.mockImplementationOnce(async () => { started(); return new Promise(resolve => { release = resolve; }); });
    const first = provider.generateFrontend(modelInput(), context()); await dispatched;
    await expect(provider.generateFrontend(modelInput(), context())).rejects.toBeDefined();
    expect(post).toHaveBeenCalledTimes(1);
    release({ status: 200, requestId: "offline-concurrent", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3", usage: { input_tokens: 100, output_tokens: 20 },
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ ready: true }) }] }] }) });
    await expect(first).resolves.toMatchObject({ output: { ready: true } });
    expect((await ledger.wordPressAllowanceStatus(actor, businessId, siteUrl, 5658)).remainingAttempts).toBe(2);
  });
});
