import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AuditReportRecord } from "../src/reports/report.types.js";
import type { ScoreAssessmentInput, ScoreSnapshot, ScorePolicyVersion } from "../src/scoring/scoring.types.js";
import { calculateScoreSnapshot } from "../src/scoring/calculator.js";
import { SOCIAL_PERFORMANCE_POLICY } from "../src/scoring/social-performance.policy.js";
import { SCORE_POLICY_REGISTRY } from "../src/scoring/policy.js";
import { MetaMuseProvider } from "../src/integrations/ai/meta-muse.provider.js";
import { buildAssessmentScoringContext } from "../src/integrations/assessment-ai/assessment-muse-scoring.js";
import { AssessmentMuseAdapter, buildMockAssessmentMuseOutput, prepareAssessmentMuseEvidence, validateAssessmentMuseOutput } from "../src/integrations/assessment-ai/assessment-muse.js";
import { assessmentMuseAnalysisSchema, currentAssessmentMuseOutputSchema } from "../src/integrations/assessment-ai/assessment-muse.types.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { SQLiteBusinessRepository } from "../src/persistence/sqlite/sqlite.repositories.js";
import { AssessmentStore } from "../src/modules/assessments/assessment.store.js";

const at = "2026-11-01T00:00:00.000Z";
const hash = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const businessId = "fixture-business";
function fixture(policyVersion: ScorePolicyVersion = "seo-spy-score-v1.4") {
  const reports: AuditReportRecord[] = (["website", "facebook"] as const).map(provider => {
    const id = randomUUID();
    return { schemaVersion: "seo-spy.audit-report.v1", reportId: id, auditId: id, generatedAt: at,
      business: { id: businessId, name: "Private fixture identity", website: "https://example.com/", createdAt: at },
      audit: { id, businessId, scope: provider === "website" ? "lighthouse" : "facebook", mode: "live", status: "completed", stage: "complete", createdAt: at, completedAt: at, startedAt: at, warnings: [], failure: null, scoringVersion: provider === "website" ? "lighthouse-v1" : "facebook-v1" },
      results: { scores: [], findings: [], recommendations: [], evidence: [{ id: "proof", auditId: id, checkId: "fixture", mode: "live", collectedAt: at, sourceUrl: "https://example.com/?token=PRIVATE", observed: { html: "PRIVATE_RAW_HTML" } }],
        ...(provider === "website" ? { lighthouse: { provider: "google-pagespeed-insights", strategy: "mobile", requestedUrl: "https://example.com/", finalUrl: "https://example.com/", fetchedAt: at, lighthouseVersion: "fixture",
          categories: ["seo", "performance", "accessibility", "best-practices"].map((id, index) => ({ id, title: id, score: [80, 60, 100, 90][index], availability: "measured", auditIds: [] })), metrics: [], checks: [], warnings: [] } }
          : { facebook: { collectedAt: at, pageId: "123", profile: {}, posts: { status: "unavailable", items: [] } } }),
      },
    } as AuditReportRecord;
  });
  const input: ScoreAssessmentInput = { businessId, cutoff: at, profile: "baseline-mobile-v1", policyVersion,
    expectedAssets: { websiteUrl: "https://example.com/", facebookPageId: "123" },
    sources: reports.map((report, index) => ({ reportId: report.reportId, reportHash: hash(report), businessId, schemaVersion: report.schemaVersion,
      provider: index === 0 ? "website" : "facebook", mode: "live", asset: index === 0 ? "https://example.com/" : "123", collectedAt: at, selectionReason: "Explicit fixture selection",
      evidenceIds: ["proof", ...(report.results?.lighthouse?.categories.map(item => `lighthouse-category:${item.id}`) ?? [])] })),
    website: { sourceReportId: reports[0].reportId, auditId: reports[0].reportId, requestedUrl: "https://example.com/", finalUrl: "https://example.com/", strategy: "mobile", lighthouseVersion: "fixture", fetchedAt: at,
      categories: reports[0].results!.lighthouse!.categories },
    social: { sourceReportId: reports[1].reportId, profile: [], goal: null, publishing: null,
      performance: { businessId, reportId: reports[1].reportId, pageId: "123", collectedAt: at, cutoff: at, evidenceIds: ["proof"], criteria: {} } }, consistency: null,
  };
  for (const group of SOCIAL_PERFORMANCE_POLICY.categories) for (const item of group.criteria) {
    input.social!.performance!.criteria[item.id] = { status: "available", value: item.direction === "lower" ? item.bands[0].threshold : item.bands.at(-1)!.threshold,
      evidence: [{ reportId: reports[1].reportId, evidenceId: "proof" }], collectedAt: at, complete: true, explanation: "Private upstream text is not copied." };
  }
  for (const id of ["shares-per-100-followers", "follower-growth-percent", "reviewed-relevance", "customer-response-rate", "customer-response-hours"] as const) delete input.social!.performance!.criteria[id];
  input.social!.performance!.criteria["posting-recency-days"]!.value = 73;
  input.social!.performance!.criteria["posts-per-week"]!.value = 0;
  input.social!.performance!.criteria["likes-per-100-followers"]!.value = 0;
  const snapshot = calculateScoreSnapshot(input);
  const assessmentId = randomUUID();
  const bundleFor = (snapshot: ScoreSnapshot, current = true) => prepareAssessmentMuseEvidence({ assessmentId, businessId, policyVersion: snapshot.policyVersion, cutoff: at,
    sources: reports, scores: Object.entries(snapshot.scores).map(([category, score]) => ({ category: category as "website" | "social" | "consistency" | "overall", value: score.value, reasonCodes: score.reasons })),
    ...(current ? { snapshot } : {}) });
  return { input, snapshot, reports, bundleFor, bundle: bundleFor(snapshot) };
}

describe("verified, bounded scoring context for assessment interpretation", () => {
  it("copies component/category points and coverage without changing snapshots, policies or reports", () => {
    const { snapshot, reports, bundle } = fixture();
    const original = hash({ snapshot, reports, policies: SCORE_POLICY_REGISTRY });
    const context = buildAssessmentScoringContext(snapshot, reports);
    expect(context.components[0]).toMatchObject({ category: "website", value: snapshot.scores.website.value, knownWeight: 100 });
    expect(context.components[0].breakdown.find(item => item.id === "seo")).toMatchObject({ score: 80, maximumPoints: 50, earnedPoints: 40 });
    expect(context.socialCoveragePercent).toBe(71); expect(context.socialStatus).toBe("definitive");
    expect(context.components[1].breakdown.map(item => item.maximumPoints)).toEqual([15, 20, 25, 15, 15, 10]);
    expect(context.components[1].breakdown.find(item => item.id === "customer-interaction")).toMatchObject({ earnedPoints: null, knownWeight: 0, status: "unavailable" });
    expect(hash({ snapshot, reports, policies: SCORE_POLICY_REGISTRY })).toBe(original);
    expect(JSON.stringify(bundle)).not.toMatch(/PRIVATE|example\.com|Private fixture|upstream text/);
  });
  it("keeps measured zero engagement a weakness and inaccessible shares/growth/response evidence a gap", () => {
    const { snapshot, reports } = fixture(); const context = buildAssessmentScoringContext(snapshot, reports);
    expect(context.observations.find(item => item.id === "score:social:likes-per-100-followers")).toMatchObject({ kind: "weakness" });
    expect(context.measurementGaps.find(item => item.id === "shares-per-100-followers")).toMatchObject({ category: "social", reasonCode: "METRIC_NOT_AVAILABLE" });
    expect(context.observations.some(item => /shares-per|follower-growth|customer-response/.test(item.id))).toBe(false);
    expect(context.observations.some(item => item.kind === "strength")).toBe(true);
  });
  it("preserves provisional eligibility separately from the numeric Social interpretation", () => {
    const { input, reports } = fixture(); delete input.social!.performance!.criteria["comments-per-100-followers"];
    const snapshot = calculateScoreSnapshot(input), context = buildAssessmentScoringContext(snapshot, reports);
    expect(context.socialStatus).toBe("provisional"); expect(context.socialCoveragePercent).toBe(61);
    expect(context.components.find(item => item.category === "social")!.value).toBeNull();
    expect(context.components.find(item => item.category === "overall")!.value).toBeNull();
  });
  it.each(["business", "hash", "citation"])("fails closed for altered scoring provenance: %s", kind => {
    const { snapshot, reports } = fixture();
    if (kind === "business") snapshot.businessId = "other";
    if (kind === "hash") reports[0].generatedAt = "2026-10-30T00:00:00.000Z";
    if (kind === "citation") snapshot.socialAssessment!.categories[0].criteria[0].evidence = [{ reportId: reports[0].reportId, evidenceId: "unknown" }];
    expect(() => buildAssessmentScoringContext(snapshot, reports)).toThrow();
  });
  it("bounds large inputs deterministically, retains both channels, and reports omissions without changing sources", () => {
    const { input, reports, bundleFor } = fixture();
    for (const [index, report] of reports.entries()) {
      const source = index === 0 ? "website" as const : "facebook" as const;
      report.results!.findings = Array.from({ length: 12 }, (_, i) => ({ id: `issue-${i}`, auditId: report.auditId, checkId: "fixture", evidenceIds: ["proof"], source,
        severity: "medium", title: "Review this saved finding ".repeat(8), explanation: "Bounded source information ".repeat(40), status: "needs_review" }));
      report.results!.recommendations = report.results!.findings.map(item => ({ id: `rec-${item.id}`, findingId: item.id, auditId: report.auditId,
        title: "Review the saved opportunity", explanation: "Review in context.", recommendedChange: "Inspect the original observation before deciding on a change. ".repeat(20), purpose: "Manual review", status: "needs_review" }));
      input.sources[index].reportHash = hash(report);
    }
    const snapshot = calculateScoreSnapshot(input), original = hash({ snapshot, reports }), bundle = bundleFor(snapshot);
    expect(bundleFor(snapshot)).toEqual(bundle);
    expect(bundle.schemaVersion).toBe("seo-spy.assessment-muse-evidence.v2");
    expect(new Set(bundle.findings.map(item => item.source)).size).toBe(2);
    expect(bundle.coverage.omittedFindings).toBe(24 - bundle.findings.length);
    expect(Buffer.byteLength(JSON.stringify(bundle))).toBeLessThanOrEqual(16000);
    const adapter = new AssessmentMuseAdapter(new ConfigService(), {} as MetaMuseProvider);
    expect(Buffer.byteLength(JSON.stringify(adapter.prepare(bundle).modelInput))).toBeLessThan(32768);
    expect(hash({ snapshot, reports })).toBe(original);
  });
  it("does not promote unavailable source findings into suggested business fixes", () => {
    const { input, reports, bundleFor } = fixture();
    reports[0].results!.evidence[0].observed.status = "unavailable";
    reports[0].results!.findings = [{ id: "access-gap", auditId: reports[0].auditId, source: "website", checkId: "fixture", evidenceIds: ["proof"], severity: "critical", title: "Unable to measure", explanation: "No measurement", status: "needs_review" }];
    input.sources[0].reportHash = hash(reports[0]);
    const bundle = bundleFor(calculateScoreSnapshot(input));
    expect(bundle.findings).toEqual([]);
    expect(buildMockAssessmentMuseOutput(bundle).recommendations.some(item => item.findingId === "access-gap")).toBe(false);
  });
  it.each(["seo-spy-score-v1", "seo-spy-score-v1.1", "seo-spy-score-v1.2", "seo-spy-score-v1.3", "seo-spy-score-v1.4"] as const)("interprets %s without changing replay or policy hashes", version => {
    const { input, snapshot, reports } = fixture(version), original = hash(snapshot);
    expect(buildAssessmentScoringContext(snapshot, reports).policyHash).toBe(SCORE_POLICY_REGISTRY[version].hash);
    expect(hash(calculateScoreSnapshot(input))).toBe(original);
  });
});

describe("useful mock interpretation with strict claims and version isolation", () => {
  it("supplies verified strengths, shortfalls, gaps and practical ranked steps with no repeated posting remedy", () => {
    const { bundle } = fixture(); const output = currentAssessmentMuseOutputSchema.parse(buildMockAssessmentMuseOutput(bundle));
    expect(output.strengths.length).toBeGreaterThan(0); expect(output.weaknesses.length).toBeGreaterThan(0); expect(output.measurementGaps.length).toBeGreaterThan(0);
    expect(output.recommendations[0].findingId).toBe("score:social:likes-per-100-followers");
    expect(output.recommendations.filter(item => /posts-per-week|posting-recency-days/.test(item.findingId))).toHaveLength(1);
    expect(output.recommendations.every(item => item.verificationSteps.length && item.manualFallback && item.rationale)).toBe(true);
  });
  it("never turns an all-unavailable assessment into fabricated strengths or business fixes", () => {
    const { input, bundleFor } = fixture(); input.website = null; delete input.social!.performance;
    const output = currentAssessmentMuseOutputSchema.parse(buildMockAssessmentMuseOutput(bundleFor(calculateScoreSnapshot(input))));
    expect(output.strengths).toEqual([]); expect(output.weaknesses).toEqual([]); expect(output.recommendations).toEqual([]);
    expect(output.measurementGaps.length).toBeGreaterThan(0);
  });
  it.each(["claim", "kind", "ref", "gap", "number", "score", "action", "strength-fix", "uncited-target"])("rejects unsupported output: %s", kind => {
    const { bundle } = fixture(); const output = currentAssessmentMuseOutputSchema.parse(buildMockAssessmentMuseOutput(bundle));
    switch (kind) {
      case "claim": output.strengths[0].text = "Customers love the service."; break;
      case "kind": output.weaknesses[0] = output.strengths[0]; break;
      case "ref": output.strengths[0].evidenceRefs[0].reportId = randomUUID(); break;
      case "gap": output.measurementGaps[0].reasonCode = "POOR_PERFORMANCE"; break;
      case "number": output.summary = "Expected revenue will grow 30%."; break;
      case "score": Object.assign(output, { score: 100 }); break;
      case "action": Object.assign(output.recommendations[0], { parameters: { mediaId: 5522 } }); break;
      case "strength-fix": output.recommendations[0].findingId = output.strengths[0].observationId; break;
      case "uncited-target": output.recommendations[0].findingId = "unknown"; break;
    }
    expect(() => validateAssessmentMuseOutput(output, bundle)).toThrow();
  });
  it("keeps legacy v1 analysis/provenance valid and isolates new caches and mixed-version records", async () => {
    const { bundle, snapshot, bundleFor } = fixture();
    const generate = jest.fn<MetaMuseProvider["generate"]>();
    const adapter = new AssessmentMuseAdapter(new ConfigService({ MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false }), { generate } as unknown as MetaMuseProvider);
    const legacyBundle = bundleFor(snapshot, false), legacy = await adapter.analyze(legacyBundle), current = await adapter.analyze(bundle);
    expect(assessmentMuseAnalysisSchema.parse(legacy)).toEqual(legacy);
    expect(legacy.promptVersion).toBe("assessment-muse-prompt-v1"); expect(current.promptVersion).toBe("assessment-muse-prompt-v2");
    expect(current.cacheKey).not.toBe(legacy.cacheKey); expect(current.inputHash).not.toBe(legacy.inputHash);
    expect(adapter.validateRecord(legacyBundle, legacy)).toEqual(legacy);
    expect(() => adapter.validateRecord(bundle, legacy)).toThrow();
    expect(assessmentMuseAnalysisSchema.safeParse({ ...legacy, promptVersion: current.promptVersion }).success).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(Buffer.byteLength(JSON.stringify(adapter.prepare(bundle).modelInput))).toBeLessThan(32768);
    expect(Buffer.byteLength(JSON.stringify(bundle))).toBeLessThan(24576);
  });
  it("preserves v1/v2 immutable analyses and cache entries through SQLite restart without opening the AI ledger", async () => {
    const { reports, snapshot, bundleFor } = fixture();
    const directory = await mkdtemp(join(tmpdir(), "seo-spy-muse-versions-"));
    const cleanup = async () => {
      const target = resolve(directory);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-muse-versions-")) throw new Error("Unsafe cleanup path");
      await rm(target, { recursive: true, force: true });
    };
    const ledger = join(directory, "protected-ai.sqlite"), protectedBytes = Buffer.from("Protected fixture ledger must not be opened or modified");
    await writeFile(ledger, protectedBytes);
    const config = new ConfigService({ DATABASE_PATH: join(directory, "app.sqlite"), AI_USAGE_DB: ledger, MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false });
    let database = new AppDatabase(config);
    try {
      database.ensureSeeded();
      await new SQLiteBusinessRepository(database).upsertBusiness(reports[0].business);
      const generate = jest.fn<MetaMuseProvider["generate"]>(), adapter = new AssessmentMuseAdapter(config, { generate } as unknown as MetaMuseProvider);
      const analyses = [await adapter.analyze(bundleFor(snapshot, false)), await adapter.analyze(bundleFor(snapshot))];
      let store = new AssessmentStore(database);
      for (const item of analyses) store.write("analysis", { ...item, createdAt: item.generatedAt }, item.cacheKey);
      const version = database.connection().prepare("PRAGMA user_version").get()?.user_version;
      database.close(); database = new AppDatabase(config); database.ensureSeeded(); store = new AssessmentStore(database);
      expect(database.connection().prepare("PRAGMA user_version").get()?.user_version).toBe(version);
      for (const item of analyses) {
        const stored = store.read("analysis", businessId, item.id) as Record<string, unknown>;
        const { createdAt: _createdAt, ...record } = stored; void _createdAt;
        expect(assessmentMuseAnalysisSchema.parse(record)).toEqual(item);
        expect(store.byCacheKey("analysis", businessId, item.cacheKey)).toEqual(stored);
      }
      expect(await readFile(ledger)).toEqual(protectedBytes);
      expect(generate).not.toHaveBeenCalled();
    } finally {
      database.close();
      await cleanup();
    }
  });
});
