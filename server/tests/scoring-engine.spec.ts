import { calculateScoreSnapshot, ScoringInputError } from "../src/scoring/calculator.js";
import { SCORE_POLICY, SCORE_POLICY_HASH, SCORE_POLICY_V1_1, SCORE_POLICY_V1_1_HASH, SCORE_POLICY_V1_2, SCORE_POLICY_V1_2_HASH } from "../src/scoring/policy.js";
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

describe("scoring policy v1.1: complete UTC reporting days with separate assessment time", () => {
  const laterAssessment = () => {
    const input = fixture();
    input.policyVersion = "seo-spy-score-v1.1";
    input.cutoff = "2026-11-01T18:30:00.000Z";
    input.social!.publishing!.reportingCutoff = cutoff;
    input.sources.forEach(item => { item.collectedAt = "2026-11-01T06:00:00.000Z"; });
    input.website!.fetchedAt = input.sources[0].collectedAt;
    return input;
  };

  it("pins the legacy policy hash and preserves byte-identical omitted/explicit v1 snapshots", () => {
    expect(SCORE_POLICY_HASH).toBe("a28472009901ef981e248a924c6ee1aaaec0fd917224c2ebf08207f469047d14");
    const implicit = fixture();
    const expected = JSON.stringify(calculateScoreSnapshot(implicit));
    const explicit = structuredClone(implicit);
    explicit.policyVersion = "seo-spy-score-v1";
    expect(JSON.stringify(calculateScoreSnapshot(explicit))).toBe(expected);
    explicit.social!.publishing!.reportingCutoff = "2030-01-01T00:00:00.000Z";
    expect(JSON.stringify(calculateScoreSnapshot(explicit))).toBe(expected);
    expect(calculateScoreSnapshot(implicit)).not.toHaveProperty("reportingCutoff");
  });

  it("publishes v1.1 independently with unchanged weights and a distinct recorded policy hash", () => {
    const input = laterAssessment();
    const result = calculateScoreSnapshot(input);
    expect(result).toMatchObject({ cutoff: input.cutoff, reportingCutoff: cutoff, policyVersion: "seo-spy-score-v1.1", policyHash: SCORE_POLICY_V1_1_HASH });
    expect(result.scores).toMatchObject({ website: { value: 80 }, social: { value: 90 }, consistency: { value: 100 }, overall: { value: 87 } });
    expect(SCORE_POLICY_V1_1_HASH).not.toBe(SCORE_POLICY_HASH);
    expect(SCORE_POLICY_V1_1.overallWeights).toEqual(SCORE_POLICY.overallWeights);
    expect(SCORE_POLICY_V1_1.websiteWeights).toEqual(SCORE_POLICY.websiteWeights);
    expect(result.sources.every(item => Date.parse(item.collectedAt) > Date.parse(result.reportingCutoff!))).toBe(true);
  });

  it("does not silently apply the new reporting-day rule to historical v1 input", () => {
    const input = laterAssessment();
    input.policyVersion = "seo-spy-score-v1";
    const result = calculateScoreSnapshot(input);
    expect(result.scores.website.value).toBe(80);
    expect(result.scores.social.reasons).toContain("INCOMPLETE_POST_WINDOW");
    expect(result.scores.overall.value).toBeNull();
    expect(result).not.toHaveProperty("reportingCutoff");
  });

  it.each([undefined, "not-a-date", "2026-10-31T00:00:00.000Z", "2026-11-01T12:00:00.000Z", "2026-11-02T00:00:00.000Z"])("requires the exact latest completed UTC day boundary: %s", reportingCutoff => {
    const input = laterAssessment();
    input.social!.publishing!.reportingCutoff = reportingCutoff;
    const result = calculateScoreSnapshot(input);
    expect(result.scores.social.reasons).toContain("INVALID_REPORTING_CUTOFF");
    expect(result.scores.social.value).toBeNull();
    expect(result.scores.overall.value).toBeNull();
    expect(result.scores.website.value).toBe(80);
    expect(result.reportingCutoff).toBeNull();
  });

  it("accepts midnight assessment and requires four exact contiguous half-open UTC periods", () => {
    const input = fixture();
    input.policyVersion = "seo-spy-score-v1.1";
    input.social!.publishing!.reportingCutoff = cutoff;
    expect(calculateScoreSnapshot(input).scores.social.value).toBe(90);
    input.social!.publishing!.periods[1].endAt = "2026-10-17T00:00:00.001Z";
    expect(calculateScoreSnapshot(input).scores.social.reasons).toContain("INCOMPLETE_POST_WINDOW");
  });

  it("does not accept rolling periods that end at the later assessment time", () => {
    const input = laterAssessment();
    const shift = Date.parse(input.cutoff) - Date.parse(cutoff);
    input.social!.publishing!.periods.forEach(period => {
      period.startAt = new Date(Date.parse(period.startAt) + shift).toISOString();
      period.endAt = new Date(Date.parse(period.endAt) + shift).toISOString();
    });
    expect(calculateScoreSnapshot(input).scores.social.reasons).toContain("INCOMPLETE_POST_WINDOW");
  });

  it("keeps source freshness/future checks against assessment time, without relaxing them to reporting time", () => {
    const input = laterAssessment();
    input.sources[1].collectedAt = "2026-11-01T19:00:00.000Z";
    expect(calculateScoreSnapshot(input).scores.social.reasons).toContain("FUTURE_INPUT");
    input.sources[1].collectedAt = new Date(Date.parse(input.cutoff) - 7 * day - 1).toISOString();
    expect(calculateScoreSnapshot(input).scores.social.reasons).toContain("STALE_INPUT");
  });

  it("keeps the 72-hour source skew rule and independent eligible Website score", () => {
    const input = laterAssessment();
    input.sources[0].collectedAt = "2026-10-29T05:59:59.999Z";
    input.website!.fetchedAt = input.sources[0].collectedAt;
    const result = calculateScoreSnapshot(input);
    expect(result.scores.website.value).toBe(80);
    expect(result.scores.social.value).toBe(90);
    expect(result.scores.consistency.reasons).toContain("SOURCE_TIME_MISMATCH");
    expect(result.scores.overall.value).toBeNull();
  });

  it("uses exact unrounded period attainments and never invents a publishing target", () => {
    const input = laterAssessment();
    input.social!.goal!.targetPostsPerPeriod = 3;
    const result = calculateScoreSnapshot(input);
    expect(result.scores.social.value).toBe(73);
    expect(result.scores.social.exact).toEqual({ numerator: "220", denominator: "3" });
    expect(result.scores.overall.value).toBe(82);
    input.social!.goal = null;
    expect(calculateScoreSnapshot(input).scores.social.reasons).toContain("UNCONFIRMED_PUBLISHING_GOAL");
  });

  it("rejects unsupported policies instead of silently choosing another policy", () => {
    for (const version of ["seo-spy-score-v2", "constructor"]) {
      const input = fixture();
      input.policyVersion = version as ScoreAssessmentInput["policyVersion"];
      expect(() => calculateScoreSnapshot(input)).toThrow(ScoringInputError);
    }
  });

  it("is replayable, JSON-safe and independent of caller mutations", () => {
    const input = laterAssessment();
    const before = JSON.stringify(input);
    const result = calculateScoreSnapshot(input);
    expect(JSON.stringify(calculateScoreSnapshot(input))).toBe(JSON.stringify(result));
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    input.sources[0].asset = "https://other.example/";
    input.social!.goal!.revision = "later-revision";
    expect(result.sources[0].asset).toBe("https://example.com/");
    expect(result.confirmations.socialGoal!.revision).toBe("confirmed-v1");
  });
});

describe("scoring policy v1.2: profile readiness and confirmed source agreement", () => {
  const inputV12 = () => {
    const input = fixture();
    input.policyVersion = "seo-spy-score-v1.2";
    input.social!.goal = null;
    input.social!.publishing = null;
    return input;
  };
  const agreement = () => {
    const input = inputV12();
    input.consistency!.comparisonMode = "source-agreement";
    input.consistency!.facts!.sourceAttestation = { websiteReportId: "website", facebookReportId: "facebook" };
    input.consistency!.criteria.forEach(criterion => { criterion.observations = { website: "Known Website observation", facebook: "Known Facebook observation" }; });
    return input;
  };

  it("preserves the exact prior policy definitions and version hashes", () => {
    expect(SCORE_POLICY_HASH).toBe("a28472009901ef981e248a924c6ee1aaaec0fd917224c2ebf08207f469047d14");
    expect(SCORE_POLICY_V1_1_HASH).toBe("31b6ee643fa5cb294339944478c0402ee18796000237c6b9430abf0467028f0f");
    expect(SCORE_POLICY_V1_2_HASH).not.toBe(SCORE_POLICY_HASH);
    expect(SCORE_POLICY_V1_2_HASH).not.toBe(SCORE_POLICY_V1_1_HASH);
    expect(SCORE_POLICY_V1_2.overallWeights).toEqual(SCORE_POLICY.overallWeights);
    expect(SCORE_POLICY_V1_2.websiteWeights).toEqual(SCORE_POLICY.websiteWeights);
    expect(SCORE_POLICY_V1_2.profileWeights).toEqual(SCORE_POLICY.profileWeights);
    expect(SCORE_POLICY_V1_2.consistencyWeights).toEqual(SCORE_POLICY.consistencyWeights);
    expect(calculateScoreSnapshot(fixture()).scores.social.value).toBe(90);
    expect(calculateScoreSnapshot(fixture())).not.toHaveProperty("socialScope");
    expect(calculateScoreSnapshot(fixture())).not.toHaveProperty("consistencyBasis");
  });

  it("scores five readiness checks at 20% each, independently of publishing targets or activity", () => {
    const input = inputV12();
    const result = calculateScoreSnapshot(input);
    expect(result).toMatchObject({ policyVersion: "seo-spy-score-v1.2", policyHash: SCORE_POLICY_V1_2_HASH, socialScope: "facebook-profile-readiness", consistencyBasis: "preferred-values" });
    expect(result.scores.social).toMatchObject({ value: 100, availability: "available", coverage: { knownWeight: 100, requiredWeight: 100 } });
    expect(result.scores.social.ledger.map(item => [item.id, item.weight])).toEqual(Object.entries(SCORE_POLICY.profileWeights));
    expect(result.scores.overall.value).toBe(90);
    expect(result.limitations).toContain("Social measures Facebook profile readiness only. Publishing activity and posting targets are advisory and do not change Social or Overall.");
    expect(result.scores.social.reasons).not.toContain("UNCONFIRMED_PUBLISHING_GOAL");
  });

  it("does not allow missing, bad or incomplete publishing metadata to block numeric scores", () => {
    const input = inputV12();
    const expectedScores = calculateScoreSnapshot(input).scores;
    input.social!.publishing = { complete: false, truncated: true, trustworthyTimestamps: false, reportingCutoff: "not-a-date", periods: [] };
    input.social!.goal = { revision: "unconfirmed-advisory", confirmedBy: "unknown", confirmedAt: "2030-01-01T00:00:00Z", targetPostsPerPeriod: 0 };
    const result = calculateScoreSnapshot(input);
    expect(result.scores).toEqual(expectedScores);
    expect(result).not.toHaveProperty("reportingCutoff");
    input.social!.publishing.reportingCutoff = cutoff;
    const withValidAdvisory = calculateScoreSnapshot(input);
    expect(withValidAdvisory.reportingCutoff).toBe(cutoff);
    expect(withValidAdvisory.scores).toEqual(expectedScores);
  });

  it("still treats unknown profile evidence as unavailable and explicit confirmed failures as zero points", () => {
    const input = inputV12();
    input.social!.profile[0].outcome = "unknown";
    expect(calculateScoreSnapshot(input).scores.social).toMatchObject({ value: null, coverage: { knownWeight: 80, requiredWeight: 100 } });
    expect(calculateScoreSnapshot(input).scores.overall.value).toBeNull();
    input.social!.profile[0].outcome = "fail";
    input.social!.profile[0].confirmation = "confirmed-absence";
    expect(calculateScoreSnapshot(input).scores.social.value).toBe(80);
    input.social!.profile.forEach(item => { item.outcome = "fail"; item.confirmation = "confirmed-absence"; });
    expect(calculateScoreSnapshot(input).scores.social).toMatchObject({ value: 0, availability: "available" });
  });

  it("does not invent a publishing-goal blocker when the Facebook source itself is missing", () => {
    const input = inputV12(); input.social = null;
    const result = calculateScoreSnapshot(input);
    expect(result.scores.social.reasons).toEqual(["MISSING_EVIDENCE"]);
    expect(result.scores.social.value).toBeNull();
    expect(result.scores.overall.value).toBeNull();
  });

  it("scores confirmed name/hours disagreement as 60 consistency without claiming a preferred source", () => {
    const input = agreement();
    input.website!.categories.forEach(item => { item.score = 78; });
    input.consistency!.criteria.filter(item => ["business-name", "hours"].includes(item.id)).forEach(item => { item.outcome = "fail"; });
    const result = calculateScoreSnapshot(input);
    expect(result.consistencyBasis).toBe("source-agreement");
    expect(result.scores).toMatchObject({ website: { value: 78 }, social: { value: 100 }, consistency: { value: 60 }, overall: { value: 81 } });
    expect(result.confirmations.consistencyFacts!.sourceAttestation).toEqual({ websiteReportId: "website", facebookReportId: "facebook" });
    expect(result.limitations).toContain("Consistency measures agreement between confirmed source observations. A disagreement does not establish which source is correct or preferred.");
  });

  it.each(["missing", "wrong-website", "wrong-facebook", "missing-revision", "future-revision"]) ("requires source-specific attestation and a valid recorded confirmation: %s", failure => {
    const input = agreement();
    if (failure === "missing") delete input.consistency!.facts!.sourceAttestation;
    if (failure === "wrong-website") input.consistency!.facts!.sourceAttestation!.websiteReportId = "other-website";
    if (failure === "wrong-facebook") input.consistency!.facts!.sourceAttestation!.facebookReportId = "other-facebook";
    if (failure === "missing-revision") input.consistency!.facts = null;
    if (failure === "future-revision") input.consistency!.facts!.confirmedAt = "2030-01-01T00:00:00.000Z";
    const result = calculateScoreSnapshot(input);
    expect(result.scores.consistency.value).toBeNull();
    expect(result.scores.overall.value).toBeNull();
    expect(result.scores.social.value).toBe(100);
  });

  it.each(["website-observation", "facebook-observation", "website-ref", "facebook-ref", "unknown-evidence"]) ("requires paired known source observations and references: %s", failure => {
    const input = agreement();
    const criterion = input.consistency!.criteria[0];
    if (failure === "website-observation") criterion.observations!.website = null;
    if (failure === "facebook-observation") criterion.observations!.facebook = " ";
    if (failure === "website-ref") criterion.evidence = ref("facebook");
    if (failure === "facebook-ref") criterion.evidence = ref("website");
    if (failure === "unknown-evidence") criterion.evidence[0].evidenceId = "not-recorded";
    expect(calculateScoreSnapshot(input).scores.consistency.value).toBeNull();
  });

  it.each(["seo-spy-score-v1", "seo-spy-score-v1.1"] as const)("does not backport source agreement to historical policy %s", version => {
    const input = agreement(); input.policyVersion = version;
    if (version === "seo-spy-score-v1.1") input.social!.publishing = { ...fixture().social!.publishing!, reportingCutoff: cutoff };
    const result = calculateScoreSnapshot(input);
    expect(result.scores.consistency.reasons).toContain("UNSUPPORTED_COMPARISON_MODE");
    expect(result.scores.overall.value).toBeNull();
    expect(result).not.toHaveProperty("consistencyBasis");
  });

  it("retains independent stale-source/skew gates and never substitutes a consistency mode", () => {
    const input = agreement();
    input.sources[1].collectedAt = new Date(Date.parse(cutoff) - 7 * day - 1).toISOString();
    expect(calculateScoreSnapshot(input).scores.social.reasons).toContain("STALE_INPUT");
    input.sources[1].collectedAt = cutoff;
    input.consistency!.comparisonMode = "unreviewed-mode" as "source-agreement";
    expect(calculateScoreSnapshot(input).scores.consistency.reasons).toContain("UNSUPPORTED_COMPARISON_MODE");
    expect(calculateScoreSnapshot(input).consistencyBasis).toBeNull();
  });

  it("keeps explicitly recorded nonapplicability separate from unknown observations", () => {
    const input = agreement();
    input.consistency!.criteria[3].applicable = false;
    input.consistency!.criteria[3].observations = { website: null, facebook: null };
    input.consistency!.applicability = input.consistency!.facts;
    expect(calculateScoreSnapshot(input).scores.consistency).toMatchObject({ value: 100, coverage: { knownWeight: 80, requiredWeight: 80 } });
    input.consistency!.applicability = null;
    expect(calculateScoreSnapshot(input).scores.consistency.value).toBeNull();
  });

  it("remains deterministic, JSON-safe and independent of source-attestation mutations", () => {
    const input = agreement();
    const original = JSON.stringify(input);
    const result = calculateScoreSnapshot(input);
    expect(JSON.stringify(input)).toBe(original);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(calculateScoreSnapshot(input)).toEqual(result);
    input.consistency!.facts!.sourceAttestation!.websiteReportId = "changed";
    expect(result.confirmations.consistencyFacts!.sourceAttestation!.websiteReportId).toBe("website");
  });
});
