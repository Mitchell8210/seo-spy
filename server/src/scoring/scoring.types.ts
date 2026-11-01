import type { SocialPerformanceInput, SocialPerformanceResult } from "./social-performance.types.js";

export type ScoreCategory = "website" | "social" | "consistency" | "overall";
export type ScoreProfile = "baseline-mobile-v1" | "baseline-desktop-v1";
export type ScorePolicyVersion = "seo-spy-score-v1" | "seo-spy-score-v1.1" | "seo-spy-score-v1.2" | "seo-spy-score-v1.3" | "seo-spy-score-v1.4";
export type ScoreOutcome = "pass" | "fail" | "unknown";
export interface ScoreEvidenceRef { reportId: string; evidenceId: string }
export interface ScoreSource {
  reportId: string;
  reportHash: string;
  businessId: string;
  schemaVersion: "seo-spy.audit-report.v1";
  provider: "website" | "facebook";
  mode: "live";
  asset: string;
  collectedAt: string;
  selectionReason: string;
  evidenceIds: string[];
}
export interface WebsiteScoreInput {
  pageBinding?: { requestedUrl: string; finalUrl: string; evidence: ScoreEvidenceRef };
  sourceReportId: string;
  auditId: string;
  requestedUrl: string;
  finalUrl: string;
  strategy: "mobile" | "desktop";
  lighthouseVersion: string;
  fetchedAt: string;
  categories: { id: string; score: number | null; availability: "measured" | "unavailable" }[];
}
export interface ScoreCriterion {
  observations?: { website: string | null; facebook: string | null };
  id: string;
  outcome: ScoreOutcome;
  /** observed = confirmed visible populated value; confirmed-absence = separate reliable absence evidence. */
  confirmation: "observed" | "confirmed-absence" | "unconfirmed";
  evidence: ScoreEvidenceRef[];
  reason?: string;
}
export interface ConfirmedRevision { revision: string; confirmedBy: string; confirmedAt: string }
export interface ConfirmedConsistencyRevision extends ConfirmedRevision {
  /** A reviewed source observation, not a preferred-value declaration. */
  sourceAttestation?: { websiteReportId: string; facebookReportId: string };
  reviewReuse?: SourceReviewReuse;
}
export interface SourceReviewReuse {
  version: "unchanged-source-observations-v1";
  originalSources: (ScoreSource & { observationHash: string })[];
  currentSources: { provider: "website" | "facebook"; reportId: string; reportHash: string; observationHash: string }[];
  reviews: { observedAt: string; validFrom: string; validUntil?: string; timeZone: string | null }[];
}
export interface SocialScoreInput {
  performance?: SocialPerformanceInput;
  sourceReportId: string;
  profile: ScoreCriterion[];
  goal: (ConfirmedRevision & { targetPostsPerPeriod: number }) | null;
  publishing: {
    /** v1.1: exclusive UTC midnight ending the latest complete UTC reporting day. */
    reportingCutoff?: string;
    complete: boolean;
    truncated: boolean;
    trustworthyTimestamps: boolean;
    periods: { startAt: string; endAt: string; count: number; evidence: ScoreEvidenceRef[] }[];
  } | null;
}
export interface ConsistencyScoreInput {
  comparisonMode?: "preferred-values" | "source-agreement";
  websiteReportId: string;
  facebookReportId: string;
  facts: ConfirmedConsistencyRevision | null;
  applicability: ConfirmedRevision | null;
  criteria: (ScoreCriterion & { applicable: boolean })[];
}
export interface ScoreAssessmentInput {
  /** Omitted preserves legacy v1 calculation and snapshot shape exactly. */
  policyVersion?: ScorePolicyVersion;
  businessId: string;
  cutoff: string;
  profile: ScoreProfile;
  expectedAssets: { websiteUrl: string; facebookPageId: string | null };
  sources: ScoreSource[];
  website: WebsiteScoreInput | null;
  social: SocialScoreInput | null;
  consistency: ConsistencyScoreInput | null;
}
export interface ExactScore { numerator: string; denominator: string }
export interface CriterionLedger {
  id: string;
  weight: number;
  outcome: ScoreOutcome;
  originalValue: number | string | null;
  exact: ExactScore | null;
  contribution: ExactScore | null;
  evidence: ScoreEvidenceRef[];
  reasons: string[];
  details?: CriterionLedger[];
}
export interface CalculatedScore {
  value: number | null;
  maximum: 100;
  availability: "available" | "unavailable";
  exact: ExactScore | null;
  coverage: { knownWeight: number; requiredWeight: number };
  reasons: string[];
  ledger: CriterionLedger[];
}
export interface ScoreSnapshot {
  schemaVersion: "seo-spy.score-snapshot.v1";
  businessId: string;
  cutoff: string;
  profile: ScoreProfile;
  policyVersion: ScorePolicyVersion;
  policyHash: string;
  /** v1.1 required reporting metadata; v1.2 optional advisory metadata. Never emitted for v1. */
  reportingCutoff?: string | null;
  socialScope?: "facebook-profile-readiness" | "facebook-presence-quality";
  socialAssessment?: SocialPerformanceResult;
  consistencyBasis?: "preferred-values" | "source-agreement" | null;
  sources: ScoreSource[];
  confirmations: { socialGoal: SocialScoreInput["goal"]; consistencyFacts: ConfirmedConsistencyRevision | null; applicability: ConfirmedRevision | null };
  scores: Record<ScoreCategory, CalculatedScore>;
  limitations: string[];
}
