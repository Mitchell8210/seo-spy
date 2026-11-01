export type ScoreCategory = "website" | "social" | "consistency" | "overall";
export type ScoreProfile = "baseline-mobile-v1" | "baseline-desktop-v1";
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
export interface SocialScoreInput {
  sourceReportId: string;
  profile: ScoreCriterion[];
  goal: (ConfirmedRevision & { targetPostsPerPeriod: number }) | null;
  publishing: {
    complete: boolean;
    truncated: boolean;
    trustworthyTimestamps: boolean;
    periods: { startAt: string; endAt: string; count: number; evidence: ScoreEvidenceRef[] }[];
  } | null;
}
export interface ConsistencyScoreInput {
  websiteReportId: string;
  facebookReportId: string;
  facts: ConfirmedRevision | null;
  applicability: ConfirmedRevision | null;
  criteria: (ScoreCriterion & { applicable: boolean })[];
}
export interface ScoreAssessmentInput {
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
  policyVersion: "seo-spy-score-v1";
  policyHash: string;
  sources: ScoreSource[];
  confirmations: { socialGoal: SocialScoreInput["goal"]; consistencyFacts: ConfirmedRevision | null; applicability: ConfirmedRevision | null };
  scores: Record<ScoreCategory, CalculatedScore>;
  limitations: string[];
}
