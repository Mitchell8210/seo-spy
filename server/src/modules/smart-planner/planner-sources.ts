import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AuditResults } from "../../contracts/domain.js";
import { analyzeFacebook } from "../../integrations/facebook/analyze.js";
import { analyzeWebsite } from "../../integrations/lighthouse/prioritize.js";
import { AppDatabase } from "../../persistence/sqlite/app-database.js";
import { summarizeEvidence } from "../../reporting/evidence-summary.js";
import { FileReportStore } from "../../reports/file-report.store.js";
import type { AuditReportRecord } from "../../reports/report.types.js";
import { AssessmentService } from "../assessments/assessment.service.js";

export type PlannerChannel = "website" | "social" | "consistency";
export interface PlannerSourceState {
  channel: PlannerChannel;
  availability: "available" | "empty" | "pending" | "unavailable" | "failed";
  reportIds: string[];
}
export interface SourcePlannerTask {
  taskKey: string; title: string; explanation: string; guidance: string;
  priority: "Urgent" | "Medium" | "Low";
  category: "Admin" | "Content" | "Social" | "Search" | "Review";
  source: string; mode: "demo" | "saved"; destination?: string;
  origin: { kind: "finding" | "assessment"; channel: PlannerChannel; reportIds: string[]; reportHashes: string[];
    findingId?: string; recommendationId?: string; assessmentId?: string; analysisId?: string; evidenceRefs: { reportId: string; evidenceId: string }[] };
  authoritativeScanAt?: string;
}
export type PlannerSourceProjection = { tasks: SourcePlannerTask[]; sources: PlannerSourceState[] };
type SavedAssessment = Awaited<ReturnType<AssessmentService["latest"]>>["assessment"];
type Issue = { id: string; title: string; explanation: string; severity: string; status: string; category: PlannerChannel; source: string;
  recommendation?: { title: string; explanation: string }; origin: SourcePlannerTask["origin"]; authoritativeScanAt?: string };
const hash = (report: AuditReportRecord) => createHash("sha256").update(JSON.stringify(report)).digest("hex");
const destination = (channel: PlannerChannel, businessId: string) => channel === "website" ? `/website?businessId=${encodeURIComponent(businessId)}`
  : channel === "social" ? `/social-media?businessId=${encodeURIComponent(businessId)}` : "/dashboard#consistency-details";
const active = (status: string) => !["verified", "resolved", "passed"].includes(status.toLowerCase());
const rank: Record<string, number> = { critical: 0, medium: 1, low: 2 };
function opportunityTitle(title: string, explanation: string): string {
  if (!/^(?:(?:saved|fixture|test|demo|profile)\s+)*(?:opportunity|finding|issue)\s*#?\d+$/i.test(title.trim())) return title;
  if (/phone|contact number/i.test(explanation) && /different|inconsisten|mismatch/i.test(explanation)) return "Contact information may be inconsistent";
  return explanation.trim() || "Review this finding";
}
function toTask(issue: Issue, businessId: string): SourcePlannerTask {
  return { taskKey: `${issue.category}:${issue.id}`, title: issue.recommendation?.title ?? opportunityTitle(issue.title, issue.explanation),
    explanation: issue.explanation, guidance: issue.recommendation?.explanation ?? "Review this finding and its source report. Confirm the correct business information before making a change.",
    priority: issue.severity === "critical" ? "Urgent" : issue.severity === "low" ? "Low" : "Medium",
    category: issue.category === "consistency" || /hours|phone|contact|business information/i.test(issue.title) ? "Admin"
      : issue.category === "social" ? "Social" : /image|content|heading|alt/i.test(issue.title) ? "Content" : /meta|search|description|title/i.test(issue.title) ? "Search" : "Review",
    source: issue.source, mode: "saved", destination: destination(issue.category, businessId), origin: issue.origin,
    ...(issue.authoritativeScanAt ? { authoritativeScanAt: issue.authoritativeScanAt } : {}) };
}

/** Only accepts the validated saved assessment returned by AssessmentService.latest. */
function interpretation(assessment: SavedAssessment, website: AuditReportRecord | null, social: AuditReportRecord | null): Issue[] | null {
  const analysis = assessment?.analysis;
  if (!assessment || !analysis || !["assessment-muse-output-v3", "assessment-muse-output-v4"].includes(analysis.output.schemaVersion)
    || assessment.reasons.includes("STALE_INPUT") || analysis.assessmentId !== assessment.id || analysis.businessId !== assessment.businessId
    || !(analysis.isMock && analysis.generationMode === "mock" || !analysis.isMock && ["poc", "demo"].includes(analysis.generationMode))
    || !analysis.isMock && (analysis.provider !== "meta" || !analysis.usageAttemptId)
    || analysis.sourceManifest.length !== assessment.sources.length) return null;
  const current = (provider: string) => provider === "website" ? website : social;
  if (analysis.sourceManifest.some(source => {
    const pinned = assessment.sources.find(item => item.provider === source.provider);
    const report = current(source.provider);
    return !pinned || pinned.businessId !== assessment.businessId || source.reportId !== pinned.reportId || source.contentHash !== pinned.reportHash
      || report?.auditId !== source.reportId || report.business.id !== assessment.businessId || hash(report) !== source.contentHash;
  })) return null;
  const resolves = (ref: { reportId: string; evidenceId: string }) => {
    const source = analysis.sourceManifest.find(item => item.reportId === ref.reportId);
    const report = source && current(source.provider);
    return !!report?.results && (report.results.evidence.some(item => item.id === ref.evidenceId && item.auditId === ref.reportId && item.mode === "live")
      || source?.provider === "website" && report.results.lighthouse?.categories.some(item => item.availability === "measured" && ref.evidenceId === `lighthouse-category:${item.id}`));
  };
  const path: Issue[] = [];
  for (const recommendation of analysis.output.recommendations) {
    const origin = "origin" in recommendation ? recommendation.origin : undefined;
    if (!origin || !recommendation.evidenceRefs.length || !recommendation.evidenceRefs.every(resolves)
      || !origin.sourceRefs.length || origin.sourceRefs.length !== recommendation.evidenceRefs.length
      || origin.sourceRefs.some(ref => !recommendation.evidenceRefs.some(item => item.reportId === ref.reportId && item.evidenceId === ref.evidenceId))) continue;
    const category = origin.category;
    const report = category === "social" ? social : website;
    let findingId: string | undefined;
    if (origin.kind === "finding") {
      const finding = report?.results?.findings.find(item => item.id === recommendation.findingId);
      if (category === "consistency" || recommendation.reportId !== report?.auditId || !finding
        || recommendation.evidenceRefs.some(ref => ref.reportId !== report.auditId || !finding.evidenceIds.includes(ref.evidenceId))) continue;
      findingId = finding.id;
    } else if (category === "social") {
      const criteria = assessment.socialAssessment?.categories.flatMap(item => item.criteria)
        .filter(item => ["posts-per-week", "posting-recency-days", "active-week-ratio", "longest-gap-days"].includes(item.id)
          && item.status === "available" && item.earned !== null && item.earned < item.maximum) ?? [];
      if (recommendation.findingId !== "score:social:posting" || recommendation.reportId !== social?.auditId || !criteria.length
        || recommendation.evidenceRefs.some(ref => !criteria.some(item => item.evidence.some(value => value.reportId === ref.reportId && value.evidenceId === ref.evidenceId)))) continue;
    } else if (category === "consistency") {
      if (recommendation.findingId !== "score:consistency:disagreements" || !assessment.comparisons.some(item => ["business-name", "hours"].includes(item.id) && item.applicable && item.outcome === "fail")
        || !recommendation.evidenceRefs.some(ref => ref.reportId === website?.auditId) || !recommendation.evidenceRefs.some(ref => ref.reportId === social?.auditId)) continue;
    } else continue;
    const source = analysis.isMock ? "Mock AI assessment" : "Meta Muse-assisted assessment";
    path.push({ id: `assessment:${analysis.id}:${recommendation.id}`, title: recommendation.title,
      explanation: `${source}: ${recommendation.recommendation}`, severity: "medium", status: "needs_review", category, source,
      recommendation: { title: recommendation.title, explanation: recommendation.recommendation },
      origin: { kind: "assessment", channel: category, reportIds: analysis.sourceManifest.map(item => item.reportId), reportHashes: analysis.sourceManifest.map(item => item.contentHash),
        assessmentId: assessment.id, analysisId: analysis.id, recommendationId: recommendation.id, ...(findingId ? { findingId } : {}), evidenceRefs: recommendation.evidenceRefs },
      authoritativeScanAt: report?.generatedAt });
  }
  return path;
}

/** Pure saved-source projection. Never changes tasks or source records. */
export function projectPlannerSources(businessId: string, website: AuditReportRecord | null, social: AuditReportRecord | null, assessment: SavedAssessment): SourcePlannerTask[] {
  const issues: Issue[] = [];
  const analysis = assessment?.businessId === businessId && assessment.analysis?.assessmentId === assessment.id
    && assessment.analysis.businessId === businessId
    && (assessment.analysis.isMock && assessment.analysis.generationMode === "mock" || !assessment.analysis.isMock && ["poc", "demo"].includes(assessment.analysis.generationMode)) ? assessment.analysis : null;
  for (const { report, category, expected, source } of [
    { report: website, category: "website" as const, expected: "website", source: "Website" },
    { report: social, category: "social" as const, expected: "facebook", source: "Facebook" },
  ]) {
    if (!report?.results) continue;
    if (report.business.id !== businessId || report.audit.businessId !== businessId) throw new Error("PLANNER_SOURCE_BUSINESS_MISMATCH");
    const reportHash = hash(report);
    let results: Pick<AuditResults, "findings" | "recommendations"> & Partial<Pick<AuditResults, "evidenceSummaries">> = report.results;
    if (category === "website") results = { ...analyzeWebsite(report.auditId, report.results), evidenceSummaries: summarizeEvidence(report.auditId, report.results) };
    else if (report.results.facebook) results = analyzeFacebook(report.results.facebook, report.auditId, report.results.evidence);
    for (const finding of results.findings) {
      if (finding.source !== expected) continue;
      const recommendation = results.recommendations.find(item => item.findingId === finding.id);
      const summary = results.evidenceSummaries?.findings.find(item => item.id === finding.id);
      const muse = analysis?.output.recommendations.find(item => item.findingId === finding.id && item.reportId === report.auditId
        && item.evidenceRefs.length > 0 && item.evidenceRefs.every(ref => ref.reportId === report.auditId && finding.evidenceIds.includes(ref.evidenceId)));
      issues.push({ id: finding.id, title: finding.title, explanation: summary?.text ?? finding.explanation, severity: finding.severity, status: finding.status, category, source,
        recommendation: muse ? { title: muse.title, explanation: `${analysis?.isMock ? "Mock AI recommendation" : "Saved AI recommendation"}: ${muse.recommendation}` }
          : recommendation ? { title: recommendation.title, explanation: recommendation.recommendedChange || recommendation.explanation } : undefined,
        origin: { kind: "finding", channel: category, reportIds: [report.auditId], reportHashes: [reportHash], findingId: finding.id,
          ...(muse ? { recommendationId: muse.id, assessmentId: assessment!.id, analysisId: analysis!.id } : recommendation ? { recommendationId: recommendation.id } : {}), evidenceRefs: finding.evidenceIds.map(evidenceId => ({ reportId: report.auditId, evidenceId })) },
        authoritativeScanAt: report.generatedAt });
    }
  }
  const activeIssues = issues.filter(issue => active(issue.status));
  const top = (["website", "social", "consistency"] as const).flatMap(category => activeIssues.filter(issue => issue.category === category)
    .sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3)).slice(0, 3));
  const selected = new Set(top.map(item => `${item.category}:${item.id}`));
  const remaining = activeIssues.filter(issue => !selected.has(`${issue.category}:${issue.id}`)).sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
  const interpreted = interpretation(assessment, website, social);
  const selectedTop = interpreted === null ? top : (["website", "social", "consistency"] as const).flatMap(category => interpreted.filter(issue => issue.category === category).slice(0, 3));
  return [...selectedTop, ...remaining].map(issue => toTask(issue, businessId));
}

@Injectable()
export class PlannerSourcesService {
  constructor(private readonly reports: FileReportStore, private readonly assessments: AssessmentService,
    private readonly database: AppDatabase) {}
  async read(businessId: string): Promise<PlannerSourceProjection> {
    const sources: PlannerSourceState[] = (["website", "social", "consistency"] as const).map(channel => ({ channel, availability: "unavailable", reportIds: [] }));
    let listed: Awaited<ReturnType<FileReportStore["list"]>>;
    try { listed = await this.reports.list(businessId); }
    catch { return { tasks: [], sources: sources.map(source => ({ ...source, availability: "failed" })) }; }
    const reportFor = async (channel: "website" | "social") => {
      const state = sources.find(source => source.channel === channel)!;
      const candidates = listed.filter(item => item.mode === "live" && (channel === "website" ? ["homepage", "lighthouse"].includes(item.scope) : item.scope === "facebook"));
      for (const candidate of candidates) {
        if (!["completed", "partial"].includes(candidate.status)) continue;
        try {
          const report = await this.reports.read(candidate.auditId);
          if (!report || report.business.id !== businessId || report.audit.businessId !== businessId || report.audit.mode !== "live"
            || (channel === "website" ? !["homepage", "lighthouse"].includes(report.audit.scope) : report.audit.scope !== "facebook")) throw new Error("Invalid source");
          // Match the saved Facebook read route: a partial attempt without usable
          // Facebook facts does not replace an older usable report.
          if (channel === "social" && !report.results?.facebook) continue;
          if (!report.results) throw new Error("Invalid source");
          state.availability = "available"; state.reportIds = [report.auditId]; return report;
        } catch { state.availability = "failed"; return null; }
      }
      if (candidates[0]?.status === "failed") state.availability = "failed";
      return null;
    };
    const [website, social, saved] = await Promise.all([reportFor("website"), reportFor("social"),
      this.assessments.latest(businessId).then(result => ({ value: result.assessment, failed: false })).catch(() => ({ value: null, failed: true }))]);
    try {
      const pending = this.database.connection().prepare("SELECT scope FROM audits WHERE business_id=? AND status IN ('queued','running')").all(businessId);
      for (const row of pending) sources[row.scope === "facebook" ? 1 : 0].availability = "pending";
    } catch { for (const state of sources.slice(0, 2)) state.availability = "failed"; }
    const consistency = sources[2];
    consistency.availability = saved.failed ? "failed" : website && social && interpretation(saved.value, website, social) !== null ? "available" : "unavailable";
    if (saved.failed || sources.slice(0, 2).some(source => source.availability === "failed")) consistency.availability = "failed";
    else if (sources.slice(0, 2).some(source => source.availability === "pending")) consistency.availability = "pending";
    consistency.reportIds = saved.value?.sources.map(item => item.reportId) ?? [];
    let tasks: SourcePlannerTask[];
    try { tasks = projectPlannerSources(businessId, website, social, saved.value); }
    catch { return { tasks: [], sources: sources.map(source => ({ ...source, availability: "failed" })) }; }
    for (const state of sources) if (state.availability === "available" && !tasks.some(task => task.origin.channel === state.channel)) state.availability = "empty";
    return { tasks, sources };
  }
}
