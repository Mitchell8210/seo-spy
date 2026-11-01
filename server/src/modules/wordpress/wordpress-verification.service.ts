import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { WebsiteCollector } from "../../integrations/website/collector.js";
import { verifyImageAlt, type ImageAltVerificationResult } from "../../integrations/wordpress/verify-image-alt.js";
import { WordPressActionsStore } from "./wordpress-actions.store.js";
import { WordPressService } from "./wordpress.service.js";

const receiptSchema = z.object({
  version: z.literal("wordpress-public-verification-v1"), id: z.string().uuid(), proposalId: z.string().uuid(),
  businessId: z.string().min(1).max(128), siteUrl: z.string().url().max(2048), actor: z.string().min(1).max(256),
  completedAt: z.string().datetime(), storedFieldMatches: z.boolean(), requestedUrl: z.string().url().max(2048),
  finalUrl: z.string().url().max(2048).nullable(), collectedAt: z.string().datetime().nullable(),
  status: z.enum(["verified", "mismatch", "inconclusive"]), matchedImages: z.number().int().min(0).max(21),
  observedAlts: z.array(z.string().max(2000).nullable()).max(20), limitations: z.array(z.string().max(2000)).max(15),
}).strict();
type Receipt = z.infer<typeof receiptSchema>;
export type WordPressPublicVerification = Omit<Receipt, "actor">;
const unavailable = () => new ServiceUnavailableException({ code: "WORDPRESS_VERIFICATION_STORAGE_ERROR", message: "The public verification receipt could not be saved or read safely." });
const notFound = () => new NotFoundException({ code: "WORDPRESS_VERIFICATION_NOT_FOUND", message: "Public verification receipt not found." });
const publicReceipt = (receipt: Receipt): WordPressPublicVerification => {
  const { actor: _actor, ...result } = receipt;
  void _actor;
  return result;
};

@Injectable()
export class WordPressVerificationService {
  constructor(private readonly wordpress: WordPressService, private readonly store: WordPressActionsStore, private readonly collector: WebsiteCollector) {}

  async verify(businessId: string, actor: string, proposalId: string, pageResource: "pages" | "posts", pageId: number): Promise<WordPressPublicVerification> {
    // The trusted adapter binds both resources to this installation and requires
    // an applied media-alt proposal. Callers never supply a collection URL.
    const target = await this.wordpress.verificationTarget(businessId, actor, proposalId, pageResource, pageId);
    let finalUrl: string | null = null;
    let collectedAt: string | null = null;
    let result: ImageAltVerificationResult;
    try {
      const page = await this.collector.collect(target.pageUrl, undefined, target.siteUrl);
      finalUrl = page.finalUrl;
      collectedAt = page.collectedAt;
      const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(page.contentType)?.[1];
      // A transport declaration takes precedence over a meta declaration. When
      // absent, the inert HTML parser handles meta/BOM encoding sniffing itself.
      const html = charset ? new TextDecoder(charset, { fatal: true }).decode(page.body) : page.body;
      result = verifyImageAlt(html, { mediaId: target.mediaId, sourceUrl: target.sourceUrl, expectedAlt: target.expectedAlt, pageUrl: page.finalUrl });
    } catch {
      result = { status: "inconclusive", matchedImages: 0, observedAlts: [], limitations: [
        "The registered public page could not be collected or decoded safely; no public alternative was established.",
        "No automatic retry was attempted. Caches, propagation delays and builder overrides may require a separately requested follow-up.",
        "Verification inspects collected HTML only; it does not execute JavaScript or establish ranking, accessibility quality or performance improvement.",
      ] };
    }
    if (!target.storedFieldMatches) result.limitations.push("The current WordPress stored alternative differs from the approved value; public HTML verification is a separate result.");
    const parsed = receiptSchema.safeParse({
      version: "wordpress-public-verification-v1", id: randomUUID(), proposalId, businessId, siteUrl: target.siteUrl, actor,
      completedAt: new Date().toISOString(), storedFieldMatches: target.storedFieldMatches, requestedUrl: target.pageUrl,
      finalUrl, collectedAt, ...result,
    });
    if (!parsed.success) throw unavailable();
    try {
      if (!await this.store.create(parsed.data.id, "verification", parsed.data)) throw unavailable();
    } catch { throw unavailable(); }
    return publicReceipt(parsed.data);
  }

  async read(businessId: string, actor: string, proposalId: string, verificationId: string): Promise<WordPressPublicVerification> {
    // Ownership/site checks and saved receipt reads only. Never collect or mutate
    // WordPress merely because a client polls this endpoint.
    await this.wordpress.getProposal(businessId, actor, proposalId);
    const siteUrl = await this.wordpress.reportSite(businessId);
    let saved: unknown;
    try { saved = await this.store.read(verificationId, "verification"); }
    catch { throw unavailable(); }
    if (saved === null) throw notFound();
    const parsed = receiptSchema.safeParse(saved);
    if (!parsed.success || parsed.data.id !== verificationId) throw unavailable();
    const receipt = parsed.data;
    if (receipt.actor !== actor || receipt.businessId !== businessId || receipt.proposalId !== proposalId || receipt.siteUrl !== siteUrl) throw notFound();
    return publicReceipt(receipt);
  }
}
