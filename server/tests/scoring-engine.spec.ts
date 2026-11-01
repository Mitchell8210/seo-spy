import { calculateScoreSnapshot, ScoringInputError } from "../src/scoring/calculator.js";
import { SCORE_POLICY, SCORE_POLICY_HASH } from "../src/scoring/policy.js";
import type { ScoreAssessmentInput, ScoreCriterion, ScoreSource } from "../src/scoring/scoring.types.js";

const cutoff = "2026-11-01T00:00:00.000Z";
const day = 86400000;
const ref = (reportId: string) => [{ reportId, evidenceId: "evidence" }];
const criterion = (id: string, outcome: ScoreCriterion["outcome"] = "pass", both = false): ScoreCriterion => ({ id, outcome, confirmation: "observed", evidence: both ? [...ref("website"), ...ref("facebook")] : ref("facebook") });
const source = (provider: ScoreSource["provider"]): ScoreSource => ({ reportId: provider, reportHash: "a".repeat(64), businessId: "business", schemaVersion: "seo-spy.audit-report.v1", provider, mode: "live", asset: provider === "website" ? "https://example.com/" : "123", collectedAt: cutoff, selectionReason: "Latest eligible immutable report selected explicitly.", evidenceIds: ["evidence", ...["seo", "performance", "accessibility", "best-practices"].map(id => `lighthouse-category:${id}`)] });
function fixture(): ScoreAssessmentInput {
  const revision = { revision: "confirmed-v1", confirmedBy: "operator", confirmedAt: "2026-10-01T00:00:00.000Z" };
  return { businessId: "business", cutoff, profile: "baseline-mobile-v1", expectedAssets: { websiteUrl: "https://example.com/", facebookPageId: "123" }, sources: [source("website"), source("facebook")],
    website: { sourceReportId: "website", auditId: "website", requestedUrl: "https://example.com", finalUrl: "https://example.com/", strategy: "mobile", lighthouseVersion: "13.0.0", fetchedAt: cutoff,
      categories: ["seo", "performance", "accessibility", "best-practices"].map(id => ({ id, score: 80, availability: "measured" })) },
    social: { sourceReportId: "facebook", profile: ["business-name", "description", "website-link", "contact-route", "category"].map(id => criterion(id)), goal: { ...revision, targetPostsPerPeriod: 1 },
      publishing: { complete: true, truncated: false, trustworthyTimestamps: true, periods: [1, 0, 2, 1].map((count, index) => ({ startAt: new Date(Date.parse(cutoff) - (4 - index) * 7 * day).toISOString(), endAt: new Date(Date.parse(cutoff) - (3 - index) * 7 * day).toISOString(), count, evidence: ref("facebook") })) } },
    consistency: { websiteReportId: "website", facebookReportId: "facebook", facts: revision, applicability: null,
      criteria: ["business-name", "phone", "website-url", "hours"].map(id => ({ ...criterion(id, "pass", true), applicable: true })) },
  };
}

describe("accepted scoring policy: pure exact deterministic calculations", () => {
  it("applies the full policy, including four-period attainment without excess-post offsets", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const result = calculateScoreSnapshot(input);
    expect(result.scores.website.value).toBe(80);
    expect(result.scores.social.value).toBe(90);
    expect(result.scores.consistency.value).toBe(100);
    expect(result.scores.overall.value).toBe(87);
    expect(result.scores.overall.exact).toEqual({ numerator: "87", denominator: "1" });
    expect(result.scores.social.ledger[1].details?.map(row => row.exact?.numerator)).toEqual(["100", "0", "100", "100"]);
    expect(JSON.stringify(input)).toBe(before);
    expect(calculateScoreSnapshot(input)).toEqual(result);
    expect(result.policyVersion).toBe("seo-spy-score-v1");
    expect(result.policyHash).toBe(SCORE_POLICY_HASH);
    expect(SCORE_POLICY_HASH).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("uses approved Website category weights and preserves measured zero", () => {
    const input = fixture();
    input.website!.categories = [
      { id: "seo", score: 100, availability: "measured" }, { id: "performance", score: 0, availability: "measured" },
      { id: "accessibility", score: 50, availability: "measured" }, { id: "best-practices", score: 75, availability: "measured" },
    ];
    const result = calculateScoreSnapshot(input).scores.website;
    expect(result.value).toBe(65);
    expect(result.coverage).toEqual({ knownWeight: 100, requiredWeight: 100 });
    for (const item of input.website!.categories) item.score = 0;
    expect(calculateScoreSnapshot(input).scores.website).toMatchObject({ value: 0, availability: "available", exact: { numerator: "0", denominator: "1" } });
  });

  it("rounds only final displayed values, using exact decimals and unrounded components for Overall", () => {
    const input = fixture();
    for (const category of input.website!.categories) category.score = 80.5;
    const result = calculateScoreSnapshot(input);
    expect(result.scores.website.value).toBe(81);
    expect(result.scores.website.exact).toEqual({ numerator: "161", denominator: "2" });
    expect(result.scores.overall.exact).toEqual({ numerator: "349", denominator: "4" });
    expect(result.scores.overall.value).toBe(87);
    input.website!.categories[0].score = 1e-7;
    expect(calculateScoreSnapshot(input).scores.website.exact).not.toBeNull();
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -1, 101])("blocks invalid/missing measured category %s", value => {
    const input = fixture(); input.website!.categories[0].score = value;
    expect(calculateScoreSnapshot(input).scores.website).toMatchObject({ value: null, availability: "unavailable" });
  });

  it("rejects duplicate, missing and unavailable Lighthouse categories without reweighting", () => {
    for (const mutation of [
      (input: ScoreAssessmentInput) => { input.website!.categories.push(input.website!.categories[0]); },
      (input: ScoreAssessmentInput) => { input.website!.categories.pop(); },
      (input: ScoreAssessmentInput) => { input.website!.categories[0].availability = "unavailable"; },
    ]) {
      const input = fixture(); mutation(input);
      expect(calculateScoreSnapshot(input).scores.website.value).toBeNull();
    }
  });

  it("allows independent Website publication but no overall score when other channels are absent", () => {
    const input = fixture(); input.social = null; input.consistency = null; input.sources.pop();
    const result = calculateScoreSnapshot(input);
    expect(result.scores.website.value).toBe(80);
    expect(result.scores.overall.value).toBeNull();
    expect(result.scores.overall.coverage).toEqual({ knownWeight: 50, requiredWeight: 100 });
    expect(result.scores.social.reasons).toContain("UNCONFIRMED_PUBLISHING_GOAL");
  });

  it.each(["business", "asset", "mode", "schema", "hash", "evidence", "duplicate"]) ("rejects invalid selected source %s", kind => {
    const input = fixture();
    if (kind === "business") input.sources[0].businessId = "other-business";
    if (kind === "asset") input.sources[0].asset = "https://www.example.com/";
    if (kind === "mode") input.sources[0].mode = "demo" as "live";
    if (kind === "schema") input.sources[0].schemaVersion = "old-schema" as ScoreSource["schemaVersion"];
    if (kind === "hash") input.sources[0].reportHash = "unverified";
    if (kind === "evidence") input.sources[0].evidenceIds = [];
    if (kind === "duplicate") input.sources[1] = { ...input.sources[0] };
    expect(calculateScoreSnapshot(input).scores.website.value).toBeNull();
  });

  it.each(["audit", "date", "strategy", "page", "version"]) ("rejects mixed Lighthouse run binding %s", kind => {
    const input = fixture();
    if (kind === "audit") input.website!.auditId = "another-audit";
    if (kind === "date") input.website!.fetchedAt = "2026-10-31T00:00:00.000Z";
    if (kind === "strategy") input.website!.strategy = "desktop";
    if (kind === "page") input.website!.requestedUrl = "https://example.com/other-page";
    if (kind === "version") input.website!.lighthouseVersion = "";
    expect(calculateScoreSnapshot(input).scores.website.reasons).toContain("RUN_MISMATCH");
  });

  it("identifies desktop as a separate explicit profile", () => {
    const input = fixture(); input.profile = "baseline-desktop-v1"; input.website!.strategy = "desktop";
    expect(calculateScoreSnapshot(input).scores.website.value).toBe(80);
  });

  it("accepts exact age/skew boundaries, rejects stale/future/unparseable inputs", () => {
    for (const [offset, expected] of [[7 * day, 80], [7 * day + 1, null], [-1, null]] as const) {
      const input = fixture(); input.sources[0].collectedAt = new Date(Date.parse(cutoff) - offset).toISOString(); input.website!.fetchedAt = input.sources[0].collectedAt;
      expect(calculateScoreSnapshot(input).scores.website.value).toBe(expected);
    }
    const invalid = fixture(); invalid.sources[0].collectedAt = "not-a-date";
    expect(calculateScoreSnapshot(invalid).scores.website.reasons).toContain("INVALID_TIMESTAMP");
    for (const [skew, expected] of [[72 * 3600000, 87], [72 * 3600000 + 1, null]] as const) {
      const input = fixture(); input.sources[0].collectedAt = new Date(Date.parse(cutoff) - skew).toISOString(); input.website!.fetchedAt = input.sources[0].collectedAt;
      expect(calculateScoreSnapshot(input).scores.overall.value).toBe(expected);
    }
  });

  it("does not convert API omission or unconfirmed absence into a social failure", () => {
    const input = fixture(); input.social!.profile[0] = { ...criterion("business-name", "fail"), confirmation: "unconfirmed" };
    expect(calculateScoreSnapshot(input).scores.social.value).toBeNull();
    input.social!.profile[0].confirmation = "confirmed-absence";
    expect(calculateScoreSnapshot(input).scores.social.value).toBe(78);
    input.social!.profile[0].outcome = "unknown";
    expect(calculateScoreSnapshot(input).scores.social.value).toBeNull();
  });

  it.each(["goal", "target", "confirmation", "complete", "truncated", "timestamps", "bounds", "negative", "evidence", "count"]) ("blocks incomplete publishing evidence %s", kind => {
    const input = fixture(); const data = input.social!;
    if (kind === "goal") data.goal = null;
    if (kind === "target") data.goal!.targetPostsPerPeriod = 0;
    if (kind === "confirmation") data.goal!.confirmedAt = "2026-11-02T00:00:00.000Z";
    if (kind === "complete") data.publishing!.complete = false;
    if (kind === "truncated") data.publishing!.truncated = true;
    if (kind === "timestamps") data.publishing!.trustworthyTimestamps = false;
    if (kind === "bounds") data.publishing!.periods[0].startAt = cutoff;
    if (kind === "negative") data.publishing!.periods[0].count = -1;
    if (kind === "evidence") data.publishing!.periods[0].evidence = ref("website");
    if (kind === "count") data.publishing!.periods.pop();
    expect(calculateScoreSnapshot(input).scores.social.value).toBeNull();
  });

  it("requires confirmed business facts, paired observations and explicit nonapplicability", () => {
    const input = fixture(); input.consistency!.facts = null;
    expect(calculateScoreSnapshot(input).scores.consistency.value).toBeNull();
    const omitted = fixture(); omitted.consistency!.criteria[3].applicable = false;
    expect(calculateScoreSnapshot(omitted).scores.consistency.reasons).toContain("UNCONFIRMED_APPLICABILITY");
    omitted.consistency!.applicability = omitted.consistency!.facts;
    omitted.consistency!.criteria[1].outcome = "fail";
    const result = calculateScoreSnapshot(omitted).scores.consistency;
    expect(result.value).toBe(63); // (20+30)/80*100 = 62.5, half up.
    expect(result.exact).toEqual({ numerator: "125", denominator: "2" });
    expect(result.coverage).toEqual({ knownWeight: 80, requiredWeight: 80 });
    omitted.consistency!.criteria[0].applicable = false;
    expect(calculateScoreSnapshot(omitted).scores.consistency.value).toBeNull();
    const unmatched = fixture(); unmatched.consistency!.criteria[0].evidence = ref("facebook");
    expect(calculateScoreSnapshot(unmatched).scores.consistency.value).toBeNull();
  });

  it("does not deduce identity equivalence from observed strings or repeated findings", () => {
    const input = fixture(); input.consistency!.criteria[1].outcome = "unknown";
    expect(calculateScoreSnapshot(input).scores.consistency.value).toBeNull();
    input.consistency!.criteria.push(input.consistency!.criteria[1]);
    expect(calculateScoreSnapshot(input).scores.consistency.reasons).toContain("INVALID_CRITERIA");
    expect(SCORE_POLICY.rankMathContribution).toContain("excluded");
  });

  it("rejects invalid root configuration and unsupported profiles without contacting anything", () => {
    const input = fixture(); input.profile = "rank-math-v1" as ScoreAssessmentInput["profile"];
    expect(() => calculateScoreSnapshot(input)).toThrow(ScoringInputError);
    input.profile = "baseline-mobile-v1"; input.cutoff = "yesterday";
    expect(() => calculateScoreSnapshot(input)).toThrow(ScoringInputError);
  });
});
