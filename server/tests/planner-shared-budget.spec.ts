import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { jest } from "@jest/globals";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { MetaMuseProvider, type MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import { defaultAiSettings, makeAiSnapshot, validateAiProposal } from "../src/modules/smart-planner/planner-ai.domain.js";
import { PlannerAiGateway } from "../src/modules/smart-planner/planner-ai.gateway.js";
import type { PlannerResponseDto } from "../src/modules/smart-planner/planner.dto.js";
import { compactPlannerFixture } from "./fixtures/planner-compact-response.js";
import { expandCompactPlan } from "../src/modules/smart-planner/planner-muse.compact.js";
import { compactPlannerMuseInput } from "../src/modules/smart-planner/planner-muse.compact.js";

const businessId = "demo-guzman", actor = "a".repeat(64);
const context = { actor, businessId, siteUrl: "https://example.com/" };
function snapshot() {
  const taskId = randomUUID();
  const state: PlannerResponseDto = { businessId, revision: 1, preferences: { useWeekends: false, dailyCapacityMinutes: 120, maxTasksPerDay: 3, horizonWeeks: 4, timeZone: "UTC" }, sources: [],
    tasks: [{ id: taskId, taskKey: `custom:${taskId}`, title: "Review saved indexing guidance", explanation: "Saved issue", guidance: "Review the existing guidance before making a change.", category: "Search", priority: "Urgent", source: "Custom task", mode: "custom", status: "Needs Action",
      schedule: null, notes: null, destination: null, origin: null, completedAt: null, estimatedDurationMinutes: 60, durationEstimateSource: "user", scheduledBy: null }] };
  return makeAiSnapshot(state, structuredClone(defaultAiSettings), "2026-11-09", [], new Date(Date.now()));
}
describe("Smart Planner uses the updated shared $25 accounting policy", () => {
  let directory: string, config: ConfigService, settings: Record<string, unknown>, ledger: AiUsageStore, gateway: PlannerAiGateway;
  let network: { mockRestore(): void };
  const post = jest.fn<MetaMuseTransport["post"]>();
  function reopen() {
    ledger = new AiUsageStore(config);
    const provider = new MetaMuseProvider(config, { post } as unknown as MetaMuseTransport, ledger);
    gateway = new PlannerAiGateway(config, undefined, undefined, provider);
  }
  beforeEach(async () => {
    jest.useFakeTimers({ now: Date.parse("2026-11-02T10:00:00Z") });
    directory = await mkdtemp(join(tmpdir(), "seo-spy-planner-shared-"));
    settings = { AI_USAGE_DB: join(directory, "usage.sqlite"), MODEL_API_KEY: "offline-fixture-key", AI_MODE: "mock", AI_ENABLED: false, MOCK_AI: true };
    config = new ConfigService(settings);
    network = jest.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Live network is forbidden"); });
    post.mockReset(); reopen();
  });
  afterEach(async () => {
    ledger.onModuleDestroy(); expect(fetch).not.toHaveBeenCalled(); network.mockRestore(); jest.useRealTimers();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-planner-shared-")) throw new Error("Unexpected fixture cleanup path");
    await rm(target, { recursive: true, force: true });
  });
  it("uses the real shared ledger with automatic accounting and no separate planner funding/manual approval", async () => {
    const source = snapshot(), original = structuredClone(source), compact = compactPlannerFixture(source), output = expandCompactPlan(source, compact);
    post.mockResolvedValue({ status: 200, requestId: "offline-response", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3", usage: { input_tokens: 1000, output_tokens: 500 },
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(compact) }] }] }) });
    const result = await gateway.generate(source, "live", randomUUID(), context);
    expect(result.output).toEqual(output); expect(result.accountingAttemptId).toBeTruthy();
    expect(validateAiProposal(source, result.output).valid).toBe(true); expect(source).toEqual(original);
    const status = await ledger.status();
    expect(status.development).toMatchObject({ budgetMicros: 25000000, chargedMicros: 3375, calls: 1 });
    expect(status.recentAttempts[0]).toMatchObject({ id: result.accountingAttemptId, status: "success", chargedMicros: 3375 });
    expect(post).toHaveBeenCalledTimes(1); expect(post.mock.calls[0][3]).toBeDefined();
    expect(JSON.parse(post.mock.calls[0][0]).max_output_tokens).toBe(8000);
    expect(status.recentAttempts[0].reserveMicros).toBeGreaterThan(8000 * 4.25);
  });
  it("uses a configurable planner-only cap and reconciles usage above the old limit", async () => {
    settings.PLANNER_MUSE_MAX_OUTPUT_TOKENS = 12000;
    const source = snapshot(), compact = compactPlannerFixture(source);
    post.mockResolvedValue({ status: 200, requestId: "offline-larger-response", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3", usage: { input_tokens: 1000, output_tokens: 3000 },
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(compact) }] }] }) });
    await gateway.generate(source, "live", randomUUID(), context);
    expect(JSON.parse(post.mock.calls[0][0]).max_output_tokens).toBe(12000);
    expect((await ledger.status()).development.chargedMicros).toBe(14000);
    const provider = new MetaMuseProvider(config, { post } as unknown as MetaMuseTransport, ledger);
    expect(provider.prepare({ instructions: "Existing workflow", input: {}, schema: { type: "object" } }).maxOutputTokens).toBe(1500);
    expect(() => provider.prepare({ instructions: "Other workflow", input: {}, schema: {}, plannerMaxOutputTokens: 8000 })).toThrow();
    await expect(provider.generateFrontend(compactPlannerMuseInput(source), { ...context, task: "wordpress-alt", resourceKey: randomUUID() })).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it.each([0, 511, 16385, 8000.5, "invalid"])("blocks invalid planner token configuration %s before dispatch", async value => {
    settings.PLANNER_MUSE_MAX_OUTPUT_TOKENS = value;
    await expect(gateway.generate(snapshot(), "live", randomUUID(), context)).rejects.toMatchObject({ code: "AI_PLANNING_CONFIG_INVALID" });
    expect(post).not.toHaveBeenCalled(); expect((await ledger.status()).development.calls).toBe(0);
  });
  it("does not enlarge the ledger output limit for unrelated workflows", async () => {
    const provider = new MetaMuseProvider(config, { post } as unknown as MetaMuseTransport, ledger);
    const prepared = provider.prepare(compactPlannerMuseInput(snapshot()));
    const { payload: _payload, ...cost } = prepared; void _payload;
    await expect(ledger.estimate({ ...cost, actor, scope: "wordpress:other-feature", cacheKey: prepared.requestHash,
      mode: "poc", reason: "Offline test of unchanged non-planner output protections." })).rejects.toMatchObject({ code: "AI_ESTIMATE_INVALID" });
    await expect(ledger.estimateFrontend({ ...cost, actor, scope: "frontend:planner:other-business:other-request", cacheKey: prepared.requestHash,
      mode: "poc", reason: "Offline test of exact business-scoped planner allowance." }, { ...context, task: "planner", resourceKey: "this-request" })).rejects.toMatchObject({ code: "AI_APPROVAL_MISMATCH" });
    expect(post).not.toHaveBeenCalled(); expect((await ledger.status()).development.calls).toBe(0);
  });
  it("retains the settled accounting link and exact rejection when completed Muse JSON is invalid", async () => {
    const source = snapshot(), compact = compactPlannerFixture(source);
    compact.rows[0].minutes = 45;
    post.mockResolvedValue({ status: 200, requestId: "offline-invalid-plan", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3", usage: { input_tokens: 6811, output_tokens: 1316 },
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(compact) }] }] }) });
    await expect(gateway.generate(source, "live", randomUUID(), context)).rejects.toMatchObject({ code: "AI_PLANNING_RESPONSE_INVALID", message: expect.stringContaining("minutes"),
      diagnostics: [{ code: "AI_RESPONSE_SCHEMA", detail: expect.stringContaining("minutes") }],
      receipt: { model: "muse-spark-1.3", requestIdentity: expect.stringMatching(/^[a-f0-9]{64}$/), accountingAttemptId: expect.any(String) } });
    expect((await ledger.status()).recentAttempts[0]).toMatchObject({ status: "success", chargedMicros: 14107, outputTokens: 1316 });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("counts historical other-mode failed reservations and never replenishes $25 on reopen or next day", async () => {
    const requestHash = createHash("sha256").update("historical-other-mode-fixture").digest("hex");
    // Disposable ledger: simulate a fully charged historical conservative failure.
    const intent = await ledger.estimate({ actor, scope: "historical:other-feature", requestHash, cacheKey: requestHash, mode: "demo", model: "muse-spark-1.3",
      maxInputTokens: 1, maxOutputTokens: 128, reserveMicros: 25000000, priceVersion: "offline-fixture", reason: "Simulated historical failed usage in a temporary ledger." });
    const attempt = await ledger.reserve(intent.id, { actor, requestHash, mode: "demo" });
    await ledger.settle(attempt.id, { status: "failed", errorCode: "OFFLINE_FIXTURE" });
    const before = await ledger.status(); expect(before.development.chargedMicros).toBe(25000000);
    jest.setSystemTime(Date.now() + 61000);
    await expect(gateway.generate(snapshot(), "live", randomUUID(), context)).rejects.toMatchObject({ code: "AI_DEVELOPMENT_BUDGET", message: expect.stringContaining("remaining shared $25") });
    expect(post).not.toHaveBeenCalled(); expect((await ledger.status()).recentAttempts).toEqual(before.recentAttempts);
    ledger.onModuleDestroy(); jest.setSystemTime(Date.now() + 86400000); reopen();
    expect((await ledger.status()).development).toMatchObject({ budgetMicros: 25000000, chargedMicros: 25000000, calls: 1 });
    await expect(gateway.generate(snapshot(), "live", randomUUID(), context)).rejects.toMatchObject({ code: "AI_DEVELOPMENT_BUDGET" });
    expect(post).not.toHaveBeenCalled();
  });
  it("keeps offline planning cost-free and refuses cross-business live scope before dispatch", async () => {
    const source = snapshot();
    expect((await gateway.generate(source, "mock", randomUUID(), context)).model).toBe("offline-simulation");
    await expect(gateway.generate(source, "live", randomUUID(), { ...context, businessId: "other-business" })).rejects.toMatchObject({ code: "AI_PLANNING_APPROVAL_REQUIRED" });
    expect(post).not.toHaveBeenCalled();
  });
});
