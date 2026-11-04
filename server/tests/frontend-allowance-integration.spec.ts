import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { MetaMuseProvider, type MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";

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
    const config = new ConfigService({ AI_USAGE_DB: join(directory, "usage.sqlite"), MOCK_AI: true, AI_ENABLED: false, AI_MODE: "mock", MODEL_API_KEY: "offline-fixture-key", AI_ADMIN_KEY: "offline-admin-key".repeat(3) });
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
    post.mockReset().mockResolvedValue({ status: 200, requestId: "offline-frontend-response", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3",
      usage: { input_tokens: 100, output_tokens: 20 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ ready: true }) }] }] }) });
    provider = new MetaMuseProvider(config, { post } as unknown as MetaMuseTransport, ledger);
  });
  afterEach(async () => {
    ledger.onModuleDestroy(); jest.useRealTimers();
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    await rm(directory, { recursive: true });
  });
  it("dispatches an authenticated supported task without funding amendments or spending approval", async () => {
    const before = await ledger.status();
    const result = await provider.generateFrontend(modelInput(), context());
    expect(result).toMatchObject({ output: { ready: true }, model: "muse-spark-1.3" });
    expect(result.attemptId).toBeTruthy(); expect(post).toHaveBeenCalledTimes(1);
    const after = await ledger.status();
    expect(after.development.budgetMicros).toBe(25000000);
    expect(after.development.chargedMicros).toBeGreaterThan(before.development.chargedMicros);
    expect(await ledger.wordPressAllowanceStatus(actor, businessId, siteUrl, 5659)).toMatchObject({ generationAuthorized: true, writeAuthorized: false });
    await expect(provider.generate(modelInput())).rejects.toMatchObject({ code: "AI_DISABLED" });
  });
  it("rejects missing actors, unsupported tasks and mismatched business snapshots before transport", async () => {
    for (const scope of [{ ...context(), actor: "" }, { ...context(), businessId: "other-business" }, { ...context(), task: "unsupported" as "planner" }])
      await expect(provider.generateFrontend(modelInput(), scope)).rejects.toBeDefined();
    expect(post).not.toHaveBeenCalled();
  });
  it("accounts invalid output and rate limits repeated requests without automatic retries", async () => {
    post.mockResolvedValueOnce({ status: 200, requestId: "offline-invalid", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3",
      usage: { input_tokens: 100, output_tokens: 20 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "not JSON" }] }] }) });
    const before = (await ledger.status()).development.chargedMicros;
    await expect(provider.generateFrontend(modelInput(), context())).rejects.toBeDefined();
    expect((await ledger.status()).development.chargedMicros).toBeGreaterThan(before);
    await expect(provider.generateFrontend(modelInput(), context())).rejects.toMatchObject({ code: "AI_RATE_LIMIT" });
    expect(post).toHaveBeenCalledTimes(1);
    tick();
    await expect(provider.generateFrontend(modelInput(), context())).resolves.toMatchObject({ output: { ready: true } });
    expect(post).toHaveBeenCalledTimes(2);
  });
  it("authenticates developer diagnostics and spends without environment edits or per-request approvals", async () => {
    await expect(provider.generateDiagnostic(modelInput(), "wrong", "diagnostic:test")).rejects.toBeDefined();
    expect(post).not.toHaveBeenCalled();
    await expect(provider.generateDiagnostic(modelInput(), "offline-admin-key".repeat(3), "diagnostic:test")).resolves.toMatchObject({ output: { ready: true } });
    expect(post).toHaveBeenCalledTimes(1);
    expect((await ledger.status()).development.calls).toBe(5);
  });
  it("retains uncertain reservations and blocks further calls without a retry", async () => {
    post.mockResolvedValueOnce({ status: 200, requestId: "offline-uncertain", body: "not JSON" });
    await expect(provider.generateFrontend(modelInput(), context())).rejects.toBeDefined();
    expect(await ledger.wordPressAllowanceStatus(actor, businessId, siteUrl, 5658)).toMatchObject({ status: "blocked", writeAuthorized: false });
    tick(); await expect(provider.generateFrontend(modelInput(), context())).rejects.toBeDefined();
    expect(post).toHaveBeenCalledTimes(1); expect((await ledger.status()).recentAttempts[0].status).toBe("unknown");
  });
  it("reserves at most one concurrent frontend dispatch", async () => {
    let release!: (value: Awaited<ReturnType<MetaMuseTransport["post"]>>) => void, started!: () => void;
    const dispatched = new Promise<void>(resolve => { started = resolve; });
    post.mockImplementationOnce(async () => { started(); return new Promise(resolve => { release = resolve; }); });
    const first = provider.generateFrontend(modelInput(), context()); await dispatched;
    await expect(provider.generateFrontend(modelInput(), context())).rejects.toBeDefined();
    expect(post).toHaveBeenCalledTimes(1);
    release({ status: 200, requestId: "offline-concurrent", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3", usage: { input_tokens: 100, output_tokens: 20 },
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ ready: true }) }] }] }) });
    await expect(first).resolves.toMatchObject({ output: { ready: true } });
    expect((await ledger.status()).development.calls).toBe(5);
  });
});
