import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { AssessmentMuseAdapter, AssessmentMuseError, prepareAssessmentMuseEvidence } from "../../integrations/assessment-ai/assessment-muse.js";
import { ASSESSMENT_MUSE_V2, ASSESSMENT_MUSE_V3, ASSESSMENT_MUSE_V4, ASSESSMENT_MUSE_V5, assessmentMuseAnalysisSchema } from "../../integrations/assessment-ai/assessment-muse.types.js";
import { validateAssessmentMuseAnalysisOutput } from "../../integrations/assessment-ai/assessment-muse.js";
import { MetaMuseError } from "../../integrations/ai/meta-muse.provider.js";
import { AssessmentService } from "./assessment.service.js";
import { AssessmentStore, assessmentHash } from "./assessment.store.js";

@Injectable()
export class AssessmentAnalysisService {
  private readonly active = new Map<string, Promise<unknown>>();
  constructor(private readonly assessments: AssessmentService, private readonly store: AssessmentStore, private readonly muse: AssessmentMuseAdapter) {}
  private async bundle(businessId: string, assessmentId: string, version: "v1" | "v2" | "v3" | "v4" | "v5" = "v5") {
    const assessment = await this.assessments.read(businessId, assessmentId);
    const sources = await this.assessments.pinnedReports(assessment);
    if (!sources.length) throw new BadRequestException({ code: "ASSESSMENT_EVIDENCE_UNAVAILABLE", message: "Saved live evidence is required for recommendations." });
    return prepareAssessmentMuseEvidence({ assessmentId, businessId, policyVersion: assessment.snapshot.policyVersion, cutoff: assessment.snapshot.cutoff,
      scores: Object.entries(assessment.snapshot.scores).map(([category, score]) => ({ category: category as "website" | "social" | "consistency" | "overall", value: score.value, reasonCodes: score.reasons })), sources,
      ...(version === "v1" ? {} : { snapshot: assessment.snapshot, version }) });
  }
  async create(businessId: string, assessmentId: string) {
    await this.assessments.business(businessId, true);
    try {
      const bundle = await this.bundle(businessId, assessmentId);
      const prepared = this.muse.prepare(bundle);
      // This development workflow deliberately exposes no live dispatch path.
      if (prepared.settings.mode !== "mock") throw new ServiceUnavailableException({ code: "AI_APPROVAL_REQUIRED", message: "The assessment workflow currently permits mocks only. A key or live-mode setting does not authorize spending." });
      const cached = this.store.byCacheKey("analysis", businessId, prepared.cacheKey);
      if (cached) {
        const { createdAt: _createdAt, ...analysis } = cached as Record<string, unknown>;
        void _createdAt;
        return this.muse.validateRecord(bundle, analysis);
      }
      const key = `${businessId}:${assessmentId}`;
      if (this.active.has(key)) throw new ConflictException({ code: "ASSESSMENT_ANALYSIS_ACTIVE", message: "Recommendations are already being prepared for this assessment." });
      const work = (async () => {
        const analysis = await this.muse.analyze(bundle);
        const stored = this.store.write("analysis", { ...analysis, createdAt: analysis.generatedAt }, prepared.cacheKey) as Record<string, unknown>;
        const { createdAt: _createdAt, ...record } = stored;
        void _createdAt;
        return this.muse.validateRecord(bundle, record);
      })();
      this.active.set(key, work);
      try { return await work; } finally { this.active.delete(key); }
    } catch (error) {
      if (error instanceof AssessmentMuseError) throw new BadRequestException({ code: error.code, message: error.message });
      if (error instanceof MetaMuseError) throw new ServiceUnavailableException({ code: error.code, message: error.message });
      throw error;
    }
  }
  /** Local operator preparation only; never estimates, authorizes or dispatches. */
  async preparePocEvidence(businessId: string, assessmentId: string) {
    await this.assessments.business(businessId, true);
    const bundle = await this.bundle(businessId, assessmentId, "v3");
    if (bundle.schemaVersion !== "seo-spy.assessment-muse-evidence.v3" || bundle.policyVersion !== "seo-spy-score-v1.4" || bundle.sources.length !== 2)
      throw new BadRequestException({ code: "ASSESSMENT_POC_EVIDENCE_INVALID", message: "This isolated POC requires saved v1.4 evidence pinned to both reports." });
    return bundle;
  }
  /** Same pinned/replay-validated sources; no estimate, authorization or dispatch. */
  async prepareV4TestingEvidence(businessId: string, assessmentId: string) {
    await this.assessments.business(businessId, true);
    const bundle = await this.bundle(businessId, assessmentId, "v4");
    if (bundle.schemaVersion !== "seo-spy.assessment-muse-evidence.v4" || bundle.policyVersion !== "seo-spy-score-v1.4" || bundle.sources.length !== 2)
      throw new BadRequestException({ code: "ASSESSMENT_POC_EVIDENCE_INVALID", message: "Controlled v4 testing requires saved v1.4 evidence pinned to both reports." });
    return bundle;
  }
  /** Local controlled operator only; shares pinned-source validation and no live gates. */
  async prepareV5TestingEvidence(businessId: string, assessmentId: string) {
    await this.assessments.business(businessId, true);
    const bundle = await this.bundle(businessId, assessmentId, "v5");
    if (bundle.schemaVersion !== "seo-spy.assessment-muse-evidence.v5" || bundle.policyVersion !== "seo-spy-score-v1.4" || bundle.sources.length !== 2)
      throw new BadRequestException({ code: "ASSESSMENT_POC_EVIDENCE_INVALID", message: "Controlled v5 testing requires saved v1.4 evidence pinned to both reports." });
    return bundle;
  }
  async read(businessId: string, assessmentId: string, analysisId: string) {
    const saved = this.store.read("analysis", businessId, analysisId);
    if (!saved) throw new NotFoundException({ code: "ASSESSMENT_ANALYSIS_NOT_FOUND", message: "Saved recommendations were not found." });
    const { createdAt: _createdAt, ...record } = saved as Record<string, unknown>;
    void _createdAt;
    const parsed = assessmentMuseAnalysisSchema.safeParse(record);
    if (!parsed.success || parsed.data.assessmentId !== assessmentId) throw new NotFoundException({ code: "ASSESSMENT_ANALYSIS_NOT_FOUND", message: "Saved recommendations do not belong to this assessment." });
    const bundle = await this.bundle(businessId, assessmentId, parsed.data.promptVersion === ASSESSMENT_MUSE_V5.prompt ? "v5" : parsed.data.promptVersion === ASSESSMENT_MUSE_V4.prompt ? "v4" : parsed.data.promptVersion === ASSESSMENT_MUSE_V3.prompt ? "v3" : parsed.data.promptVersion === ASSESSMENT_MUSE_V2.prompt ? "v2" : "v1");
    // Historic saved reads stay usable when model settings change; provenance is preserved.
    if (parsed.data.businessId !== businessId || parsed.data.policyVersion !== bundle.policyVersion || parsed.data.inputHash !== assessmentHash(bundle) || parsed.data.sourceManifest.length !== bundle.sources.length
      || JSON.stringify(parsed.data.sourceManifest) !== JSON.stringify(bundle.sources)) throw new ServiceUnavailableException({ code: "ASSESSMENT_STORAGE_ERROR", message: "Saved recommendations no longer match their evidence." });
    try { validateAssessmentMuseAnalysisOutput(parsed.data, bundle); }
    catch { throw new ServiceUnavailableException({ code: "ASSESSMENT_STORAGE_ERROR", message: "Saved recommendations no longer match their evidence." }); }
    return parsed.data;
  }
}
