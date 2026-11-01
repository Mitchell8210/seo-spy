import { createHash } from "node:crypto";

/** Accepted deterministic baseline. Importing this policy never enables score publication. */
export const SCORE_POLICY = Object.freeze({
  version: "seo-spy-score-v1" as const,
  overallWeights: Object.freeze({ website: 50, social: 30, consistency: 20 }),
  websiteWeights: Object.freeze({ seo: 50, performance: 25, accessibility: 15, "best-practices": 10 }),
  socialWeights: Object.freeze({ profile: 60, publishing: 40 }),
  profileWeights: Object.freeze({ "business-name": 20, description: 20, "website-link": 20, "contact-route": 20, category: 20 }),
  consistencyWeights: Object.freeze({ "business-name": 20, phone: 30, "website-url": 30, hours: 20 }),
  maxSourceAgeMs: 7 * 86400000,
  maxSourceSkewMs: 72 * 3600000,
  publishingPeriods: 4,
  periodMs: 7 * 86400000,
  rounding: "nearest-integer-half-up-final-only",
  coverage: "all-applicable-required-criteria",
  rankMathContribution: "excluded-until-separately-eligible-profile",
});
for (const weights of [SCORE_POLICY.overallWeights, SCORE_POLICY.websiteWeights, SCORE_POLICY.socialWeights, SCORE_POLICY.profileWeights, SCORE_POLICY.consistencyWeights]) {
  if (Object.values(weights).some(weight => !Number.isInteger(weight) || weight <= 0) || Object.values(weights).reduce((sum, weight) => sum + weight, 0) !== 100) throw new Error("Invalid score policy weights.");
}
export const SCORE_POLICY_HASH = createHash("sha256").update(JSON.stringify(SCORE_POLICY)).digest("hex");
