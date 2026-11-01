import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import type { AuditReportRecord } from "../src/reports/report.types.js";
import { MetaMuseProvider } from "../src/integrations/ai/meta-muse.provider.js";
import { AssessmentMuseAdapter, buildMockAssessmentMuseOutput, prepareAssessmentMuseEvidence, validateAssessmentMuseOutput } from "../src/integrations/assessment-ai/assessment-muse.js";
import { assessmentMuseAnalysisSchema, type AssessmentMuseEvidenceBundle } from "../src/integrations/assessment-ai/assessment-muse.types.js";

const at = "2026-10-31T12:00:00.000Z";
function report(provider: "website" | "facebook" = "website", count = 2): AuditReportRecord {
  const auditId = randomUUID();
  const findings = Array.from({ length: count }, (_, index) => ({ id: `finding-${index}`, auditId, checkId: `${provider}:check-${index}`,
    evidenceIds: [`evidence-${index}`], severity: "medium" as const, source: provider, title: `Review source finding ${index}`, explanation: "Review existing evidence.", status: "needs_review" as const }));
  return {
    schemaVersion: "seo-spy.audit-report.v1", reportId: auditId, auditId, generatedAt: at,
    business: { id: "business", name: "Private business name is not needed in the prompt", website: "https://example.com/", createdAt: at },
    audit: { id: auditId, businessId: "business", scope: provider === "website" ? "homepage" : "facebook", mode: "live", status: "partial", stage: "complete", createdAt: at, startedAt: at, completedAt: at, warnings: [], failure: null, scoringVersion: "homepage-v1" },
    results: { findings,
      recommendations: findings.map(finding => ({ id: `recommendation-${finding.id}`, auditId, findingId: finding.id, title: "Review the saved finding", explanation: "Inspect the saved evidence first.", recommendedChange: "Review the exact target before deciding whether an edit is necessary.", purpose: "Help visitors.", status: "needs_review" })),
      evidence: findings.map((finding, index) => ({ id: `evidence-${index}`, auditId, checkId: finding.checkId, sourceUrl: "https://example.com/private?token=secret", collectedAt: at, observed: { html: "RAW_HTML_NOT_FOR_PROMPT", api_key: "SECRET_RAW_VALUE" }, mode: "live" })), scores: [],
      ...(provider === "facebook" ? { facebook: { provider: "facebook-graph", version: "facebook-v1", graphVersion: "v26.0", pageId: "123", pageName: "Private Facebook Page name", collectedAt: at,
        window: { since: at, until: at, requestedDays: 30 }, profile: {}, posts: { status: "unavailable", items: [], truncated: false, collectedAt: at }, metrics: [],
        summary: { followersStart: null, followersEnd: null, followersChange: null, latestPostAt: null, postsInWindow: null, postsInWindowComplete: false },
        coverage: { profileFieldsAvailable: 0, profileFieldsMissing: 0, profileFieldsUnavailable: 5, metricsAvailable: 0, metricsRequested: 0, postsLimit: 50 }, limitations: ["Partial coverage"] } as const } : {}),
    },
  };
}
function bundle(sources = [report(), report("facebook")]) {
  return prepareAssessmentMuseEvidence({ assessmentId: "11111111-1111-4111-8111-111111111111", businessId: "business", policyVersion: "seo-spy-v1", cutoff: at,
    scores: [{ category: "website", value: 72, reasonCodes: [] }, { category: "overall", value: null, reasonCodes: ["MISSING_EVIDENCE"] }], sources });
}
function setup(settings: Record<string, unknown> = {}) {
  const generate = jest.fn<MetaMuseProvider["generate"]>();
  const estimate = jest.fn<MetaMuseProvider["estimate"]>();
  const adapter = new AssessmentMuseAdapter(new ConfigService(settings), { generate, estimate } as unknown as MetaMuseProvider);
  return { adapter, generate, estimate };
}

describe("saved assessment Muse evidence boundary", () => {
  it("selects both saved channels, records immutable hashes and excludes private/raw fields", () => {
    const records = [report(), report("facebook")];
    const input = bundle(records);
    expect(input.sources).toHaveLength(2);
    expect(input.findings).toHaveLength(4);
    expect(input.sources[0].contentHash).toBe(createHash("sha256").update(JSON.stringify(records[0])).digest("hex"));
    for (const source of input.sources) expect(input.findings.some(finding => finding.reportId === source.reportId)).toBe(true);
    const serialized = JSON.stringify(input);
    for (const secret of ["RAW_HTML_NOT_FOR_PROMPT", "SECRET_RAW_VALUE", "Private business", "Private Facebook", "example.com", "sourceUrl", "observed"]) expect(serialized).not.toContain(secret);
    expect(input.scores.find(score => score.category === "overall")?.value).toBeNull();
  });
  it("accepts a trusted canonical source hash without including the source payload", () => {
    const source = report();
    const input = prepareAssessmentMuseEvidence({ assessmentId: randomUUID(), businessId: "business", policyVersion: "v1", cutoff: at, scores: [], sources: [{ report: source, contentHash: "a".repeat(64) }] });
    expect(input.sources[0].contentHash).toBe("a".repeat(64));
  });
  it("caps each channel at six findings and preserves honest omission/coverage counts", () => {
    const input = bundle([report("website", 25), report("facebook", 3)]);
    expect(input.findings.filter(finding => finding.source === "website")).toHaveLength(6);
    expect(input.findings.filter(finding => finding.source === "facebook")).toHaveLength(3);
    expect(input.coverage).toMatchObject({ selectedFindings: 9, omittedFindings: 19 });
  });
  it("redacts contacts, URLs, inline secrets, controls and private-key blocks in selected source excerpts", () => {
    const record = report();
    record.results!.findings[0].explanation = "<b>Private</b> person@example.com +1 (702) 555-1212 https://example.com/ api_key=SUPER_SECRET\u0000 password: PASSWORD_VALUE";
    record.results!.findings[1].explanation = "-----BEGIN PRIVATE KEY-----" + "PRIVATE_KEY_BYTES".repeat(500);
    const input = bundle([record]);
    const serialized = JSON.stringify(input.findings);
    for (const value of ["person@example", "702", "example.com", "SUPER_SECRET", "PASSWORD_VALUE", "PRIVATE_KEY_BYTES", "<b>"]) expect(serialized).not.toContain(value);
    expect(serialized).toContain("omitted]");
  });
  it.each(["business", "audit", "schema", "mode", "scope", "status", "id", "future", "unknown-ref", "duplicate-ref", "other-audit", "demo-evidence", "duplicate-findings"])("rejects incompatible source: %s", kind => {
    const source = report();
    switch (kind) {
      case "business": source.business.id = "other"; break;
      case "audit": source.audit.businessId = "other"; break;
      case "schema": (source as unknown as { schemaVersion: string }).schemaVersion = "other"; break;
      case "mode": source.audit.mode = "demo"; break;
      case "scope": source.audit.scope = "demo"; break;
      case "status": source.audit.status = "failed"; break;
      case "id": source.auditId = randomUUID(); break;
      case "future": source.audit.completedAt = "2027-01-01T00:00:00.000Z"; break;
      case "unknown-ref": source.results!.findings[0].evidenceIds = ["unknown"]; break;
      case "duplicate-ref": source.results!.findings[0].evidenceIds.push("evidence-0"); break;
      case "other-audit": source.results!.evidence[0].auditId = "other"; break;
      case "demo-evidence": source.results!.evidence[0].mode = "demo"; break;
      case "duplicate-findings": source.results!.findings.push(source.results!.findings[0]); break;
    }
    expect(() => bundle([source])).toThrow("saved assessment evidence");
  });
  it("rejects duplicate channel records and duplicate score categories", () => {
    expect(() => bundle([report(), report()])).toThrow();
    const input = bundle();
    expect(() => prepareAssessmentMuseEvidence({ ...input, scores: [input.scores[0], input.scores[0]], sources: [report()] })).toThrow();
  });
  it("does not invent evidence or recommendations when no eligible finding exists", () => {
    const input = bundle([report("website", 0)]);
    expect(buildMockAssessmentMuseOutput(input).recommendations).toEqual([]);
    expect(buildMockAssessmentMuseOutput(input).summaryEvidenceRefs).toEqual([]);
  });
  it("deduplicates shared evidence in a mock summary while keeping exact finding citations", () => {
    const source = report(); source.results!.findings[1].evidenceIds = ["evidence-0"];
    const input = bundle([source]);
    expect(buildMockAssessmentMuseOutput(input).summaryEvidenceRefs).toHaveLength(1);
    expect(buildMockAssessmentMuseOutput(input).recommendations).toHaveLength(2);
  });
});

describe("strict assessment interpretation output", () => {
  it("requires composite report/evidence/finding identity, even when local IDs collide between channels", () => {
    const input = bundle();
    const output = buildMockAssessmentMuseOutput(input);
    expect(validateAssessmentMuseOutput(output, input)).toEqual(output);
    output.recommendations[0].evidenceRefs[0].reportId = input.sources[1].reportId;
    expect(() => validateAssessmentMuseOutput(output, input)).toThrow("did not match");
  });
  it.each(["score", "tools", "approval", "patch"])("rejects unexpected executable or scoring field %s", field => {
    const input = bundle();
    expect(() => validateAssessmentMuseOutput({ ...buildMockAssessmentMuseOutput(input), [field]: {} }, input)).toThrow();
  });
  it("rejects unresolved findings, duplicate refs, duplicate recommendation IDs and unsupported scoring categories", () => {
    const input = bundle();
    const cases = [
      (output: ReturnType<typeof buildMockAssessmentMuseOutput>) => { output.recommendations[0].findingId = "unknown"; },
      (output: ReturnType<typeof buildMockAssessmentMuseOutput>) => { output.summaryEvidenceRefs.push(output.summaryEvidenceRefs[0]); },
      (output: ReturnType<typeof buildMockAssessmentMuseOutput>) => { output.recommendations[1].id = output.recommendations[0].id; },
      (output: ReturnType<typeof buildMockAssessmentMuseOutput>) => { output.scoringExplanation.categories = ["consistency"]; },
    ];
    for (const mutate of cases) { const output = buildMockAssessmentMuseOutput(input); mutate(output); expect(() => validateAssessmentMuseOutput(output, input)).toThrow(); }
  });
});

describe("mock-first assessment adapter and protected provider integration", () => {
  it("defaults to clearly identified zero-cost fixtures without invoking any provider method", async () => {
    const { adapter, generate, estimate } = setup({ MODEL_API_KEY: "privately-configured-but-unused" });
    const input = bundle();
    const result = await adapter.analyze(input);
    expect(result).toMatchObject({ generationMode: "mock", provider: "mock-fixture", isMock: true, usage: { inputTokens: 0, outputTokens: 0 }, requestId: null });
    expect(result.output.limitations.join(" ")).toContain("MOCK DATA");
    expect(adapter.validateRecord(input, result)).toEqual(result);
    expect(generate).not.toHaveBeenCalled(); expect(estimate).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("score");
  });
  it.each([{ AI_MODE: "poc", MOCK_AI: true, AI_ENABLED: true }, { AI_MODE: "demo", AI_ENABLED: true }, { AI_MODE: "mock", MOCK_AI: false, AI_ENABLED: true }])("keeps the mock master block in effect: %j", async settings => {
    const { adapter, generate } = setup(settings);
    expect((await adapter.analyze(bundle())).isMock).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });
  it("changes cache identity for inputs, policy, model, budgeted settings and operating mode", () => {
    const input = bundle();
    const base = setup().adapter.prepare(input).cacheKey;
    for (const settings of [{ AI_MODEL: "muse-spark-1.2" }, { AI_MAX_OUTPUT_TOKENS: 1000 }, { AI_REASONING_EFFORT: "minimal" }, { AI_MODE: "poc", MOCK_AI: false }]) expect(setup(settings).adapter.prepare(input).cacheKey).not.toBe(base);
    expect(setup().adapter.prepare({ ...input, policyVersion: "v2" }).cacheKey).not.toBe(base);
    expect(setup().adapter.prepare({ ...input, scores: input.scores.map(score => ({ ...score, value: null })) }).cacheKey).not.toBe(base);
  });
  it("rejects cross-assessment, source-hash, cache, mock/live and numeric tampering on cache reads", async () => {
    const { adapter } = setup(); const input = bundle(); const result = await adapter.analyze(input);
    const cases = [
      { ...result, businessId: "other" }, { ...result, assessmentId: randomUUID() }, { ...result, inputHash: "a".repeat(64) }, { ...result, cacheKey: "b".repeat(64) },
      { ...result, isMock: false }, { ...result, usage: { inputTokens: 1, outputTokens: 1 } },
      { ...result, sourceManifest: result.sourceManifest.map(source => ({ ...source, contentHash: "c".repeat(64) })) },
    ];
    for (const record of cases) expect(() => adapter.validateRecord(input, record)).toThrow();
    expect(assessmentMuseAnalysisSchema.safeParse({ ...result, seoSpyScore: 100 }).success).toBe(false);
  });
  it("requires explicit exact approval before delegating any live request to the sole protected provider", async () => {
    const { adapter, generate } = setup({ AI_MODE: "poc", MOCK_AI: false, AI_ENABLED: true });
    await expect(adapter.analyze(bundle())).rejects.toMatchObject({ code: "AI_APPROVAL_REQUIRED" });
    expect(generate).not.toHaveBeenCalled();
  });
  it("passes only an explicit scoped live intent to the existing protected provider using an offline stub", async () => {
    const { adapter, generate } = setup({ AI_MODE: "poc", MOCK_AI: false, AI_ENABLED: true });
    const input = bundle();
    generate.mockResolvedValue({ output: buildMockAssessmentMuseOutput(input), model: "muse-spark-1.3", usage: { inputTokens: 123, outputTokens: 321 }, requestId: "fixture-provider-request", attemptId: randomUUID() });
    const intentId = randomUUID(); const result = await adapter.analyze(input, { intentId, actor: "operator" });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ input, schema: expect.any(Object) }), undefined, { intentId, actor: "operator", scope: `assessment:business:${input.assessmentId}` });
    expect(result).toMatchObject({ generationMode: "poc", provider: "meta", isMock: false, usage: { inputTokens: 123, outputTokens: 321 } });
    expect(result).not.toHaveProperty("fixtureVersion");
  });
  it("delegates only an explicit estimate action without generating a request", async () => {
    const { adapter, generate, estimate } = setup(); const input = bundle();
    await adapter.estimate(input, "operator", "Essential proof of concept");
    expect(estimate).toHaveBeenCalledWith(expect.objectContaining({ input }), { actor: "operator", reason: "Essential proof of concept", scope: `assessment:business:${input.assessmentId}` });
    expect(generate).not.toHaveBeenCalled();
  });
  it.each([{ AI_MODE: "automatic" }, { AI_MODEL: "more-expensive" }, { AI_PROCESSING_MODE: "priority" }, { AI_REASONING_EFFORT: "high" }, { AI_MAX_OUTPUT_TOKENS: 1501 }, { AI_MAX_INPUT_BYTES: 32769 }])("rejects unsupported provider settings: %j", settings => {
    expect(() => setup(settings).adapter.prepare(bundle())).toThrow("permitted development bounds");
  });
  it("fails closed on an input exceeding the configured bound", () => {
    const input: AssessmentMuseEvidenceBundle = bundle();
    expect(() => setup({ AI_MAX_INPUT_BYTES: 4096 }).adapter.prepare(input)).toThrow("configured input limit");
  });
});
