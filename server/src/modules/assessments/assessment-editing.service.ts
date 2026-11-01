import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { WordPressMuseService } from "../wordpress/wordpress-muse.service.js";
import { WordPressService } from "../wordpress/wordpress.service.js";

export const prepareAssessmentMediaAltSchema = z.object({
  reportId: z.string().uuid(), analysisId: z.string().uuid(),
  recommendationId: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  altText: z.string().max(2000),
}).strict();
export type PrepareAssessmentMediaAlt = z.infer<typeof prepareAssessmentMediaAltSchema>;

/** An explicit operator-authored preview, never a model execution tool. */
@Injectable()
export class AssessmentEditingService {
  constructor(private readonly muse: WordPressMuseService, private readonly wordpress: WordPressService) {}

  async prepareMediaAlt(businessId: string, actor: string, input: PrepareAssessmentMediaAlt) {
    const parsed = prepareAssessmentMediaAltSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException({ code: "ASSESSMENT_EDIT_INPUT_INVALID", message: "Select a saved recommendation and an exact media alternative of at most 2000 characters." });
    const selected = parsed.data;
    // This reader revalidates business/site/source hash and every saved citation.
    // It reads local reports only, even when model generation is disabled.
    const analysis = await this.muse.read(businessId, selected.reportId, selected.analysisId);
    const recommendation = analysis.output.recommendations.find(item => item.id === selected.recommendationId);
    if (!recommendation) throw new NotFoundException({ code: "ASSESSMENT_RECOMMENDATION_NOT_FOUND", message: "The selected recommendation was not found in this saved analysis." });
    const mediaId = recommendation.targetContentId;
    const mediaCitation = `${selected.reportId}:wordpress:media:${mediaId}:content`;
    if (recommendation.resource !== "media" || recommendation.capabilityId !== "wordpress.media.propose-update"
      || mediaId === null || !Number.isSafeInteger(mediaId) || mediaId <= 0 || !recommendation.evidenceIds.includes(mediaCitation)) {
      throw new BadRequestException({ code: "ASSESSMENT_EDIT_UNSUPPORTED", message: "An exact cited WordPress media target is required. Other recommendations remain informational or manual-only." });
    }
    if (analysis.siteUrl !== await this.wordpress.reportSite(businessId)) {
      throw new ConflictException({ code: "ASSESSMENT_EDIT_SITE_CHANGED", message: "The saved recommendation does not match the currently configured WordPress installation." });
    }
    // Only the operator's explicit text enters the patch. Recommendation prose
    // and model output never become parameters or grant approval to apply.
    const proposal = await this.wordpress.propose(businessId, actor, { resource: "media", resourceId: mediaId, changes: { altText: selected.altText } });
    const route = `/api/wordpress/businesses/${encodeURIComponent(businessId)}/proposals/${proposal.id}`;
    return {
      schemaVersion: "seo-spy.assessment-edit-preview.v1" as const, businessId, kind: "wordpress-media-alt" as const,
      origin: { reportId: selected.reportId, sourceHash: analysis.sourceHash, analysisId: selected.analysisId,
        recommendationId: selected.recommendationId, evidenceIds: [...recommendation.evidenceIds],
        generationMode: analysis.generationMode ?? "unknown", provider: analysis.provider ?? "unknown", isMock: analysis.isMock ?? null },
      proposal,
      nextSteps: {
        apply: { method: "POST" as const, path: `${route}/apply`, proposalHash: proposal.hash, confirmed: true as const },
        publicVerification: { method: "POST" as const, path: `${route}/verifications`, requiresPublishedPageId: true as const },
      },
      limitations: [
        ...(analysis.isMock === true ? ["MOCK recommendation: this interpretation used a local development fixture, not a live model. The exact alternative is separately authored and reviewed by the operator."] : []),
        "A saved recommendation is not authorization. Preparing this preview performs one fresh target read, creates no approval and applies no WordPress change.",
        "Review before/changes, target and expiry. Applying requires an explicit confirmed request for this exact hash and the independent WordPress write gate.",
        "Stored-field success and public rendered verification are separate. Attachment alternatives may differ from builder/widget-specific alternatives; empty alternatives may be intentional.",
        "No model generation, score change, public collection, external write or automatic retry is triggered by this preview.",
      ],
    };
  }
}
