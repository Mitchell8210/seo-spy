import { createHash } from "node:crypto";
import type { SocialCriterionDefinition, SocialPerformancePolicy, SocialThresholdBand } from "./social-performance.types.js";

const up = (...thresholds: number[]): readonly SocialThresholdBand[] => thresholds.map((threshold, index) => ({ threshold, percent: (index + 1) * 100 / thresholds.length }));
const down = (...thresholds: number[]): readonly SocialThresholdBand[] => thresholds.map((threshold, index) => ({ threshold, percent: 100 - index * 100 / thresholds.length }));
const criterion = (id: SocialCriterionDefinition["id"], label: string, weight: number, unit: string, bands: readonly SocialThresholdBand[], recommendation: string, direction: "higher" | "lower" = "higher"): SocialCriterionDefinition => ({ id, label, weight, unit, direction, bands, recommendation });

/** Explicit initial product targets for small-business reviews, not established Meta or industry benchmarks. */
export const SOCIAL_PERFORMANCE_POLICY: SocialPerformancePolicy = {
  version: "social-performance-v1", benchmarkStatus: "provisional-product-thresholds-not-industry-standards",
  maxAgeMs: 7 * 86400000, minimumCoveragePercent: 70, minimumPostingWeight: 10, minimumEngagementWeight: 15,
  categories: [
    { id: "profile-quality", label: "Profile Quality", weight: 15, criteria: [
      criterion("profile-name", "Business name", 3, "validated presence", up(1), "Publish a clear business name that people can recognize."),
      criterion("profile-description", "Description clarity signals", 3, "observable description signals", up(1, 2), "Describe the service and give a useful next step or contact route; textual signals do not establish writing quality."),
      criterion("profile-website", "Website link", 3, "valid HTTP(S) destination", up(1), "Add a valid public website link and verify its destination separately."),
      criterion("profile-contact", "Contact route", 3, "valid contact route", up(1), "Provide a syntactically valid phone number or email that customers can use."),
      criterion("profile-category", "Business category", 3, "validated presence", up(1), "Select a populated business category and review whether it describes your services."),
    ] },
    { id: "posting-consistency", label: "Posting Consistency", weight: 20, criteria: [
      criterion("posts-per-week", "Posting frequency", 6, "posts/week across 90 days", up(0.25, 0.5, 1, 2), "Build a sustainable publishing schedule; the full target is two posts per week averaged over 90 days."),
      criterion("posting-recency-days", "Latest post recency", 5, "days since latest post", down(7, 14, 30, 60), "Publish a useful update when the latest post is old; seven days or less meets the current recency target.", "lower"),
      criterion("active-week-ratio", "Weeks with a post", 5, "fraction of 12 complete weeks", up(0.25, 0.5, 0.75, 1), "Spread posts across the 12 complete weeks instead of publishing them in one burst."),
      criterion("longest-gap-days", "Longest inactive interval", 4, "days including 90-day window edges", down(7, 14, 30, 60), "Reduce long gaps between posts; the current full target is no gap longer than seven days.", "lower"),
    ] },
    { id: "audience-engagement", label: "Audience Engagement", weight: 25, criteria: [
      criterion("likes-per-100-followers", "Likes per 100 current followers", 10, "30-day likes per 100 followers", up(0.5, 1, 3, 5), "Publish content that invites relevant reactions; this measure covers LIKE reactions only, not all reaction types."),
      criterion("comments-per-100-followers", "Comments per 100 current followers", 10, "30-day comments per 100 followers", up(0.25, 0.5, 1, 2), "Invite substantive questions and discussion, then review the conversations for useful follow-up."),
      criterion("shares-per-100-followers", "Shares per 100 current followers", 5, "30-day shares per 100 followers", up(0.1, 0.25, 0.5, 1), "Provide useful material people want to share; establish complete timestamped share evidence before scoring this measure."),
    ] },
    { id: "reach-growth", label: "Audience Reach and Growth", weight: 15, criteria: [
      criterion("follower-growth-percent", "Follower growth", 10, "30-day growth percent from aligned snapshots", up(1, 3, 5, 10), "Collect comparable start/end follower snapshots; daily unique follows/unfollows do not establish an exact starting audience."),
      criterion("media-views-per-follower", "Content visibility per current follower", 5, "30-day non-unique media views per follower", up(0.5, 1, 3, 5), "Improve distribution of useful content and monitor its visibility; media views are not unique people reached."),
    ] },
    { id: "content-quality", label: "Content Quality", weight: 15, criteria: [
      criterion("actionable-post-ratio", "Observable actionability", 4, "fraction with contact, resource, question or explanatory structure", up(0.25, 0.5, 0.75, 1), "Include an appropriate resource, clear next step, useful question or explanatory list; these are structural proxies, not proof of usefulness."),
      criterion("observable-structure-count", "Content structure variety", 3, "distinct observable structures in 90 days", up(1, 2, 3, 4), "Vary observable structures such as resources, questions, contact invitations and explanations when they serve the audience."),
      criterion("distinct-post-ratio", "Avoiding exact repetition", 4, "distinct normalized text / text posts", up(0.25, 0.5, 0.75, 1), "Review repeated wording and add substantive context rather than repeatedly publishing identical text."),
      criterion("reviewed-relevance", "Reviewed usefulness and relevance", 4, "explicit supported review ratio", up(0.25, 0.5, 0.75, 1), "Review content against the business and customer needs; simple text patterns cannot establish factual accuracy or relevance."),
    ] },
    { id: "customer-interaction", label: "Customer Interaction", weight: 10, criteria: [
      criterion("customer-response-rate", "Customer response coverage", 5, "verified response fraction for eligible inquiries", up(0.25, 0.5, 0.75, 1), "Establish eligible inbound-inquiry and business-response evidence before assessing response coverage."),
      criterion("customer-response-hours", "Customer response time", 5, "verified median response hours", down(1, 4, 12, 24), "Respond promptly to eligible inquiries and measure actual paired inquiry/response timestamps; conversations alone cannot measure response quality.", "lower"),
    ] },
  ],
};
for (const category of SOCIAL_PERFORMANCE_POLICY.categories) {
  for (const item of category.criteria) {
    for (const band of item.bands) Object.freeze(band);
    Object.freeze(item.bands); Object.freeze(item);
  }
  Object.freeze(category.criteria); Object.freeze(category);
}
Object.freeze(SOCIAL_PERFORMANCE_POLICY.categories); Object.freeze(SOCIAL_PERFORMANCE_POLICY);
export const SOCIAL_PERFORMANCE_POLICY_HASH = createHash("sha256").update(JSON.stringify(SOCIAL_PERFORMANCE_POLICY)).digest("hex");
