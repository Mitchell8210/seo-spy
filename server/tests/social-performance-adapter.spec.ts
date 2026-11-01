import { randomUUID } from "node:crypto";
import { collectFacebookSocialHistory, facebookSocialHistoryEvidence } from "../src/integrations/facebook/social-history.js";
import { createFacebookReportingWindow } from "../src/integrations/facebook/reporting-window.js";
import { buildAssessmentInput } from "../src/modules/assessments/assessment-input.js";
import { buildSocialPerformanceInput } from "../src/modules/assessments/assessment-social-performance.js";
import { calculateScoreSnapshot } from "../src/scoring/calculator.js";
import { calculateSocialPerformance } from "../src/scoring/social-performance.js";
import type { AuditReportRecord } from "../src/reports/report.types.js";
import type { Evidence } from "../src/contracts/domain.js";
import type { FacebookReport } from "../src/integrations/facebook/types.js";

const at = "2026-11-01T18:00:00.000Z", pageId = "123", business = { id: "business", name: "Accounting", website: "https://example.com/", createdAt: at };
async function fixture(active = true) {
  const id = randomUUID(), evidence: Evidence[] = [], window = createFacebookReportingWindow(new Date(at));
  const add = (checkId: string, observed: Record<string, string>) => { evidence.push({ id: randomUUID(), auditId: id, checkId, mode: "live", collectedAt: at, sourceUrl: `https://www.facebook.com/${pageId}`, observed }); };
  const fb: FacebookReport = { provider: "facebook-graph", version: "facebook-v1", graphVersion: "v26.0", pageId, pageName: business.name, collectedAt: at,
    window, profile: {}, posts: { status: "available", items: [], truncated: true, collectedAt: at }, metrics: [],
    summary: { followersStart: null, followersEnd: null, followersChange: null, latestPostAt: null, postsInWindow: null, postsInWindowComplete: false },
    coverage: { profileFieldsAvailable: 6, profileFieldsMissing: 0, profileFieldsUnavailable: 0, metricsAvailable: 3, metricsRequested: 3, postsLimit: 50 }, limitations: [] };
  for (const [name, value] of Object.entries({ name: "Accounting", about: "We offer accounting services. Contact us for an appointment.", website: business.website, phone: "+17025551212", category: "Accounting", followers_count: 100 })) {
    fb.profile[name] = { status: "available", value, collectedAt: at }; add(`facebook:profile:${name}`, { status: "available", value: JSON.stringify(value) });
  }
  for (const name of ["page_post_likes", "page_media_view"]) {
    const points = window.dayEnds.map((endTime, index) => ({ endTime, value: active && index === 0 ? name === "page_post_likes" ? 20 : 500 : 0 }));
    const metric: FacebookReport["metrics"][number] = { name, status: "available", period: "day", aggregation: "sum", total: points.reduce((a, b) => a + b.value, 0), points,
      collectedAt: at, sourceMetric: name === "page_post_likes" ? "page_actions_post_reactions_total" : name, ...(name === "page_post_likes" ? { breakdown: "like" as const } : {}), coverage: { complete: true, expectedDays: 30, returnedDays: 30 } };
    fb.metrics.push(metric); add(`facebook:insight:${name}`, { status: "available", metric: JSON.stringify(metric), requestedSince: window.since, requestedUntil: window.until });
  }
  fb.commentCounts = { basis: "reporting-window", since: window.since, until: window.until, timeZone: "America/Los_Angeles", status: "available", total: active ? 10 : 0, observedTotal: active ? 10 : 0,
    complete: true, postsCollected: 36, postsChecked: 36, collectedAt: at };
  add("facebook:comment-counts", { summary: JSON.stringify(fb.commentCounts) });
  const end = Date.parse("2026-11-01T00:00:00.000Z");
  const messages = ["Contact us to discuss your bookkeeping.", "Have questions about tax records?", "Read our resource https://example.com/guide", "How to organize records:\n1. Save receipts\n2. Check invoices"];
  const posts = active ? Array.from({ length: 36 }, (_, index) => ({ id: `${pageId}_${index + 1}`, created_time: new Date(end - (index * 2.4 + 1) * 86400000).toISOString(), message: `${messages[index % 4]} Topic ${index}.` })) : [];
  fb.socialHistory = await collectFacebookSocialHistory(async () => ({ data: posts.slice(0, 25), ...(posts.length > 25 ? { paging: { next: "unused", cursors: { after: "second" } } } : {}) }), pageId, at);
  if (posts.length > 25) {
    let calls = 0;
    fb.socialHistory = await collectFacebookSocialHistory(async () => ++calls === 1 ? { data: posts.slice(0, 25), paging: { next: "unused", cursors: { after: "second" } } } : { data: posts.slice(25) }, pageId, at);
  }
  add("facebook:social-history", facebookSocialHistoryEvidence(fb.socialHistory));
  const report: AuditReportRecord = { schemaVersion: "seo-spy.audit-report.v1", reportId: id, auditId: id, generatedAt: at, business,
    audit: { id, businessId: business.id, scope: "facebook", mode: "live", status: "completed", stage: "complete", createdAt: at, startedAt: at, completedAt: at, warnings: [], failure: null, scoringVersion: "facebook-v1" },
    results: { scores: [], findings: [], recommendations: [], evidence, facebook: fb } };
  return { report, fb, evidence };
}
const adapt = (report: AuditReportRecord) => buildSocialPerformanceInput(business, report, at, []);
const criterion = (result: ReturnType<typeof calculateSocialPerformance>, id: string) => result.categories.flatMap(item => item.criteria).find(item => item.id === id)!;

describe("v1.4 saved Facebook evidence adapter", () => {
  it("supports a strong active business using actual owned citations and complete 90-day evidence", async () => {
    const { report } = await fixture();
    const result = calculateSocialPerformance(adapt(report));
    expect(result.status).toBe("definitive"); expect(result.coveragePercent).toBe(71);
    expect(result.value).toBe(100);
    expect(result.categories.map(item => item.maximum)).toEqual([15, 20, 25, 15, 15, 10]);
    expect(criterion(result, "shares-per-100-followers").status).toBe("unavailable");
    expect(criterion(result, "customer-response-rate").status).toBe("unavailable");
    const input = buildAssessmentInput({ business, facebook: report, website: null, facts: null, cutoff: at, profile: "baseline-mobile-v1", policyVersion: "seo-spy-score-v1.4" });
    const snapshot = calculateScoreSnapshot(input);
    expect(snapshot.scores.social.value).toBe(100); expect(snapshot.socialScope).toBe("facebook-presence-quality");
    expect(snapshot.socialAssessment).toEqual(result); expect(snapshot.scores.overall.value).toBeNull();
    expect(calculateScoreSnapshot(input)).toEqual(snapshot);
  });
  it("scores complete but inactive profiles with verified zeros, never inferring poor content", async () => {
    const { report } = await fixture(false), result = calculateSocialPerformance(adapt(report));
    expect(result.status).toBe("provisional"); expect(result.coveragePercent).toBe(60); expect(result.value).toBe(25);
    expect(criterion(result, "posts-per-week")).toMatchObject({ status: "available", value: 0, earned: 0 });
    expect(criterion(result, "likes-per-100-followers")).toMatchObject({ status: "available", value: 0, earned: 0 });
    expect(criterion(result, "actionable-post-ratio").earned).toBeNull();
    const snapshot = calculateScoreSnapshot(buildAssessmentInput({ business, facebook: report, website: null, facts: null, cutoff: at, profile: "baseline-mobile-v1", policyVersion: "seo-spy-score-v1.4" }));
    expect(snapshot.scores.social.value).toBeNull(); expect(snapshot.scores.social.reasons).toContain("SOCIAL_SCORE_PROVISIONAL");
  });
  it("preserves profile-only evidence as insufficient data and never adopts a legacy post sample", async () => {
    const { report, fb } = await fixture(); delete fb.socialHistory; delete fb.commentCounts; fb.metrics = [];
    const result = calculateSocialPerformance(adapt(report));
    expect(result.value).toBeNull(); expect(result.status).toBe("insufficient_data"); expect(result.coveragePercent).toBe(15);
  });
  it.each(["missing", "unavailable"] as const)("does not score %s profile fields as zero or full points", async status => {
    const { report, fb } = await fixture(); fb.profile.name = { status, value: null, collectedAt: at };
    expect(criterion(calculateSocialPerformance(adapt(report)), "profile-name").earned).toBeNull();
  });
  it("requires matching current insight evidence, complete periods and a positive follower denominator", async () => {
    const { report, fb, evidence } = await fixture();
    fb.metrics[0]!.total = 0;
    expect(criterion(calculateSocialPerformance(adapt(report)), "likes-per-100-followers").status).toBe("unavailable");
    fb.profile.followers_count!.value = 0; evidence.find(item => item.checkId === "facebook:profile:followers_count")!.observed.value = "0";
    expect(criterion(calculateSocialPerformance(adapt(report)), "media-views-per-follower").status).toBe("unavailable");
  });
  it("accepts equivalent validated metric objects after schema parsing changes property order", async () => {
    const { report, fb } = await fixture();
    fb.metrics = fb.metrics.map(item => Object.fromEntries(Object.entries(item).reverse()) as unknown as FacebookReport["metrics"][number]);
    const result = calculateSocialPerformance(adapt(report));
    expect(criterion(result, "likes-per-100-followers").status).toBe("available");
    expect(criterion(result, "media-views-per-follower").status).toBe("available");
  });
  it("rejects wrong Page citations, changed history text and incomplete comments", async () => {
    const { report, fb, evidence } = await fixture();
    evidence.find(item => item.checkId === "facebook:insight:page_post_likes")!.sourceUrl = "https://www.facebook.com/other";
    fb.socialHistory!.items[0]!.message = "Changed after collection"; fb.commentCounts!.complete = false;
    const result = calculateSocialPerformance(adapt(report));
    for (const id of ["likes-per-100-followers", "posts-per-week", "comments-per-100-followers"]) expect(criterion(result, id).status).toBe("unavailable");
  });
  it("does not use lifetime shares, daily flow or conversations as unavailable quality measures", async () => {
    const { report, fb } = await fixture(); fb.lifetimeShares = { basis: "lifetime", sourceField: "shares", knownTotal: 243, total: 243, complete: true, postsCollected: 50, postsWithCounts: 50, collectedAt: at };
    const result = calculateSocialPerformance(adapt(report));
    for (const id of ["shares-per-100-followers", "follower-growth-percent", "customer-response-rate", "customer-response-hours"]) expect(criterion(result, id).status).toBe("unavailable");
  });
  it("blocks cross-business social input from publishing a score", async () => {
    const { report } = await fixture();
    const input = buildAssessmentInput({ business, facebook: report, website: null, facts: null, cutoff: at, profile: "baseline-mobile-v1", policyVersion: "seo-spy-score-v1.4" });
    input.social!.performance!.businessId = "other";
    expect(() => calculateScoreSnapshot(input)).toThrow("The scoring input is invalid or unsupported.");
  });
});
