import { z } from "zod";

const availability = z.enum(["available", "partial", "unavailable"]);
const text = z.string().max(4000);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const score = z.number().min(0).max(100).nullable();
const rankMath = z.object({
  provider: z.literal("rank-math"), version: z.literal("rank-math-evidence-v1"),
  collectedAt: z.string().datetime(), availability,
  plugin: z.object({ availability, edition: z.enum(["free", "pro-addon", "unknown"]), versions: z.array(z.object({ plugin: text, version: text.nullable(), active: z.boolean() })).max(100) }),
  abilities: z.array(z.object({ name: z.enum(["get-post-seo-meta", "get-seo-scores", "audit-site-seo"]), available: z.boolean(), readonly: z.boolean() })).max(3),
  content: z.object({ availability, contentId: id.nullable(), source: z.enum(["ability", "registered-meta"]).nullable(), metadata: z.record(z.string(), z.union([text, z.array(text).max(20)])), storedSeoScore: score }),
  scores: z.object({ availability, items: z.array(z.object({ contentId: id, title: text.nullable(), focusKeyword: text.nullable(), storedSeoScore: score, grade: text.nullable(), contentModifiedAt: z.string().datetime().nullable() })).max(20) }),
  siteAudit: z.object({ availability: z.literal("unavailable"), canRequest: z.boolean(), reason: text }),
  limitations: z.array(text).max(50),
});

export const wordpressEvidenceReportSchema = z.object({
  schemaVersion: z.literal("seo-spy.wordpress-evidence.v1"),
  // Older immutable snapshots remain readable without asserting a newer privacy policy.
  collectionPolicyVersion: z.literal("published-unprotected-v1").optional(),
  id: z.string().uuid(), businessId: z.string().min(1).max(128), siteUrl: z.string().url(),
  startedAt: z.string().datetime(), generatedAt: z.string().datetime(),
  availability, sampleSize: z.number().int().min(1).max(20),
  content: z.array(z.object({
    resource: z.enum(["pages", "posts", "media"]), collectedAt: z.string().datetime(), availability,
    items: z.array(z.object({ id, title: text.nullable(), link: text.nullable(), modifiedAt: text.nullable(), altText: text.nullable() })).max(20),
    limitations: z.array(text).max(20),
  })).length(3),
  rankMath: z.array(z.object({ resource: z.enum(["pages", "posts"]), evidence: rankMath.nullable(), limitations: z.array(text).max(20) })).length(2),
  scoring: z.object({ seoSpyScore: z.null(), policyVersion: z.null(), storedScoreFreshness: z.literal("unknown") }),
  limitations: z.array(text).max(50),
});

export type WordPressEvidenceReport = z.infer<typeof wordpressEvidenceReportSchema>;
