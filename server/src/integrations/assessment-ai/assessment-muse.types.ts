import { z } from "zod";

export const ASSESSMENT_MUSE_PROMPT_VERSION = "assessment-muse-prompt-v1";
export const ASSESSMENT_MUSE_OUTPUT_VERSION = "assessment-muse-output-v1";
export const ASSESSMENT_MUSE_FIXTURE_VERSION = "assessment-muse-fixture-v1";
export const ASSESSMENT_MUSE_SELECTION_VERSION = "assessment-muse-selection-v1";
export const ASSESSMENT_MUSE_V2 = {
  prompt: "assessment-muse-prompt-v2", fixture: "assessment-muse-fixture-v2", selection: "assessment-muse-selection-v2",
} as const;
export const ASSESSMENT_MUSE_V3 = { prompt: "assessment-muse-prompt-v3", fixture: "assessment-muse-fixture-v3", selection: "assessment-muse-selection-v3" } as const;
export const ASSESSMENT_MUSE_V4 = { prompt: "assessment-muse-prompt-v4", fixture: "assessment-muse-fixture-v4", selection: "assessment-muse-selection-v4" } as const;
export const ASSESSMENT_MUSE_V5 = { prompt: "assessment-muse-prompt-v5", fixture: "assessment-muse-fixture-v5", selection: "assessment-muse-selection-v5" } as const;
export const ASSESSMENT_MUSE_V3_PROSE_FIXTURE = "assessment-muse-fixture-v3.1";
const id = z.string().min(1).max(160);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(700);
export const assessmentEvidenceRefSchema = z.object({ reportId: id, evidenceId: id }).strict();
export const assessmentSourceSchema = z.object({ reportId: id, contentHash: hash, provider: z.enum(["website", "facebook"]), collectedAt: z.string().datetime(), status: z.enum(["completed", "partial"]) }).strict();
const category = z.enum(["website", "social", "consistency", "overall"]);
const legacyEvidenceSchema = z.object({
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
const boundedNumber = z.number().finite().nonnegative();
const reasons = z.array(z.string().regex(/^[A-Z0-9_:-]{1,100}$/)).max(8);
const measurementGapSchema = z.object({ category, id, reasonCode: z.string().max(100), label: z.string().max(80), explanation: z.string().min(1).max(220) }).strict();
export const scoringObservationSchema = z.object({
  id, category, kind: z.enum(["strength", "weakness"]), statement: z.string().min(1).max(240),
  evidenceRefs: z.array(assessmentEvidenceRefSchema).min(1).max(4),
  // Only an established criterion shortfall may offer this informational next step.
  nextStep: z.object({ title: z.string().min(1).max(100), text: z.string().min(1).max(360), verification: z.string().min(1).max(240),
    effort: z.enum(["small", "medium", "large", "unknown"]), risk: z.enum(["low", "medium", "high", "unknown"]),
    severity: z.enum(["critical", "medium", "low"]), shortfallPoints: boundedNumber.max(100),
  }).strict().nullable(),
}).strict();
export const assessmentScoringContextSchema = z.object({
  policyHash: hash, asOf: z.string().datetime(),
  components: z.array(z.object({ category, value: boundedNumber.max(100).nullable(), availability: z.enum(["available", "unavailable"]),
    knownWeight: boundedNumber.max(100), requiredWeight: boundedNumber.max(100), reasonCodes: reasons,
    breakdown: z.array(z.object({ id, label: z.string().max(80), maximumPoints: boundedNumber.max(100).nullable(), earnedPoints: boundedNumber.max(100).nullable(),
      score: boundedNumber.max(100).nullable(), knownWeight: boundedNumber.max(100), applicableWeight: boundedNumber.max(100),
      status: z.enum(["available", "partial", "unavailable", "not_applicable"]), reasonCodes: reasons,
    }).strict()).max(6),
  }).strict()).length(4),
  socialStatus: z.enum(["definitive", "provisional", "insufficient_data"]).nullable(), socialCoveragePercent: boundedNumber.max(100).nullable(),
  observations: z.array(scoringObservationSchema).max(12), omittedObservations: z.number().int().nonnegative(),
  measurementGaps: z.array(measurementGapSchema).max(12), omittedMeasurementGaps: z.number().int().nonnegative(),
  limitations: z.array(z.string().min(1).max(280)).max(8),
}).strict();
export type AssessmentScoringContext = z.infer<typeof assessmentScoringContextSchema>;
export type ScoringObservation = z.infer<typeof scoringObservationSchema>;
const currentEvidenceSchema = legacyEvidenceSchema.extend({
  schemaVersion: z.literal("seo-spy.assessment-muse-evidence.v2"), selectionVersion: z.literal(ASSESSMENT_MUSE_V2.selection),
  scoringContext: assessmentScoringContextSchema,
}).strict();
const businessRefList = z.array(assessmentEvidenceRefSchema).min(1).max(6);
const businessFactSchema = z.object({ id, category: z.enum(["website", "social", "consistency"]), kind: z.enum(["strength", "weakness", "context"]), group: id,
  text: z.string().min(1).max(500), evidenceRefs: businessRefList }).strict();
export const businessRecommendationSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), reportId: id, findingId: id, title: z.string().min(1).max(160),
  recommendation: z.string().min(1).max(500), rationale: z.string().min(1).max(400), effort: z.enum(["small", "medium", "large", "unknown"]), risk: z.enum(["low", "medium", "high", "unknown"]),
  evidenceRefs: businessRefList, verificationSteps: z.array(z.string().min(1).max(280)).min(1).max(3), manualFallback: z.string().min(1).max(280),
  origin: z.object({ kind: z.enum(["finding", "scoring-observation"]), category: z.enum(["website", "social", "consistency"]), sourceRefs: businessRefList }).strict(),
}).strict();
const businessEvidenceSchema = currentEvidenceSchema.extend({
  schemaVersion: z.literal("seo-spy.assessment-muse-evidence.v3"), selectionVersion: z.literal(ASSESSMENT_MUSE_V3.selection),
  businessContext: z.object({ facts: z.array(businessFactSchema).max(8),
    measures: z.array(z.object({ id, value: boundedNumber, unit: z.string().max(100), since: z.string().datetime().nullable(), until: z.string().datetime().nullable(),
      normalizedValue: boundedNumber.nullable(), evidenceRefs: businessRefList }).strict()).max(8),
    overallContributions: z.array(z.object({ category, weight: boundedNumber.max(100), earnedPoints: boundedNumber.nullable() }).strict()).max(3),
    executiveAssessment: z.string().min(1).max(700), scoringExplanation: z.string().min(1).max(1400),
    recommendations: z.array(businessRecommendationSchema).max(5),
  }).strict(),
}).strict();
export const opportunitySchema = z.object({
  id: z.string().regex(/^o_[a-f0-9]{16}$/), group: id, kind: z.enum(["confirmed", "conditional-review"]),
  severity: z.enum(["critical", "medium", "low"]), statement: z.string().min(1).max(500),
  action: businessRecommendationSchema,
}).strict();
const opportunityEvidenceSchema = businessEvidenceSchema.extend({
  schemaVersion: z.literal("seo-spy.assessment-muse-evidence.v4"), selectionVersion: z.literal(ASSESSMENT_MUSE_V4.selection),
  opportunities: z.array(opportunitySchema).max(8),
}).strict();
export type Opportunity = z.infer<typeof opportunitySchema>;
export type OpportunityBundle = z.infer<typeof opportunityEvidenceSchema>;
export const opportunitySelectionSchema = z.object({ schemaVersion: z.literal("assessment-muse-selection-output-v4"), opportunityIds: z.array(id).max(3) }).strict();
const transparencyEvidenceSchema = opportunityEvidenceSchema.extend({
  schemaVersion: z.literal("seo-spy.assessment-muse-evidence.v5"), selectionVersion: z.literal(ASSESSMENT_MUSE_V5.selection),
  reviewIfOmittedIds: z.array(id).max(2),
}).strict();
export type TransparencyBundle = z.infer<typeof transparencyEvidenceSchema>;
export const selectedDecisionReasons = ["ADDRESS_CONFIRMED_SHORTFALL", "RESOLVE_CUSTOMER_INFORMATION", "VERIFY_RECORDED_FLAG"] as const;
export const omittedDecisionReasons = ["FOCUS_CONFIRMED_SHORTFALLS", "HIGHER_PRIORITY_ELSEWHERE", "CONTEXT_BEFORE_PRIORITIZING"] as const;
const opportunityIdSchema = z.string().regex(/^o_[a-f0-9]{16}$/);
export const transparencySelectionSchema = z.object({
  schemaVersion: z.literal("assessment-muse-selection-output-v5"),
  selected: z.array(z.object({ id: opportunityIdSchema, reason: z.enum(selectedDecisionReasons) }).strict()).max(3),
  omitted: z.array(z.object({ id: opportunityIdSchema, reason: z.enum(omittedDecisionReasons) }).strict()).max(2),
}).strict();
export type TransparencySelection = z.infer<typeof transparencySelectionSchema>;
export const assessmentMuseEvidenceSchema = z.discriminatedUnion("schemaVersion", [legacyEvidenceSchema, currentEvidenceSchema, businessEvidenceSchema, opportunityEvidenceSchema, transparencyEvidenceSchema]);
export type AssessmentMuseEvidenceBundle = z.infer<typeof assessmentMuseEvidenceSchema>;
export type AssessmentMuseScoreSummary = AssessmentMuseEvidenceBundle["scores"][number];

/** Informational recommendations only: no scores, executable patches, approvals or targets. */
export const legacyAssessmentMuseOutputSchema = z.object({
  schemaVersion: z.literal(ASSESSMENT_MUSE_OUTPUT_VERSION), summary: z.string().min(1).max(280), summaryEvidenceRefs: z.array(assessmentEvidenceRefSchema).max(12),
  recommendations: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), reportId: id, findingId: id,
    title: z.string().min(1).max(160), recommendation: text, rationale: text,
    effort: z.enum(["small", "medium", "large", "unknown"]), risk: z.enum(["low", "medium", "high", "unknown"]),
    evidenceRefs: z.array(assessmentEvidenceRefSchema).min(1).max(4), verificationSteps: z.array(text).min(1).max(4), manualFallback: text,
  }).strict()).max(5),
  scoringExplanation: z.object({ text, categories: z.array(category).max(4) }).strict(),
  limitations: z.array(text).min(1).max(8),
}).strict();
const verifiedClaim = z.object({ observationId: id, text: z.string().min(1).max(240), evidenceRefs: z.array(assessmentEvidenceRefSchema).min(1).max(4) }).strict();
export const currentAssessmentMuseOutputSchema = legacyAssessmentMuseOutputSchema.extend({
  schemaVersion: z.literal("assessment-muse-output-v2"),
  strengths: z.array(verifiedClaim).max(3), weaknesses: z.array(verifiedClaim).max(3),
  measurementGaps: z.array(measurementGapSchema).max(5),
}).strict();
export const businessAssessmentMuseOutputSchema = currentAssessmentMuseOutputSchema.extend({
  schemaVersion: z.literal("assessment-muse-output-v3"), summary: z.string().min(1).max(700),
  strengths: z.array(z.object({ observationId: id, text: z.string().min(1).max(500), evidenceRefs: businessRefList }).strict()).max(3),
  weaknesses: z.array(z.object({ observationId: id, text: z.string().min(1).max(500), evidenceRefs: businessRefList }).strict()).max(3),
  recommendations: z.array(businessRecommendationSchema).max(5),
  scoringExplanation: z.object({ text: z.string().min(1).max(1400), categories: z.array(category).max(4) }).strict(),
}).strict();
/** The provider selects vetted IDs, not a large repeated ledger/citation JSON.
 * Full verified prose and references are materialized locally under the same
 * output validation. This keeps the unchanged paid output cap practical.
 */
export const businessMuseSelectionSchema = z.object({
  schemaVersion: z.literal("assessment-muse-selection-output-v3"),
  strengthIds: z.array(id).max(3), weaknessIds: z.array(id).max(3), recommendationIds: z.array(id).max(5),
}).strict();
export const opportunityOutputSchema = businessAssessmentMuseOutputSchema.extend({ schemaVersion: z.literal("assessment-muse-output-v4"), recommendations: z.array(businessRecommendationSchema).max(3), summaryEvidenceRefs: z.array(assessmentEvidenceRefSchema).max(18), measurementGaps: z.array(measurementGapSchema).max(12), limitations: z.array(text).min(1).max(32) }).strict();
export const assessmentMuseOutputSchema = z.discriminatedUnion("schemaVersion", [legacyAssessmentMuseOutputSchema, currentAssessmentMuseOutputSchema, businessAssessmentMuseOutputSchema, opportunityOutputSchema]);
export type AssessmentMuseOutput = z.infer<typeof assessmentMuseOutputSchema>;

export const assessmentMuseAnalysisSchema = z.object({
  schemaVersion: z.literal("seo-spy.assessment-muse-analysis.v1"), id: z.string().uuid(), assessmentId: z.string().uuid(), businessId: id,
  policyVersion: id, sourceManifest: z.array(assessmentSourceSchema).min(1).max(2), inputHash: hash, cacheKey: hash,
  promptVersion: z.enum([ASSESSMENT_MUSE_PROMPT_VERSION, ASSESSMENT_MUSE_V2.prompt, ASSESSMENT_MUSE_V3.prompt, ASSESSMENT_MUSE_V4.prompt, ASSESSMENT_MUSE_V5.prompt]), outputSchemaVersion: z.enum([ASSESSMENT_MUSE_OUTPUT_VERSION, "assessment-muse-output-v2", "assessment-muse-output-v3", "assessment-muse-output-v4"]),
  model: z.enum(["muse-spark-1.3", "muse-spark-1.2"]), generationMode: z.enum(["mock", "poc", "demo"]), provider: z.enum(["mock-fixture", "meta"]), isMock: z.boolean(),
  fixtureVersion: z.enum([ASSESSMENT_MUSE_FIXTURE_VERSION, ASSESSMENT_MUSE_V2.fixture, ASSESSMENT_MUSE_V3.fixture, ASSESSMENT_MUSE_V3_PROSE_FIXTURE, ASSESSMENT_MUSE_V4.fixture, ASSESSMENT_MUSE_V5.fixture]).optional(), startedAt: z.string().datetime(), generatedAt: z.string().datetime(),
  usage: z.object({ inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), outputTokens: z.number().int().nonnegative().max(1500) }).strict(),
  requestId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/).nullable(), usageAttemptId: z.string().uuid().optional(),
  authorization: z.object({ intentId: z.string().uuid(), actor: hash, requestHash: hash, scope: z.string().min(1).max(300), maximumMicros: z.number().int().positive() }).strict().optional(),
  decisionLabels: transparencySelectionSchema.optional(),
  output: assessmentMuseOutputSchema, limitations: z.array(text).min(1).max(8),
}).strict().superRefine((record, context) => {
  const mock = record.generationMode === "mock";
  const current = record.promptVersion === ASSESSMENT_MUSE_V2.prompt;
  const transparency = record.promptVersion === ASSESSMENT_MUSE_V5.prompt;
  const opportunity = record.promptVersion === ASSESSMENT_MUSE_V4.prompt || transparency;
  if (transparency !== (record.decisionLabels !== undefined)) context.addIssue({ code: "custom", message: "Decision labels require the v5 prompt and must be present for v5." });
  const business = record.promptVersion === ASSESSMENT_MUSE_V3.prompt;
  if (record.authorization && (mock || record.generationMode !== "poc" || record.authorization.scope !== `assessment:${record.businessId}:${record.assessmentId}`))
    context.addIssue({ code: "custom", message: "Analysis authorization provenance is incompatible." });
  if (record.outputSchemaVersion !== record.output.schemaVersion || current !== (record.outputSchemaVersion === "assessment-muse-output-v2") || business !== (record.outputSchemaVersion === "assessment-muse-output-v3") || opportunity !== (record.outputSchemaVersion === "assessment-muse-output-v4"))
    context.addIssue({ code: "custom", message: "Analysis versions are incompatible." });
  const validFixture = transparency ? record.fixtureVersion === ASSESSMENT_MUSE_V5.fixture : opportunity ? record.fixtureVersion === ASSESSMENT_MUSE_V4.fixture : business ? record.fixtureVersion === ASSESSMENT_MUSE_V3.fixture || record.fixtureVersion === ASSESSMENT_MUSE_V3_PROSE_FIXTURE : record.fixtureVersion === (current ? ASSESSMENT_MUSE_V2.fixture : ASSESSMENT_MUSE_FIXTURE_VERSION);
  if (mock ? record.provider !== "mock-fixture" || !record.isMock || !validFixture || record.usage.inputTokens !== 0 || record.usage.outputTokens !== 0 || record.requestId !== null || record.usageAttemptId !== undefined
    : record.provider !== "meta" || record.isMock || record.fixtureVersion !== undefined || !record.usageAttemptId)
    context.addIssue({ code: "custom", message: "Analysis generation provenance is incompatible." });
});
export type AssessmentMuseAnalysis = z.infer<typeof assessmentMuseAnalysisSchema>;

/** The operator retains approval provenance; browser reads never receive it. */
export function assessmentMuseBrowserView(analysis: AssessmentMuseAnalysis) {
  const { authorization: _authorization, decisionLabels: _decisionLabels, ...view } = analysis;
  void _authorization; void _decisionLabels;
  return view;
}
