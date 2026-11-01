import type { ExactScore, ScoreEvidenceRef } from "./scoring.types.js";

export type SocialCategoryId = "profile-quality" | "posting-consistency" | "audience-engagement" | "reach-growth" | "content-quality" | "customer-interaction";
export type SocialCriterionId = "profile-name" | "profile-description" | "profile-website" | "profile-contact" | "profile-category"
  | "posts-per-week" | "posting-recency-days" | "active-week-ratio" | "longest-gap-days"
  | "likes-per-100-followers" | "comments-per-100-followers" | "shares-per-100-followers"
  | "follower-growth-percent" | "media-views-per-follower"
  | "actionable-post-ratio" | "observable-structure-count" | "distinct-post-ratio" | "reviewed-relevance"
  | "customer-response-rate" | "customer-response-hours";
export interface SocialCriterionInput {
  status: "available" | "unavailable" | "not_applicable";
  value: number | null;
  evidence: ScoreEvidenceRef[];
  collectedAt: string;
  complete: boolean;
  explanation: string;
  reason?: string;
  /** Unavailability never makes a criterion inapplicable. Exclusion requires separate attested applicability evidence. */
  applicabilityEvidence?: ScoreEvidenceRef[];
}
export interface SocialPerformanceInput {
  businessId: string; pageId: string; reportId: string; collectedAt: string; cutoff: string;
  /** Evidence IDs in the exact owning report, validated before this pure engine is called. */
  evidenceIds: string[];
  criteria: Partial<Record<SocialCriterionId, SocialCriterionInput>>;
}
export interface SocialThresholdBand { threshold: number; percent: number }
export interface SocialCriterionDefinition {
  id: SocialCriterionId; label: string; weight: number; unit: string;
  direction: "higher" | "lower"; bands: readonly SocialThresholdBand[]; recommendation: string;
}
export interface SocialCategoryDefinition { id: SocialCategoryId; label: string; weight: number; criteria: readonly SocialCriterionDefinition[] }
export interface SocialPerformancePolicy {
  version: "social-performance-v1";
  benchmarkStatus: "provisional-product-thresholds-not-industry-standards";
  maxAgeMs: number; minimumCoveragePercent: number; minimumPostingWeight: number; minimumEngagementWeight: number;
  categories: readonly SocialCategoryDefinition[];
}
export interface SocialCriterionResult {
  id: SocialCriterionId; label: string; maximum: number; earned: number | null; exact: ExactScore | null;
  status: "available" | "unavailable" | "not_applicable"; value: number | null; unit: string;
  explanation: string; reason?: string; evidence: ScoreEvidenceRef[]; recommendation: string;
  collectedAt: string | null;
}
export interface SocialCategoryResult {
  id: SocialCategoryId; label: string; maximum: number; earned: number | null;
  evidencedWeight: number; applicableWeight: number; status: "available" | "partial" | "unavailable" | "not_applicable";
  criteria: SocialCriterionResult[]; recommendations: string[];
}
export interface SocialPerformanceResult {
  version: "social-performance-v1"; policyHash: string; businessId: string; pageId: string; reportId: string;
  value: number | null; exact: ExactScore | null; status: "definitive" | "provisional" | "insufficient_data";
  coveragePercent: number; knownWeight: number; applicableWeight: number;
  categories: SocialCategoryResult[]; missingMetrics: { id: SocialCriterionId; label: string; reason: string }[];
  recommendations: string[]; limitations: string[];
  freshness: { collectedAt: string; cutoff: string; expiresAt: string; status: "fresh" | "stale" };
}
