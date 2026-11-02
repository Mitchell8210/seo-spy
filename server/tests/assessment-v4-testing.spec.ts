import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { AssessmentStore } from "../src/modules/assessments/assessment.store.js";
import { AssessmentAnalysisService } from "../src/modules/assessments/assessment-analysis.service.js";
import { AssessmentTestingOperator } from "../src/modules/assessments/assessment-testing.operator.js";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { MUSE_TESTING_POLICY_HASH, testingMetadataSchema } from "../src/integrations/ai/muse-testing-ledger.js";
import { MetaMuseError, type MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import { assessmentMuseAnalysisSchema, assessmentMuseEvidenceSchema, type AssessmentMuseAnalysis, type OpportunityBundle, type TransparencyBundle } from "../src/integrations/assessment-ai/assessment-muse.types.js";
import { validateAssessmentMuseAnalysisOutput } from "../src/integrations/assessment-ai/assessment-muse.js";
import { prepareTransparencyAssessment } from "../src/integrations/assessment-ai/assessment-muse-transparency.js";
import { groupedOpportunityBaseline, opportunityId } from "../src/integrations/assessment-ai/assessment-muse-opportunities.js";

const frozen = assessmentMuseEvidenceSchema.parse(JSON.parse(readFileSync("tests/fixtures/muse-v4-guzman.json", "utf8")));
if (frozen.schemaVersion !== "seo-spy.assessment-muse-evidence.v4") throw new Error("Expected sanitized saved v4 fixture.");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const admin = "offline-v4-fixture-admin-".repeat(3);
const confirmed = (preview: { requestHash: string; inputHash: string; maximumMicros: number }) => ({ confirmed: true, requestHash: preview.requestHash, inputHash: preview.inputHash, maximumMicros: preview.maximumMicros });

describe.each(["v4", "v5"] as const)("%s testing operator, real protected pipeline with isolated mock transport only", version => {
  let directory: string, database: AppDatabase, ledger: AiUsageStore, store: AssessmentStore;
  let bundle: OpportunityBundle | TransparencyBundle, v3: Extract<ReturnType<typeof assessmentMuseEvidenceSchema.parse>, { schemaVersion: "seo-spy.assessment-muse-evidence.v3" }>;
  let service: AssessmentAnalysisService, testing: AssessmentTestingOperator, legacy: AssessmentTestingOperator;
  let post: ReturnType<typeof jest.fn<MetaMuseTransport["post"]>>, now: number;
  beforeEach(async () => {
    now = Date.parse("2026-11-02T02:00:00.000Z"); jest.spyOn(Date, "now").mockImplementation(() => now);
    directory = await mkdtemp(join(tmpdir(), "seo-spy-v4-operator-"));
    const config = new ConfigService({ NODE_ENV: "test", DATABASE_PATH: ":memory:", AI_USAGE_DB: join(directory, "usage.sqlite"), AI_ADMIN_KEY: admin,
      MODEL_API_KEY: "offline-fake-key-no-network", AI_DEV_BUDGET_MICROS: 0, MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false });
    database = new AppDatabase(config); store = new AssessmentStore(database); ledger = new AiUsageStore(config); await ledger.status();
    bundle = version === "v5" ? prepareTransparencyAssessment(structuredClone(frozen)) : structuredClone(frozen);
    const { opportunities: _opportunities, ...base } = frozen; void _opportunities;
    const parsedV3 = assessmentMuseEvidenceSchema.parse({ ...base, schemaVersion: "seo-spy.assessment-muse-evidence.v3", selectionVersion: "assessment-muse-selection-v3",
      businessContext: { ...base.businessContext, recommendations: groupedOpportunityBaseline(bundle.opportunities).map(id => bundle.opportunities.find(item => item.id === id)!.action) } });
    if (parsedV3.schemaVersion !== "seo-spy.assessment-muse-evidence.v3") throw new Error("Bad v3 fixture");
    v3 = parsedV3;
    database.connection().prepare("INSERT INTO businesses(id,created_at,data_json) VALUES(?,?,?)").run(bundle.businessId, bundle.cutoff, JSON.stringify({ id: bundle.businessId, name: "Saved fixture business", website: "https://example.com/", createdAt: bundle.cutoff }));
    service = {
      preparePocEvidence: jest.fn<AssessmentAnalysisService["preparePocEvidence"]>().mockImplementation(async (businessId, assessmentId) => {
        if (businessId !== bundle.businessId || assessmentId !== bundle.assessmentId || v3.schemaVersion !== "seo-spy.assessment-muse-evidence.v3") throw new Error("Wrong scope"); return v3;
      }),
      prepareV4TestingEvidence: jest.fn<AssessmentAnalysisService["prepareV4TestingEvidence"]>().mockImplementation(async (businessId, assessmentId) => {
        if (businessId !== bundle.businessId || assessmentId !== bundle.assessmentId || bundle.schemaVersion !== "seo-spy.assessment-muse-evidence.v4") throw new Error("Wrong scope"); return bundle;
      }),
      prepareV5TestingEvidence: jest.fn<AssessmentAnalysisService["prepareV5TestingEvidence"]>().mockImplementation(async (businessId, assessmentId) => {
        if (businessId !== bundle.businessId || assessmentId !== bundle.assessmentId || bundle.schemaVersion !== "seo-spy.assessment-muse-evidence.v5") throw new Error("Wrong scope"); return bundle;
      }),
      read: jest.fn<AssessmentAnalysisService["read"]>().mockImplementation(async (businessId, assessmentId, id) => {
        const saved = store.read("analysis", businessId, id) as Record<string, unknown>;
        const { createdAt: _createdAt, ...record } = saved; void _createdAt;
        const parsed = assessmentMuseAnalysisSchema.parse(record);
        if (parsed.businessId !== businessId || parsed.assessmentId !== assessmentId) throw new Error("Wrong ownership");
        validateAssessmentMuseAnalysisOutput(parsed, parsed.promptVersion.endsWith("-v3") ? v3 : bundle); return parsed;
      }),
    } as unknown as AssessmentAnalysisService;
    post = jest.fn<MetaMuseTransport["post"]>().mockResolvedValue(response({ schemaVersion: "assessment-muse-selection-output-v3", strengthIds: parsedV3.businessContext.facts.filter(item => item.kind === "strength").map(item => item.id), weaknessIds: parsedV3.businessContext.facts.filter(item => item.kind === "weakness").map(item => item.id), recommendationIds: parsedV3.businessContext.recommendations.map(item => item.id) }));
    legacy = new AssessmentTestingOperator(config, service, store, ledger, { post } as unknown as MetaMuseTransport, () => ledger.status());
    testing = new AssessmentTestingOperator(config, service, store, ledger, { post } as unknown as MetaMuseTransport, () => ledger.status(), version);
    // Preserve the same historical development baseline; all data is disposable.
    for (let index = 0; index < 4; index++) {
      const reserve = index === 0 ? 131460 : index === 3 ? 8196 : 6544;
      const intent = await ledger.estimate({ actor: "offline-history", scope: `history:${index}`, requestHash: hash(index), cacheKey: hash(index), mode: "poc", model: "muse-spark-1.3", maxInputTokens: 100, maxOutputTokens: 512, reserveMicros: reserve, priceVersion: "offline-fixture", reason: "Immutable isolated historical attempt fixture." });
      await ledger.approve(intent.id, "offline-history"); const attempt = await ledger.reserve(intent.id, { actor: intent.actor, requestHash: intent.requestHash, mode: "poc" });
      await ledger.settle(attempt.id, index === 3 ? { status: "success", inputTokens: 10, outputTokens: 105, actualMicros: 460 } : { status: "failed", errorCode: "AI_PROVIDER_FAILED" }); now += 61000;
    }
    await expect(ledger.estimate({ actor: "offline-history", scope: "reduce", requestHash: hash("reduce"), cacheKey: hash("reduce"), mode: "poc", model: "muse-spark-1.3", maxInputTokens: 100, maxOutputTokens: 512, reserveMicros: 6544, priceVersion: "offline-fixture", reason: "Preserve narrowed historical limits." }, { budgetMicros: 152744, dailyMicros: 152744, maxCalls: 4 })).rejects.toBeDefined();
  });
  afterEach(async () => { jest.restoreAllMocks(); database.close(); ledger.onModuleDestroy(); await rm(directory, { recursive: true }); });
  function response(output: unknown) {
    return { status: 200, requestId: "offline-v4-response", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3", usage: { input_tokens: 1000, output_tokens: 100, output_tokens_details: { reasoning_tokens: 40 } }, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) };
  }
  const selection = (ids: string[]) => version === "v4" ? { schemaVersion: "assessment-muse-selection-output-v4", opportunityIds: ids } : {
    schemaVersion: "assessment-muse-selection-output-v5",
    selected: ids.map(id => ({ id, reason: id === opportunityId("consistency") ? "RESOLVE_CUSTOMER_INFORMATION" : bundle.opportunities.find(item => item.id === id)?.kind === "conditional-review" ? "VERIFY_RECORDED_FLAG" : "ADDRESS_CONFIRMED_SHORTFALL" })),
    omitted: (bundle as TransparencyBundle).reviewIfOmittedIds.filter(id => !ids.includes(id)).map(id => ({ id, reason: ids.length ? "HIGHER_PRIORITY_ELSEWHERE" : "CONTEXT_BEFORE_PRIORITIZING" })),
  };
  async function activateAndUseHistoricalV3() {
    const preview = await legacy.previewTesting(bundle.businessId, bundle.assessmentId), exact = confirmed(preview);
    await legacy.activate(bundle.businessId, bundle.assessmentId, admin, { ...exact, policyHash: MUSE_TESTING_POLICY_HASH });
    const approval = await legacy.approveTesting(bundle.businessId, bundle.assessmentId, admin, { ...exact, authorizeOneRequest: true, reason: "Offline historical v3 fixture, no actual network." });
    const result = await legacy.executeTesting(bundle.businessId, bundle.assessmentId, admin, approval.intentId, { ...exact, poc: true });
    expect(result).toMatchObject({ receipt: { persisted: true } }); now += 61000; post.mockClear();
  }
  async function approveV4() {
    const preview = await testing.previewTesting(bundle.businessId, bundle.assessmentId);
    const exact = confirmed(preview);
    const approval = await testing.approveTesting(bundle.businessId, bundle.assessmentId, admin, { ...exact, authorizeOneRequest: true, reason: "Offline controlled v4 response fixture only." });
    return { preview, exact, approval };
  }
  it("previews without authorization and cannot activate or borrow exhausted development capacity", async () => {
    const before = await ledger.status(), preview = await testing.previewTesting(bundle.businessId, bundle.assessmentId);
    expect(preview).toMatchObject({ selectionVersion: version, noAuthorizationOrReservationCreated: true, gates: { singleUseApproval: false, allLiveGatesSatisfied: false } });
    expect(preview.allowedSelections.opportunities).toHaveLength(8);
    expect(preview.evaluation?.baselineIds).toEqual(groupedOpportunityBaseline(bundle.opportunities));
    await expect(testing.activate(bundle.businessId, bundle.assessmentId, admin, { ...confirmed(preview), policyHash: MUSE_TESTING_POLICY_HASH })).rejects.toBeDefined();
    await expect(approveV4()).rejects.toBeDefined();
    expect(await ledger.status()).toEqual(before); expect(post).not.toHaveBeenCalled();
  });
  it.each([[], ["loading"], ["consistency", "loading"], ["posting", "loading", "consistency"], ["text-readability", "touch-controls", "keyboard-navigation"]].map(groups => ({ groups })))("persists selected order $groups and reuses cache without another call", async ({ groups }) => {
    await activateAndUseHistoricalV3(); const before = await ledger.status();
    post.mockResolvedValue(response(selection(groups.map(opportunityId))));
    const { preview, exact, approval } = await approveV4();
    expect(preview.testingCapacity?.callsUsed).toBe(1);
    const result = await testing.executeTesting(bundle.businessId, bundle.assessmentId, admin, approval.intentId, { ...exact, poc: true });
    expect(result).toMatchObject({ receipt: { persisted: true, schemaValid: true, idsValid: true, selectionVersion: `assessment-muse-selection-output-${version}`, selectedIds: { strengths: [], weaknesses: [], recommendations: groups.map(opportunityId) } } });
    if (version === "v5") {
      expect(result).toMatchObject({ receipt: { decisionLabels: selection(groups.map(opportunityId)) }, analysis: { decisionLabels: selection(groups.map(opportunityId)) } });
      expect((await ledger.testingReceipts())[1].decisionLabels).toEqual(selection(groups.map(opportunityId)));
    }
    const analysis = result.analysis as AssessmentMuseAnalysis;
    expect(analysis.output.recommendations.map(item => item.id)).toEqual(groups.map(opportunityId));
    expect(analysis.output.schemaVersion).toBe("assessment-muse-output-v4");
    if (groups.length) expect(analysis.output.summary).toContain(bundle.opportunities.find(item => item.id === opportunityId(groups[0]))!.action.title);
    else expect(analysis.output.summary).toContain("No improvement opportunities were selected");
    const replay = await testing.executeTesting(bundle.businessId, bundle.assessmentId, admin, approval.intentId, { ...exact, poc: true });
    expect(replay).toMatchObject({ cacheHit: true, modelDispatches: 0, providerCostMicros: 0 }); expect(post).toHaveBeenCalledTimes(1);
    const after = await ledger.status(); expect(after.development).toEqual(before.development); expect(after.demo).toEqual(before.demo);
    expect(after.recentAttempts.slice(1)).toEqual(before.recentAttempts);
    expect((await ledger.testingReceipts())[0].selectionVersion).toBeUndefined(); // Historical receipt untouched.
    expect(JSON.parse(post.mock.calls[0][0])).toMatchObject({ reasoning: { effort: "minimal" }, max_output_tokens: 1500, tools: [], store: false, stream: false, background: false });
    await expect(legacy.executeTesting(bundle.businessId, bundle.assessmentId, admin, approval.intentId, { ...exact, poc: true })).rejects.toBeDefined();
  });
  it.each(["ids", "duplicate", "schema", "score", "cross-business", "unsupported-evidence", "malformed", "incomplete", "http", "network", "persistence"])("rejects %s responses without publishing or retrying", async kind => {
    await activateAndUseHistoricalV3();
    const { exact, approval } = await approveV4();
    let output: unknown = selection([opportunityId("loading")]);
    if (kind === "ids") output = selection(["invented-id"]);
    if (kind === "duplicate") output = selection([opportunityId("loading"), opportunityId("loading")]);
    if (kind === "schema") output = { wrong: "schema" };
    if (kind === "score") output = { ...selection([]), score: 100 };
    if (kind === "cross-business") output = { ...selection([]), reportId: "foreign-business-report" };
    if (kind === "unsupported-evidence") output = { ...selection([]), evidenceRefs: [{ reportId: bundle.sources[0].reportId, evidenceId: "unverified-proof" }] };
    const reply = response(output);
    if (kind === "malformed") reply.body = "not-json";
    if (kind === "incomplete") { const body = JSON.parse(reply.body); body.status = "incomplete"; body.incomplete_details = { reason: "max_output_tokens" }; reply.body = JSON.stringify(body); }
    if (kind === "http") { reply.status = 400; reply.body = ""; }
    post.mockImplementation(async () => { if (kind === "network") throw new MetaMuseError("AI_NETWORK_ERROR", "Offline network failure."); return reply; });
    if (kind === "persistence") jest.spyOn(store, "write").mockImplementation(() => { throw new Error("Offline publication failure."); });
    const result = await testing.executeTesting(bundle.businessId, bundle.assessmentId, admin, approval.intentId, { ...exact, poc: true });
    expect(result).toMatchObject({ receipt: { persisted: false, selectionVersion: `assessment-muse-selection-output-${version}` } });
    expect("receipt" in result && result.receipt?.failureCategory).toBeTruthy();
    expect(store.list("analysis", bundle.businessId)).toHaveLength(1); // Only seeded historical v3.
    await expect(testing.executeTesting(bundle.businessId, bundle.assessmentId, admin, approval.intentId, { ...exact, poc: true })).rejects.toBeDefined();
    expect(post).toHaveBeenCalledTimes(1);
  });
  it.each(["duplicate-group", "unsupported-proof", "cross-business-source"])("rejects %s candidate provenance before authorization", async kind => {
    await activateAndUseHistoricalV3(); const before = await ledger.status();
    if (kind === "duplicate-group") bundle.opportunities[1].group = bundle.opportunities[0].group;
    if (kind === "unsupported-proof") bundle.opportunities[0].action.evidenceRefs[0].evidenceId = "unsupported";
    if (kind === "cross-business-source") bundle.opportunities[0].action.evidenceRefs[0].reportId = "foreign-business";
    await expect(testing.previewTesting(bundle.businessId, bundle.assessmentId)).rejects.toBeDefined();
    expect(await ledger.status()).toEqual(before); expect(post).not.toHaveBeenCalled();
  });
  it.each(["credential", "request", "input", "cost", "confirmed"])("requires separate exact v4 approval: %s", async kind => {
    await activateAndUseHistoricalV3(); const before = await ledger.status(), preview = await testing.previewTesting(bundle.businessId, bundle.assessmentId), exact = confirmed(preview);
    if (kind === "request") exact.requestHash = "f".repeat(64);
    if (kind === "input") exact.inputHash = "f".repeat(64);
    if (kind === "cost") exact.maximumMicros--;
    if (kind === "confirmed") exact.confirmed = false;
    await expect(testing.approveTesting(bundle.businessId, bundle.assessmentId, kind === "credential" ? "wrong" : admin, { ...exact, authorizeOneRequest: true, reason: "Offline rejected approval fixture." })).rejects.toBeDefined();
    expect(await ledger.status()).toEqual(before); expect(post).not.toHaveBeenCalled();
  });
  it("versions new metadata without rewriting or relaxing legacy metadata", () => {
    const common = { assessmentId: bundle.assessmentId, businessId: bundle.businessId, inputHash: hash(1), sourceManifestHash: hash(2), analysisCacheKey: hash(3) };
    expect(testingMetadataSchema.parse({ ...common, reasoning: "low", promptVersion: "assessment-muse-prompt-v3", outputSchemaVersion: "assessment-muse-output-v3" })).toMatchObject({ reasoning: "low" });
    expect(() => testingMetadataSchema.parse({ ...common, reasoning: "low", promptVersion: "assessment-muse-prompt-v4", outputSchemaVersion: "assessment-muse-output-v4" })).toThrow();
    expect(() => testingMetadataSchema.parse({ ...common, reasoning: "minimal", promptVersion: "assessment-muse-prompt-v3", outputSchemaVersion: "assessment-muse-output-v4" })).toThrow();
    const v5 = { ...common, reasoning: "minimal", promptVersion: "assessment-muse-prompt-v5", outputSchemaVersion: "assessment-muse-output-v4", selectionSchemaVersion: "assessment-muse-selection-output-v5" };
    expect(testingMetadataSchema.parse(v5)).toEqual(v5);
    for (const mutation of [{ reasoning: "low" }, { selectionSchemaVersion: undefined }, { promptVersion: "assessment-muse-prompt-v4" }, { outputSchemaVersion: "assessment-muse-output-v3" }])
      expect(() => testingMetadataSchema.parse({ ...v5, ...mutation })).toThrow();
  });
  if (version === "v5") {
    it.each(["conditional-confirmed", "information-premise", "missing-omission", "omission-premise", "invented-omission", "extra-prose"])("rejects invalid v5 label %s without retaining labels, publishing or retrying", async kind => {
      await activateAndUseHistoricalV3();
      const { exact, approval } = await approveV4();
      const output = selection([opportunityId("posting")]) as { selected: { id: string; reason: string }[]; omitted: { id: string; reason: string }[]; explanation?: string };
      if (kind === "conditional-confirmed") output.selected = [{ id: opportunityId("text-readability"), reason: "ADDRESS_CONFIRMED_SHORTFALL" }];
      if (kind === "information-premise") output.selected[0].reason = "RESOLVE_CUSTOMER_INFORMATION";
      if (kind === "missing-omission") output.omitted = [];
      if (kind === "omission-premise") output.omitted.forEach(row => { row.reason = "FOCUS_CONFIRMED_SHORTFALLS"; }); // Loading is confirmed.
      if (kind === "invented-omission") output.omitted[0].id = "o_0000000000000000";
      if (kind === "extra-prose") output.explanation = "Unsupported free-form claim";
      post.mockResolvedValue(response(output));
      const result = await testing.executeTesting(bundle.businessId, bundle.assessmentId, admin, approval.intentId, { ...exact, poc: true });
      expect(result).toMatchObject({ receipt: { persisted: false, idsValid: false } });
      expect("receipt" in result && result.receipt).not.toHaveProperty("decisionLabels");
      expect(store.list("analysis", bundle.businessId)).toHaveLength(1);
      await expect(testing.executeTesting(bundle.businessId, bundle.assessmentId, admin, approval.intentId, { ...exact, poc: true })).rejects.toBeDefined();
      expect(post).toHaveBeenCalledTimes(1);
    });
  }
});
