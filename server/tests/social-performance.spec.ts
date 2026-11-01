import { calculateSocialPerformance } from "../src/scoring/social-performance.js";
import { SOCIAL_PERFORMANCE_POLICY, SOCIAL_PERFORMANCE_POLICY_HASH } from "../src/scoring/social-performance.policy.js";
import { derive90DayPostMeasurements, descriptionSignalCount, observablePostStructures } from "../src/scoring/social-post-measurements.js";
import type { SocialCriterionId, SocialCriterionInput, SocialPerformanceInput } from "../src/scoring/social-performance.types.js";

const at = "2026-11-01T00:00:00.000Z", since = "2026-08-03T00:00:00.000Z", reportId = "saved-report", evidenceId = "verified-source", day = 86400000;
const evidence = [{ reportId, evidenceId }];
const measured = (value: number): SocialCriterionInput => ({ status: "available", value, evidence, collectedAt: at, complete: true, explanation: "Verified owned measurement with matching window and source." });
function fixture(): SocialPerformanceInput {
  return { businessId: "business", pageId: "123", reportId, collectedAt: at, cutoff: at, evidenceIds: [evidenceId], criteria: {} };
}
function complete(): SocialPerformanceInput {
  const input = fixture();
  for (const category of SOCIAL_PERFORMANCE_POLICY.categories) for (const criterion of category.criteria) input.criteria[criterion.id] = measured(criterion.direction === "lower" ? criterion.bands[0]!.threshold : criterion.bands.at(-1)!.threshold);
  return input;
}
const resultCriterion = (input: SocialPerformanceInput, id: SocialCriterionId) => calculateSocialPerformance(input).categories.flatMap(category => category.criteria).find(item => item.id === id)!;

describe("deterministic evidence-aware social performance", () => {
  it("retains the exact six category weights and only assigns definitive 100 with broad strong evidence", () => {
    const input = complete(), before = JSON.stringify(input), score = calculateSocialPerformance(input);
    expect(score.categories.map(category => category.maximum)).toEqual([15, 20, 25, 15, 15, 10]);
    expect(score).toMatchObject({ value: 100, exact: { numerator: "100", denominator: "1" }, status: "definitive", coveragePercent: 100, knownWeight: 100, applicableWeight: 100, policyHash: SOCIAL_PERFORMANCE_POLICY_HASH });
    expect(score.missingMetrics).toEqual([]);
    expect(JSON.stringify(input)).toBe(before);
    expect(calculateSocialPerformance(input)).toEqual(score);
  });
  it("never produces a numeric or definitive 100 from profile completeness alone", () => {
    const input = fixture();
    for (const criterion of SOCIAL_PERFORMANCE_POLICY.categories[0]!.criteria) input.criteria[criterion.id] = measured(criterion.id === "profile-description" ? 2 : 1);
    const score = calculateSocialPerformance(input);
    expect(score).toMatchObject({ value: null, exact: null, status: "insufficient_data", coveragePercent: 15, knownWeight: 15 });
    expect(score.categories[0]).toMatchObject({ earned: 15, evidencedWeight: 15 });
  });
  it("scores a complete but inactive profile from verified zeros without treating missing content as poor quality", () => {
    const input = complete();
    for (const category of SOCIAL_PERFORMANCE_POLICY.categories) if (category.id !== "profile-quality") for (const criterion of category.criteria) delete input.criteria[criterion.id];
    const posting = derive90DayPostMeasurements([], since, at, true);
    for (const [id, value] of Object.entries(posting)) input.criteria[id as SocialCriterionId] = measured(value);
    input.criteria["likes-per-100-followers"] = measured(0); input.criteria["comments-per-100-followers"] = measured(0); input.criteria["media-views-per-follower"] = measured(0);
    const score = calculateSocialPerformance(input);
    expect(score).toMatchObject({ value: 25, status: "provisional", knownWeight: 60, coveragePercent: 60 });
    expect(score.categories[1]).toMatchObject({ earned: 0, evidencedWeight: 20, status: "available" });
    expect(score.categories[4]).toMatchObject({ earned: null, evidencedWeight: 0, status: "unavailable" });
  });
  it("keeps verified zero engagement measured while inaccessible engagement remains unknown", () => {
    const input = fixture(); input.criteria["likes-per-100-followers"] = measured(0);
    const score = calculateSocialPerformance(input);
    expect(resultCriterion(input, "likes-per-100-followers")).toMatchObject({ status: "available", earned: 0, value: 0 });
    expect(resultCriterion(input, "comments-per-100-followers")).toMatchObject({ status: "unavailable", earned: null, value: null });
    expect(score).toMatchObject({ value: 0, status: "provisional", knownWeight: 10 });
  });
  it("requires 70% coverage and meaningful posting and engagement even when other categories have evidence", () => {
    const noPosting = complete(); for (const definition of SOCIAL_PERFORMANCE_POLICY.categories[1]!.criteria) delete noPosting.criteria[definition.id];
    expect(calculateSocialPerformance(noPosting)).toMatchObject({ coveragePercent: 80, status: "provisional" });
    const noEngagement = complete(); for (const definition of SOCIAL_PERFORMANCE_POLICY.categories[2]!.criteria) delete noEngagement.criteria[definition.id];
    expect(calculateSocialPerformance(noEngagement)).toMatchObject({ coveragePercent: 75, status: "provisional" });
    const likesOnly = complete(); delete likesOnly.criteria["comments-per-100-followers"]; delete likesOnly.criteria["shares-per-100-followers"];
    expect(calculateSocialPerformance(likesOnly)).toMatchObject({ coveragePercent: 85, status: "provisional" });
  });
  it("normalizes only evidenced weights and allows definitive scores with the current integration's 71 supported points", () => {
    const input = complete();
    for (const id of ["shares-per-100-followers", "follower-growth-percent", "reviewed-relevance", "customer-response-rate", "customer-response-hours"] as const) delete input.criteria[id];
    expect(calculateSocialPerformance(input)).toMatchObject({ value: 100, status: "definitive", knownWeight: 71, applicableWeight: 100, coveragePercent: 71 });
    expect(calculateSocialPerformance(input).missingMetrics).toHaveLength(5);
  });
  it("stronger audience-normalized engagement earns progressively more points without using raw popularity", () => {
    const input = complete();
    const earned = [0, 0.5, 1, 3, 5].map(value => { input.criteria["likes-per-100-followers"] = measured(value); return resultCriterion(input, "likes-per-100-followers").earned; });
    expect(earned).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(resultCriterion(input, "likes-per-100-followers").label).toContain("Likes");
  });
  it("does not exclude missing criteria from coverage or award points for API omissions", () => {
    const input = complete();
    input.criteria["customer-response-rate"] = { ...measured(1), status: "unavailable", value: null, reason: "MESSAGING_EVIDENCE_UNAVAILABLE" };
    const score = calculateSocialPerformance(input);
    expect(score).toMatchObject({ applicableWeight: 100, knownWeight: 95, coveragePercent: 95 });
    expect(score.missingMetrics).toContainEqual({ id: "customer-response-rate", label: "Customer response coverage", reason: "MESSAGING_EVIDENCE_UNAVAILABLE" });
  });
  it("only excludes inapplicable weight with complete explicitly cited applicability evidence", () => {
    const input = complete();
    input.criteria["customer-response-rate"] = { ...measured(0), status: "not_applicable", value: null };
    expect(calculateSocialPerformance(input)).toMatchObject({ applicableWeight: 100, knownWeight: 95 });
    input.criteria["customer-response-rate"]!.applicabilityEvidence = evidence;
    expect(calculateSocialPerformance(input)).toMatchObject({ applicableWeight: 95, knownWeight: 95, coveragePercent: 100 });
  });
  it("suppresses stale/future/foreign/uncited/incomplete measurements and preserves their missing-data reasons", () => {
    const input = complete();
    input.criteria["profile-name"] = { ...measured(1), evidence: [{ reportId: "other-report", evidenceId }] };
    input.criteria["profile-description"] = { ...measured(2), evidence: [{ reportId, evidenceId: "not-saved" }] };
    input.criteria["profile-website"] = { ...measured(1), collectedAt: "2026-11-02T00:00:00.000Z" };
    input.criteria["profile-contact"] = { ...measured(1), complete: false };
    input.criteria["profile-category"] = { ...measured(1), collectedAt: "2026-10-24T23:59:59.999Z" };
    expect(calculateSocialPerformance(input).categories[0]).toMatchObject({ earned: null, evidencedWeight: 0, status: "unavailable" });
    const stale = complete(); stale.cutoff = "2026-11-08T00:00:00.001Z";
    expect(calculateSocialPerformance(stale)).toMatchObject({ value: null, status: "insufficient_data", knownWeight: 0, freshness: { status: "stale" } });
  });
  it("retains exact rational normalized arithmetic and half-up final rounding", () => {
    const input = fixture(); input.criteria["profile-description"] = measured(1); input.criteria["posts-per-week"] = measured(0.5);
    expect(calculateSocialPerformance(input)).toMatchObject({ value: 50, exact: { numerator: "50", denominator: "1" }, knownWeight: 9 });
    const rounded = complete(); rounded.criteria["profile-description"] = measured(1);
    expect(calculateSocialPerformance(rounded)).toMatchObject({ value: 99, exact: { numerator: "197", denominator: "2" } });
  });
  it("expires the saved assessment at the earliest used observation rather than renewing old evidence with a fresh report header", () => {
    const input = complete(); input.criteria["likes-per-100-followers"]!.collectedAt = "2026-10-30T00:00:00.000Z";
    expect(calculateSocialPerformance(input)).toMatchObject({ status: "definitive", freshness: { collectedAt: at, expiresAt: "2026-11-06T00:00:00.000Z" } });
    input.criteria["likes-per-100-followers"]!.status = "unavailable";
    expect(calculateSocialPerformance(input).freshness.expiresAt).toBe("2026-11-08T00:00:00.000Z");
    input.criteria["customer-response-rate"] = { ...measured(0), status: "not_applicable", value: null, applicabilityEvidence: evidence, collectedAt: "2026-10-29T00:00:00.000Z" };
    expect(calculateSocialPerformance(input).freshness.expiresAt).toBe("2026-11-05T00:00:00.000Z");
  });
  it("rejects malformed rates/configuration rather than clamping invalid evidence into a score", () => {
    const input = complete(); input.criteria["active-week-ratio"] = measured(1.2);
    expect(resultCriterion(input, "active-week-ratio")).toMatchObject({ earned: null, status: "unavailable" });
    input.criteria["likes-per-100-followers"] = measured(Number.NaN);
    expect(resultCriterion(input, "likes-per-100-followers")).toMatchObject({ earned: null, status: "unavailable" });
    const invalid = structuredClone(SOCIAL_PERFORMANCE_POLICY); invalid.minimumCoveragePercent = 69;
    expect(() => calculateSocialPerformance(input, invalid)).toThrow("Invalid social performance policy");
    expect(() => calculateSocialPerformance({ ...input, businessId: "" })).toThrow("Invalid social performance input");
  });
  it("supports explicit policy threshold changes with a distinct reproducible policy hash", () => {
    const input = complete(), changed = structuredClone(SOCIAL_PERFORMANCE_POLICY);
    changed.categories[2]!.criteria[0]!.bands = [{ threshold: 10, percent: 100 }];
    expect(calculateSocialPerformance(input, changed).policyHash).not.toBe(SOCIAL_PERFORMANCE_POLICY_HASH);
    expect(calculateSocialPerformance(input, changed).value).toBe(90);
  });
});

describe("observable 90-day post measurements", () => {
  const post = (id: number, daysAgo: number, message: string | null = "Helpful update") => ({ id: `123_${id}`, createdTime: new Date(Date.parse(at) - daysAgo * day).toISOString(), message, messageStatus: message === null ? "not-returned" as const : "available" as const });
  it("measures frequency, recency, complete weeks and inactivity including window boundaries", () => {
    const result = derive90DayPostMeasurements([post(1, 89), post(2, 14), post(3, 7)], since, at, true);
    expect(result).toMatchObject({ "posts-per-week": 3 * 7 / 90, "posting-recency-days": 7, "active-week-ratio": 2 / 12, "longest-gap-days": 75 });
  });
  it("recognizes deterministic bilingual structures and exact normalized repetition without claiming relevance", () => {
    const text = "¿Cómo preparar tus documentos?\n• Revisa esta lista\nhttps://example.com\nAgenda hoy";
    expect(observablePostStructures(text)).toHaveLength(4);
    const result = derive90DayPostMeasurements([post(1, 10, text), post(2, 5, text.toUpperCase())], since, at, true);
    expect(result).toMatchObject({ "actionable-post-ratio": 1, "observable-structure-count": 4, "distinct-post-ratio": 0.5 });
    expect(result["reviewed-relevance"]).toBeUndefined();
  });
  it("keeps content unknown for no posts, omitted/retention-limited text, or media-only empty messages", () => {
    for (const items of [[], [post(1, 4, null)], [post(1, 4, "")], [{ ...post(1, 4), message: null, messageStatus: "not-retained" as const }]]) {
      const result = derive90DayPostMeasurements(items, since, at, true);
      expect(result["posts-per-week"]).toBeDefined();
      expect(result["actionable-post-ratio"]).toBeUndefined(); expect(result["distinct-post-ratio"]).toBeUndefined();
    }
    expect(derive90DayPostMeasurements([post(1, 4)], since, at, false)["actionable-post-ratio"]).toBeUndefined();
  });
  it("does not derive verified zeros or content metrics from invalid windows, duplicates or out-of-window dates", () => {
    expect(derive90DayPostMeasurements([], "2026-10-01T00:00:00.000Z", at, true)).toEqual({});
    expect(derive90DayPostMeasurements([post(1, 5), post(1, 4)], since, at, true)).toEqual({});
    expect(derive90DayPostMeasurements([post(1, 91)], since, at, true)).toEqual({});
    expect(derive90DayPostMeasurements([post(1, 0)], since, at, true)).toEqual({});
  });
  it("description signals distinguish presence from observable service or next-step cues", () => {
    expect(descriptionSignalCount("")).toBe(0); expect(descriptionSignalCount("An accounting business.")).toBe(1);
    expect(descriptionSignalCount("Ofrecemos servicios para empresas.")).toBe(2);
    expect(descriptionSignalCount("Contact us today.")).toBe(2);
  });
});
