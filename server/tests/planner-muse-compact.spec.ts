import { ConfigService } from "@nestjs/config";
import { MetaMuseProvider, type MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import type { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { computeWorkloads, defaultAiSettings, makeAiSnapshot, offlineAiProposal, validateAiProposal, type AiSnapshot } from "../src/modules/smart-planner/planner-ai.domain.js";
import { compactPlannerMuseInput, expandCompactPlan, PLANNER_COMPACT_PROMPT_VERSION } from "../src/modules/smart-planner/planner-muse.compact.js";
import type { PlannerResponseDto } from "../src/modules/smart-planner/planner.dto.js";
import { compactPlannerFixture } from "./fixtures/planner-compact-response.js";

function snapshot(count = 23): AiSnapshot {
  const state: PlannerResponseDto = { businessId: "business-a", revision: 7, preferences: { useWeekends: false, dailyCapacityMinutes: 120, maxTasksPerDay: 3, horizonWeeks: 4, timeZone: "UTC" }, sources: [],
    tasks: Array.from({ length: count }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, taskKey: `fixture-${i}`, title: `Saved SEO task ${i}`, explanation: "Saved bounded evidence", guidance: "Review saved guidance and test the change.", category: "Search", priority: i % 3 === 0 ? "Urgent" : "Medium", source: "Website", mode: "saved", status: "Needs Action", estimatedDurationMinutes: 60, durationEstimateSource: "user", scheduledBy: null, schedule: null, notes: null, destination: null, origin: null, completedAt: null })) };
  return makeAiSnapshot(state, structuredClone(defaultAiSettings), "2026-11-09", [], new Date("2026-11-02T10:00:00Z"), "all");
}
describe("compact Muse schedule transport preserves the full reviewed proposal", () => {
  it("reduces the failing 23-task response shape without changing provider limits or active state", () => {
    const source = snapshot(), before = structuredClone(source), full = offlineAiProposal(source), compact = compactPlannerFixture(source, full), expanded = expandCompactPlan(source, compact);
    expect(compact.rows).toHaveLength(23);
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(5000); // Bytes, not a claimed model token measurement.
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(Buffer.byteLength(JSON.stringify(full)) / 3);
    expect(expanded.entries.map(entry => ({ id: entry.taskId, start: entry.proposedStart, end: entry.proposedEnd, duration: entry.estimatedMinutes })))
      .toEqual(full.entries.map(entry => ({ id: entry.taskId, start: entry.proposedStart, end: entry.proposedEnd, duration: entry.estimatedMinutes })));
    expect(expanded.weeklyWorkloads).toEqual(computeWorkloads(source, expanded.entries));
    expect(validateAiProposal(source, expanded).valid).toBe(true); expect(source).toEqual(before);
    const provider = new MetaMuseProvider(new ConfigService(), {} as MetaMuseTransport, {} as AiUsageStore);
    const request = provider.prepare(compactPlannerMuseInput(source));
    expect(request.maxOutputTokens).toBe(8000); expect(Buffer.byteLength(request.payload)).toBeLessThan(32768);
    expect(request.payload).toContain(PLANNER_COMPACT_PROMPT_VERSION);
  });
  it.each([
    ["missing row", (response: ReturnType<typeof compactPlannerFixture>) => { response.rows.pop(); }],
    ["duplicate row", (response: ReturnType<typeof compactPlannerFixture>) => { response.rows[1] = { ...response.rows[0] }; }],
    ["unknown task", (response: ReturnType<typeof compactPlannerFixture>) => { response.rows[0].taskRef = 59; }],
    ["invalid priority", (response: ReturnType<typeof compactPlannerFixture>) => { Object.assign(response.rows[0], { priority: -1 }); }],
    ["invalid impact", (response: ReturnType<typeof compactPlannerFixture>) => { Object.assign(response.rows[0], { impact: -1 }); }],
    ["unsupported effort", (response: ReturnType<typeof compactPlannerFixture>) => { response.rows[0].minutes = 45; }],
    ["out of horizon", (response: ReturnType<typeof compactPlannerFixture>) => { response.rows[0].start!.dayOffset = 28; }],
    ["invalid slot", (response: ReturnType<typeof compactPlannerFixture>) => { response.rows[0].start!.startSlot = 16; }],
    ["unknown reason", (response: ReturnType<typeof compactPlannerFixture>) => { response.rows[0].reasonRef = 5; }],
    ["partial deferral", (response: ReturnType<typeof compactPlannerFixture>) => { Object.assign(response.rows[0], { start: { dayOffset: 0 } }); }],
    ["invalid confidence", (response: ReturnType<typeof compactPlannerFixture>) => { response.impactConfidence = "Certain"; }],
    ["extra row fields", (response: ReturnType<typeof compactPlannerFixture>) => { Object.assign(response.rows[0], { extra: 1 }); }],
  ])("rejects %s rather than repairing or applying it", (_label, edit) => {
    const source = snapshot(3), response = compactPlannerFixture(source); edit(response);
    expect(() => expandCompactPlan(source, response)).toThrow(expect.objectContaining({ code: "AI_PLANNING_RESPONSE_INVALID" }));
  });
  it("keeps deferral explicit and maps only existing same-business prerequisite identities", () => {
    const source = snapshot(3), response = compactPlannerFixture(source);
    response.rows[1].start = null; response.rows[1].reasonRef = 1;
    response.dependencies = [{ task: response.rows[0].taskRef, required: [response.rows[1].taskRef], suggested: [] }];
    const expanded = expandCompactPlan(source, response);
    expect(expanded.entries[1].proposedStart).toBeNull(); expect(expanded.entries[1].deferredReason).toBe(response.reasons[1]);
    const validation = validateAiProposal(source, expanded);
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.diagnostics.some(item => item.code === "AI_DEPENDENCY_ORDER")).toBe(true);
    response.dependencies[0].required = [59]; expect(() => expandCompactPlan(source, response)).toThrow();
  });
  it("does not repair overlapping placements or accept incomplete JSON", () => {
    const source = snapshot(3), response = compactPlannerFixture(source);
    response.rows[1].start = { ...response.rows[0].start! };
    const expanded = expandCompactPlan(source, response), validation = validateAiProposal(source, expanded);
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.diagnostics.some(item => item.code === "AI_INTERVAL_OVERLAP")).toBe(true);
    expect(() => expandCompactPlan(source, { version: "planner-compact-v2" })).toThrow();
  });
  it("identifies invalid task coverage and row fields without retaining model text", () => {
    const source = snapshot(3), response = compactPlannerFixture(source);
    response.rows.pop();
    expect(() => expandCompactPlan(source, response)).toThrow(expect.objectContaining({ diagnostics: [{ code: "AI_RESPONSE_MISSING_TASKS", detail: expect.stringContaining("2 of 3") }] }));
    response.rows[0].minutes = 45;
    expect(() => expandCompactPlan(source, response)).toThrow(expect.objectContaining({ diagnostics: [{ code: "AI_RESPONSE_SCHEMA", detail: expect.stringContaining("minutes") }] }));
    const untrusted = { ...response, impactConfidence: "secret-provider-text", "private-property-token": "sensitive" };
    try { expandCompactPlan(source, untrusted); throw new Error("Expected rejection"); }
    catch (error) {
      expect(error).toMatchObject({ diagnostics: expect.arrayContaining([{ code: "AI_RESPONSE_SCHEMA", detail: "wire response: impactConfidence (invalid_value)." }]) });
      expect(JSON.stringify(error)).not.toMatch(/secret-provider-text|private-property-token|sensitive/);
    }
  });
  it("constrains priority in the advertised schema and rejects the observed -1 priority even for deferred work", () => {
    const source = snapshot(), input = compactPlannerMuseInput(source), response = compactPlannerFixture(source);
    const schema = input.schema as { properties: { rows: { minItems: number; maxItems: number; items: { type: string; properties: Record<string, { enum?: string[] }> } } } };
    expect(schema.properties.rows).toMatchObject({ minItems: 23, maxItems: 23, items: { type: "object" } });
    expect(schema.properties.rows.items.properties.priority.enum).toEqual(["Urgent", "Medium", "Low"]);
    expect(input.input.candidateRefs).toEqual(Array.from({ length: 23 }, (_, i) => i));
    response.rows[3].start = null;
    Object.assign(response.rows[3], { priority: -1 });
    expect(() => expandCompactPlan(source, response)).toThrow(expect.objectContaining({ diagnostics: [{ code: "AI_RESPONSE_SCHEMA", detail: "wire response: rows.[3].priority (invalid_value)." }] }));
    response.rows[3].priority = "Medium";
    const expanded = expandCompactPlan(source, response);
    expect(expanded.entries[3]).toMatchObject({ recommendedPriority: "Medium", proposedStart: null, proposedEnd: null });
    expect(validateAiProposal(source, expanded).valid).toBe(true);
  });
});
