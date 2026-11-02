import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AssessmentMuseAdapter, validateAssessmentMuseAnalysisOutput } from "../src/integrations/assessment-ai/assessment-muse.js";
import { assessmentMuseAnalysisSchema, assessmentMuseBrowserView, assessmentMuseEvidenceSchema, type TransparencyBundle, type TransparencySelection } from "../src/integrations/assessment-ai/assessment-muse.types.js";
import { buildTransparencyMock, expandTransparencySelection, prepareTransparencyAssessment, scrutinyIds, transparencyBase, transparencyInstructions, transparencyProjection, validateTransparencySelection } from "../src/integrations/assessment-ai/assessment-muse-transparency.js";
import { opportunityId, opportunityProjection } from "../src/integrations/assessment-ai/assessment-muse-opportunities.js";
import { syntheticOpportunityBundle, type SyntheticOpportunityScenario } from "../src/integrations/assessment-ai/fixtures/opportunity-scenarios.js";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { MetaMuseProvider, type MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";

const frozen = assessmentMuseEvidenceSchema.parse(JSON.parse(readFileSync("tests/fixtures/muse-v4-guzman.json", "utf8")));
if (frozen.schemaVersion !== "seo-spy.assessment-muse-evidence.v4") throw new Error("Wrong fixture version");
const definitions = JSON.parse(readFileSync("tests/fixtures/muse-v4-scenarios.json", "utf8")) as SyntheticOpportunityScenario[];
const actual = prepareTransparencyAssessment(frozen);
const scenarios: [string, TransparencyBundle][] = [["Guzman", actual], ...definitions.map(item => [item.id, prepareTransparencyAssessment(syntheticOpportunityBundle(item))] as [string, TransparencyBundle]), ["zero eligible", prepareTransparencyAssessment(syntheticOpportunityBundle({ ...definitions[1], candidates: [] }))]];
const denied = () => { throw new Error("No real provider or ledger operation in mock tests."); };
const config = () => new ConfigService({ MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false, AI_DEV_BUDGET_MICROS: 0 });
const adapter = () => new AssessmentMuseAdapter(config(), { generate: denied, estimate: denied } as unknown as MetaMuseProvider);
function fixture(bundle: TransparencyBundle, groups: string[]): TransparencySelection {
  const selected = groups.map(group => {
    const item = bundle.opportunities.find(item => item.group === group)!;
    return { id: item.id, reason: (["consistency", "contact-route", "identity-review", "hours-review"].includes(group) ? "RESOLVE_CUSTOMER_INFORMATION" : item.kind === "confirmed" ? "ADDRESS_CONFIRMED_SHORTFALL" : "VERIFY_RECORDED_FLAG") as TransparencySelection["selected"][number]["reason"] };
  });
  return { schemaVersion: "assessment-muse-selection-output-v5", selected, omitted: bundle.reviewIfOmittedIds.filter(id => !selected.some(row => row.id === id)).map(id => ({ id, reason: groups.length ? "HIGHER_PRIORITY_ELSEWHERE" : "CONTEXT_BEFORE_PRIORITIZING" })) };
}

describe("v5 decision transparency, bounded evidence-consistent labels only", () => {
  it.each([0, 1, 2, 3])("supports %i recommendations, full rendering and meaningful omissions", count => {
    const groups = ["loading", "posting", "consistency"].slice(0, count), decision = fixture(actual, groups);
    const output = expandTransparencySelection(decision, actual, true);
    expect(output.recommendations.map(item => item.id)).toEqual(groups.map(opportunityId));
    expect(decision.omitted).toHaveLength(count < 1 ? 2 : count < 3 ? 1 : 0);
    if (count) expect(output.summary).toContain(output.recommendations[0].title);
    else expect(output.summary).toContain("No improvement opportunities were selected");
    expect(output.scoringExplanation.text).toContain("Website 80/100");
    expect(output.limitations.join(" ")).toContain("Source disagreements do not establish which source is correct");
    expect(output.schemaVersion).toBe("assessment-muse-output-v4");
  });
  it("permits selecting only conditional tasks, including owner verification", () => {
    const decision = fixture(actual, ["consistency", "keyboard-navigation", "touch-controls"]);
    expect(validateTransparencySelection(decision, actual)).toEqual(decision);
    expect(expandTransparencySelection(decision, actual).recommendations).toHaveLength(3);
  });
  it.each(scenarios)("preserves compact candidate data and neutral scrutiny across five permutations: %s", async (_name, bundle) => {
    expect(transparencyProjection(bundle).opportunities).toEqual(opportunityProjection(transparencyBase(bundle)).opportunities);
    const expected = buildTransparencyMock(bundle);
    for (let index = 0; index < 5; index++) {
      const copy = structuredClone(bundle), cut = index % Math.max(1, copy.opportunities.length);
      copy.opportunities = [...copy.opportunities.slice(cut), ...copy.opportunities.slice(0, cut)];
      if (index % 2) copy.opportunities.reverse();
      expect(scrutinyIds(transparencyBase(copy))).toEqual(bundle.reviewIfOmittedIds);
      expect(validateTransparencySelection(expected, copy)).toEqual(expected);
      expect(buildTransparencyMock(copy)).toEqual(expected);
    }
    const analysis = await adapter().analyze(bundle);
    expect(analysis).toMatchObject({ promptVersion: "assessment-muse-prompt-v5", fixtureVersion: "assessment-muse-fixture-v5", outputSchemaVersion: "assessment-muse-output-v4", isMock: true, usage: { inputTokens: 0, outputTokens: 0 }, decisionLabels: expected });
    expect(adapter().validateRecord(bundle, analysis)).toEqual(analysis);
    expect(assessmentMuseBrowserView(analysis).output).toEqual(analysis.output);
    expect(assessmentMuseBrowserView(analysis)).not.toHaveProperty("decisionLabels");
  });
  it("allows sparse owner verification, abstention and an empty pool without padding", () => {
    const sparse = scenarios[2][1], empty = scenarios[3][1];
    expect(expandTransparencySelection(fixture(sparse, ["hours-review"]), sparse).recommendations).toHaveLength(1);
    expect(expandTransparencySelection(fixture(sparse, []), sparse).recommendations).toEqual([]);
    expect(expandTransparencySelection(fixture(empty, []), empty).recommendations).toEqual([]);
    expect(buildTransparencyMock(empty).omitted).toEqual([]);
  });
  it.each([
    { groups: ["contact-route", "customer-responses", "indexing-intent"] },
    { groups: ["customer-responses", "contact-route", "loading"] },
    { groups: ["identity-review", "indexing-intent"] },
  ])("allows competing-priority order $groups", ({ groups }) => {
    const trade = scenarios[1][1], out = expandTransparencySelection(fixture(trade, groups), trade);
    expect(out.recommendations.map(item => item.id)).toEqual(groups.map(opportunityId));
  });
  it.each(["conditional-confirmed", "wrong-information", "confirmed-flag", "invented", "duplicate", "missing-omission", "selected-omission", "duplicate-omission", "unrelated-omission", "quick-win", "missing-as-failure", "free-prose", "score", "four", "focus-confirmed-omission"])("rejects %s", kind => {
    const out = fixture(actual, ["loading", "posting"]);
    let value: unknown = out;
    if (kind === "conditional-confirmed") out.selected[0] = { id: opportunityId("consistency"), reason: "ADDRESS_CONFIRMED_SHORTFALL" };
    if (kind === "wrong-information") out.selected[0].reason = "RESOLVE_CUSTOMER_INFORMATION";
    if (kind === "confirmed-flag") out.selected[1].reason = "VERIFY_RECORDED_FLAG";
    if (kind === "invented") out.selected[0].id = "o_0000000000000000";
    if (kind === "duplicate") out.selected.push({ ...out.selected[0] });
    if (kind === "missing-omission") out.omitted = [];
    if (kind === "selected-omission") out.omitted[0].id = out.selected[0].id;
    if (kind === "duplicate-omission") out.omitted.push({ ...out.omitted[0] });
    if (kind === "unrelated-omission") out.omitted[0].id = opportunityId("image-alternatives");
    if (kind === "quick-win") value = { ...out, selected: [{ ...out.selected[0], reason: "QUICK_WIN" }] };
    if (kind === "missing-as-failure") value = { ...out, omitted: [{ ...out.omitted[0], reason: "MISSING_DATA_PROVES_FAILURE" }] };
    if (kind === "free-prose") value = { ...out, explanation: "Hours do not matter." };
    if (kind === "score") value = { ...out, score: 100 };
    if (kind === "four") value = fixture(actual, ["loading", "posting", "consistency", "touch-controls"]);
    if (kind === "focus-confirmed-omission") { value = fixture(actual, ["posting"]); (value as TransparencySelection).omitted.find(row => row.id === opportunityId("loading"))!.reason = "FOCUS_CONFIRMED_SHORTFALLS"; }
    expect(() => validateTransparencySelection(value, actual)).toThrow();
  });
  it.each(["focus-with-conditional", "relative-with-empty", "context-without-unknown"])("checks omission premise: %s", kind => {
    const bundle = structuredClone(actual);
    const decision = fixture(bundle, kind === "focus-with-conditional" ? ["keyboard-navigation"] : kind === "context-without-unknown" ? ["posting"] : []);
    if (kind === "focus-with-conditional") decision.omitted.find(row => row.id === opportunityId("consistency"))!.reason = "FOCUS_CONFIRMED_SHORTFALLS";
    if (kind === "relative-with-empty") decision.omitted[0].reason = "HIGHER_PRIORITY_ELSEWHERE";
    if (kind === "context-without-unknown") {
      const item = bundle.opportunities.find(item => item.group === "loading")!;
      item.action.effort = "small"; item.action.risk = "low";
      decision.omitted.find(row => row.id === item.id)!.reason = "CONTEXT_BEFORE_PRIORITIZING";
    }
    expect(() => validateTransparencySelection(decision, bundle)).toThrow();
  });
  it("never forces a selection when every available candidate has known effort and risk", () => {
    const base = transparencyBase(actual);
    base.opportunities = base.opportunities.filter(item => item.kind === "confirmed").map(item => ({ ...item, action: { ...item.action, effort: "small", risk: "low" } }));
    const bundle = prepareTransparencyAssessment(base), decision = fixture(bundle, []);
    expect(validateTransparencySelection(decision, bundle).selected).toEqual([]);
    expect(expandTransparencySelection(decision, bundle).recommendations).toEqual([]);
  });
  it("accepts supported focus labels without treating them as proof of good judgment", () => {
    const decision = fixture(actual, ["loading", "posting"]); decision.omitted[0].reason = "FOCUS_CONFIRMED_SHORTFALLS";
    expect(validateTransparencySelection(decision, actual)).toEqual(decision);
    expect(transparencyInstructions).toContain("self-reported decision bases");
    expect(transparencyInstructions).not.toContain("over cosmetic reviews");
    expect(transparencyInstructions).toContain("Conditional tasks need not receive priority");
  });
  it.each(["duplicate-group", "cross-source", "unowned-proof", "scrutiny-bias"])("rejects invalid backend input: %s", kind => {
    const bundle = structuredClone(actual);
    if (kind === "duplicate-group") bundle.opportunities[1].group = bundle.opportunities[0].group;
    if (kind === "cross-source") bundle.opportunities[0].action.evidenceRefs[0].reportId = "foreign-business";
    if (kind === "unowned-proof") bundle.opportunities[0].action.evidenceRefs[0].evidenceId = "unowned-proof";
    if (kind === "scrutiny-bias") bundle.reviewIfOmittedIds = [opportunityId("posting")];
    expect(() => adapter().prepare(bundle)).toThrow();
  });
  it("isolates v4/v5 caches and mock/live modes while preserving historical record shape", async () => {
    const mock = adapter(), v4 = await mock.analyze(frozen), v5 = await mock.analyze(actual);
    expect(v4.decisionLabels).toBeUndefined();
    expect(mock.prepare(frozen).cacheKey).not.toBe(mock.prepare(actual).cacheKey);
    const live = new AssessmentMuseAdapter(new ConfigService({ MOCK_AI: false, AI_MODE: "poc" }), {} as MetaMuseProvider);
    expect(live.prepare(actual).cacheKey).not.toBe(mock.prepare(actual).cacheKey);
    await expect(live.analyze(actual)).rejects.toMatchObject({ code: "AI_APPROVAL_REQUIRED" });
    expect(() => assessmentMuseAnalysisSchema.parse({ ...v4, decisionLabels: v5.decisionLabels })).toThrow();
    expect(() => assessmentMuseAnalysisSchema.parse({ ...v5, decisionLabels: undefined })).toThrow();
    const altered = structuredClone(v5); altered.decisionLabels!.selected.reverse();
    expect(() => mock.validateRecord(actual, altered)).toThrow();
    expect(() => validateAssessmentMuseAnalysisOutput(altered, actual)).toThrow();
  });
  it("keeps complete request bounded and the model/reasoning/output settings fixed", () => {
    const prepared = adapter().prepare(actual), provider = new MetaMuseProvider(config(), {} as MetaMuseTransport, {} as AiUsageStore);
    const wire = provider.prepare(prepared.modelInput), parsed = JSON.parse(wire.payload);
    expect(Buffer.byteLength(wire.payload)).toBeLessThan(13000);
    expect(parsed).toMatchObject({ model: "muse-spark-1.3", max_output_tokens: 1500, reasoning: { effort: "minimal" }, tools: [], store: false, stream: false, background: false });
    expect(parsed.text.format.schema.properties.selected.maxItems).toBe(3);
    expect(parsed.text.format.schema.properties.omitted.maxItems).toBe(2);
    expect(JSON.stringify(prepared.modelInput.input)).not.toContain("evidenceId");
  });
});

describe("v5 provider transport fixtures, no actual network or production ledger", () => {
  it.each(["valid", "invalid-reason"])("uses strict labels and renders selected order: %s", async kind => {
    const directory = await mkdtemp(join(tmpdir(), "muse-v5-fixture-"));
    const settings = new ConfigService({ AI_MODE: "poc", MOCK_AI: false, AI_ENABLED: true, MODEL_API_KEY: "offline-fake-key", AI_USAGE_DB: join(directory, "ledger.sqlite") });
    const ledger = new AiUsageStore(settings), decision = fixture(actual, ["posting", "loading"]);
    if (kind === "invalid-reason") decision.selected[0].reason = "VERIFY_RECORDED_FLAG";
    const post = jest.fn<MetaMuseTransport["post"]>().mockResolvedValue({ status: 200, requestId: "offline-fixture", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3", usage: { input_tokens: 1000, output_tokens: 150 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(decision) }] }] }) });
    try {
      const provider = new MetaMuseProvider(settings, { post } as unknown as MetaMuseTransport, ledger), muse = new AssessmentMuseAdapter(settings, provider);
      const prepared = muse.prepare(actual), actor = randomUUID();
      const intent = await provider.estimate(prepared.modelInput, { actor, scope: `assessment:${actual.businessId}:${actual.assessmentId}`, reason: "Isolated offline v5 fixture only." });
      await ledger.approve(intent.id, actor);
      if (kind === "invalid-reason") await expect(muse.analyze(actual, { intentId: intent.id, actor })).rejects.toBeDefined();
      else { const record = await muse.analyze(actual, { intentId: intent.id, actor }); expect(record.decisionLabels).toEqual(decision); expect(record.output.recommendations.map(item => item.id)).toEqual(decision.selected.map(item => item.id)); expect(record.output.summary.indexOf("Restart")).toBeLessThan(record.output.summary.indexOf("Investigate")); }
      expect(post).toHaveBeenCalledTimes(1);
    } finally { ledger.onModuleDestroy(); await rm(directory, { recursive: true }); }
  });
});
