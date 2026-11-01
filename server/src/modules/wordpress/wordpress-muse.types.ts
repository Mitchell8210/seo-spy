import { BadGatewayException } from "@nestjs/common";
import { z } from "zod";
import type { WordPressMuseEvidenceBundle } from "./wordpress-muse-evidence.js";

export const WORDPRESS_MUSE_PROMPT_VERSION = "wordpress-muse-prompt-v1";
export const WORDPRESS_MUSE_OUTPUT_VERSION = "wordpress-muse-output-v1";
const text = z.string().min(1).max(1000);
const refs = z.array(z.string().min(1).max(160)).min(1).max(8);
const localId = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const capabilityId = z.enum([
  "wordpress.pages.propose-update", "wordpress.posts.propose-update", "wordpress.media.propose-update",
  "rank-math.seo-metadata.update", "elementor.structured-content.update",
]);

/** Informational interpretation only. Exact patches, approval, execution and score fields are absent. */
export const wordpressMuseOutputSchema = z.object({
  schemaVersion: z.literal(WORDPRESS_MUSE_OUTPUT_VERSION),
  summary: z.string().min(1).max(280), summaryEvidenceIds: refs,
  observations: z.array(z.object({ id: localId, kind: z.enum(["fact", "hypothesis"]), text, evidenceIds: refs }).strict()).max(20),
  recommendations: z.array(z.object({
    id: localId, observationIds: z.array(localId).min(1).max(5),
    resource: z.enum(["pages", "posts", "media"]), targetContentId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    capabilityId: capabilityId.nullable(), recommendation: text, rationale: text,
    effort: z.enum(["small", "medium", "large", "unknown"]), risk: z.enum(["low", "medium", "high", "unknown"]),
    verificationSteps: z.array(text).min(1).max(5), manualFallback: text, evidenceIds: refs,
  }).strict()).max(10),
  limitations: z.array(text).min(1).max(10), seoSpyScore: z.null(),
}).strict();
export type WordPressMuseOutput = z.infer<typeof wordpressMuseOutputSchema>;

export const wordpressMuseAnalysisSchema = z.object({
  schemaVersion: z.literal("seo-spy.wordpress-muse-analysis.v1"), id: z.string().uuid(),
  businessId: z.string().min(1).max(128), siteUrl: z.string().url().max(2048), reportId: z.string().uuid(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), model: z.enum(["muse-spark-1.3", "muse-spark-1.2"]),
  promptVersion: z.literal(WORDPRESS_MUSE_PROMPT_VERSION), outputSchemaVersion: z.literal(WORDPRESS_MUSE_OUTPUT_VERSION),
  startedAt: z.string().datetime(), generatedAt: z.string().datetime(),
  usage: z.object({ inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), outputTokens: z.number().int().nonnegative().max(8192) }).strict(),
  requestId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/).nullable(), output: wordpressMuseOutputSchema,
  generationMode: z.enum(["mock", "poc", "demo"]).optional(),
  provider: z.enum(["mock-fixture", "meta"]).optional(), isMock: z.boolean().optional(),
  cacheKey: z.string().regex(/^[a-f0-9]{64}$/).optional(), fixtureVersion: z.string().max(100).optional(),
  usageAttemptId: z.string().uuid().optional(),
  limitations: z.array(text).min(1).max(10),
}).strict().superRefine((record, context) => {
  const provenance = [record.generationMode, record.provider, record.isMock, record.cacheKey];
  if (provenance.every(value => value === undefined)) return; // Immutable legacy records remain readable as unknown provenance.
  if (provenance.some(value => value === undefined)
      || (record.generationMode === "mock" ? record.provider !== "mock-fixture" || record.isMock !== true || !record.fixtureVersion || record.usage.inputTokens !== 0 || record.usage.outputTokens !== 0 || record.requestId !== null || record.usageAttemptId !== undefined
        : record.provider !== "meta" || record.isMock !== false || record.fixtureVersion !== undefined))
    context.addIssue({ code: "custom", message: "Analysis provenance is incomplete or incompatible." });
});
export type WordPressMuseAnalysis = z.infer<typeof wordpressMuseAnalysisSchema>;
const invalid = () => new BadGatewayException({ code: "WORDPRESS_MUSE_OUTPUT_INVALID", message: "Muse returned an unsupported analysis or unresolved evidence references. No analysis was published." });

export function validateWordPressMuseOutput(input: unknown, bundle: WordPressMuseEvidenceBundle): WordPressMuseOutput {
  const parsed = wordpressMuseOutputSchema.safeParse(input);
  if (!parsed.success) throw invalid();
  const output = parsed.data;
  const evidence = new Map(bundle.observations.map(observed => [observed.evidenceId, observed]));
  const checkRefs = (ids: string[]) => {
    if (new Set(ids).size !== ids.length || ids.some(id => !evidence.has(id))) throw invalid();
  };
  checkRefs(output.summaryEvidenceIds);
  const observations = new Map(output.observations.map(observed => [observed.id, observed]));
  if (observations.size !== output.observations.length || new Set(output.recommendations.map(item => item.id)).size !== output.recommendations.length) throw invalid();
  for (const observed of output.observations) checkRefs(observed.evidenceIds);
  const catalog = new Map(bundle.capabilities.map(item => [item.id, item]));
  const manual = new Set(bundle.unsupported.map(item => item.id));
  for (const recommendation of output.recommendations) {
    checkRefs(recommendation.evidenceIds);
    if (new Set(recommendation.observationIds).size !== recommendation.observationIds.length || recommendation.observationIds.some(id => !observations.has(id))) throw invalid();
    // Every cited observation must contribute actual source evidence to this recommendation.
    if (recommendation.observationIds.some(id => !observations.get(id)!.evidenceIds.some(ref => recommendation.evidenceIds.includes(ref)))) throw invalid();
    const capability = recommendation.capabilityId === null ? undefined : catalog.get(recommendation.capabilityId);
    if (recommendation.capabilityId !== null && !capability && !manual.has(recommendation.capabilityId)) throw invalid();
    if (capability && (capability.resource !== recommendation.resource || recommendation.targetContentId === null)) throw invalid();
    if (recommendation.resource === "media" && recommendation.capabilityId !== null && !capability) throw invalid();
    if (recommendation.targetContentId !== null && !recommendation.evidenceIds.some(ref => {
      const source = evidence.get(ref)!;
      return source.resource === recommendation.resource && source.contentId === recommendation.targetContentId;
    })) throw invalid();
    if (recommendation.targetContentId === null && recommendation.capabilityId !== null) throw invalid();
  }
  return output;
}
