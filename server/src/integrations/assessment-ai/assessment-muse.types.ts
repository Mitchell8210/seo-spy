import { z } from "zod";

export const ASSESSMENT_MUSE_PROMPT_VERSION = "assessment-muse-prompt-v1";
export const ASSESSMENT_MUSE_OUTPUT_VERSION = "assessment-muse-output-v1";
export const ASSESSMENT_MUSE_FIXTURE_VERSION = "assessment-muse-fixture-v1";
export const ASSESSMENT_MUSE_SELECTION_VERSION = "assessment-muse-selection-v1";
const id = z.string().min(1).max(160);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(700);
export const assessmentEvidenceRefSchema = z.object({ reportId: id, evidenceId: id }).strict();
export const assessmentSourceSchema = z.object({ reportId: id, contentHash: hash, provider: z.enum(["website", "facebook"]), collectedAt: z.string().datetime(), status: z.enum(["completed", "partial"]) }).strict();
const category = z.enum(["website", "social", "consistency", "overall"]);
export const assessmentMuseEvidenceSchema = z.object({
  schemaVersion: z.literal("seo-spy.assessment-muse-evidence.v1"), assessmentId: z.string().uuid(), businessId: id,
  policyVersion: id, cutoff: z.string().datetime(), selectionVersion: z.literal(ASSESSMENT_MUSE_SELECTION_VERSION),
  sources: z.array(assessmentSourceSchema).min(1).max(2),
  scores: z.array(z.object({ category, value: z.number().finite().min(0).max(100).nullable(), reasonCodes: z.array(z.string().regex(/^[A-Z0-9_:-]{1,100}$/)).max(15) }).strict()).max(4),
  findings: z.array(z.object({ reportId: id, findingId: id, source: z.enum(["website", "facebook"]), title: z.string().min(1).max(160),
    summary: z.string().min(1).max(280), severity: z.enum(["critical", "medium", "low"]), evidenceRefs: z.array(assessmentEvidenceRefSchema).min(1).max(4),
    existingRecommendation: z.object({ title: z.string().min(1).max(160), change: text }).strict().nullable(),
  }).strict()).max(12),
  coverage: z.object({ selectedFindings: z.number().int().min(0).max(12), omittedFindings: z.number().int().nonnegative(), limitations: z.array(text).min(1).max(8) }).strict(),
}).strict();
export type AssessmentMuseEvidenceBundle = z.infer<typeof assessmentMuseEvidenceSchema>;
export type AssessmentMuseScoreSummary = AssessmentMuseEvidenceBundle["scores"][number];

/** Informational recommendations only: no scores, executable patches, approvals or targets. */
export const assessmentMuseOutputSchema = z.object({
  schemaVersion: z.literal(ASSESSMENT_MUSE_OUTPUT_VERSION), summary: z.string().min(1).max(280), summaryEvidenceRefs: z.array(assessmentEvidenceRefSchema).max(12),
  recommendations: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), reportId: id, findingId: id,
    title: z.string().min(1).max(160), recommendation: text, rationale: text,
    effort: z.enum(["small", "medium", "large", "unknown"]), risk: z.enum(["low", "medium", "high", "unknown"]),
    evidenceRefs: z.array(assessmentEvidenceRefSchema).min(1).max(4), verificationSteps: z.array(text).min(1).max(4), manualFallback: text,
  }).strict()).max(5),
  scoringExplanation: z.object({ text, categories: z.array(category).max(4) }).strict(),
  limitations: z.array(text).min(1).max(8),
}).strict();
export type AssessmentMuseOutput = z.infer<typeof assessmentMuseOutputSchema>;

export const assessmentMuseAnalysisSchema = z.object({
  schemaVersion: z.literal("seo-spy.assessment-muse-analysis.v1"), id: z.string().uuid(), assessmentId: z.string().uuid(), businessId: id,
  policyVersion: id, sourceManifest: z.array(assessmentSourceSchema).min(1).max(2), inputHash: hash, cacheKey: hash,
  promptVersion: z.literal(ASSESSMENT_MUSE_PROMPT_VERSION), outputSchemaVersion: z.literal(ASSESSMENT_MUSE_OUTPUT_VERSION),
  model: z.enum(["muse-spark-1.3", "muse-spark-1.2"]), generationMode: z.enum(["mock", "poc", "demo"]), provider: z.enum(["mock-fixture", "meta"]), isMock: z.boolean(),
  fixtureVersion: z.literal(ASSESSMENT_MUSE_FIXTURE_VERSION).optional(), startedAt: z.string().datetime(), generatedAt: z.string().datetime(),
  usage: z.object({ inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), outputTokens: z.number().int().nonnegative().max(1500) }).strict(),
  requestId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/).nullable(), usageAttemptId: z.string().uuid().optional(),
  output: assessmentMuseOutputSchema, limitations: z.array(text).min(1).max(8),
}).strict().superRefine((record, context) => {
  const mock = record.generationMode === "mock";
  if (mock ? record.provider !== "mock-fixture" || !record.isMock || record.fixtureVersion !== ASSESSMENT_MUSE_FIXTURE_VERSION || record.usage.inputTokens !== 0 || record.usage.outputTokens !== 0 || record.requestId !== null || record.usageAttemptId !== undefined
    : record.provider !== "meta" || record.isMock || record.fixtureVersion !== undefined || !record.usageAttemptId)
    context.addIssue({ code: "custom", message: "Analysis generation provenance is incompatible." });
});
export type AssessmentMuseAnalysis = z.infer<typeof assessmentMuseAnalysisSchema>;
