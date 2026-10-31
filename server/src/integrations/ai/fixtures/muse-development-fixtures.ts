import type { WordPressMuseEvidenceBundle } from "../../../modules/wordpress/wordpress-muse-evidence.js";
import type { WordPressMuseOutput } from "../../../modules/wordpress/wordpress-muse.types.js";

export const MUSE_DEVELOPMENT_FIXTURES_VERSION = "muse-development-fixtures-v1";

/** Local examples only. These are never provider results or live measurements. */
export const museDevelopmentFixtures = {
  schemaVersion: "seo-spy.mock-ai-fixtures.v1",
  fixtureVersion: MUSE_DEVELOPMENT_FIXTURES_VERSION,
  isMock: true,
  provider: "mock-fixture",
  seoAudit: {
    scope: "illustrative_homepage",
    observations: [
      { id: "fixture-title", field: "title", observed: "Example Tax Services", outcome: "present" },
      { id: "fixture-description", field: "meta_description", observed: null, outcome: "not_observed_in_fixture" },
      { id: "fixture-alt", field: "image_alt", observed: "", outcome: "review_context" },
    ],
    limitations: ["Invented local fixture, not a real audit. Missing metadata may have a template or rendering fallback."],
  },
  recommendations: [
    { evidenceIds: ["fixture-description"], recommendation: "Inspect the rendered page and SEO-plugin template before deciding whether a description is missing.", effort: "small", risk: "low", verification: "Compare the saved configuration with public source HTML.", executable: false },
    { evidenceIds: ["fixture-alt"], recommendation: "Review the image in context; keep an empty alternative if the image is decorative.", effort: "small", risk: "low", verification: "Verify the specific rendered image alternative after any separately approved edit.", executable: false },
  ],
  scoringExplanation: {
    seoSpyScore: null,
    reason: "No approved scoring policy or sufficient eligible evidence is present in this fixture.",
    coverage: "illustrative_only",
    notes: ["Unavailable evidence is not zero.", "Stored Rank Math optimization scores are separate from Lighthouse and SEO Spy scores.", "The deterministic backend owns scoring; this example does not calculate a score."],
  },
} as const;

/** Bind fixed local response templates to real saved references without inventing findings. */
export function buildMockWordPressMuseOutput(bundle: WordPressMuseEvidenceBundle): WordPressMuseOutput {
  const sources = bundle.observations.filter(item => item.contentId !== null).slice(0, 3);
  const selected = sources.length ? sources : bundle.observations.slice(0, 1);
  if (!selected.length) throw new Error("Mock evidence requires an existing source reference.");
  const observations: WordPressMuseOutput["observations"] = selected.map((item, index) => {
    let text = "A stored source observation is available in this bounded sample; its scope and collection date require review.";
    if (item.values.kind === "wordpress_content") {
      text = item.resource === "media"
        ? item.values.altText === "" ? "The sampled media record stores an empty alternative; that may be intentional for a decorative image."
          : item.values.altText === null ? "The sampled media record does not expose an alternative in this report; the rendered image remains unverified."
            : "The sampled media record exposes a stored alternative; its public rendering remains unverified."
        : item.values.title === null ? "The sampled content record does not expose a title in this report; the rendered page remains unverified."
          : item.values.title === "" ? "The sampled content record stores an empty title; the rendered title and plugin templates remain unverified."
            : "The sampled published content record exposes a stored title; this does not establish the public SEO title.";
    } else if (item.values.kind === "rank_math_stored_score") {
      text = item.values.storedSeoScore === null ? "The sampled stored optimization score is unavailable; it is not treated as zero."
        : `Rank Math exposes a stored optimization score of ${item.values.storedSeoScore} for this sample; its calculation date is unknown.`;
    }
    return { id: `sample_${index}`, kind: "fact", text, evidenceIds: [item.evidenceId] };
  });
  const target = selected[0];
  const recommendations: WordPressMuseOutput["recommendations"] = [{
    id: "review_sample", observationIds: [observations[0].id], resource: target.resource,
    targetContentId: target.contentId,
    capabilityId: target.contentId === null ? null : `wordpress.${target.resource}.propose-update`,
    recommendation: target.resource === "media" ? "Review the sampled image in context before proposing alternative text. Keep an empty alternative when it is decorative."
      : "Compare the sampled stored fields with the public page and SEO-plugin templates before proposing any edit.",
    rationale: "Stored fields and a bounded sample do not independently establish the public result or a defect.",
    effort: "small", risk: "low", verificationSteps: ["Inspect the exact public page and source record independently.", "If an edit is warranted, review a separate exact proposal and verify stored and rendered values afterwards."],
    manualFallback: "Review the existing WordPress record manually; this mock fixture authorizes no change.", evidenceIds: [target.evidenceId],
  }];
  return {
    schemaVersion: "wordpress-muse-output-v1",
    summary: "Mock development fixture: review the sampled WordPress evidence. No real model call or automatic edit was made.",
    summaryEvidenceIds: [target.evidenceId], observations, recommendations,
    limitations: ["MOCK DATA: generated locally from fixed development templates, not by Meta AI.", "Only selected saved observations are represented; public rendering, complete site coverage and scoring freshness remain unverified."],
    seoSpyScore: null,
  };
}
