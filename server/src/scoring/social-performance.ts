import { createHash } from "node:crypto";
import { add, exact, multiply, rational, roundHalfUp, type Rational } from "./rational.js";
import { SOCIAL_PERFORMANCE_POLICY } from "./social-performance.policy.js";
import type { SocialCategoryResult, SocialCriterionDefinition, SocialCriterionId, SocialCriterionResult, SocialPerformanceInput, SocialPerformancePolicy, SocialPerformanceResult } from "./social-performance.types.js";

const DAY = 86400000;
const timestamp = (value: unknown): number => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : Number.NaN;
const numeric = (value: Rational) => Number(value.n) / Number(value.d);
const sum = (values: Rational[]) => values.reduce(add, rational(0n));
const ratioIds = new Set<SocialCriterionId>(["active-week-ratio", "actionable-post-ratio", "distinct-post-ratio", "reviewed-relevance", "customer-response-rate"]);
const binaryIds = new Set<SocialCriterionId>(["profile-name", "profile-website", "profile-contact", "profile-category"]);
function validValue(id: SocialCriterionId, value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && (id === "follower-growth-percent" ? value >= -100 : value >= 0)
    && (!ratioIds.has(id) || value <= 1) && (!binaryIds.has(id) || Number.isInteger(value) && value <= 1)
    && (id !== "profile-description" || Number.isInteger(value) && value <= 2)
    && (id !== "observable-structure-count" || Number.isInteger(value) && value <= 4);
}
function validatePolicy(policy: SocialPerformancePolicy) {
  const ids = policy.categories.flatMap(category => category.criteria.map(item => item.id));
  if (policy.version !== "social-performance-v1" || policy.categories.length !== 6 || new Set(ids).size !== ids.length
    || policy.categories.reduce((total, category) => total + category.weight, 0) !== 100
    || policy.categories.some(category => !Number.isInteger(category.weight) || category.weight <= 0 || category.criteria.reduce((total, item) => total + item.weight, 0) !== category.weight
      || category.criteria.some(item => !Number.isInteger(item.weight) || item.weight <= 0 || !item.bands.length || item.bands.some(band => !Number.isFinite(band.threshold) || !Number.isInteger(band.percent) || band.percent < 0 || band.percent > 100)
        || item.bands.some((band, index) => index > 0 && (band.threshold <= item.bands[index - 1]!.threshold || (item.direction === "higher" ? band.percent < item.bands[index - 1]!.percent : band.percent > item.bands[index - 1]!.percent)))))
    || !Number.isInteger(policy.minimumCoveragePercent) || policy.minimumCoveragePercent < 70 || policy.minimumCoveragePercent > 100
    || !Number.isInteger(policy.minimumPostingWeight) || policy.minimumPostingWeight < 10 || policy.minimumPostingWeight > 20
    || !Number.isInteger(policy.minimumEngagementWeight) || policy.minimumEngagementWeight < 15 || policy.minimumEngagementWeight > 25
    || !Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs <= 0 || policy.maxAgeMs > 7 * DAY) throw new Error("Invalid social performance policy.");
}
function percentage(definition: SocialCriterionDefinition, value: number): number {
  if (definition.direction === "lower") return definition.bands.find(band => value <= band.threshold)?.percent ?? 0;
  return [...definition.bands].reverse().find(band => value >= band.threshold)?.percent ?? 0;
}

/** Pure scoring of adapter-validated report evidence; never collects, calls AI, reads a clock or changes source records. */
export function calculateSocialPerformance(input: SocialPerformanceInput, policy: SocialPerformancePolicy = SOCIAL_PERFORMANCE_POLICY): SocialPerformanceResult {
  validatePolicy(policy);
  const cutoff = timestamp(input.cutoff), observed = timestamp(input.collectedAt);
  if (!Number.isFinite(cutoff) || !input.businessId || !/^\d+$/.test(input.pageId) || !input.reportId || !Array.isArray(input.evidenceIds) || input.evidenceIds.length > 20000
    || new Set(input.evidenceIds).size !== input.evidenceIds.length) throw new Error("Invalid social performance input identity or cutoff.");
  const sourceFresh = Number.isFinite(observed) && observed <= cutoff && cutoff - observed <= policy.maxAgeMs;
  const refValid = (refs: { reportId: string; evidenceId: string }[] | undefined) => Array.isArray(refs) && refs.length > 0 && refs.length <= 1000
    && refs.every(ref => ref.reportId === input.reportId && input.evidenceIds.includes(ref.evidenceId));
  const results: SocialCriterionResult[] = [];
  const earnedById = new Map<SocialCriterionId, Rational>();
  const categories: SocialCategoryResult[] = policy.categories.map(category => {
    const criteria = category.criteria.map(definition => {
      const item = input.criteria[definition.id];
      const date = timestamp(item?.collectedAt);
      const dateValid = Number.isFinite(date) && date <= cutoff && cutoff - date <= policy.maxAgeMs;
      let status: SocialCriterionResult["status"] = "unavailable";
      let reason: string | undefined = !sourceFresh || !dateValid && !!item ? "STALE_OR_INVALID_EVIDENCE" : item?.reason ?? "METRIC_NOT_AVAILABLE";
      let earned: Rational | null = null;
      if (sourceFresh && dateValid && item?.complete === true) {
        if (item.status === "not_applicable" && refValid(item.applicabilityEvidence)) { status = "not_applicable"; reason = undefined; }
        else if (item.status === "available" && validValue(definition.id, item.value) && refValid(item.evidence)) {
          status = "available"; reason = undefined;
          earned = rational(BigInt(definition.weight * percentage(definition, item.value)), 100n);
          earnedById.set(definition.id, earned);
        } else if (item.status === "available") reason = "INVALID_OR_UNCITED_METRIC";
        else if (item.status === "not_applicable") reason = "APPLICABILITY_NOT_CONFIRMED";
      } else if (sourceFresh && dateValid && item?.status === "available") reason = "INCOMPLETE_METRIC_EVIDENCE";
      const result: SocialCriterionResult = { id: definition.id, label: definition.label, maximum: definition.weight,
        earned: earned ? numeric(earned) : null, exact: earned ? exact(earned) : null, status,
        value: status === "available" ? item!.value : null, unit: definition.unit,
        explanation: item?.explanation || "The available saved evidence does not establish this measure.", ...(reason ? { reason } : {}),
        evidence: structuredClone(status === "not_applicable" ? item?.applicabilityEvidence ?? [] : item?.evidence?.filter(ref => ref.reportId === input.reportId && input.evidenceIds.includes(ref.evidenceId)) ?? []),
        recommendation: definition.recommendation, collectedAt: item?.collectedAt ?? null };
      results.push(result); return result;
    });
    const known = criteria.filter(item => item.status === "available"), applicable = criteria.filter(item => item.status !== "not_applicable");
    return { id: category.id, label: category.label, maximum: category.weight,
      earned: known.length ? numeric(sum(known.map(item => earnedById.get(item.id)!))) : null,
      evidencedWeight: known.reduce((total, item) => total + item.maximum, 0), applicableWeight: applicable.reduce((total, item) => total + item.maximum, 0),
      status: applicable.length === 0 ? "not_applicable" : known.length === 0 ? "unavailable" : known.length === applicable.length ? "available" : "partial",
      criteria, recommendations: criteria.filter(item => item.status === "unavailable" || item.status === "available" && item.earned! < item.maximum).map(item => item.recommendation) };
  });
  const knownWeight = categories.reduce((total, item) => total + item.evidencedWeight, 0), applicableWeight = categories.reduce((total, item) => total + item.applicableWeight, 0);
  const coveragePercent = applicableWeight ? Math.round(knownWeight * 10000 / applicableWeight) / 100 : 0;
  const posting = categories.find(item => item.id === "posting-consistency")!.evidencedWeight, engagement = categories.find(item => item.id === "audience-engagement")!.evidencedWeight;
  const enough = applicableWeight > 0 && knownWeight * 100 >= applicableWeight * policy.minimumCoveragePercent && posting >= policy.minimumPostingWeight && engagement >= policy.minimumEngagementWeight;
  const hasPerformance = categories.some(item => item.id !== "profile-quality" && item.evidencedWeight > 0);
  const status = enough ? "definitive" : hasPerformance && knownWeight > 0 ? "provisional" : "insufficient_data";
  const score = status !== "insufficient_data" && knownWeight ? multiply(sum([...earnedById.values()]), rational(100n, BigInt(knownWeight))) : null;
  // A saved read must stop publishing this exact assessment as soon as any used observation expires.
  // Include attested applicability, because an expired exclusion also invalidates the normalized denominator.
  const usedDates = results.filter(item => item.status !== "unavailable").map(item => timestamp(item.collectedAt));
  const earliestUsed = Number.isFinite(observed) ? Math.min(observed, ...usedDates) : Number.NaN;
  return { version: policy.version, policyHash: createHash("sha256").update(JSON.stringify(policy)).digest("hex"),
    businessId: input.businessId, pageId: input.pageId, reportId: input.reportId,
    value: score ? roundHalfUp(score) : null, exact: score ? exact(score) : null, status, coveragePercent, knownWeight, applicableWeight,
    categories, missingMetrics: results.filter(item => item.status === "unavailable").map(item => ({ id: item.id, label: item.label, reason: item.reason ?? "METRIC_NOT_AVAILABLE" })),
    recommendations: [...new Set(categories.flatMap(item => item.recommendations))],
    limitations: ["Thresholds are provisional product targets, not established industry standards or a guarantee of business results.",
      "Overall score is normalized only across evidenced applicable criterion weight; coverage is reported independently.",
      "A definitive score requires at least 70% applicable coverage, 10 evidenced posting points and 15 evidenced engagement points.",
      "Likes and comments per current follower are 30-day action-density proxies, not unique-person engagement rates. Repeated actions and non-followers can contribute.",
      "Media views are non-unique visibility, not people reached. Lifetime shares cannot substitute for period share evidence.",
      "Content pattern checks assess observable structure and exact repetition; relevance, factual accuracy and substantive usefulness require supported review.",
      "Conversation counts cannot establish response quality, response time or message volume."],
    freshness: { collectedAt: input.collectedAt, cutoff: input.cutoff, expiresAt: Number.isFinite(earliestUsed) ? new Date(earliestUsed + policy.maxAgeMs).toISOString() : input.cutoff, status: sourceFresh ? "fresh" : "stale" } };
}
