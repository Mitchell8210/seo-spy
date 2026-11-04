import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AssessmentMuseAdapter, buildMockAssessmentMuseOutput, prepareAssessmentMuseEvidence, validateAssessmentMuseOutput } from "../src/integrations/assessment-ai/assessment-muse.js";
import { assessmentMuseEvidenceSchema, type OpportunityBundle } from "../src/integrations/assessment-ai/assessment-muse.types.js";
import { expandOpportunitySelection, groupedOpportunityBaseline, opportunityId, opportunityProjection, prepareOpportunityAssessment } from "../src/integrations/assessment-ai/assessment-muse-opportunities.js";
import { syntheticOpportunityBundle, type SyntheticOpportunityScenario } from "../src/integrations/assessment-ai/fixtures/opportunity-scenarios.js";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { MetaMuseProvider, type MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import type { AuditReportRecord } from "../src/reports/report.types.js";
import type { ScoreSnapshot } from "../src/scoring/scoring.types.js";

const saved = assessmentMuseEvidenceSchema.parse(JSON.parse(readFileSync("tests/fixtures/muse-v4-guzman.json", "utf8")));
if (saved.schemaVersion !== "seo-spy.assessment-muse-evidence.v4") throw new Error("Wrong frozen fixture version.");
const actual = saved;
const definitions = JSON.parse(readFileSync("tests/fixtures/muse-v4-scenarios.json", "utf8")) as SyntheticOpportunityScenario[];
const scenarios: [string, OpportunityBundle][] = [["actual Guzman saved evidence", actual], ...definitions.map(item => [item.id, syntheticOpportunityBundle(item)] as [string, OpportunityBundle])];
const selection = (opportunityIds: string[]) => ({ schemaVersion: "assessment-muse-selection-output-v4", opportunityIds });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const config = () => new ConfigService({ MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false, AI_DEV_BUDGET_MICROS: 0 });
const denied = () => { throw new Error("No provider or ledger use in mock checks."); };
const adapter = () => new AssessmentMuseAdapter(config(), { generate: denied, estimate: denied } as unknown as MetaMuseProvider);

describe("Muse v4 opportunity contracts (offline fixtures, not Muse reasoning quality)", () => {
  it("has eight real groups, seven grouped synthetic tradeoffs and one sparse verification task", () => {
    expect(scenarios.map(([, bundle]) => bundle.opportunities.length)).toEqual([8, 7, 1]);
    expect(actual.opportunities.filter(item => item.kind === "confirmed").map(item => item.group).sort()).toEqual(["loading", "posting"]);
    expect(actual.opportunities.filter(item => item.group === "loading")).toHaveLength(1);
    expect(definitions[0].candidates).toHaveLength(8); // Two loading symptoms become one group.
    const tradeoffs = scenarios[1][1];
    expect(groupedOpportunityBaseline(tradeoffs.opportunities)).toEqual(["contact-route", "customer-responses", "indexing-intent"].map(opportunityId));
    expect(scenarios[2][1].opportunities[0].kind).toBe("conditional-review");
  });
  it.each(scenarios)("preserves safe backend outputs and all mandatory context: %s", async (_name, bundle) => {
    const before = hash(bundle), result = await adapter().analyze(bundle);
    expect(result).toMatchObject({ promptVersion: "assessment-muse-prompt-v4", fixtureVersion: "assessment-muse-fixture-v4", outputSchemaVersion: "assessment-muse-output-v4", isMock: true, usage: { inputTokens: 0, outputTokens: 0 } });
    expect(result.output.recommendations.map(item => item.id)).toEqual(groupedOpportunityBaseline(bundle.opportunities));
    expect(result.output.schemaVersion).toBe("assessment-muse-output-v4");
    if (result.output.schemaVersion !== "assessment-muse-output-v4") throw new Error("Wrong output version");
    expect(result.output.measurementGaps).toEqual(bundle.scoringContext.measurementGaps);
    expect(result.output.limitations.join(" ")).toMatch(/Small audiences.*unavailable|Small audiences.*Unavailable/);
    expect(result.output.limitations.join(" ")).toMatch(/Source disagreements do not establish which source is correct/);
    for (const gap of bundle.scoringContext.measurementGaps) expect(result.output.limitations).toContain(gap.explanation);
    expect(hash(bundle)).toBe(before);
    expect(adapter().validateRecord(bundle, result)).toEqual(result);
  });
  it.each([0, 1, 2, 3])("accepts exactly %i selected opportunities without forcing source coverage", count => {
    const ids = actual.opportunities.filter(item => item.action.origin.category === "website").slice(0, count).map(item => item.id);
    const output = expandOpportunitySelection(selection(ids), actual, true);
    expect(output.recommendations).toHaveLength(count);
    expect(validateAssessmentMuseOutput(output, actual)).toEqual(output);
    expect(output.summary).not.toMatch(/loading.*first/i);
    if (count === 0) expect(output.summary).toMatch(/No improvement opportunities were selected/);
    else expect(output.summary).toContain(actual.opportunities.find(item => item.id === ids[0])!.action.title);
  });
  it("supports a genuine empty eligible pool and never pads sparse missing measurements", () => {
    const sparse = scenarios[2][1];
    expect(buildMockAssessmentMuseOutput(sparse).recommendations).toHaveLength(1);
    const empty = syntheticOpportunityBundle({ ...definitions[1], candidates: [] });
    const output = buildMockAssessmentMuseOutput(empty);
    expect(output.recommendations).toEqual([]);
    expect(output.summaryEvidenceRefs).toEqual([]);
    expect(output.limitations.join(" ")).toMatch(/Posting history inaccessible/);
    expect(output.limitations.join(" ")).toMatch(/ten followers.*two measured LIKE actions/);
    expect(opportunityProjection(empty).context.join(" ")).toMatch(/ten followers/);
  });
  it.each([
    ["contact-route", "customer-responses", "indexing-intent"],
    ["customer-responses", "contact-route", "loading"],
    ["contact-route", "customer-responses", "loading"],
  ])("allows predeclared defensible tradeoff order %j without treating novelty as better", (...groups) => {
    const bundle = scenarios[1][1];
    const output = expandOpportunitySelection(selection(groups.map(opportunityId)), bundle, true);
    expect(output.recommendations.map(item => item.id)).toEqual(groups.map(opportunityId));
    expect(validateAssessmentMuseOutput(output, bundle)).toEqual(output);
  });
  it.each(scenarios)("maps fixed response fixtures consistently across five candidate permutations: %s", (_name, bundle) => {
    const baseline = groupedOpportunityBaseline(bundle.opportunities), expected = expandOpportunitySelection(selection(baseline), bundle, true);
    for (let index = 0; index < 5; index++) {
      const copy = structuredClone(bundle), cut = index % Math.max(1, copy.opportunities.length);
      copy.opportunities = [...copy.opportunities.slice(cut), ...copy.opportunities.slice(0, cut)];
      if (index % 2) copy.opportunities.reverse();
      expect(groupedOpportunityBaseline(copy.opportunities)).toEqual(baseline);
      expect(expandOpportunitySelection(selection(baseline), copy, true)).toEqual(expected);
    }
    // Fixture invariance is not evidence of real model order insensitivity.
  });
  it.each([
    { schemaVersion: "assessment-muse-selection-output-v4", opportunityIds: ["invented"] },
    selection([actual.opportunities[0].id, actual.opportunities[0].id]),
    selection(actual.opportunities.slice(0, 4).map(item => item.id)),
    { ...selection([]), score: 100 },
    { ...selection([]), edits: [] },
    { ...selection([]), recommendation: "Missing growth proves failure." },
    { schemaVersion: "assessment-muse-selection-output-v3", opportunityIds: [] },
  ])("rejects invalid, duplicated or unsupported selection fields %#", value => {
    expect(() => expandOpportunitySelection(value, actual)).toThrow();
  });
  it("rejects duplicate issue groups before selection, even under different IDs", () => {
    const bundle = structuredClone(actual), duplicate = structuredClone(bundle.opportunities[0]);
    duplicate.id = opportunityId("different-id"); duplicate.action.id = duplicate.id;
    bundle.opportunities = [bundle.opportunities[0], duplicate];
    expect(() => expandOpportunitySelection(selection(bundle.opportunities.map(item => item.id)), bundle)).toThrow();
  });
  it.each(["report", "finding", "evidence", "origin", "category", "group"])("rejects wrong-source ownership changes: %s", part => {
    const bundle = structuredClone(actual), item = bundle.opportunities[0];
    if (part === "report") item.action.reportId = "other-business-report";
    if (part === "finding") item.action.findingId = "other-business-finding";
    if (part === "evidence") item.action.evidenceRefs[0].evidenceId = "other-business-proof";
    if (part === "origin") item.action.origin.sourceRefs = [{ reportId: "other-business-report", evidenceId: "proof" }];
    if (part === "category") item.action.origin.category = "social";
    if (part === "group") item.group = "invented";
    expect(() => adapter().prepare(bundle)).toThrow();
  });
  it("rejects missing-data-as-failure claims, omitted caveats, score changes and unsupported actions in materialized output", () => {
    const output = buildMockAssessmentMuseOutput(scenarios[2][1]);
    expect(() => validateAssessmentMuseOutput({ ...output, summary: "Unavailable growth establishes business failure." }, scenarios[2][1])).toThrow();
    expect(() => validateAssessmentMuseOutput({ ...output, limitations: ["No limits."] }, scenarios[2][1])).toThrow();
    expect(() => validateAssessmentMuseOutput({ ...output, score: 100 }, scenarios[2][1])).toThrow();
    expect(() => validateAssessmentMuseOutput({ ...output, recommendations: [{ ...output.recommendations[0], recommendation: "Automatically remove noindex and publish." }] }, scenarios[2][1])).toThrow();
  });
  it.each(scenarios)("keeps input, strict selection and full provider payload within limits: %s", (_name, bundle) => {
    const prepared = adapter().prepare(bundle), provider = new MetaMuseProvider(config(), {} as MetaMuseTransport, {} as AiUsageStore);
    const wire = provider.prepare(prepared.modelInput), payload = JSON.parse(wire.payload);
    expect(Buffer.byteLength(wire.payload)).toBeLessThan(32768);
    expect(payload).toMatchObject({ model: "muse-spark-1.3", reasoning: { effort: "minimal" }, max_output_tokens: 1500, tools: [], tool_choice: "auto", store: false, stream: false, background: false });
    expect(payload.text.format.schema.additionalProperties).toBe(false);
    expect(payload.text.format.schema.properties.opportunityIds.maxItems).toBe(3);
    expect(JSON.stringify(selection(groupedOpportunityBaseline(bundle.opportunities))).length).toBeLessThan(200);
    const projection = JSON.stringify(prepared.modelInput.input);
    expect(projection).not.toMatch(/priority_|reportId|evidenceId|executiveAssessment|scoringExplanation|overallContributions|deterministicBaseline/);
    expect(Buffer.byteLength(projection)).toBeLessThan(9000);
    expect(prepared.settings.reasoning).toBe("minimal");
  });
  it("fails closed on oversized prompts and preserves complete backend mapping in cache identity", () => {
    const tooSmall = new AssessmentMuseAdapter(new ConfigService({ MOCK_AI: true, AI_MAX_INPUT_BYTES: 4096 }), {} as MetaMuseProvider);
    expect(() => tooSmall.prepare(actual)).toThrow(/exceeded/);
    const altered = structuredClone(actual); altered.sources[0].contentHash = "f".repeat(64);
    expect(adapter().prepare(altered).cacheKey).not.toBe(adapter().prepare(actual).cacheKey);
    const { opportunities: _opportunities, ...v3Copy } = actual; void _opportunities;
    const v3 = assessmentMuseEvidenceSchema.parse({ ...v3Copy, schemaVersion: "seo-spy.assessment-muse-evidence.v3", selectionVersion: "assessment-muse-selection-v3" });
    expect(adapter().prepare(v3).cacheKey).not.toBe(adapter().prepare(actual).cacheKey);
  });
});

describe("v4 eligibility from saved check proofs (synthetic extraction fixtures)", () => {
  function fixture(status = "available") {
    const base = structuredClone(actual);
    base.businessContext.recommendations = [];
    const reportId = base.sources[0].reportId, auditId = reportId;
    const report = { reportId, auditId, audit: { id: auditId, scope: "lighthouse", businessId: base.businessId }, business: { id: base.businessId }, results: {
      findings: ["lighthouse:link-name", "lighthouse:crawlable-anchors", "lighthouse:color-contrast", "lighthouse:target-size", "lighthouse:skip-link", "image-alt"].map((checkId, index) => ({ id: `finding:${index}`, auditId, checkId, source: "website", status: "needs_review", severity: "low", evidenceIds: [`proof:${index}`] })),
      evidence: ["lighthouse:link-name", "lighthouse:crawlable-anchors", "lighthouse:color-contrast", "lighthouse:target-size", "lighthouse:skip-link", "image-alt"].map((checkId, index) => ({ id: `proof:${index}`, auditId, checkId, mode: "live", observed: { status, score: "0", emptyCount: "1" } })), recommendations: [],
    } } as unknown as AuditReportRecord;
    const { opportunities: _opportunities, ...v3Copy } = base; void _opportunities;
    const v3 = assessmentMuseEvidenceSchema.parse({ ...v3Copy, schemaVersion: "seo-spy.assessment-muse-evidence.v3", selectionVersion: "assessment-muse-selection-v3" });
    if (v3.schemaVersion !== "seo-spy.assessment-muse-evidence.v3") throw new Error("Bad fixture.");
    const snapshot = { scores: { website: { reasons: [] }, social: { reasons: [] }, consistency: { reasons: [] } } } as unknown as ScoreSnapshot;
    return { v3, snapshot, report };
  }
  it("extracts five groups from six usable check findings, keeping every audit review conditional", () => {
    const { v3, snapshot, report } = fixture();
    const result = prepareOpportunityAssessment(v3, snapshot, [report]);
    expect(result.opportunities).toHaveLength(5);
    expect(result.opportunities.every(item => item.kind === "conditional-review")).toBe(true);
    expect(result.opportunities.filter(item => item.group === "link-purpose")).toHaveLength(1);
    expect(result.opportunities.find(item => item.group === "image-alternatives")!.action.recommendation).toMatch(/Empty alternatives can be intentional/);
  });
  it.each(["missing", "unavailable", "unsupported", "error", "skipped", "stale"])("never extracts failures from %s measurements", status => {
    const { v3, snapshot, report } = fixture(status);
    expect(prepareOpportunityAssessment(v3, snapshot, [report]).opportunities).toEqual([]);
  });
  it("excludes stale measurements even when their check proof exists", () => {
    const { v3, snapshot, report } = fixture(); snapshot.scores.website.reasons = ["STALE_INPUT"];
    expect(prepareOpportunityAssessment(v3, snapshot, [report]).opportunities).toEqual([]);
  });
  it("rejects cross-business reports before constructing a v4 pool", () => {
    const { snapshot, report } = fixture(); report.business.id = "another-business";
    expect(() => prepareAssessmentMuseEvidence({ assessmentId: actual.assessmentId, businessId: actual.businessId, policyVersion: actual.policyVersion, cutoff: actual.cutoff, sources: [report], snapshot, scores: actual.scores, version: "v4" })).toThrow();
  });
  it("requires exact finding/evidence ownership and check-specific proof, not generic run metadata", () => {
    const { v3, snapshot, report } = fixture();
    report.results!.evidence[0].auditId = "wrong-audit";
    expect(() => prepareOpportunityAssessment(v3, snapshot, [report])).toThrow();
    report.results!.evidence[0].auditId = report.auditId;
    for (const proof of report.results!.evidence) proof.checkId = "lighthouse:report";
    expect(prepareOpportunityAssessment(v3, snapshot, [report]).opportunities).toEqual([]);
  });
});

describe("real provider pipeline with isolated mock transport and fake approvals only", () => {
  it.each(scenarios)("accepts a strict response fixture and never retries: %s", async (_name, bundle) => {
    const directory = await mkdtemp(join(tmpdir(), "muse-v4-offline-"));
    const settings = new ConfigService({ AI_MODE: "poc", MOCK_AI: false, AI_ENABLED: true, MODEL_API_KEY: "offline-fixture-not-a-real-key", AI_USAGE_DB: join(directory, "ledger.sqlite"), AI_REASONING_EFFORT: "low" });
    const ledger = new AiUsageStore(settings);
    const ids = groupedOpportunityBaseline(bundle.opportunities);
    const post = jest.fn<MetaMuseTransport["post"]>().mockResolvedValue({ status: 200, requestId: "offline-fixture", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3", usage: { input_tokens: 1000, output_tokens: 100 }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(selection(ids)) }] }] }) });
    try {
      const provider = new MetaMuseProvider(settings, { post } as unknown as MetaMuseTransport, ledger), muse = new AssessmentMuseAdapter(settings, provider);
      const prepared = muse.prepare(bundle);
      const intent = await provider.estimate(prepared.modelInput, { actor: "offline-fixture-admin", scope: `assessment:${bundle.businessId}:${bundle.assessmentId}`, reason: "Offline fixture transport in isolated temporary ledger only." });
      await ledger.approve(intent.id, "offline-fixture-admin");
      const result = await muse.analyze(bundle, { intentId: intent.id, actor: "offline-fixture-admin" });
      expect(post).toHaveBeenCalledTimes(1);
      expect(JSON.parse(post.mock.calls[0][0]).reasoning).toEqual({ effort: "minimal" });
      expect(result.output.recommendations.map(item => item.id)).toEqual(ids);
      await expect(muse.analyze(bundle, { intentId: intent.id, actor: "offline-fixture-admin" })).rejects.toBeDefined();
      expect(post).toHaveBeenCalledTimes(1);
    } finally { ledger.onModuleDestroy(); await rm(directory, { recursive: true }); }
  });
});
