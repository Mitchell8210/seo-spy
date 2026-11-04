import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { MetaMuseProvider, type MetaMuseAuthorization } from "../src/integrations/ai/meta-muse.provider.js";
import { defaultAiSettings, makeAiSnapshot, offlineAiProposal, plannerMuseInput, PLANNER_AI_INSTRUCTIONS, PLANNER_AI_PROMPT_VERSION, PLANNER_AI_SCHEMA_VERSION, PLANNER_AI_SCOPE, snapshotHash } from "../src/modules/smart-planner/planner-ai.domain.js";
import { PlannerAiGateway, PlannerAiGenerationError, type PlannerAiAuthorization, type PlannerMuseExecutor } from "../src/modules/smart-planner/planner-ai.gateway.js";
import { plannerMuseConfig, PlannerMuseError, preparePlannerMuse, type PlannerMuseRequest } from "../src/modules/smart-planner/planner-muse.request.js";
import type { PlannerResponseDto } from "../src/modules/smart-planner/planner.dto.js";
import { compactPlannerFixture } from "./fixtures/planner-compact-response.js";
import { compactPlannerMuseInput, expandCompactPlan } from "../src/modules/smart-planner/planner-muse.compact.js";

const businessId = "business-a", taskId = "11111111-1111-4111-8111-111111111111", generationId = "22222222-2222-4222-8222-222222222222";
const fixedTime = Date.parse("2026-11-02T08:00:00.000Z");
function snapshot() {
  const state: PlannerResponseDto = { businessId, revision: 7,
    preferences: { useWeekends: false, dailyCapacityMinutes: 120, maxTasksPerDay: 3, horizonWeeks: 4, timeZone: "UTC" }, sources: [],
    tasks: [{ id: taskId, taskKey: `custom:${taskId}`, title: "Review important SEO guidance", explanation: "Saved finding with bounded relevant evidence.", guidance: "Review the content and document the result.",
      priority: "Medium", category: "Review", source: "Custom task", sourceSeverity: "medium", mode: "custom", status: "Needs Action", estimatedDurationMinutes: 60, durationEstimateSource: "user", scheduledBy: null,
      schedule: null, destination: null, notes: null, completedAt: null, origin: null }],
  };
  return makeAiSnapshot(state, structuredClone(defaultAiSettings), "2026-11-02", [], new Date(fixedTime));
}
const dedicatedScope = `${PLANNER_AI_SCOPE}:${businessId}`;
const approval: MetaMuseAuthorization = { intentId: "33333333-3333-4333-8333-333333333333", actor: "server-authenticated-fixture-administrator", scope: dedicatedScope };
const liveConfig = (extra: Record<string, unknown> = {}) => new ConfigService({ AI_ENABLED: true, MOCK_AI: false, AI_MODE: "poc", PLANNER_MUSE_MAX_OUTPUT_TOKENS: 8000, ...extra });
type Execution = Awaited<ReturnType<PlannerMuseExecutor["execute"]>>;
function execution(request: PlannerMuseRequest, outputTokens = 300): Execution {
  return { response: { status: 200, requestId: "offline-provider-request", body: JSON.stringify({ status: "completed", model: request.model,
    usage: { input_tokens: 100, output_tokens: outputTokens }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(offlineAiProposal(snapshot())) }] }] }) },
    accountingAttemptId: "offline-central-attempt", requestHash: request.requestHash, settingsHash: request.settingsHash, scope: dedicatedScope };
}

describe("feature-local planner Muse gateway with trusted executor fixtures only", () => {
  let network: { mockRestore(): void }, clock: { mockRestore(): void };
  let config: ConfigService;
  const execute = jest.fn<PlannerMuseExecutor["execute"]>();
  const preflight = jest.fn<PlannerAiAuthorization["preflight"]>();
  beforeEach(() => {
    config = liveConfig();
    execute.mockReset().mockImplementation(async request => execution(request));
    preflight.mockReset().mockResolvedValue(null);
    clock = jest.spyOn(Date, "now").mockReturnValue(fixedTime);
    network = jest.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Network forbidden in gateway fixtures"); });
  });
  afterEach(() => { jest.useRealTimers(); expect(fetch).not.toHaveBeenCalled(); network.mockRestore(); clock.mockRestore(); });

  it.each(["authorization", "executor", "both"])("blocks missing %s before reading configuration, financial preflight or credential dispatch", async missing => {
    const reads = jest.spyOn(config, "get").mockImplementation(() => { throw new Error("Configuration must not be accessed before capabilities exist"); });
    const gateway = new PlannerAiGateway(config, missing === "executor" ? { preflight } : undefined, missing === "authorization" ? { execute } : undefined);
    await expect(gateway.generate(snapshot(), "live", generationId)).rejects.toMatchObject({ code: "AI_PLANNING_APPROVAL_REQUIRED" });
    expect(reads).not.toHaveBeenCalled(); expect(preflight).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("generates explicitly offline previews without reading configuration or accessing financial adapters", async () => {
    const reads = jest.spyOn(config, "get").mockImplementation(() => { throw new Error("No model configuration needed for offline preview"); });
    const gateway = new PlannerAiGateway(config, { preflight }, { execute }), source = snapshot();
    const generated = await gateway.generate(source, "mock", generationId);
    expect(generated).toEqual({ output: offlineAiProposal(source), model: "offline-simulation", requestIdentity: null, accountingAttemptId: null });
    expect(reads).not.toHaveBeenCalled(); expect(preflight).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("uses authenticated frontend scope and the common strict provider instead of dedicated developer approvals", async () => {
    const source = snapshot(), compact = compactPlannerFixture(source), output = expandCompactPlan(source, compact);
    const prepare = jest.fn(() => ({ model: "muse-spark-1.3", requestHash: "d".repeat(64) }));
    const generateFrontend = jest.fn(async () => ({ model: "muse-spark-1.3", output: compact, attemptId: "central-fixture-attempt" }));
    const provider = { prepare, generateFrontend } as unknown as MetaMuseProvider;
    const context = { actor: "a".repeat(64), businessId, siteUrl: "https://example.com/" };
    const gateway = new PlannerAiGateway(new ConfigService({ MOCK_AI: true, AI_ENABLED: false }), undefined, undefined, provider);
    expect(await gateway.generate(source, "live", generationId, context)).toEqual({ output, model: "muse-spark-1.3", requestIdentity: "d".repeat(64), accountingAttemptId: "central-fixture-attempt" });
    expect(generateFrontend).toHaveBeenCalledWith(compactPlannerMuseInput(source), { ...context, task: "planner", resourceKey: generationId });
    await expect(gateway.generate(source, "live", generationId, { ...context, businessId: "other" })).rejects.toMatchObject({ code: "AI_PLANNING_APPROVAL_REQUIRED" });
    expect(generateFrontend).toHaveBeenCalledTimes(1);
    await gateway.generate(source, "mock", generationId, context);
    expect(generateFrontend).toHaveBeenCalledTimes(1);
  });

  it("reports a capped frontend request failure without retry or technical details", async () => {
    const generateFrontend = jest.fn(async () => { throw Object.assign(new Error("private ledger detail"), { code: "AI_FRONTEND_COST_LIMIT" }); });
    const provider = { prepare: () => ({ model: "muse-spark-1.3", requestHash: "d".repeat(64) }), generateFrontend } as unknown as MetaMuseProvider;
    await expect(new PlannerAiGateway(config, undefined, undefined, provider).generate(snapshot(), "live", generationId, { actor: "a".repeat(64), businessId, siteUrl: "https://example.com/" }))
      .rejects.toMatchObject({ code: "AI_FRONTEND_COST_LIMIT", message: "This plan exceeds the current per-request size or cost limit. The shared $25 budget does not raise provider limits. No calendar changes were made." });
    expect(generateFrontend).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["AI_DEVELOPMENT_BUDGET", "remaining shared $25"],
    ["AI_RATE_LIMIT", "rate-limited"],
    ["AI_INPUT_TOO_LARGE", "does not raise provider limits"],
    ["AI_TRUNCATED", "response limit"],
  ])("reports shared-policy %s accurately without suggesting new feature funding", async (code, message) => {
    const generateFrontend = jest.fn(async () => { throw Object.assign(new Error("private financial detail"), { code }); });
    const provider = { prepare: () => ({ model: "muse-spark-1.3", requestHash: "d".repeat(64) }), generateFrontend } as unknown as MetaMuseProvider;
    await expect(new PlannerAiGateway(config, undefined, undefined, provider).generate(snapshot(), "live", generationId, { actor: "a".repeat(64), businessId, siteUrl: "https://example.com/" }))
      .rejects.toMatchObject({ code, message: expect.stringContaining(message) });
    expect(generateFrontend).toHaveBeenCalledTimes(1);
  });

  it.each([
    { AI_ENABLED: false }, { AI_ENABLED: "false" }, { MOCK_AI: true }, { MOCK_AI: "true" }, { AI_MODE: "mock" }, { AI_MODE: "unsupported" },
  ])("honors application-wide master safety switches %j before preflight or execution", async flags => {
    config = liveConfig(flags); preflight.mockResolvedValueOnce(approval);
    await expect(new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "live", generationId)).rejects.toMatchObject({ code: "AI_PLANNING_DISABLED" });
    expect(preflight).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed when master safety configuration is missing", async () => {
    jest.spyOn(config, "get").mockReturnValue(undefined);
    await expect(new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "live", generationId)).rejects.toMatchObject({ code: "AI_PLANNING_DISABLED" });
    expect(preflight).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("allows an explicit offline preview while application-wide paid generation is disabled", async () => {
    config = liveConfig({ AI_ENABLED: false, MOCK_AI: true, AI_MODE: "mock" });
    expect(await new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "mock", generationId)).toMatchObject({ model: "offline-simulation", requestIdentity: null });
    expect(preflight).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("accepts explicit string master-switch values and demo mode only with a dedicated authorization and executor", async () => {
    config = liveConfig({ AI_ENABLED: "true", MOCK_AI: "false", AI_MODE: "demo" }); preflight.mockResolvedValueOnce(approval);
    expect(await new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "live", generationId)).toMatchObject({ model: "muse-spark-1.3" });
    expect(preflight).toHaveBeenCalledTimes(1); expect(execute).toHaveBeenCalledTimes(1);
  });

  it("preflights exact local request/settings hashes, dedicated business scope, snapshot and generation identity", async () => {
    const source = snapshot(), prepared = preparePlannerMuse(source, plannerMuseConfig(config), fixedTime), gateway = new PlannerAiGateway(config, { preflight }, { execute });
    await expect(gateway.generate(source, "live", generationId)).rejects.toBeInstanceOf(PlannerAiGenerationError);
    expect(preflight).toHaveBeenCalledWith({ businessId, scope: dedicatedScope, snapshotHash: snapshotHash(source), requestHash: prepared.requestHash, settingsHash: prepared.settingsHash,
      reserveMicros: prepared.reserveMicros, generationId, model: prepared.model, maxInputTokens: prepared.maxInputTokens, maxOutputTokens: prepared.maxOutputTokens,
      priceVersion: prepared.priceVersion, perGenerationMicros: prepared.perGenerationMicros, allowanceCeilingMicros: prepared.allowanceCeilingMicros });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([PLANNER_AI_SCOPE, `${PLANNER_AI_SCOPE}:business-b`, "assessment:interpretation", "wordpress:fix", "diagnostics:hello"])("rejects unrelated authorization scope %s without borrowing it", async scope => {
    preflight.mockResolvedValueOnce({ ...approval, scope });
    await expect(new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "live", generationId)).rejects.toMatchObject({ code: "AI_PLANNING_APPROVAL_REQUIRED" });
    expect(preflight).toHaveBeenCalledTimes(1); expect(execute).not.toHaveBeenCalled();
  });

  it.each(["actor", "intentId"] as const)("rejects an incomplete trusted approval missing %s", async key => {
    preflight.mockResolvedValueOnce({ ...approval, [key]: "" });
    await expect(new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "live", generationId)).rejects.toMatchObject({ code: "AI_PLANNING_APPROVAL_REQUIRED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes only an exact prepared request with a matching dedicated approval and receipt", async () => {
    preflight.mockResolvedValueOnce(approval);
    const source = snapshot(), prepared = preparePlannerMuse(source, plannerMuseConfig(config), fixedTime);
    const result = await new PlannerAiGateway(config, { preflight }, { execute }).generate(source, "live", generationId);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(prepared, approval, { businessId, generationId }, expect.any(AbortSignal));
    expect(result).toEqual({ output: offlineAiProposal(source), model: prepared.model, requestIdentity: prepared.requestHash, accountingAttemptId: "offline-central-attempt" });
    expect(Object.keys(result)).not.toContain("usage");
  });

  it("uses feature-local model/output limits independently of existing Muse workflows' limits", async () => {
    config = liveConfig({ PLANNER_MUSE_MODEL: "muse-spark-1.2", PLANNER_MUSE_MAX_OUTPUT_TOKENS: 12000, AI_MODEL: "muse-spark-1.3", AI_MAX_OUTPUT_TOKENS: 1500 });
    const reads = jest.spyOn(config, "get"), source = snapshot(); preflight.mockResolvedValueOnce(approval);
    execute.mockImplementationOnce(async request => execution(request, 9000));
    const result = await new PlannerAiGateway(config, { preflight }, { execute }).generate(source, "live", generationId);
    const prepared = execute.mock.calls[0][0], payload = JSON.parse(prepared.payload) as { model: string; max_output_tokens: number };
    expect(payload).toMatchObject({ model: "muse-spark-1.2", max_output_tokens: 12000 }); expect(prepared.maxOutputTokens).toBe(12000); expect(result.model).toBe("muse-spark-1.2");
    expect(reads.mock.calls.every(([name]) => String(name).startsWith("PLANNER_MUSE_") || ["AI_ENABLED", "MOCK_AI", "AI_MODE"].includes(String(name)))).toBe(true);
    expect(reads.mock.calls.some(([name]) => ["AI_MODEL", "AI_MAX_OUTPUT_TOKENS"].includes(String(name)))).toBe(false);
    expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ model: "muse-spark-1.2", maxOutputTokens: 12000 }));
  });

  it("fails invalid feature configuration before preflight or execution", async () => {
    config = liveConfig({ PLANNER_MUSE_MAX_OUTPUT_TOKENS: 999999 });
    await expect(new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "live", generationId)).rejects.toMatchObject({ code: "AI_PLANNING_CONFIG_INVALID" });
    expect(preflight).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("fails per-generation capacity restrictions before financial preflight", async () => {
    config = liveConfig({ PLANNER_MUSE_PER_GENERATION_MICROS: 1 });
    await expect(new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "live", generationId)).rejects.toMatchObject({ code: "AI_PLANNING_COST_LIMIT" });
    expect(preflight).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("maps allowance/capacity-storage rejection to an accurate blocked state without execution", async () => {
    preflight.mockRejectedValueOnce(new Error("private financial details"));
    await expect(new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "live", generationId)).rejects.toMatchObject({ code: "AI_PLANNING_ALLOWANCE_UNAVAILABLE", message: expect.not.stringContaining("private financial details") });
    expect(preflight).toHaveBeenCalledTimes(1); expect(execute).not.toHaveBeenCalled();
  });

  const badReceipts: [string, (result: Execution) => void][] = [
    ["missing attempt", result => { result.accountingAttemptId = ""; }],
    ["non-string attempt", result => { result.accountingAttemptId = 123 as unknown as string; }],
    ["oversized attempt", result => { result.accountingAttemptId = "a".repeat(129); }],
    ["wrong request hash", result => { result.requestHash = "b".repeat(64); }],
    ["wrong settings hash", result => { result.settingsHash = "c".repeat(64); }],
    ["wrong business scope", result => { result.scope = `${PLANNER_AI_SCOPE}:other-business`; }],
  ];
  it.each(badReceipts)("rejects a receipt with %s before accepting a response", async (_name, alter) => {
    preflight.mockResolvedValueOnce(approval); execute.mockImplementationOnce(async request => { const result = execution(request); alter(result); return result; });
    await expect(new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "live", generationId)).rejects.toMatchObject({ code: "AI_PLANNING_ACCOUNTING_MISMATCH" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("maps uncertain execution failure without leaking details or automatically retrying", async () => {
    preflight.mockResolvedValueOnce(approval); execute.mockRejectedValueOnce(new Error("private provider details"));
    await expect(new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "live", generationId)).rejects.toMatchObject({ code: "AI_PLANNING_PROVIDER_FAILED", message: expect.not.stringContaining("private provider details") });
    expect(preflight).toHaveBeenCalledTimes(1); expect(execute).toHaveBeenCalledTimes(1);
  });

  it("preserves typed feature-local execution failures without fallback", async () => {
    const error = new PlannerMuseError("AI_PLANNING_USAGE_LIMIT", "Fixture usage exceeded reserved tokens"); preflight.mockResolvedValueOnce(approval); execute.mockRejectedValueOnce(error);
    await expect(new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "live", generationId)).rejects.toBe(error);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("aborts once on timeout and retains an uncertain outcome without automatic retry", async () => {
    jest.useFakeTimers({ now: fixedTime }); config = liveConfig({ PLANNER_MUSE_TIMEOUT_MS: 1000 }); preflight.mockResolvedValueOnce(approval);
    execute.mockImplementationOnce(() => new Promise<Execution>(() => { /* remote outcome remains uncertain */ }));
    const pending = new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "live", generationId);
    const rejection = expect(pending).rejects.toMatchObject({ code: "AI_PLANNING_TIMEOUT" });
    await jest.advanceTimersByTimeAsync(1000); await rejection;
    expect(execute.mock.calls[0][3].aborted).toBe(true); expect(execute).toHaveBeenCalledTimes(1); expect(preflight).toHaveBeenCalledTimes(1);
  });

  const invalidResponses: [string, (result: Execution) => void, string][] = [
    ["provider rejection", result => { result.response.status = 400; }, "AI_PLANNING_PROVIDER_REJECTED"],
    ["malformed response", result => { result.response.body = "not-json"; }, "AI_PLANNING_RESPONSE_INVALID"],
    ["incomplete response", result => { result.response.body = JSON.stringify({ status: "incomplete" }); }, "AI_PLANNING_RESPONSE_INCOMPLETE"],
    ["wrong returned model", result => { const body = JSON.parse(result.response.body) as { model: string }; body.model = "unrelated-model"; result.response.body = JSON.stringify(body); }, "AI_PLANNING_RESPONSE_INVALID"],
    ["missing usage", result => { const body = JSON.parse(result.response.body) as { usage?: unknown }; delete body.usage; result.response.body = JSON.stringify(body); }, "AI_PLANNING_RESPONSE_INVALID"],
  ];
  it.each(invalidResponses)("rejects %s after receipt validation without retrying", async (_name, alter, code) => {
    preflight.mockResolvedValueOnce(approval); execute.mockImplementationOnce(async request => { const result = execution(request); alter(result); return result; });
    await expect(new PlannerAiGateway(config, { preflight }, { execute }).generate(snapshot(), "live", generationId)).rejects.toMatchObject({ code });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("keeps a separate versioned strict impact-first prompt/schema in the prepared request", () => {
    const source = snapshot(), input = plannerMuseInput(source), prepared = preparePlannerMuse(source, plannerMuseConfig(config), fixedTime);
    const payload = JSON.parse(prepared.payload) as { model: string; instructions: string; max_output_tokens: number; text: { format: { name: string; strict: boolean; schema: object } } };
    expect(input.instructions).toBe(PLANNER_AI_INSTRUCTIONS); expect(input.instructions).toContain(PLANNER_AI_PROMPT_VERSION);
    expect(input.instructions).toMatch(/maximize expected qualitative SEO impact/i); expect(input.instructions).toMatch(/untrusted data/i); expect(input.instructions).toMatch(/never claim measured time/i);
    expect(input.input).toEqual({ snapshot: source, snapshotHash: snapshotHash(source), weeklyBudgetMinutes: 420 });
    expect(payload.text.format).toMatchObject({ name: "planner_muse_schedule", strict: true, schema: { type: "object", additionalProperties: false, properties: { schemaVersion: { const: PLANNER_AI_SCHEMA_VERSION } } } });
    expect(payload.instructions).toBe(PLANNER_AI_INSTRUCTIONS); expect(payload.max_output_tokens).toBe(8000);
    expect(JSON.stringify(input)).not.toMatch(/MODEL_API_KEY|AI_USAGE_DB|Bearer /);
  });
});
