import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assessmentMuseAnalysisSchema } from "../../integrations/assessment-ai/assessment-muse.types.js";
import { BUSINESS_REPOSITORY, type BusinessRepository } from "../../persistence/repositories.js";
import { FileReportStore } from "../../reports/file-report.store.js";
import type { AuditReportRecord } from "../../reports/report.types.js";
import { calculateScoreSnapshot } from "../../scoring/calculator.js";
import type { ScoreAssessmentInput, ScorePolicyVersion, ScoreProfile, ScoreSnapshot } from "../../scoring/scoring.types.js";
import { sourceReviewReuseReasons } from "../../scoring/review-reuse.js";
import { buildAssessmentInput } from "./assessment-input.js";
import { assessmentHash, AssessmentStore } from "./assessment.store.js";
import { allConfirmedFactsSchema, confirmedFactsInputSchema, sourceAgreementInputSchema, type AnyConfirmedScoringFacts } from "./confirmed-facts.js";

export interface AssessmentRecord {
  schemaVersion: "seo-spy.assessment.v1"; id: string; businessId: string; createdAt: string; cacheKey: string;
  input: ScoreAssessmentInput; snapshot: ScoreSnapshot;
}
export interface AssessmentSelection { websiteReportId?: string; facebookReportId?: string; profile?: ScoreProfile; cutoff?: string; policyVersion?: ScorePolicyVersion }
const storageFailure = () => new ServiceUnavailableException({ code: "ASSESSMENT_STORAGE_ERROR", message: "The saved assessment is invalid or cannot be replayed safely." });

@Injectable()
export class AssessmentService {
  constructor(@Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository, private readonly reports: FileReportStore,
    private readonly store: AssessmentStore, private readonly config: ConfigService) {}
  async business(businessId: string, operator = false) {
    const business = await this.businesses.findById(businessId);
    if (!business) throw new NotFoundException({ code: "BUSINESS_NOT_FOUND", message: "Business not found." });
    if (operator && this.config.get<string>("WORDPRESS_BUSINESS_ID") !== businessId) throw new ForbiddenException({ code: "ASSESSMENT_BUSINESS_MISMATCH", message: "This business is not bound to the current local operator connection." });
    return business;
  }
  private validate(input: unknown, businessId: string): AssessmentRecord {
    try {
      const record = input as AssessmentRecord;
      if (record.schemaVersion !== "seo-spy.assessment.v1" || record.businessId !== businessId || !z.string().uuid().safeParse(record.id).success
        || !z.string().datetime().safeParse(record.createdAt).success || record.input.businessId !== businessId || record.snapshot.businessId !== businessId) throw storageFailure();
      const expected = calculateScoreSnapshot(record.input);
      if (assessmentHash(expected) !== assessmentHash(record.snapshot) || record.cacheKey !== assessmentHash({ version: "assessment-cache-v1", input: record.input, policyHash: expected.policyHash })) throw storageFailure();
      return record;
    } catch { throw storageFailure(); }
  }
  async source(businessId: string, id: string, provider: "website" | "facebook") {
    const report = await this.reports.read(id);
    if (!report || report.business.id !== businessId || report.audit.businessId !== businessId) throw new NotFoundException({ code: "ASSESSMENT_SOURCE_NOT_FOUND", message: "The selected report does not belong to this business." });
    if (report.audit.mode !== "live" || !["completed", "partial"].includes(report.audit.status) || (provider === "website" ? !["homepage", "lighthouse"].includes(report.audit.scope) : report.audit.scope !== "facebook")) {
      throw new BadRequestException({ code: "ASSESSMENT_SOURCE_UNUSABLE", message: "Only usable saved live reports of the selected channel can be assessed." });
    }
    return report;
  }
  facts(businessId: string, cutoff?: string): AnyConfirmedScoringFacts | null {
    for (const record of this.store.list("confirmed-facts", businessId, cutoff ? 100 : 1)) {
      const parsed = allConfirmedFactsSchema.safeParse(record);
      if (!parsed.success || parsed.data.businessId !== businessId) throw storageFailure();
      if (!cutoff || Date.parse(parsed.data.createdAt) <= Date.parse(cutoff)) return parsed.data;
    }
    return null;
  }
  async confirmFacts(businessId: string, actor: string, body: unknown) {
    const business = await this.business(businessId, true);
    const parsed = z.union([confirmedFactsInputSchema, sourceAgreementInputSchema]).safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: "SCORING_FACTS_INVALID", message: "Confirm preferred values, explicit applicability and the publishing target using the scoring-facts contract." });
    if ("comparisonMode" in parsed.data) {
      const values = parsed.data;
      await this.source(businessId, values.websiteReportId, "website");
      await this.source(businessId, values.facebookReportId, "facebook");
      if (values.sourceReviews.some(review => review.reportId !== (review.provider === "website" ? values.websiteReportId : values.facebookReportId))) throw new BadRequestException({ code: "SCORING_FACTS_EVIDENCE_INVALID", message: "Source reviews must reference the attested report pair." });
    } else if (!parsed.data.preferred.websiteUrls.some(value => new URL(value).href === new URL(business.website).href)) throw new BadRequestException({ code: "SCORING_FACTS_SITE_MISMATCH", message: "The approved canonical destinations must include the registered business website." });
    for (const absence of ("profileAbsences" in parsed.data ? parsed.data.profileAbsences : [])) {
      const report = await this.source(businessId, absence.reportId, "facebook");
      if (absence.evidenceIds.some(id => !report.results?.evidence.some(item => item.id === id))) throw new BadRequestException({ code: "SCORING_FACTS_EVIDENCE_INVALID", message: "Visible-absence confirmations must reference the selected saved report's evidence." });
    }
    const reviews = parsed.data.sourceReviews ?? [];
    if (new Set(reviews.map(review => `${review.provider}:${review.reportId}:${review.field}`)).size !== reviews.length) throw new BadRequestException({ code: "SCORING_FACTS_EVIDENCE_INVALID", message: "Conflicting duplicate source reviews are not allowed." });
    for (const review of reviews) {
      const source = await this.source(businessId, review.reportId, review.provider);
      if (Date.parse(review.observedAt) > Date.now() || review.evidenceIds.some(id => !source.results?.evidence.some(item => item.id === id && item.checkId === (review.provider === "website" ? "business-facts" : "facebook:profile:hours")))) {
        throw new BadRequestException({ code: "SCORING_FACTS_EVIDENCE_INVALID", message: "Hours source reviews require matching saved evidence and a nonfuture observation time." });
      }
    }
    const record = allConfirmedFactsSchema.parse({ schemaVersion: "comparisonMode" in parsed.data ? "seo-spy.confirmed-scoring-facts.v2" : "seo-spy.confirmed-scoring-facts.v1", id: randomUUID(), businessId, createdAt: new Date().toISOString(), confirmedBy: actor, values: parsed.data });
    return allConfirmedFactsSchema.parse(this.store.write("confirmed-facts", record, assessmentHash(record)));
  }
  async create(businessId: string, selection: AssessmentSelection = {}): Promise<AssessmentRecord> {
    const business = await this.business(businessId);
    const list = await this.reports.list(businessId);
    const candidates = list.filter(item => item.mode === "live" && ["completed", "partial"].includes(item.status));
    const websiteId = selection.websiteReportId ?? candidates.find(item => ["homepage", "lighthouse"].includes(item.scope))?.auditId;
    const facebookId = selection.facebookReportId ?? candidates.find(item => item.scope === "facebook")?.auditId;
    const [website, facebook] = await Promise.all([websiteId ? this.source(businessId, websiteId, "website") : null, facebookId ? this.source(businessId, facebookId, "facebook") : null]);
    const cutoff = selection.cutoff ?? new Date().toISOString();
    if (!z.string().datetime({ offset: true }).safeParse(cutoff).success || Date.parse(cutoff) > Date.now()) throw new BadRequestException({ code: "ASSESSMENT_CUTOFF_INVALID", message: "Assessment cutoff must be a valid current or historical UTC timestamp." });
    const policyVersion = selection.policyVersion ?? "seo-spy-score-v1.4";
    const facts = this.facts(businessId, cutoff);
    let reviewedSources: { website: AuditReportRecord; facebook: AuditReportRecord } | undefined;
    if (["seo-spy-score-v1.3", "seo-spy-score-v1.4"].includes(policyVersion) && facts?.schemaVersion === "seo-spy.confirmed-scoring-facts.v2") {
      try {
        const [reviewedWebsite, reviewedFacebook] = await Promise.all([
          this.source(businessId, facts.values.websiteReportId, "website"), this.source(businessId, facts.values.facebookReportId, "facebook"),
        ]);
        reviewedSources = { website: reviewedWebsite, facebook: reviewedFacebook };
      } catch (error) { if (!(error instanceof NotFoundException)) throw error; }
    }
    const input = buildAssessmentInput({ business, website, facebook, cutoff, profile: selection.profile ?? "baseline-mobile-v1", facts, policyVersion, reviewedSources });
    const snapshot = calculateScoreSnapshot(input);
    const cacheKey = assessmentHash({ version: "assessment-cache-v1", input, policyHash: snapshot.policyHash });
    const previous = this.store.byCacheKey("assessment", businessId, cacheKey);
    if (previous) return this.validate(previous, businessId);
    const record: AssessmentRecord = { schemaVersion: "seo-spy.assessment.v1", id: randomUUID(), businessId, createdAt: new Date().toISOString(), cacheKey, input, snapshot };
    return this.validate(this.store.write("assessment", record, cacheKey), businessId);
  }
  async read(businessId: string, id: string): Promise<AssessmentRecord> {
    await this.business(businessId);
    const record = this.store.read("assessment", businessId, id);
    if (!record) throw new NotFoundException({ code: "ASSESSMENT_NOT_FOUND", message: "Saved assessment not found." });
    return this.validate(record, businessId);
  }
  async pinnedReports(record: AssessmentRecord): Promise<AuditReportRecord[]> {
    const reports: AuditReportRecord[] = [];
    for (const source of record.input.sources) {
      const report = await this.source(record.businessId, source.reportId, source.provider);
      if (assessmentHash(report) !== source.reportHash) throw storageFailure();
      reports.push(report);
    }
    return reports;
  }
  /** Saved reads never collect, generate AI, calculate a replacement snapshot or rewrite history. */
  async latest(businessId: string) {
    await this.business(businessId);
    const saved = this.store.list("assessment", businessId, 1)[0];
    if (!saved) return { businessId, assessment: null };
    const record = this.validate(saved, businessId);
    let analysis = null;
    for (const item of this.store.list("analysis", businessId, 100)) {
      const { createdAt: _createdAt, ...value } = item as Record<string, unknown>;
      void _createdAt;
      const parsed = assessmentMuseAnalysisSchema.safeParse(value);
      if (!parsed.success) throw storageFailure();
      if (parsed.data.assessmentId !== record.id) continue;
      if (parsed.data.businessId !== businessId || parsed.data.policyVersion !== record.snapshot.policyVersion
        || parsed.data.sourceManifest.length !== record.snapshot.sources.length
        || parsed.data.sourceManifest.some(source => !record.snapshot.sources.some(item => item.reportId === source.reportId && item.reportHash === source.contentHash))) throw storageFailure();
      analysis = parsed.data;
      break;
    }
    const now = Date.now();
    const scores = structuredClone(record.snapshot.scores);
    const sourceAges = new Map(record.input.sources.map(source => [source.provider, now - Date.parse(source.collectedAt)]));
    const reasons: string[] = [];
    for (const category of ["website", "social", "consistency", "overall"] as const) {
      const providers = category === "website" ? ["website"] : category === "social" ? ["facebook"] : ["website", "facebook"];
      if (providers.some(provider => { const age = sourceAges.get(provider as "website" | "facebook"); return age !== undefined && (!Number.isFinite(age) || age < 0 || age > 7 * 86400000); })) {
        scores[category] = { ...scores[category], value: null, availability: "unavailable", reasons: [...new Set([...scores[category].reasons, "STALE_INPUT"])], exact: null };
        reasons.push("STALE_INPUT");
      }
    }
    const facts = this.facts(businessId);
    if (["seo-spy-score-v1.3", "seo-spy-score-v1.4"].includes(record.snapshot.policyVersion) && record.input.consistency?.comparisonMode === "source-agreement") {
      const reviewReasons = sourceReviewReuseReasons(record.input, new Date(now).toISOString());
      if (reviewReasons.length) {
        for (const category of ["consistency", "overall"] as const) scores[category] = { ...scores[category], value: null, availability: "unavailable", exact: null, reasons: [...new Set([...scores[category].reasons, ...reviewReasons])] };
        reasons.push(...reviewReasons);
      }
    }
    const confirmedIds = Object.values(record.snapshot.confirmations).filter(item => item !== null).map(item => item.revision);
    const confirmationsChanged = (facts && !confirmedIds.includes(facts.id)) || (!facts && confirmedIds.length > 0);
    if (confirmationsChanged) {
      for (const category of ["social", "consistency", "overall"] as const) scores[category] = { ...scores[category], value: null, availability: "unavailable", exact: null, reasons: [...new Set([...scores[category].reasons, "CONFIRMATIONS_CHANGED"])] };
      reasons.push("CONFIRMATIONS_CHANGED");
    }
    const socialAssessment = record.snapshot.socialAssessment ? structuredClone(record.snapshot.socialAssessment) : null;
    if (socialAssessment) {
      const stale = now > Date.parse(socialAssessment.freshness.expiresAt) || now < Date.parse(socialAssessment.freshness.collectedAt) || scores.social.reasons.includes("STALE_INPUT");
      if (stale || confirmationsChanged) {
        const reason = stale ? "STALE_INPUT" : "CONFIRMATIONS_CHANGED";
        socialAssessment.status = "insufficient_data"; socialAssessment.value = null; socialAssessment.exact = null;
        socialAssessment.knownWeight = 0; socialAssessment.coveragePercent = 0;
        if (stale) socialAssessment.freshness.status = "stale";
        socialAssessment.categories = socialAssessment.categories.map(category => ({ ...category, earned: null, evidencedWeight: 0, status: "unavailable",
          criteria: category.criteria.map(criterion => ({ ...criterion, earned: null, exact: null, status: "unavailable", value: null, reason })) }));
        socialAssessment.missingMetrics = socialAssessment.categories.flatMap(category => category.criteria.map(criterion => ({ id: criterion.id, label: criterion.label, reason })));
        for (const category of ["social", "overall"] as const) scores[category] = { ...scores[category], value: null, availability: "unavailable", exact: null, reasons: [...new Set([...scores[category].reasons, reason])] };
        reasons.push(reason);
      }
    }
    return { businessId, assessment: { id: record.id, businessId, policyVersion: record.snapshot.policyVersion, policyHash: record.snapshot.policyHash, profile: record.snapshot.profile, cutoff: record.snapshot.cutoff,
      ...(record.snapshot.reportingCutoff !== undefined ? { reportingCutoff: record.snapshot.reportingCutoff } : {}),
      ...(record.snapshot.socialScope ? { socialScope: record.snapshot.socialScope } : {}),
      ...(socialAssessment ? { socialAssessment } : {}),
      ...(record.snapshot.consistencyBasis ? { consistencyBasis: record.snapshot.consistencyBasis } : {}),
      readAt: new Date(now).toISOString(), sources: record.snapshot.sources, scores, analysis,
      comparisons: record.input.consistency?.criteria.map(item => ({ id: item.id, outcome: confirmationsChanged || scores.consistency.reasons.some(reason => ["STALE_INPUT", "SOURCE_REVIEW_EXPIRED", "SOURCE_REVIEW_CHANGED_OR_UNAVAILABLE", "UNCONFIRMED_SOURCE_REUSE"].includes(reason)) ? "unknown" as const : item.outcome, applicable: item.applicable, website: item.observations?.website ?? null, facebook: item.observations?.facebook ?? null })) ?? [],
      reasons: [...new Set(reasons)], limitations: record.snapshot.limitations } };
  }
}
