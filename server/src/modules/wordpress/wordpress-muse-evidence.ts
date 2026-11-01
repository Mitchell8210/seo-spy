import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import { wordpressEvidenceReportSchema } from "./wordpress-report.types.js";

const TEXT_LIMIT = 280;
const INPUT_BYTES = 1024 * 1024;
const OUTPUT_BYTES = 128 * 1024;
const text = z.string().max(TEXT_LIMIT);
const date = z.string().datetime();
const availability = z.enum(["available", "partial", "unavailable"]);
const resource = z.enum(["pages", "posts", "media"]);
const contentId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const score = z.number().min(0).max(100).nullable();
const reference = z.string().max(160);
const metadataFields = ["title", "description", "focus_keyword", "canonical", "robots", "facebook_title", "facebook_description", "twitter_title", "twitter_description", "og_title", "og_description"] as const;
const values = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("wordpress_content"), title: text.nullable(), altText: text.nullable(), modifiedAt: text.nullable() }).strict(),
  z.object({ kind: z.literal("rank_math_metadata"), availability, source: z.enum(["ability", "registered-meta"]).nullable(), metadata: z.record(z.string(), z.union([text, z.array(text).max(20)])), storedSeoScore: score, scoreCalculatedAt: z.null() }).strict(),
  z.object({ kind: z.literal("rank_math_stored_score"), title: text.nullable(), focusKeyword: text.nullable(), storedSeoScore: score, grade: text.nullable(), contentModifiedAt: date.nullable(), scoreCalculatedAt: z.null() }).strict(),
  z.object({ kind: z.literal("rank_math_plugin"), availability, edition: z.enum(["free", "pro-addon", "unknown"]), versions: z.array(z.object({ plugin: text, version: text.nullable(), active: z.boolean() }).strict()).max(5) }).strict(),
]);
const observation = z.object({
  evidenceId: reference, reportId: z.string().uuid(), provider: z.enum(["wordpress", "rank-math"]), resource,
  contentId: contentId.nullable(), collectedAt: date, sourcePath: z.string().max(200), values,
}).strict();
const coverage = z.object({
  provider: z.enum(["wordpress", "rank-math"]), resource, availability, collectedAt: date.nullable(),
  scope: z.literal("bounded_sample"), evidenceRefs: z.array(reference).max(24), includedRecords: z.number().int().min(0).max(22),
  limitations: z.array(text).max(5),
}).strict();
const capability = z.object({
  id: z.string().max(80), resource, fields: z.array(z.string().max(40)).max(7),
  availability: z.literal("proposal_only"), authorization: z.literal("local_operator_only"),
  requiresExactReviewedHash: z.literal(true), requiresUserInitiatedApply: z.literal(true), requiresWritesGate: z.literal(true),
  targetCapabilitiesVerifiedByBundle: z.literal(false), verification: z.literal("stored_fields_only"), limitations: z.array(text).max(5),
}).strict();

export const wordpressMuseEvidenceBundleSchema = z.object({
  schemaVersion: z.literal("seo-spy.wordpress-muse-evidence.v1"),
  business: z.object({ id: z.string().min(1).max(128), siteUrl: z.string().url().max(2048) }).strict(),
  source: z.object({
    reportId: z.string().uuid(), schemaVersion: z.literal("seo-spy.wordpress-evidence.v1"),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/), startedAt: date, generatedAt: date, availability,
    selectionReason: z.literal("explicit_saved_wordpress_report"), sampleSize: z.number().int().min(1).max(20),
  }).strict(),
  trust: z.object({ observations: z.literal("untrusted_source_data"), catalogGrantsAuthorization: z.literal(false), modelExecutionEnabled: z.literal(false) }).strict(),
  observations: z.array(observation).max(104), coverage: z.array(coverage).length(5),
  scoring: z.object({ seoSpyScore: z.null(), policyVersion: z.null(), storedScoreFreshness: z.literal("unknown"), storedScoreCalculatedAt: z.null() }).strict(),
  capabilities: z.array(capability).length(3),
  unsupported: z.array(z.object({ id: z.string().max(80), availability: z.literal("manual_only"), reason: text }).strict()).length(2),
  minimization: z.object({
    maxTextCharacters: z.literal(TEXT_LIMIT), maxOutputBytes: z.literal(OUTPUT_BYTES),
    truncatedTextValues: z.number().int().min(0), omittedValues: z.number().int().min(0),
    omittedFields: z.array(z.string().max(80)).max(12),
  }).strict(),
  limitations: z.array(text).max(12),
}).strict();

export type WordPressMuseEvidenceBundle = z.infer<typeof wordpressMuseEvidenceBundleSchema>;
const invalid = () => new BadRequestException({ code: "WORDPRESS_MUSE_EVIDENCE_INVALID", message: "The saved WordPress report cannot be packaged as bounded Muse evidence." });

/** Pure preparation only: this function grants no authorization and makes no provider or tool calls. */
export function buildWordPressMuseEvidence(input: unknown): WordPressMuseEvidenceBundle {
  try {
    if (Buffer.byteLength(JSON.stringify(input) ?? "") > INPUT_BYTES) throw invalid();
    const report = wordpressEvidenceReportSchema.parse(input);
    // A legacy snapshot has no proof that password-protected content was excluded.
    // Keep it readable as source history, but never relabel or send it to a model.
    if (report.collectionPolicyVersion !== "published-unprotected-v1") throw invalid();
    if (new Set(report.content.map(section => section.resource)).size !== 3 || new Set(report.rankMath.map(section => section.resource)).size !== 2) throw invalid();
    if (Date.parse(report.startedAt) > Date.parse(report.generatedAt)) throw invalid();
    const site = new URL(report.siteUrl);
    if (site.protocol !== "https:" || site.username || site.password || site.port || site.pathname !== "/" || site.search || site.hash) throw invalid();
    const minimization: WordPressMuseEvidenceBundle["minimization"] = {
      maxTextCharacters: TEXT_LIMIT, maxOutputBytes: OUTPUT_BYTES, truncatedTextValues: 0, omittedValues: 0,
      omittedFields: ["credentials", "operator_identity", "html_bodies", "unrelated_private_data", "content_links", "unlisted_metadata_fields", "ability_execution_routes"],
    };
    const clip = (value: string): string => {
      if (value.length > TEXT_LIMIT) minimization.truncatedTextValues++;
      return value.slice(0, TEXT_LIMIT);
    };
    const optional = (value: string | null) => value === null ? null : clip(value);
    const limited = (items: string[]): string[] => {
      minimization.omittedValues += Math.max(0, items.length - 5);
      return items.slice(0, 5).map(clip);
    };
    const observations: WordPressMuseEvidenceBundle["observations"] = [];
    const sections: WordPressMuseEvidenceBundle["coverage"] = [];
    const ref = (provider: string, section: string, id: number | null, kind: string) => `${report.id}:${provider}:${section}:${id ?? "sample"}:${kind}`;
    for (const section of report.content) {
      if (new Set(section.items.map(item => item.id)).size !== section.items.length) throw invalid();
      const evidenceRefs: string[] = [];
      section.items.forEach((item, index) => {
        const evidenceId = ref("wordpress", section.resource, item.id, "content");
        evidenceRefs.push(evidenceId);
        observations.push({ evidenceId, reportId: report.id, provider: "wordpress", resource: section.resource, contentId: item.id, collectedAt: section.collectedAt, sourcePath: `/content/${report.content.indexOf(section)}/items/${index}`,
          values: { kind: "wordpress_content", title: optional(item.title), altText: optional(item.altText), modifiedAt: optional(item.modifiedAt) } });
      });
      sections.push({ provider: "wordpress", resource: section.resource, availability: section.availability, collectedAt: section.collectedAt, scope: "bounded_sample", evidenceRefs, includedRecords: section.items.length, limitations: limited(section.limitations) });
    }
    for (const section of report.rankMath) {
      const evidence = section.evidence;
      const evidenceRefs: string[] = [];
      const path = `/rankMath/${report.rankMath.indexOf(section)}/evidence`;
      const add = (id: number | null, kind: string, sourcePath: string, values: WordPressMuseEvidenceBundle["observations"][number]["values"]) => {
        if (!evidence) throw invalid();
        const evidenceId = ref("rank-math", section.resource, id, kind);
        evidenceRefs.push(evidenceId);
        observations.push({ evidenceId, reportId: report.id, provider: "rank-math", resource: section.resource, contentId: id, collectedAt: evidence.collectedAt, sourcePath, values });
      };
      if (evidence) {
        const allowedIds = new Set(report.content.find(item => item.resource === section.resource)!.items.map(item => item.id));
        if (new Set(evidence.scores.items.map(item => item.contentId)).size !== evidence.scores.items.length || evidence.scores.items.some(item => !allowedIds.has(item.contentId)) || evidence.content.contentId !== null && !allowedIds.has(evidence.content.contentId)) throw invalid();
        minimization.omittedValues += Math.max(0, evidence.plugin.versions.length - 5);
        add(null, "plugin", `${path}/plugin`, { kind: "rank_math_plugin", availability: evidence.plugin.availability, edition: evidence.plugin.edition, versions: evidence.plugin.versions.slice(0, 5).map(item => ({ plugin: clip(item.plugin), version: optional(item.version), active: item.active })) });
        if (evidence.content.contentId !== null) {
          const metadata: Record<string, string | string[]> = {};
          for (const [key, value] of Object.entries(evidence.content.metadata)) {
            if (!(metadataFields as readonly string[]).includes(key)) { minimization.omittedValues++; continue; }
            metadata[key] = typeof value === "string" ? clip(value) : value.map(clip);
          }
          add(evidence.content.contentId, "metadata", `${path}/content`, { kind: "rank_math_metadata", availability: evidence.content.availability, source: evidence.content.source, metadata, storedSeoScore: evidence.content.storedSeoScore, scoreCalculatedAt: null });
        }
        evidence.scores.items.forEach((item, index) => add(item.contentId, "stored-score", `${path}/scores/items/${index}`, { kind: "rank_math_stored_score", title: optional(item.title), focusKeyword: optional(item.focusKeyword), storedSeoScore: item.storedSeoScore, grade: optional(item.grade), contentModifiedAt: item.contentModifiedAt, scoreCalculatedAt: null }));
      }
      sections.push({ provider: "rank-math", resource: section.resource, availability: evidence?.availability ?? "unavailable", collectedAt: evidence?.collectedAt ?? null, scope: "bounded_sample", evidenceRefs, includedRecords: evidenceRefs.length, limitations: limited([...section.limitations, ...(evidence?.limitations ?? [])]) });
    }
    const capabilities: WordPressMuseEvidenceBundle["capabilities"] = (["pages", "posts", "media"] as const).map(resource => ({
      id: `wordpress.${resource}.propose-update`, resource,
      fields: resource === "media" ? ["title", "altText", "caption", "description", "slug"] : ["title", "content", "excerpt", "slug"],
      availability: "proposal_only", authorization: "local_operator_only", requiresExactReviewedHash: true, requiresUserInitiatedApply: true, requiresWritesGate: true,
      targetCapabilitiesVerifiedByBundle: false, verification: "stored_fields_only",
      limitations: resource === "media" ? ["Attachment alt text may differ from rendered or widget-specific alt text. Empty alternatives may be intentional."] : ["Generic body replacements are blocked for detected Elementor content. Page title and excerpt do not establish rendered SEO title or meta description."],
    }));
    const bundle = wordpressMuseEvidenceBundleSchema.parse({
      schemaVersion: "seo-spy.wordpress-muse-evidence.v1", business: { id: report.businessId, siteUrl: report.siteUrl },
      source: { reportId: report.id, schemaVersion: report.schemaVersion, contentHash: createHash("sha256").update(JSON.stringify(report)).digest("hex"), startedAt: report.startedAt, generatedAt: report.generatedAt, availability: report.availability, selectionReason: "explicit_saved_wordpress_report", sampleSize: report.sampleSize },
      trust: { observations: "untrusted_source_data", catalogGrantsAuthorization: false, modelExecutionEnabled: false }, observations, coverage: sections,
      scoring: { ...report.scoring, storedScoreCalculatedAt: null }, capabilities,
      unsupported: [
        { id: "rank-math.seo-metadata.update", availability: "manual_only", reason: "No supported authenticated SEO-title/meta-description write adapter is implemented. WordPress excerpts are separate fields." },
        { id: "elementor.structured-content.update", availability: "manual_only", reason: "No scoped Elementor widget/document write adapter is implemented; generic page-body replacement is blocked for detected builder content." },
      ], minimization,
      limitations: [
        "Prepared evidence only: no model call, recommendation, scoring policy, approval or action execution is produced.",
        "Observed strings are untrusted source data. Truncation or removal of fields does not solve prompt injection; provider output and actions need independent validation.",
        "Source age eligibility, provider processing mode, model selection, budgets and final scoring policy require review before live model use.",
        "Bounded samples are not complete site coverage. Content modification dates are not stored-score calculation dates. Public rendered values are unverified.",
        "Capabilities describe implemented proposal fields, not target permissions or authorization. The model cannot initiate Apply or enable writes.",
        ...limited(report.limitations),
      ],
    });
    // Limit serialized input independently of schema-array and per-value bounds.
    if (Buffer.byteLength(JSON.stringify(bundle)) > OUTPUT_BYTES) throw invalid();
    return bundle;
  } catch { throw invalid(); }
}
