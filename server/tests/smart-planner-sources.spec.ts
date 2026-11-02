import { jest } from "@jest/globals";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { analyzeWebsite } from "../src/integrations/lighthouse/prioritize.js";
import { summarizeEvidence } from "../src/reporting/evidence-summary.js";
import { analyzeFacebook } from "../src/integrations/facebook/analyze.js";
import { PlannerSourcesService, projectPlannerSources } from "../src/modules/smart-planner/planner-sources.js";
import type { FileReportStore } from "../src/reports/file-report.store.js";
import type { AssessmentService } from "../src/modules/assessments/assessment.service.js";
import type { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import type { AuditReportRecord } from "../src/reports/report.types.js";

const at = "2026-11-02T12:00:00.000Z";
// Run actual frontend selection/mapping code. Unrelated score/card formatting is
// stubbed because this contract compares only planner task content and ordering.
const clientModules = new Map<string, Record<string, unknown>>();
function clientModule(name: string): Record<string, unknown> {
  const normalized = name.replace(/^\.\//, "").replace(/\.ts$/, "");
  if (normalized === "dashboardMapping") return { mapDashboardReports: () => ({ websiteResults: { overall: {} }, consistency: { score: {}, checks: [] }, main: { overall: {} } }) };
  if (normalized === "socialScoreDetails") return { socialScoreDetails: () => null };
  const existing = clientModules.get(normalized); if (existing) return existing;
  const output: Record<string, unknown> = {}; clientModules.set(normalized, output);
  const compiled = ts.transpileModule(readFileSync(new URL(`../../client/src/services/${normalized}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "require", compiled)(output, clientModule);
  return output;
}
function clientTasks(saved: AuditReportRecord, selected: Assessment, social: AuditReportRecord | null = null) {
  const analyzed = analyzeWebsite(saved.auditId, saved.results);
  const website = { ...saved, results: { ...saved.results, findings: analyzed.findings, recommendations: analyzed.recommendations, evidenceSummaries: summarizeEvidence(saved.auditId, saved.results!) } };
  const map = clientModule("dashboardAssessment").mapDashboardAssessment as (businessId: string, dashboard: unknown, website: unknown, social: unknown) => { top: Record<string, unknown[]>; remaining: unknown[] };
  const toTasks = clientModule("smartPlanner").tasksFromIssues as (issues: unknown[]) => Record<string, unknown>[];
  const projected = map("business-a", { assessment: selected }, website, social ? { report: social,
    analysis: analyzeFacebook(social.results!.facebook!, social.auditId, social.results!.evidence) } : null);
  return toTasks([...Object.values(projected.top).flat(), ...projected.remaining]);
}
function expectClientParity(saved: AuditReportRecord, selected: Assessment, social: AuditReportRecord | null = null) {
  const expected = clientTasks(saved, selected, social);
  const actual = projectPlannerSources("business-a", saved, social, selected).map(({ taskKey, origin: _origin, authoritativeScanAt: _at, ...task }) => {
    void _origin; void _at; return { ...task, id: taskKey, status: "Needs Action" };
  });
  expect(actual).toEqual(expected);
}
function report(id = "report-a"): AuditReportRecord {
  return { schemaVersion: "seo-spy.audit-report.v1", reportId: id, auditId: id, generatedAt: at,
    business: { id: "business-a", name: "Example", website: "https://example.com", createdAt: at },
    audit: { id, businessId: "business-a", scope: "homepage", mode: "live", status: "completed", stage: "complete", createdAt: at, startedAt: at, completedAt: at,
      warnings: [], failure: null, scoringVersion: "homepage-v1" },
    results: { evidence: [], scores: [], findings: Array.from({ length: 5 }, (_, index) => ({ id: `finding-${index}`, auditId: id, checkId: "example", evidenceIds: [],
      severity: index === 4 ? "critical" : "medium", source: "website", title: `Image finding ${index}`, explanation: "Original evidence", status: "needs_review" })),
      recommendations: [] } };
}
function facebookReport(): AuditReportRecord {
  const saved = report("facebook-a"); saved.audit.scope = "facebook"; saved.audit.scoringVersion = "facebook-v1";
  saved.results = { evidence: ["facebook:posts", "facebook:profile:phone", "facebook:profile:hours"].map((checkId, index) => ({
    id: `facebook-evidence-${index}`, auditId: saved.auditId, checkId, mode: "live", collectedAt: at, sourceUrl: "https://facebook.com/123", observed: {} })), findings: [], recommendations: [], scores: [],
    facebook: { provider: "facebook-graph", version: "facebook-v1", graphVersion: "v26.0", pageId: "123", pageName: "Example", collectedAt: at,
      window: { since: "2026-10-03T12:00:00.000Z", until: at, requestedDays: 30 },
      profile: { phone: { status: "available", value: "(702) 340-6758", collectedAt: at }, hours: { status: "missing", value: null, collectedAt: at } },
      posts: { status: "available", items: [{ id: "123_456", message: "Contact (725) 340-6758", createdTime: "2026-08-01T12:00:00.000Z", url: "https://facebook.com/123_456" }], truncated: true, collectedAt: at },
      metrics: [], summary: { followersStart: null, followersEnd: null, followersChange: null, latestPostAt: null, postsInWindow: 0, postsInWindowComplete: false },
      coverage: { profileFieldsAvailable: 1, profileFieldsMissing: 1, profileFieldsUnavailable: 0, metricsAvailable: 0, metricsRequested: 7, postsLimit: 50 }, limitations: [] } };
  return saved;
}
type Assessment = Parameters<typeof projectPlannerSources>[3];
function assessment(website: AuditReportRecord): Assessment {
  const contentHash = createHash("sha256").update(JSON.stringify(website)).digest("hex");
  return { id: "assessment-a", businessId: "business-a", policyVersion: "seo-spy-score-v1.4", policyHash: "a".repeat(64), scores: {}, reasons: [], sources: [{ provider: "website", businessId: "business-a", reportId: website.auditId, reportHash: contentHash }],
    analysis: { id: "analysis-a", assessmentId: "assessment-a", businessId: "business-a", isMock: true, generationMode: "mock",
      sourceManifest: [{ provider: "website", reportId: website.auditId, contentHash, collectedAt: at, status: "completed" }], output: { schemaVersion: "assessment-muse-output-v4", summary: "Saved summary", scoringExplanation: { text: "Saved scoring explanation" }, recommendations: [] } } } as unknown as Assessment;
}
function service(website: AuditReportRecord | null, options: { listFailure?: boolean; readFailure?: boolean; assessment?: Assessment; assessmentFailure?: boolean; pending?: string[] } = {}) {
  const reports = { list: jest.fn(async () => { if (options.listFailure) throw new Error("storage"); return website ? [{ auditId: website.auditId, mode: "live", scope: "homepage", status: "completed" }] : []; }),
    read: jest.fn(async () => { if (options.readFailure) throw new Error("read"); return website; }) };
  const assessments = { latest: jest.fn(async () => { if (options.assessmentFailure) throw new Error("assessment"); return { assessment: options.assessment ?? null }; }) };
  const database = { connection: () => ({ prepare: () => ({ all: () => (options.pending ?? []).map(scope => ({ scope })) }) }) };
  return { adapter: new PlannerSourcesService(reports as unknown as FileReportStore, assessments as unknown as AssessmentService, database as unknown as AppDatabase), reports, assessments };
}
describe("Smart Planner saved-source adapter", () => {
  it("maps top category tasks and remaining findings in current severity order without mutating evidence", () => {
    const saved = report(); const before = structuredClone(saved);
    const tasks = projectPlannerSources("business-a", saved, null, null);
    expect(tasks.map(task => task.taskKey)).toEqual(["website:finding-4", "website:finding-0", "website:finding-1", "website:finding-2", "website:finding-3"]);
    expect(tasks[0]).toMatchObject({ priority: "Urgent", category: "Content", mode: "saved", source: "Website", origin: { kind: "finding", reportIds: ["report-a"] } });
    expect(tasks[0].origin.reportHashes[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(saved).toEqual(before);
    expectClientParity(saved, null);
  });
  it("preserves valid empty assessment selection while retaining raw remaining issues", () => {
    const saved = report();
    expect(projectPlannerSources("business-a", saved, null, assessment(saved)).map(task => task.taskKey)).toEqual(["website:finding-2", "website:finding-3"]);
    expectClientParity(saved, assessment(saved));
    const stale = assessment(saved)!; stale.reasons = ["STALE_INPUT"];
    expect(projectPlannerSources("business-a", saved, null, stale)).toHaveLength(5);
    expectClientParity(saved, stale);
  });
  it("rejects foreign business report provenance", () => {
    expect(() => projectPlannerSources("business-b", report(), null, null)).toThrow("PLANNER_SOURCE_BUSINESS_MISMATCH");
  });
  it("matches current Facebook derived findings and cross-channel source provenance", () => {
    const website = report(), social = facebookReport();
    expectClientParity(website, null, social);
    const tasks = projectPlannerSources("business-a", website, social, null);
    expect(tasks.some(task => task.source === "Facebook" && task.origin.reportIds[0] === "facebook-a")).toBe(true);
    expect(social.results!.findings).toEqual([]);
  });
  it("matches validated consistency recommendations without turning observations into findings", () => {
    const website = report(), social = facebookReport();
    website.results!.evidence.push({ id: "website-evidence", auditId: website.auditId, checkId: "business-facts", mode: "live", collectedAt: at, sourceUrl: "https://example.com", observed: {} });
    const selected = assessment(website)!;
    const contentHash = createHash("sha256").update(JSON.stringify(social)).digest("hex");
    selected.sources.push({ provider: "facebook", businessId: "business-a", reportId: social.auditId, reportHash: contentHash } as typeof selected.sources[number]);
    selected.analysis!.sourceManifest.push({ provider: "facebook", reportId: social.auditId, contentHash, collectedAt: at, status: "completed" });
    selected.comparisons = [{ id: "business-name", applicable: true, outcome: "fail", website: "Example", facebook: "Other Example" }];
    const refs = [{ reportId: website.auditId, evidenceId: "website-evidence" }, { reportId: social.auditId, evidenceId: "facebook-evidence-2" }];
    selected.analysis!.output.recommendations.push({ id: "consistency-action", reportId: website.auditId, findingId: "score:consistency:disagreements", title: "Review the business name", recommendation: "Confirm the correct name across sources", rationale: "Saved disagreement", effort: "small", risk: "low", evidenceRefs: refs, verificationSteps: [], manualFallback: "Review manually", origin: { kind: "scoring-observation", category: "consistency", sourceRefs: refs } });
    expectClientParity(website, selected, social);
    expect(projectPlannerSources("business-a", website, social, selected).find(task => task.origin.channel === "consistency")).toMatchObject({ category: "Admin", origin: { kind: "assessment", evidenceRefs: refs } });
  });
  it("preserves selected assessment finding provenance and the existing raw remaining rows", () => {
    const saved = report();
    saved.results!.evidence.push({ id: "evidence-a", auditId: saved.auditId, checkId: "example", mode: "live", collectedAt: at, sourceUrl: "https://example.com", observed: {} });
    saved.results!.findings[3].evidenceIds = ["evidence-a"];
    const selected = assessment(saved)!;
    const ref = { reportId: saved.auditId, evidenceId: "evidence-a" };
    selected.analysis!.output.recommendations.push({ id: "recommendation-a", reportId: saved.auditId, findingId: "finding-3", title: "Inspect the relevant image", recommendation: "Review its purpose before editing", rationale: "Saved evidence", effort: "small", risk: "low", evidenceRefs: [ref], verificationSteps: [], manualFallback: "Review manually", origin: { kind: "finding", category: "website", sourceRefs: [ref] } });
    const tasks = projectPlannerSources("business-a", saved, null, selected);
    expect(tasks[0]).toMatchObject({ taskKey: "website:assessment:analysis-a:recommendation-a", title: "Inspect the relevant image", explanation: "Mock AI assessment: Review its purpose before editing",
      guidance: "Review its purpose before editing", origin: { kind: "assessment", findingId: "finding-3", assessmentId: "assessment-a", analysisId: "analysis-a", evidenceRefs: [ref] } });
    expect(tasks.some(task => task.taskKey === "website:finding-3")).toBe(true);
    expectClientParity(saved, selected);
    // Same title in a new report is a different exact origin, never a semantic match.
    expect(projectPlannerSources("business-a", report("report-b"), null, null)[0].origin).not.toEqual(projectPlannerSources("business-a", report(), null, null)[0].origin);
  });
  it("does not treat unavailable interpretation as empty consistency evidence", async () => {
    const result = await service(report()).adapter.read("business-a");
    expect(result.tasks).toHaveLength(5);
    expect(result.sources).toContainEqual({ channel: "consistency", availability: "unavailable", reportIds: [] });
  });
  it("distinguishes successful empty saved findings from unavailable and failed reads", async () => {
    const empty = report(); empty.results!.findings = [];
    expect((await service(empty).adapter.read("business-a")).sources[0].availability).toBe("empty");
    expect((await service(null).adapter.read("business-a")).sources[0].availability).toBe("unavailable");
    expect((await service(report(), { readFailure: true }).adapter.read("business-a")).sources[0].availability).toBe("failed");
    expect((await service(null, { listFailure: true }).adapter.read("business-a")).sources.every(source => source.availability === "failed")).toBe(true);
  });
  it("preserves usable saved task projection while identifying pending scans in both channels", async () => {
    const result = await service(report(), { pending: ["homepage", "facebook"] }).adapter.read("business-a");
    expect(result.tasks).toHaveLength(5);
    expect(result.sources.map(source => source.availability)).toEqual(["pending", "pending", "pending"]);
  });
  it("retains older usable Facebook facts after a newer partial attempt lacks Facebook data", async () => {
    const usable = facebookReport(), unusable = facebookReport(); unusable.auditId = "facebook-new"; unusable.results!.facebook = undefined;
    const reports = { list: async () => [unusable, usable].map(item => ({ auditId: item.auditId, mode: "live", scope: "facebook", status: "partial" })),
      read: async (id: string) => id === usable.auditId ? usable : unusable };
    const assessments = { latest: async () => ({ assessment: null }) };
    const database = { connection: () => ({ prepare: () => ({ all: () => [] }) }) };
    const adapter = new PlannerSourcesService(reports as unknown as FileReportStore, assessments as unknown as AssessmentService, database as unknown as AppDatabase);
    const result = await adapter.read("business-a");
    expect(result.sources[1]).toMatchObject({ availability: "available", reportIds: ["facebook-a"] });
    expect(result.tasks.every(task => task.origin.reportIds.includes("facebook-a"))).toBe(true);
  });
  it("reads only saved stores and never calls assessment creation or changes source records", async () => {
    const saved = report(); const before = JSON.stringify(saved); const fixture = service(saved, { assessmentFailure: true });
    const result = await fixture.adapter.read("business-a");
    expect(fixture.reports.list).toHaveBeenCalledWith("business-a");
    expect(fixture.assessments.latest).toHaveBeenCalledTimes(1);
    expect(result.sources[2].availability).toBe("failed");
    expect(JSON.stringify(saved)).toBe(before);
    expect(result.tasks.every(task => !("status" in task))).toBe(true);
  });
});
