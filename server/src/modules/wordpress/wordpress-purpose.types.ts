import { createHash } from "node:crypto";
import { load } from "cheerio";
import { z } from "zod";
import { observeImages, matchMediaImages } from "../../integrations/wordpress/image-evidence.js";
import type { WordPressService } from "./wordpress.service.js";
import { altProposalContextSchema, fixHash, fixTargetSchema, type AltEvidence } from "./wordpress-fix.types.js";
import { fixDigest } from "./wordpress-fix.store.js";

export const PURPOSE_POLICY_VERSION = "wordpress-purpose-dependencies-v1";
type AltFresh = Awaited<ReturnType<WordPressService["altTarget"]>>;
const businessSchema = z.object({ id: z.string().min(1).max(100), name: z.string().max(300), website: z.string().url().max(2048) }).strict();
const pageContextSchema = z.object({ id: z.number().int().positive(), resource: z.enum(["pages", "posts"]), url: z.string().url().max(2048),
  title: z.string().max(300).nullable(), textExcerpt: z.string().max(1200), collectedAt: z.string().datetime() }).strict();
const imageSchema = z.object({ sourceUrl: z.string().url().max(2048), sha256: fixHash, bytes: z.number().int().positive().max(2 * 1024 * 1024) }).strict();
const attributesSchema = z.record(z.string(), z.string().max(2048));
const placementSchema = z.object({ imageIndex: z.number().int().nonnegative(), image: attributesSchema,
  ancestors: z.array(z.object({ tag: z.string().max(30), attributes: attributesSchema }).strict()).max(30),
  link: z.object({ href: z.string().max(2048), title: z.string().max(500), text: z.string().max(1000) }).strict().nullable(),
  caption: z.string().max(1000), heading: z.string().max(1000), block: z.object({ id: z.number().int().positive(), sizeSlug: z.string().max(100).nullable(), linkDestination: z.string().max(100).nullable() }).strict().nullable(),
  renderedUrls: z.array(z.string().url().max(2048)).min(1).max(100) }).strict();
export const purposeDependenciesSchema = z.object({ policyVersion: z.literal(PURPOSE_POLICY_VERSION), evidenceId: z.string().uuid(), originalReviewHash: fixHash,
  business: businessSchema, siteUrl: z.string().url().max(2048),
  media: z.object({ id: z.number().int().positive(), sourceUrl: z.string().url().max(2048), sourceUrls: z.array(z.string().url().max(2048)).min(1).max(100), parentId: z.number().int().positive() }).strict(),
  page: pageContextSchema.omit({ collectedAt: true }), image: imageSchema, renderedImages: z.array(imageSchema).min(1).max(9).optional(),
  review: z.object({ purpose: z.enum(["informative", "functional", "decorative", "unknown"]), verifiedDescription: z.string().max(500), language: z.literal("es").nullable(), requiredTerms: z.array(z.string().min(2).max(40)).max(5) }).strict(),
  placements: z.array(placementSchema).min(1).max(20), publicPlacements: z.array(placementSchema).min(1).max(20).optional(), publicContextHash: fixHash.optional() }).strict()
  .refine(value => (value.publicPlacements !== undefined) === (value.publicContextHash !== undefined), "Public placement and context fingerprints must be recorded together.");
export type PurposeDependencies = z.infer<typeof purposeDependenciesSchema>;
export const purposeBindingSchema = z.object({ id: z.string().uuid(), kind: z.literal("purpose-binding"), businessId: z.string(), actor: fixHash,
  siteUrl: z.string().url(), createdAt: z.string().datetime(), policyVersion: z.literal(PURPOSE_POLICY_VERSION), evidenceId: z.string().uuid(),
  originalReviewHash: fixHash, originalConfirmedAt: z.string().datetime(), originalConfirmedBy: fixHash, dependencyHash: fixHash,
  dependencies: purposeDependenciesSchema, originalImageHash: fixHash, hashProvenance: z.string().min(1).max(500) }).strict();
export type PurposeBinding = z.infer<typeof purposeBindingSchema>;
export const executionStateSchema = z.object({ id: z.string().uuid(), kind: z.literal("execution-state"), businessId: z.string(), actor: fixHash,
  siteUrl: z.string().url(), createdAt: z.string().datetime(), expiresAt: z.string().datetime(), evidenceId: z.string().uuid(), purposeBindingId: z.string().uuid(), dependencyHash: fixHash,
  target: fixTargetSchema, source: z.object({ reportId: z.string().uuid(), findingId: z.string(), evidenceId: z.string().uuid(), reportHash: fixHash }).strict(),
  proposalContext: altProposalContextSchema.optional() }).strict().refine(value => {
    const duration = Date.parse(value.expiresAt) - Date.parse(value.createdAt);
    return duration > 0 && duration <= 15 * 60000;
  }, "Execution preconditions require a positive lifetime of at most fifteen minutes.");
export type ExecutionState = z.infer<typeof executionStateSchema>;
const reject = (): never => { throw new Error("Exact purpose dependencies did not validate; owner review is not renewed."); };
const normalized = (value: string) => value.replace(/\s+/g, " ").trim();
function safeUrl(value: string, site?: string): string {
  if (value.length > 2048 || /[\s\p{Cc}]/u.test(value)) return reject();
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || site && url.hostname.replace(/^www\./, "") !== new URL(site).hostname.replace(/^www\./, "")) return reject();
  return url.href;
}

/** Canonical material dependencies only; mutable alt and operational clocks are separate. */
export function purposeDependencies(evidence: AltEvidence, fresh: AltFresh, imageInput: { sourceUrl: string; sha256: string; bytes: number },
  pageInput: z.infer<typeof pageContextSchema>, businessInput: z.infer<typeof businessSchema>): PurposeDependencies {
  const business = businessSchema.parse(businessInput), page = pageContextSchema.parse(pageInput), image = imageSchema.parse(imageInput);
  const target = fixTargetSchema.parse(fresh.target), original = evidence.target;
  const siteUrl = safeUrl(evidence.siteUrl), website = safeUrl(business.website, siteUrl);
  if (business.id !== evidence.businessId || target.mediaId !== original.mediaId || target.pageId !== original.pageId || target.pageResource !== original.pageResource
    || target.sourceUrl !== original.sourceUrl || target.pageUrl !== original.pageUrl || fresh.mediaParentId !== target.pageId
    || page.id !== target.pageId || page.resource !== target.pageResource || page.url !== target.pageUrl || image.sourceUrl !== target.sourceUrl) return reject();
  safeUrl(target.sourceUrl, siteUrl); safeUrl(target.pageUrl, siteUrl);
  if (!fresh.sourceUrls.length || fresh.sourceUrls.length > 100) return reject();
  const sourceUrls = [...new Set(fresh.sourceUrls.map(url => safeUrl(url, siteUrl)))].sort();
  if (!sourceUrls.includes(safeUrl(target.sourceUrl, siteUrl))) return reject();
  const reviewed = evidence.proposalContext;
  if (reviewed && (reviewed.business.id !== business.id || reviewed.business.name !== business.name || safeUrl(reviewed.business.website) !== website
    || reviewed.page.id !== page.id || reviewed.page.resource !== page.resource || reviewed.page.url !== page.url
    || normalized(reviewed.page.title ?? "") !== normalized(page.title ?? "") || normalized(reviewed.page.textExcerpt) !== normalized(page.textExcerpt))) return reject();
  const observations = observeImages(fresh.pageHtml), catalog = [{ mediaId: target.mediaId, sourceUrls }];
  const matched = matchMediaImages(observations, target.pageUrl, catalog, target.mediaId);
  if (matched.status !== "matched" || matched.matches.length > 20) return reject();
  const $ = load(fresh.pageHtml), elements = $("img").toArray(), readingOrder = $("h1,h2,h3,h4,h5,h6,img").toArray();
  const stableAttributes = ["id", "class", "data-id", "data-elementor-id", "data-block-id", "data-attachment-id", "role", "aria-hidden"];
  const attributes = (element: typeof elements[number]) => Object.fromEntries(stableAttributes.flatMap(key => $(element).attr(key) === undefined ? [] : [[key, normalized($(element).attr(key)!)]]));
  const placements = observations.flatMap((observation, imageIndex) => {
    if (!matched.matches.includes(observation)) return [];
    const element = elements[imageIndex]; if (!element) return reject();
    const node = $(element), ancestors = node.parents().toArray();
    if (ancestors.length > 30) return reject();
    const anchor = node.closest("a"), figure = node.closest("figure"), section = node.closest("section,article,main,figure");
    const precedingHeading = readingOrder.slice(0, readingOrder.indexOf(element)).filter(item => item.tagName !== "img").at(-1);
    const href = anchor.attr("href");
    let block: z.infer<typeof placementSchema>["block"] = null;
    for (const candidate of [element, ...ancestors]) {
      let previous = candidate.prev;
      while (previous?.type === "text" && !previous.data.trim()) previous = previous.prev;
      if (previous?.type !== "comment") continue;
      const marker = /^\s*wp:image\s+(\{[\s\S]*\})\s*$/.exec(previous.data);
      if (!marker) continue;
      if (marker[1].length > 4096) return reject();
      const parsed = z.object({ id: z.number().int().positive(), sizeSlug: z.string().max(100).optional(), linkDestination: z.string().max(100).optional() }).passthrough().parse(JSON.parse(marker[1]));
      if (parsed.id !== target.mediaId || block && block.id !== parsed.id) return reject();
      block = { id: parsed.id, sizeSlug: parsed.sizeSlug ?? null, linkDestination: parsed.linkDestination ?? null };
    }
    return [{ imageIndex, image: attributes(element), ancestors: ancestors.map(ancestor => ({ tag: ancestor.tagName, attributes: attributes(ancestor) })),
      link: !anchor.length ? null : { href: href === undefined ? "" : new URL(href, target.pageUrl).href, title: normalized(anchor.attr("title") ?? ""), text: normalized(anchor.text()) },
      caption: normalized(figure.find("figcaption").text()), heading: normalized(precedingHeading ? $(precedingHeading).text() : section.find("h1,h2,h3,h4,h5,h6").first().text()), block,
      renderedUrls: matchMediaImages([observation], target.pageUrl, catalog, target.mediaId).renderedUrls }];
  });
  // Different link/caption/hidden contexts can give the same file a different
  // purpose. Repeated identical contexts retain all positions; conflicting ones fail.
  if (new Set(placements.map(placement => fixDigest({ link: placement.link, caption: placement.caption, heading: placement.heading,
    role: placement.image.role ?? null, hidden: placement.image["aria-hidden"] ?? null, block: placement.block }))).size > 1) return reject();
  return purposeDependenciesSchema.parse({ policyVersion: PURPOSE_POLICY_VERSION, evidenceId: evidence.id, originalReviewHash: fixDigest(evidence),
    business: { ...business, website }, siteUrl, media: { id: target.mediaId, sourceUrl: target.sourceUrl, sourceUrls, parentId: fresh.mediaParentId },
    page: { id: page.id, resource: page.resource, url: page.url, title: page.title === null ? null : normalized(page.title), textExcerpt: normalized(page.textExcerpt) }, image,
    review: { purpose: evidence.purpose, verifiedDescription: evidence.verifiedDescription, language: reviewed?.language ?? null, requiredTerms: [...(reviewed?.requiredTerms ?? [])] }, placements });
}

export const purposeDependencyHash = (dependencies: PurposeDependencies): string => fixDigest(purposeDependenciesSchema.parse(dependencies));
export function deterministicPurposeBindingId(evidenceId: string): string {
  z.string().uuid().parse(evidenceId);
  const chars = createHash("sha256").update(PURPOSE_POLICY_VERSION + ":" + evidenceId).digest("hex").slice(0, 32).split("");
  chars[12] = "4"; chars[16] = ((parseInt(chars[16], 16) & 3) | 8).toString(16);
  const id = chars.join(""); return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}
export function validatePurposeBinding(input: unknown, evidence: AltEvidence): PurposeBinding {
  const binding = purposeBindingSchema.parse(input), deps = binding.dependencies;
  const reviewed = evidence.proposalContext;
  if (binding.id !== deterministicPurposeBindingId(evidence.id) || binding.evidenceId !== evidence.id || binding.businessId !== evidence.businessId || binding.actor !== evidence.actor || binding.siteUrl !== evidence.siteUrl
    || binding.originalReviewHash !== fixDigest(evidence) || binding.originalConfirmedAt !== evidence.createdAt || binding.originalConfirmedBy !== evidence.actor
    || Date.parse(binding.createdAt) < Date.parse(evidence.createdAt) || binding.dependencyHash !== purposeDependencyHash(deps) || binding.originalImageHash !== deps.image.sha256
    || deps.evidenceId !== evidence.id || deps.originalReviewHash !== binding.originalReviewHash || deps.business.id !== evidence.businessId || deps.siteUrl !== safeUrl(evidence.siteUrl)
    || deps.media.id !== evidence.target.mediaId || deps.media.sourceUrl !== evidence.target.sourceUrl || deps.media.parentId !== evidence.target.pageId || deps.image.sourceUrl !== evidence.target.sourceUrl
    || deps.page.id !== evidence.target.pageId || deps.page.resource !== evidence.target.pageResource || deps.page.url !== evidence.target.pageUrl
    || deps.review.purpose !== evidence.purpose || deps.review.verifiedDescription !== evidence.verifiedDescription
    || deps.review.language !== (reviewed?.language ?? null) || fixDigest(deps.review.requiredTerms) !== fixDigest(reviewed?.requiredTerms ?? [])
    || reviewed && (deps.business.name !== reviewed.business.name || deps.business.website !== safeUrl(reviewed.business.website)
      || deps.page.title !== (reviewed.page.title === null ? null : normalized(reviewed.page.title)) || deps.page.textExcerpt !== normalized(reviewed.page.textExcerpt))) return reject();
  if (safeUrl(deps.business.website, evidence.siteUrl) !== deps.business.website || deps.media.sourceUrls.some(url => safeUrl(url, evidence.siteUrl) !== url)
    || !deps.media.sourceUrls.includes(safeUrl(evidence.target.sourceUrl, evidence.siteUrl))) return reject();
  return binding;
}
