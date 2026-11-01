import { z } from "zod";
import { SCORE_POLICY, SCORE_POLICY_HASH } from "./policy.js";
import { add, decimal, exact, fromExact, multiply, rational, roundHalfUp, type Rational } from "./rational.js";
import type { CalculatedScore, ConfirmedRevision, CriterionLedger, ScoreAssessmentInput, ScoreCriterion, ScoreEvidenceRef, ScoreSnapshot, ScoreSource } from "./scoring.types.js";

export class ScoringInputError extends Error {
  constructor(public readonly code: string) { super("The scoring input is invalid or unsupported."); this.name = "ScoringInputError"; }
}
const unique = (values: string[]) => [...new Set(values)];
const timestamp = (value: string): number | null => z.string().datetime({ offset: true }).safeParse(value).success && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
function url(value: string): string | null {
  try { const parsed = new URL(value); return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.hash ? parsed.href : null; } catch { return null; }
}
const label = (value: string) => typeof value === "string" && value.trim().length > 0 && value.length <= 500;
const sum = (values: Rational[]) => values.reduce(add, rational(0n));
const contribution = (value: Rational, weight: number, denominator = 100): Rational => multiply(value, rational(BigInt(weight), BigInt(denominator)));

function finish(ledger: CriterionLedger[], requiredWeight: number, extraReasons: string[] = []): CalculatedScore {
  const required = ledger.filter(row => row.weight > 0);
  const knownWeight = required.filter(row => row.exact !== null).reduce((total, row) => total + row.weight, 0);
  const reasons = unique([...extraReasons, ...required.flatMap(row => row.reasons)]);
  const eligible = requiredWeight > 0 && knownWeight === requiredWeight && reasons.length === 0;
  const total = eligible ? sum(required.map(row => fromExact(row.contribution!))) : null;
  return { value: total ? roundHalfUp(total) : null, maximum: 100, availability: total ? "available" : "unavailable", exact: total ? exact(total) : null,
    coverage: { knownWeight, requiredWeight }, reasons, ledger };
}
function row(id: string, weight: number, value: Rational | null, originalValue: CriterionLedger["originalValue"], reasons: string[], evidence: ScoreEvidenceRef[] = [], denominator = 100): CriterionLedger {
  return { id, weight, outcome: value === null ? "unknown" : value.n > 0n ? "pass" : "fail", originalValue,
    exact: value === null ? null : exact(value), contribution: value === null ? null : exact(contribution(value, weight, denominator)), evidence, reasons: unique(reasons) };
}
const missing = (id: string, reasons = ["MISSING_EVIDENCE"]): CalculatedScore => finish([row(id, 100, null, null, reasons)], 100);

/** Pure and replayable: no providers, database, environment configuration, jobs or clock reads. */
export function calculateScoreSnapshot(input: ScoreAssessmentInput): ScoreSnapshot {
  const cutoff = timestamp(input.cutoff);
  if (cutoff === null || !label(input.businessId) || !url(input.expectedAssets.websiteUrl) || !Array.isArray(input.sources) || input.sources.length > 2) throw new ScoringInputError("INVALID_SCORING_INPUT");
  if (!["baseline-mobile-v1", "baseline-desktop-v1"].includes(input.profile)) throw new ScoringInputError("UNSUPPORTED_PROFILE");
  const sourceReasons = (source: ScoreSource): string[] => {
    const reasons: string[] = [];
    if (source.businessId !== input.businessId || source.schemaVersion !== "seo-spy.audit-report.v1" || source.mode !== "live"
      || !label(source.reportId) || !/^[a-f0-9]{64}$/.test(source.reportHash) || !label(source.selectionReason)
      || !Array.isArray(source.evidenceIds) || source.evidenceIds.length > 20000 || source.evidenceIds.some(id => !label(id)) || new Set(source.evidenceIds).size !== source.evidenceIds.length
      || input.sources.filter(other => other.provider === source.provider).length !== 1 || input.sources.filter(other => other.reportId === source.reportId).length !== 1) reasons.push("SOURCE_MISMATCH");
    if (source.provider === "website" ? url(source.asset) !== url(input.expectedAssets.websiteUrl) : source.provider !== "facebook" || !input.expectedAssets.facebookPageId || source.asset !== input.expectedAssets.facebookPageId) reasons.push("ASSET_MISMATCH");
    const collected = timestamp(source.collectedAt);
    if (collected === null) reasons.push("INVALID_TIMESTAMP");
    else if (collected > cutoff) reasons.push("FUTURE_INPUT");
    else if (cutoff - collected > SCORE_POLICY.maxSourceAgeMs) reasons.push("STALE_INPUT");
    return unique(reasons);
  };
  const source = (id: string, provider: ScoreSource["provider"]): ScoreSource | null => input.sources.find(item => item.reportId === id && item.provider === provider) ?? null;
  const refsValid = (refs: ScoreEvidenceRef[], allowed: string[]) => Array.isArray(refs) && refs.length > 0 && refs.length <= 1000 && refs.every(ref => allowed.includes(ref.reportId) && input.sources.some(item => item.reportId === ref.reportId && Array.isArray(item.evidenceIds) && item.evidenceIds.includes(ref.evidenceId)));
  const revisionValid = (value: ConfirmedRevision | null): boolean => !!value && label(value.revision) && label(value.confirmedBy) && timestamp(value.confirmedAt) !== null && timestamp(value.confirmedAt)! <= cutoff;
  const skewReasons = (sources: ScoreSource[]) => {
    const dates = sources.map(item => timestamp(item.collectedAt));
    return dates.some(value => value === null) ? ["INVALID_TIMESTAMP"] : Math.max(...dates as number[]) - Math.min(...dates as number[]) > SCORE_POLICY.maxSourceSkewMs ? ["SOURCE_TIME_MISMATCH"] : [];
  };
  const criterionValue = (criterion: ScoreCriterion | undefined, allowed: string[], absenceOnly: boolean) => {
    const reasons: string[] = [];
    if (!criterion || criterion.outcome === "unknown") reasons.push("MISSING_EVIDENCE");
    else if (!["pass", "fail"].includes(criterion.outcome) || !refsValid(criterion.evidence, allowed)) reasons.push("MISSING_EVIDENCE");
    else if (criterion.confirmation === "unconfirmed" || criterion.outcome === "pass" && criterion.confirmation !== "observed"
      || absenceOnly && criterion.outcome === "fail" && criterion.confirmation !== "confirmed-absence"
      || !["observed", "confirmed-absence"].includes(criterion.confirmation)) reasons.push("UNCONFIRMED_OBSERVATION");
    return { value: reasons.length ? null : rational(criterion!.outcome === "pass" ? 100n : 0n), reasons };
  };

  let website: CalculatedScore;
  if (!input.website) website = missing("website");
  else {
    const data = input.website;
    const selected = source(data.sourceReportId, "website");
    const reasons = selected ? sourceReasons(selected) : ["MISSING_EVIDENCE"];
    const boundPage = data.pageBinding && url(data.pageBinding.requestedUrl) === url(input.expectedAssets.websiteUrl)
      && url(data.pageBinding.finalUrl) === url(data.requestedUrl) && url(data.finalUrl) === url(data.pageBinding.finalUrl)
      && refsValid([data.pageBinding.evidence], [data.sourceReportId]);
    const directPage = url(data.requestedUrl) === url(input.expectedAssets.websiteUrl) && url(data.finalUrl) === url(data.requestedUrl);
    if (!selected || data.auditId !== data.sourceReportId || timestamp(data.fetchedAt) === null || timestamp(data.fetchedAt) !== timestamp(selected.collectedAt)
      || !directPage && !boundPage || !url(data.finalUrl) || !label(data.lighthouseVersion)
      || data.strategy !== (input.profile === "baseline-mobile-v1" ? "mobile" : "desktop")) reasons.push("RUN_MISMATCH");
    const measuredCategories = Array.isArray(data.categories) ? data.categories : [];
    if (measuredCategories.length !== 4 || new Set(measuredCategories.map(item => item.id)).size !== 4) reasons.push("INVALID_MEASUREMENT");
    website = finish(Object.entries(SCORE_POLICY.websiteWeights).map(([id, weight]) => {
      const categories = measuredCategories.filter(item => item.id === id);
      const category = categories[0];
      const evidence = [{ reportId: data.sourceReportId, evidenceId: `lighthouse-category:${id}` }];
      const invalid = categories.length !== 1 || category.availability !== "measured" || typeof category.score !== "number" || !Number.isFinite(category.score) || category.score < 0 || category.score > 100;
      const categoryReasons = [...reasons, ...(invalid ? ["INVALID_MEASUREMENT"] : []), ...(!refsValid(evidence, [data.sourceReportId]) ? ["MISSING_EVIDENCE"] : [])];
      return row(id, weight, categoryReasons.length ? null : decimal(category.score!), category?.score ?? null, categoryReasons, evidence);
    }), 100);
  }

  let social: CalculatedScore;
  if (!input.social) social = missing("social", ["MISSING_EVIDENCE", "UNCONFIRMED_PUBLISHING_GOAL"]);
  else {
    const data = input.social;
    const selected = source(data.sourceReportId, "facebook");
    const reasons = selected ? sourceReasons(selected) : ["MISSING_EVIDENCE"];
    if (data.profile.length !== 5 || new Set(data.profile.map(item => item.id)).size !== 5) reasons.push("INVALID_CRITERIA");
    const profile = finish(Object.entries(SCORE_POLICY.profileWeights).map(([id, weight]) => {
      const criterion = data.profile.find(item => item.id === id);
      const result = criterionValue(criterion, [data.sourceReportId], true);
      return row(id, weight, reasons.length || result.reasons.length ? null : result.value, criterion?.outcome ?? null, [...reasons, ...result.reasons], criterion?.evidence);
    }), 100);
    const publishingReasons = [...reasons];
    const goal = data.goal;
    if (!goal || !revisionValid(goal) || !Number.isSafeInteger(goal.targetPostsPerPeriod) || goal.targetPostsPerPeriod <= 0) publishingReasons.push("UNCONFIRMED_PUBLISHING_GOAL");
    const publishing = data.publishing;
    if (!publishing || !publishing.complete || publishing.truncated || !publishing.trustworthyTimestamps || publishing.periods.length !== 4) publishingReasons.push("INCOMPLETE_POST_WINDOW");
    const periods: CriterionLedger[] = (publishing?.periods ?? []).slice(0, 4).map((period, index) => {
      const start = cutoff - (4 - index) * SCORE_POLICY.periodMs;
      const end = cutoff - (3 - index) * SCORE_POLICY.periodMs;
      const periodReasons = [...publishingReasons];
      if (timestamp(period.startAt) !== start || timestamp(period.endAt) !== end || !Number.isSafeInteger(period.count) || period.count < 0 || !refsValid(period.evidence, [data.sourceReportId])) periodReasons.push("INCOMPLETE_POST_WINDOW");
      const value = periodReasons.length ? null : multiply(rational(BigInt(Math.min(period.count, goal!.targetPostsPerPeriod)), BigInt(goal!.targetPostsPerPeriod)), rational(100n));
      return row(`publishing-period-${index + 1}`, 25, value, `${period.count}/${goal?.targetPostsPerPeriod ?? "unknown"}`, periodReasons, period.evidence);
    });
    const publishingScore = periods.length === 4 ? finish(periods, 100, publishingReasons) : missing("publishing", unique([...publishingReasons, "INCOMPLETE_POST_WINDOW"]));
    social = finish([
      row("profile", 60, profile.exact ? fromExact(profile.exact) : null, profile.value, profile.reasons),
      row("publishing", 40, publishingScore.exact ? fromExact(publishingScore.exact) : null, publishingScore.value, publishingScore.reasons),
    ], 100);
    // Native subweights and contributions remain nested, avoiding double-counting.
    social.ledger[0].details = profile.ledger;
    social.ledger[1].details = publishingScore.ledger;
  }

  let consistency: CalculatedScore;
  if (!input.consistency) consistency = missing("consistency", ["UNCONFIRMED_BUSINESS_FACTS"]);
  else {
    const data = input.consistency;
    const websiteSource = source(data.websiteReportId, "website");
    const facebookSource = source(data.facebookReportId, "facebook");
    const sources = [websiteSource, facebookSource].filter((value): value is ScoreSource => value !== null);
    const reasons = sources.length !== 2 ? ["MISSING_EVIDENCE"] : [...sources.flatMap(sourceReasons), ...skewReasons(sources)];
    if (!revisionValid(data.facts)) reasons.push("UNCONFIRMED_BUSINESS_FACTS");
    if (data.criteria.length !== 4 || new Set(data.criteria.map(item => item.id)).size !== 4) reasons.push("INVALID_CRITERIA");
    const definitions = Object.entries(SCORE_POLICY.consistencyWeights).map(([id, weight]) => ({ id, weight, criterion: data.criteria.find(item => item.id === id) }));
    if (definitions.some(item => !item.criterion || typeof item.criterion.applicable !== "boolean") || definitions.some(item => ["business-name", "website-url"].includes(item.id) && !item.criterion?.applicable)) reasons.push("INVALID_APPLICABILITY");
    if (definitions.some(item => item.criterion?.applicable === false) && !revisionValid(data.applicability)) reasons.push("UNCONFIRMED_APPLICABILITY");
    const denominator = definitions.reduce((total, item) => total + (item.criterion?.applicable === false ? 0 : item.weight), 0);
    consistency = finish(definitions.map(({ id, weight, criterion }) => {
      if (criterion?.applicable === false) return row(id, 0, null, "not-applicable", ["NOT_APPLICABLE"], criterion.evidence);
      const result = criterionValue(criterion, [data.websiteReportId, data.facebookReportId], false);
      if (criterion && (!criterion.evidence.some(ref => ref.reportId === data.websiteReportId) || !criterion.evidence.some(ref => ref.reportId === data.facebookReportId))) result.reasons.push("MISSING_EVIDENCE");
      return row(id, weight, reasons.length || result.reasons.length ? null : result.value, criterion?.outcome ?? null, [...reasons, ...result.reasons], criterion?.evidence, denominator || 100);
    }), denominator, reasons);
  }

  const components = { website, social, consistency };
  const overall = finish(Object.entries(SCORE_POLICY.overallWeights).map(([id, weight]) => {
    const score = components[id as keyof typeof components];
    return row(id, weight, score.exact ? fromExact(score.exact) : null, score.value, score.reasons);
  }), 100, input.sources.length === 2 ? skewReasons(input.sources) : []);
  return { schemaVersion: "seo-spy.score-snapshot.v1", businessId: input.businessId, cutoff: input.cutoff, profile: input.profile,
    policyVersion: SCORE_POLICY.version, policyHash: SCORE_POLICY_HASH, sources: structuredClone(input.sources),
    confirmations: { socialGoal: structuredClone(input.social?.goal ?? null), consistencyFacts: structuredClone(input.consistency?.facts ?? null), applicability: structuredClone(input.consistency?.applicability ?? null) },
    scores: { ...components, overall }, limitations: ["Website coverage is one tested page and device profile, not a sitewide assessment.", "This policy measures declared observed criteria, not search rankings, traffic, revenue or compliance.", "Rank Math, traffic metrics, issue counts and Muse judgments do not alter this baseline's arithmetic."] };
}
