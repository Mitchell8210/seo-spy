import { ConfigService } from "@nestjs/config";
import { jest } from "@jest/globals";
import { createHash } from "node:crypto";
import { MetaMuseProvider, type MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import type { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { museUsageCostMicros, MUSE_PRICE_VALID_UNTIL } from "../src/integrations/ai/muse-cost.js";
import { defaultAiSettings, makeAiSnapshot, offlineAiProposal, plannerMuseInput } from "../src/modules/smart-planner/planner-ai.domain.js";
import { parsePlannerMuseResponse, plannerMuseConfig, preparePlannerMuse } from "../src/modules/smart-planner/planner-muse.request.js";
import type { PlannerResponseDto } from "../src/modules/smart-planner/planner.dto.js";

const now = Date.parse("2026-11-02T08:00:00.000Z");
function snapshot(count = 1, guidance = "Review the saved issue") {
  const state: PlannerResponseDto = { businessId: "business-a", revision: 1,
    preferences: { useWeekends: false, dailyCapacityMinutes: 120, maxTasksPerDay: 3, horizonWeeks: 4, timeZone: "UTC" }, sources: [],
    tasks: Array.from({ length: count }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, taskKey: `fixture-${i}`, title: `Task ${i}`, explanation: "Saved issue", guidance,
      priority: "Medium", category: "Content", source: "Custom task", mode: "custom", status: "Needs Action", schedule: null, notes: null, destination: null, origin: null, completedAt: null,
      estimatedDurationMinutes: 60, durationEstimateSource: "default", scheduledBy: null })) };
  return makeAiSnapshot(state, structuredClone(defaultAiSettings), "2026-11-02", [], new Date(now));
}
const config = (values: Record<string, unknown> = {}) => plannerMuseConfig(new ConfigService({ PLANNER_MUSE_MAX_OUTPUT_TOKENS: 8000, ...values }));
function fixture(source = snapshot()) {
  const prepared = preparePlannerMuse(source, config(), now), output = offlineAiProposal(source);
  const body = { status: "completed", error: null, incomplete_details: null, model: prepared.model, usage: { input_tokens: 1000, output_tokens: 4000 },
    output: [{ type: "reasoning" }, { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(output) }] }] };
  return { prepared, output, body };
}
describe("isolated planner Muse request limits, pricing and Responses decoding", () => {
  let network: ReturnType<typeof jest.spyOn>;
  beforeEach(() => { network = jest.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("No network permitted"); }); });
  afterEach(() => { expect(fetch).not.toHaveBeenCalled(); network.mockRestore(); });
  it("reads only planner-prefixed configuration and never inherits other workflow limits", () => {
    expect(() => plannerMuseConfig(new ConfigService({ AI_MAX_OUTPUT_TOKENS: 8000 }))).toThrow(expect.objectContaining({ code: "AI_PLANNING_CONFIG_INVALID" }));
    const configured = config({ AI_MODEL: "other-model", AI_MAX_OUTPUT_TOKENS: 16, AI_MAX_INPUT_BYTES: 4096, AI_TIMEOUT_MS: 1, AI_DEV_BUDGET_MICROS: 1 });
    expect(configured).toEqual({ model: "muse-spark-1.3", maxOutputTokens: 8000, maxRequestBytes: 98304, timeoutMs: 90000, perGenerationMicros: 500000, allowanceCeilingMicros: 0 });
    expect(config({ PLANNER_MUSE_MODEL: "muse-spark-1.2", PLANNER_MUSE_MAX_OUTPUT_TOKENS: "12000", PLANNER_MUSE_TIMEOUT_MS: "45000" })).toMatchObject({ model: "muse-spark-1.2", maxOutputTokens: 12000, timeoutMs: 45000 });
  });
  it.each([
    { PLANNER_MUSE_MODEL: "muse-wonder-1.0" }, { PLANNER_MUSE_MODEL: "muse-spark-1.3-contributor" },
    { PLANNER_MUSE_MAX_OUTPUT_TOKENS: 16385 }, { PLANNER_MUSE_MAX_OUTPUT_TOKENS: "8000junk" }, { PLANNER_MUSE_MAX_OUTPUT_TOKENS: null },
    { PLANNER_MUSE_MAX_REQUEST_BYTES: 131073 }, { PLANNER_MUSE_TIMEOUT_MS: 999 }, { PLANNER_MUSE_TIMEOUT_MS: 120001 },
    { PLANNER_MUSE_PER_GENERATION_MICROS: -1 }, { PLANNER_MUSE_PER_GENERATION_MICROS: 1000001 }, { PLANNER_MUSE_ALLOWANCE_CEILING_MICROS: -1 },
  ])("rejects invalid isolated configuration %j", value => { expect(() => config(value)).toThrow(); });
  it("preserves prompt/schema versions, sets only scheduling wire limits, hashes exact request and full configuration", () => {
    const source = snapshot(), settings = config(), prepared = preparePlannerMuse(source, settings, now), wire = JSON.parse(prepared.payload) as Record<string, unknown>;
    expect(wire).toMatchObject({ model: "muse-spark-1.3", store: false, stream: false, background: false, max_output_tokens: 8000, tools: [], truncation: "disabled", reasoning: { effort: "minimal" }, text: { format: { name: "planner_muse_schedule", strict: true } } });
    expect(wire.instructions).toBe(plannerMuseInput(source).instructions);
    expect(prepared.requestHash).toBe(createHash("sha256").update(prepared.payload).digest("hex"));
    const timeoutChanged = preparePlannerMuse(source, { ...settings, timeoutMs: 45000 }, now);
    expect(timeoutChanged.requestHash).toBe(prepared.requestHash); expect(timeoutChanged.settingsHash).not.toBe(prepared.settingsHash);
    expect(prepared.maxInputTokens).toBe(Buffer.byteLength(prepared.payload) * 4 + 4096);
    expect(prepared.reserveMicros).toBe(museUsageCostMicros(prepared.maxInputTokens, 8000, prepared));
    expect(prepared.payload).not.toMatch(/MODEL_API_KEY|AI_USAGE_DB|Bearer /);
  });
  it("accepts larger feature requests while the existing provider retains its original limits", () => {
    const source = snapshot(28, "Review saved evidence. ".repeat(45)), prepared = preparePlannerMuse(source, config(), now);
    expect(Buffer.byteLength(prepared.payload)).toBeGreaterThan(32768);
    const legacy = new MetaMuseProvider(new ConfigService(), {} as MetaMuseTransport, {} as AiUsageStore);
    expect(() => legacy.prepare(plannerMuseInput(source))).toThrow();
    const small = legacy.prepare(plannerMuseInput(snapshot()));
    expect(small.maxOutputTokens).toBe(1500); expect(JSON.parse(small.payload).text.format.name).toBe("wordpress_analysis");
  });
  it.each([
    ["size", { maxRequestBytes: 8192 }, "AI_PLANNING_INPUT_LIMIT"],
    ["cost", { perGenerationMicros: 1 }, "AI_PLANNING_COST_LIMIT"],
    ["allowance ceiling", { allowanceCeilingMicros: 1 }, "AI_PLANNING_COST_LIMIT"],
  ] as const)("enforces %s before execution", (_name, overrides, code) => {
    expect(() => preparePlannerMuse(snapshot(15), { ...config(), ...overrides }, now)).toThrow(expect.objectContaining({ code }));
  });
  it("fails closed on expired or unavailable reviewed prices", () => {
    for (const date of [NaN, Date.parse("2026-10-30"), Date.parse(MUSE_PRICE_VALID_UNTIL)]) expect(() => preparePlannerMuse(snapshot(), config(), date)).toThrow(expect.objectContaining({ code: "AI_PLANNING_PRICING_UNAVAILABLE" }));
  });
  it("parses a larger valid response within scheduling caps, independently of the legacy 1500-token limit", () => {
    const { prepared, output, body } = fixture(snapshot(20));
    expect(Buffer.byteLength(JSON.stringify(output))).toBeGreaterThan(8000);
    expect(parsePlannerMuseResponse({ status: 200, body: JSON.stringify(body), requestId: "fixture" }, prepared)).toEqual({ output, model: prepared.model });
  });
  it.each(["incomplete", "failed", "queued", "in_progress", "cancelled"])("rejects response status %s", status => {
    const { prepared, body } = fixture(); body.status = status;
    expect(() => parsePlannerMuseResponse({ status: 200, body: JSON.stringify(body), requestId: null }, prepared)).toThrow(expect.objectContaining({ code: "AI_PLANNING_RESPONSE_INCOMPLETE" }));
  });
  it.each([
    ["missing usage", (body: Record<string, unknown>) => { delete body.usage; }],
    ["wrong model", (body: Record<string, unknown>) => { body.model = "unrequested-model"; }],
    ["refusal", (body: Record<string, unknown>) => { body.output = [{ type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "No" }] }]; }],
    ["tool call", (body: Record<string, unknown>) => { body.output = [{ type: "function_call" }]; }],
    ["truncated JSON", (body: Record<string, unknown>) => { body.output = [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "{\"schemaVersion\":" }] }]; }],
    ["invalid proposal", (body: Record<string, unknown>) => { body.output = [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "{}" }] }]; }],
  ] as const)("rejects %s without accepting a proposal", (_name, edit) => {
    const { prepared, body } = fixture(); edit(body);
    expect(() => parsePlannerMuseResponse({ status: 200, body: JSON.stringify(body), requestId: null }, prepared)).toThrow(expect.objectContaining({ code: "AI_PLANNING_RESPONSE_INVALID" }));
  });
  it("rejects provider errors, oversized bodies, bad JSON and token overruns", () => {
    const { prepared, body } = fixture();
    expect(() => parsePlannerMuseResponse({ status: 400, body: "not logged", requestId: null }, prepared)).toThrow(expect.objectContaining({ code: "AI_PLANNING_PROVIDER_REJECTED" }));
    expect(() => parsePlannerMuseResponse({ status: 200, body: "x".repeat(512 * 1024 + 1), requestId: null }, prepared)).toThrow(expect.objectContaining({ code: "AI_PLANNING_OUTPUT_LIMIT" }));
    expect(() => parsePlannerMuseResponse({ status: 200, body: "{", requestId: null }, prepared)).toThrow(expect.objectContaining({ code: "AI_PLANNING_RESPONSE_INVALID" }));
    body.usage.output_tokens = prepared.maxOutputTokens + 1;
    expect(() => parsePlannerMuseResponse({ status: 200, body: JSON.stringify(body), requestId: null }, prepared)).toThrow(expect.objectContaining({ code: "AI_PLANNING_USAGE_LIMIT" }));
  });
});
