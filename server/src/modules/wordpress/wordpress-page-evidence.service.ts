import { ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { load, loadBuffer } from "cheerio";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Audit } from "../../contracts/domain.js";
import { WebsiteCollector } from "../../integrations/website/collector.js";
import { matchMediaImages, observeImages } from "../../integrations/wordpress/image-evidence.js";
import { BUSINESS_REPOSITORY, type BusinessRepository } from "../../persistence/repositories.js";
import { FileReportStore } from "../../reports/file-report.store.js";
import { fixDigest } from "./wordpress-fix.store.js";
import { fixHash, fixTargetSchema } from "./wordpress-fix.types.js";
import { WordPressService } from "./wordpress.service.js";
import { WordPressImageContent } from "../../integrations/wordpress/image-content.js";

export const collectPageEvidenceSchema = z.object({ confirmed: z.literal(true), mediaId: z.number().int().positive(),
  pageResource: z.enum(["pages", "posts"]), pageId: z.number().int().positive() }).strict();
export const pageMediaBindingSchema = z.object({ version: z.literal("wordpress-page-media-v1"), businessId: z.string(), siteUrl: z.string().url(),
  target: fixTargetSchema, sourceUrls: z.array(z.string().url().max(2048)).min(1).max(100), mediaParentId: z.number().int().positive(),
  pageModified: z.string().min(1).max(100), metadataCollectedAt: z.string().datetime(), publicCollectedAt: z.string().datetime(),
  publicHtmlHash: fixHash, renderedUrls: z.array(z.string().url()).min(1).max(100) }).strict();
export type PageMediaBinding = z.infer<typeof pageMediaBindingSchema>;
export const pageSnapshot = (fresh: Awaited<ReturnType<WordPressService["altTarget"]>>) => ({ target: fresh.target, sourceUrls: fresh.sourceUrls,
  mediaParentId: fresh.mediaParentId, pageModified: fresh.pageModified });
const rejected = () => new ConflictException({ code: "WORDPRESS_PAGE_EVIDENCE_UNRESOLVED", message: "Exact current published page, authoritative media identity and matching stored/public alt could not be established. No report or edit permission was created." });

/** Explicit operator-only collection of ONE WordPress-derived published page and ONE media ID. */
@Injectable()
export class WordPressPageEvidenceService {
  constructor(private readonly wordpress: WordPressService, private readonly collector: WebsiteCollector, private readonly reports: FileReportStore,
    @Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository, @Optional() private readonly images?: WordPressImageContent) {}

  async collect(businessId: string, input: unknown) {
    const body = collectPageEvidenceSchema.parse(input);
    const business = await this.businesses.findById(businessId);
    const siteUrl = await this.wordpress.reportSite(businessId);
    const before = await this.wordpress.altTarget(businessId, body.mediaId, body.pageResource, body.pageId);
    if (!business || before.mediaParentId !== body.pageId || !before.pageModified) throw rejected();
    const catalog = [{ mediaId: body.mediaId, sourceUrls: before.sourceUrls }];
    const authenticated = matchMediaImages(observeImages(before.pageHtml), before.target.pageUrl, catalog, body.mediaId);
    if (authenticated.status !== "matched" || authenticated.matches.some(image => image.alt !== before.target.currentAlt)) throw rejected();
    const page = await this.collector.collect(before.target.pageUrl, undefined, siteUrl);
    if (page.status !== 200 || new URL(page.finalUrl).href !== before.target.pageUrl) throw rejected();
    const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(page.contentType)?.[1];
    const html = charset ? new TextDecoder(charset, { fatal: true }).decode(page.body) : page.body;
    const publicMatch = matchMediaImages(observeImages(html), page.finalUrl, catalog, body.mediaId);
    if (publicMatch.status !== "matched" || publicMatch.matches.some(image => image.alt !== before.target.currentAlt)) throw rejected();
    const $ = typeof html === "string" ? load(html) : loadBuffer(html);
    const pageTitle = load(before.pageTitle ?? "").text().replace(/\s+/g, " ").trim().slice(0, 300);
    const language = ($("html").attr("lang") ?? "").trim().toLowerCase();
    const pageLanguage = /^(es|en)(?:-|$)/.exec(language)?.[1] ?? "";
    // Content fingerprints strengthen durable review; an unavailable/oversized source
    // must not fabricate one or invalidate otherwise exact page/media evidence.
    let image: Awaited<ReturnType<WordPressImageContent["fingerprint"]>> | null = null;
    if (this.images) { try { image = await this.images.fingerprint(before.target.sourceUrl, siteUrl); } catch { /* No durable hash is claimed. */ } }
    // Bound changes during collection without pretending WordPress offers an atomic read snapshot.
    const after = await this.wordpress.altTarget(businessId, body.mediaId, body.pageResource, body.pageId);
    if (fixDigest(pageSnapshot(before)) !== fixDigest(pageSnapshot(after))) throw rejected();
    const binding = pageMediaBindingSchema.parse({ version: "wordpress-page-media-v1", businessId, siteUrl, ...pageSnapshot(after),
      metadataCollectedAt: after.metadataCollectedAt, publicCollectedAt: page.collectedAt, publicHtmlHash: createHash("sha256").update(page.body).digest("hex"), renderedUrls: publicMatch.renderedUrls });
    const reportId = randomUUID(), evidenceId = randomUUID(), findingId = randomUUID(), now = new Date().toISOString();
    const title = "Review this image alternative";
    const explanation = "The exact published page image is bound to authenticated WordPress media metadata. Its alternative requires contextual review; an empty value is not a confirmed defect.";
    const audit: Audit = { id: reportId, businessId, scope: "wordpress-page", mode: "live", status: "completed", stage: "complete", createdAt: now, startedAt: now, completedAt: now,
      scoringVersion: "homepage-v1", failure: null, warnings: ["Explicit single-page media evidence only; optional bounded raster fingerprint, no scores, AI generation or WordPress write. Image purpose is not confirmed by URL matching."],
      results: { scores: [], evidence: [{ id: evidenceId, auditId: reportId, checkId: "image-alt", sourceUrl: page.finalUrl, collectedAt: page.collectedAt, mode: "live",
        observed: { values: JSON.stringify(publicMatch.matches), wordpressMediaBinding: JSON.stringify(binding), pageTitle, pageLanguage,
          sourceImageFingerprintStatus: image ? "verified" : "unavailable",
          ...(image ? { sourceImageSha256: image.sha256, sourceImageBytes: String(image.bytes), sourceImageCollectedAt: image.collectedAt } : {}), count: String(publicMatch.matches.length),
          missingCount: String(publicMatch.matches.filter(image => image.alt === null).length), emptyCount: String(publicMatch.matches.filter(image => image.alt === "").length) } }],
      findings: [{ id: findingId, auditId: reportId, checkId: "image-alt", evidenceIds: [evidenceId], source: "website", severity: "low", status: "needs_review", title, explanation }],
      recommendations: [{ id: randomUUID(), auditId: reportId, findingId, title, explanation, recommendedChange: "Confirm this image's purpose and whether its current alternative communicates the essential meaning. Keep empty alt when intentionally decorative or redundant.", purpose: "Review the exact image in its published page context.", status: "needs_review" }] } };
    // This is an immutable report artifact, not a queued audit or Dashboard replacement.
    // Keep schema-3 audit rows and their historical scope constraints untouched.
    const reference = await this.reports.write(audit, business);
    return { businessId, reportId, findingId, evidenceId, report: reference, binding, purpose: "unreviewed", fixable: false,
      requiresOperatorPurposeConfirmation: true, modelRequests: 0, wordPressWrites: 0 };
  }
}
