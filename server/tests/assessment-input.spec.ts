import { load } from "cheerio";
import { randomUUID } from "node:crypto";
import { extractWebsiteBusinessEntities } from "../src/integrations/website/business-facts.js";
import { buildAssessmentInput, normalizeConfirmedPhone } from "../src/modules/assessments/assessment-input.js";
import { confirmedFactsSchema, sourceAgreementFactsSchema } from "../src/modules/assessments/confirmed-facts.js";
import { calculateScoreSnapshot } from "../src/scoring/calculator.js";
import type { AuditReportRecord } from "../src/reports/report.types.js";
import type { FacebookReport } from "../src/integrations/facebook/types.js";
import { collectFacebookPostWindow } from "../src/integrations/facebook/post-coverage.js";
import { sourceReviewReuseReasons } from "../src/scoring/review-reuse.js";

const at = "2026-11-01T00:00:00.000Z";
const business = { id: "business", name: "Confirmed Accounting", website: "https://example.com/", createdAt: at };
function fixture() {
  const id = randomUUID();
  const website: AuditReportRecord = { schemaVersion: "seo-spy.audit-report.v1", reportId: id, auditId: id, generatedAt: at, business,
    audit: { id, businessId: business.id, mode: "live", scope: "lighthouse", strategy: "mobile", status: "completed", stage: "complete", createdAt: at, startedAt: at, completedAt: at, warnings: [], failure: null, scoringVersion: "lighthouse-v1" },
    results: { evidence: [{ id: "facts", auditId: id, checkId: "business-facts", mode: "live", collectedAt: at, sourceUrl: business.website,
      observed: { entities: JSON.stringify([{ name: business.name, url: business.website, phone: "702-555-1212", hours: null }]) } }], findings: [], recommendations: [], scores: [],
      lighthouse: { provider: "google-pagespeed-insights", requestedUrl: business.website, finalUrl: business.website, fetchedAt: at, strategy: "mobile", lighthouseVersion: "13.0.0",
        categories: (["seo", "performance", "accessibility", "best-practices"] as const).map(id => ({ id, title: id, score: 80, availability: "measured" as const, auditIds: [] })),
        metrics: [], checks: [], warnings: [] } } };
  const facebook = structuredClone(website);
  facebook.auditId = randomUUID(); facebook.reportId = facebook.auditId; facebook.audit.id = facebook.auditId; facebook.audit.scope = "facebook";
  facebook.results!.evidence = [];
  delete facebook.results!.lighthouse;
  facebook.results!.facebook = { provider: "facebook-graph", version: "facebook-v1", graphVersion: "v26.0", pageId: "123", pageName: business.name, collectedAt: at,
    profile: Object.fromEntries(Object.entries({ name: business.name, about: "Accounting services", website: business.website, phone: "+17025551212", category: "Accountant" }).map(([name, value]) => [name, { status: "available", value, collectedAt: at }])),
    window: { since: "2026-10-02T00:00:00.000Z", until: at, requestedDays: 30 },
    posts: { status: "available", truncated: false, collectedAt: at, items: ["2026-10-04", "2026-10-18", "2026-10-25"].map((date, index) => ({ id: `123_${index}`, message: null, url: `https://facebook.com/123_${index}`, createdTime: `${date}T12:00:00.000Z` })) },
    metrics: [], summary: { followersStart: null, followersEnd: null, followersChange: null, latestPostAt: null, postsInWindow: 3, postsInWindowComplete: true },
    coverage: { profileFieldsAvailable: 5, profileFieldsMissing: 0, profileFieldsUnavailable: 0, metricsAvailable: 0, metricsRequested: 0, postsLimit: 50 }, limitations: [] } satisfies FacebookReport;
  const facts = confirmedFactsSchema.parse({ schemaVersion: "seo-spy.confirmed-scoring-facts.v1", id: randomUUID(), businessId: business.id, createdAt: "2026-10-01T00:00:00.000Z", confirmedBy: "a".repeat(64),
    values: { confirmed: true, publishingTarget: 1, preferred: { name: business.name, aliases: [], country: "US", phones: ["+17025551212"], websiteUrls: [business.website], timeZone: "America/Los_Angeles", hours: null, hoursApplicable: false }, profileAbsences: [] } });
  return { business, website, facebook, facts, cutoff: at, profile: "baseline-mobile-v1" as const };
}

function agreementFixture() {
  const selected = fixture();
  selected.website.results!.evidence[0]!.observed.entities = JSON.stringify([{ name: "Accounting & Multi Services", url: business.website, phone: "+1-702-555-1212", hours: [{ day: "Monday", opens: "09:00", closes: "18:00" }] }]);
  const fb = selected.facebook.results!.facebook!;
  fb.profile.name!.value = "Accounting & Associates";
  fb.profile.hours = { status: "missing", value: null, collectedAt: at };
  for (const field of ["name", "phone", "website", "hours"]) selected.facebook.results!.evidence.push({ id: `real-${field}`, auditId: selected.facebook.reportId, checkId: `facebook:profile:${field}`, mode: "live", collectedAt: at, sourceUrl: "https://www.facebook.com/123", observed: { status: fb.profile[field]!.status } });
  const facts = sourceAgreementFactsSchema.parse({ schemaVersion: "seo-spy.confirmed-scoring-facts.v2", id: randomUUID(), businessId: business.id, createdAt: at, confirmedBy: "a".repeat(64), values: {
    confirmed: true, comparisonMode: "source-agreement", country: "international", confirmedPhone: "+17025551212", websiteReportId: selected.website.reportId, facebookReportId: selected.facebook.reportId,
    sourceReviews: [{ provider: "facebook", reportId: selected.facebook.reportId, evidenceIds: ["real-hours"], field: "hours", state: "always-open", timeZone: null, hours: null, observedAt: at, validFrom: "2026-11-01", notes: "The operator confirms the public Page displays Always open." }], notes: "Source agreement approved without a preferred business name." } });
  return { ...selected, facts, policyVersion: "seo-spy-score-v1.2" as const };
}

describe("approved source-agreement adapter", () => {
  it("scores real paired observations without a preferred name or publishing target", () => {
    const selected = agreementFixture();
    const input = buildAssessmentInput(selected);
    const scores = calculateScoreSnapshot(input);
    expect(scores.scores.social.value).toBe(100);
    expect(scores.scores.consistency.value).toBe(60);
    expect(scores.scores.overall.value).toBe(82);
    expect(input.consistency?.criteria.map(item => item.outcome)).toEqual(["fail", "pass", "pass", "fail"]);
    expect(input.consistency?.criteria[3]!.observations?.facebook).toBe("Always open (operator reviewed)");
  });
  it("fails closed on API omission without the operator observation", () => {
    const selected = agreementFixture(); selected.facts.values.sourceReviews = [];
    expect(calculateScoreSnapshot(buildAssessmentInput(selected)).scores.consistency.value).toBeNull();
  });
  it("requires the exact attested source pair and genuine paired evidence", () => {
    const selected = agreementFixture(); selected.facts.values.facebookReportId = randomUUID();
    expect(calculateScoreSnapshot(buildAssessmentInput(selected)).scores.consistency.value).toBeNull();
    const missing = agreementFixture(); missing.facebook.results!.evidence = missing.facebook.results!.evidence.filter(item => item.checkId !== "facebook:profile:phone");
    expect(calculateScoreSnapshot(buildAssessmentInput(missing)).scores.consistency.value).toBeNull();
  });
});

function renewedAgreement() {
  const original = agreementFixture();
  const renew = (report: AuditReportRecord) => JSON.parse(JSON.stringify(report).replaceAll(report.reportId, randomUUID())) as AuditReportRecord;
  return { ...original, website: renew(original.website), facebook: renew(original.facebook), policyVersion: "seo-spy-score-v1.3" as const,
    reviewedSources: { website: original.website, facebook: original.facebook } };
}

describe("v1.3 unchanged source review reuse", () => {
  it("scores new exact report IDs while preserving original review identity, dates and archives", () => {
    const selected = renewedAgreement(), before = JSON.stringify(selected);
    const input = buildAssessmentInput(selected), scored = calculateScoreSnapshot(input);
    expect(scored.scores.consistency.value).toBe(60);
    expect(scored.scores.overall.value).toBe(82);
    expect(scored.confirmations.consistencyFacts).toMatchObject({ revision: selected.facts.id, confirmedAt: at,
      sourceAttestation: { websiteReportId: selected.reviewedSources.website.reportId, facebookReportId: selected.reviewedSources.facebook.reportId },
      reviewReuse: { version: "unchanged-source-observations-v1", reviews: [{ observedAt: at }] } });
    expect(scored.sources.map(item => item.reportId)).toEqual([selected.website.reportId, selected.facebook.reportId]);
    expect(JSON.stringify(selected)).toBe(before);
    expect(calculateScoreSnapshot(input)).toEqual(scored);
  });
  it.each(["name", "phone", "website", "hours"])("requires a new review when the Facebook %s claim changes", field => {
    const selected = renewedAgreement();
    selected.facebook.results!.facebook!.profile[field] = { status: "available", collectedAt: at,
      value: field === "phone" ? "+17025551213" : field === "website" ? "https://changed.example/" : field === "hours" ? { mon_1_open: "09:00", mon_1_close: "17:00" } : "Different & Associates" };
    expect(calculateScoreSnapshot(buildAssessmentInput(selected)).scores.consistency.value).toBeNull();
  });
  it("does not reuse a review when website hours change even if they still disagree with Always open", () => {
    const selected = renewedAgreement();
    selected.website.results!.evidence[0]!.observed.entities = selected.website.results!.evidence[0]!.observed.entities!.replace("18:00", "17:00");
    expect(calculateScoreSnapshot(buildAssessmentInput(selected)).scores.consistency.value).toBeNull();
  });
  it("does not reuse missing current hours evidence or a different Page", () => {
    const missing = renewedAgreement(); missing.facebook.results!.evidence = missing.facebook.results!.evidence.filter(item => item.checkId !== "facebook:profile:hours");
    expect(calculateScoreSnapshot(buildAssessmentInput(missing)).scores.consistency.value).toBeNull();
    const wrong = renewedAgreement(); wrong.facebook.results!.facebook!.pageId = "other";
    expect(calculateScoreSnapshot(buildAssessmentInput(wrong)).scores.consistency.value).toBeNull();
  });
  it("never extends the review clock when refreshed reports remain fresh", () => {
    const selected = renewedAgreement(), input = buildAssessmentInput(selected);
    expect(sourceReviewReuseReasons(input, "2026-11-08T00:00:00.001Z")).toContain("SOURCE_REVIEW_EXPIRED");
    selected.facts.createdAt = "2026-10-24T23:59:59.999Z";
    expect(calculateScoreSnapshot(buildAssessmentInput(selected)).scores.consistency.reasons).toContain("SOURCE_REVIEW_EXPIRED");
  });
  it("honors calendar scope and rejects future reviews", () => {
    const selected = renewedAgreement(), input = buildAssessmentInput(selected);
    input.consistency!.facts!.reviewReuse!.reviews[0]!.validUntil = "2026-11-01";
    expect(sourceReviewReuseReasons(input, "2026-11-02T00:00:00.000Z")).toContain("SOURCE_REVIEW_EXPIRED");
    input.consistency!.facts!.reviewReuse!.reviews[0]!.observedAt = "2026-11-02T00:00:00.000Z";
    expect(calculateScoreSnapshot(input).scores.consistency.value).toBeNull();
  });
  it.each(["hash", "binding", "business", "observation"])("fails closed on changed %s provenance", change => {
    const input = buildAssessmentInput(renewedAgreement()), proof = input.consistency!.facts!.reviewReuse!;
    if (change === "hash") proof.currentSources[0]!.reportHash = "a".repeat(64);
    if (change === "binding") proof.originalSources[0]!.reportId = randomUUID();
    if (change === "business") proof.originalSources[0]!.businessId = "other-business";
    if (change === "observation") proof.originalSources[0]!.observationHash = "b".repeat(64);
    expect(calculateScoreSnapshot(input).scores.overall.value).toBeNull();
  });
  it("keeps v1.2's exact-pair restriction unchanged", () => {
    const selected = renewedAgreement();
    expect(calculateScoreSnapshot(buildAssessmentInput({ ...selected, policyVersion: "seo-spy-score-v1.2" })).scores.consistency.reasons).toContain("UNCONFIRMED_SOURCE_ATTESTATION");
  });
});

describe("saved evidence to scoring inputs", () => {
  it("derives all eligible component values from confirmed facts and complete saved evidence", () => {
    const selection = fixture();
    const before = JSON.stringify(selection);
    const input = buildAssessmentInput(selection);
    const scored = calculateScoreSnapshot(input);
    expect(scored.scores.website.value).toBe(80);
    expect(scored.scores.social.value).toBe(90);
    expect(scored.scores.consistency.value).toBe(100);
    expect(scored.scores.overall.value).toBe(87);
    expect(JSON.stringify(selection)).toBe(before);
  });
  it("treats missing Facebook fields and truncated publishing windows as unknown", () => {
    const selection = fixture();
    selection.facebook.results!.facebook!.profile.name = { status: "missing", value: null, collectedAt: at };
    selection.facebook.results!.facebook!.posts.truncated = true;
    const scored = calculateScoreSnapshot(buildAssessmentInput(selection));
    expect(scored.scores.social.value).toBeNull(); expect(scored.scores.overall.value).toBeNull();
    expect(scored.scores.social.reasons).toContain("INCOMPLETE_POST_WINDOW");
    expect(scored.scores.website.value).toBe(80);
  });
  it("requires explicit targets, comparable facts and trustworthy time bounds", () => {
    const selection = fixture();
    const scored = calculateScoreSnapshot(buildAssessmentInput({ ...selection, facts: null }));
    expect(scored.scores.social.reasons).toContain("UNCONFIRMED_PUBLISHING_GOAL");
    expect(scored.scores.consistency.reasons).toContain("UNCONFIRMED_BUSINESS_FACTS");
    selection.cutoff = "2026-11-01T00:00:00.001Z";
    expect(calculateScoreSnapshot(buildAssessmentInput(selection)).scores.social.value).toBeNull();
  });
  it("excludes phone only through recorded business applicability without excluding required name or URL", () => {
    const selection = fixture();
    selection.facts.values.preferred.phoneApplicable = false;
    selection.facts.values.preferred.phones = [];
    selection.facebook.results!.facebook!.profile.phone = { status: "missing", value: null, collectedAt: at };
    const score = calculateScoreSnapshot(buildAssessmentInput(selection)).scores.consistency;
    expect(score.value).toBe(100); expect(score.coverage.requiredWeight).toBe(50);
    expect(score.ledger.find(item => item.id === "phone")?.weight).toBe(0);
  });
  it("does not assume hostname aliases or countryless telephone equivalence", () => {
    expect(normalizeConfirmedPhone("(702) 555-1212", "US")).toBe("+17025551212");
    expect(normalizeConfirmedPhone("7025551212", "international")).toBeNull();
    expect(normalizeConfirmedPhone("+17025551212 ext 2", "US")).toBeNull();
    const selection = fixture(); selection.facebook.results!.facebook!.profile.website!.value = "https://www.example.com/";
    expect(calculateScoreSnapshot(buildAssessmentInput(selection)).scores.consistency.value).toBe(63);
  });
  it("rejects cross-business reports and ambiguous business markup", () => {
    const selection = fixture(); selection.website.business = { ...business, id: "other" };
    expect(() => buildAssessmentInput(selection)).toThrow();
    const second = fixture();
    second.website.results!.evidence[0]!.observed.entities = JSON.stringify([{ name: business.name, url: business.website, phone: "7025551212", hours: null }, { name: business.name, url: business.website, phone: "7025550000", hours: null }]);
    expect(calculateScoreSnapshot(buildAssessmentInput(second)).scores.consistency.value).toBeNull();
  });
  it("accepts an exact saved redirect binding without assuming hostname aliases", () => {
    const selected = fixture();
    const lighthouse = selected.website.results!.lighthouse!;
    lighthouse.requestedUrl = "https://www.example.com/"; lighthouse.finalUrl = lighthouse.requestedUrl;
    expect(calculateScoreSnapshot(buildAssessmentInput(selected)).scores.website.value).toBeNull();
    selected.website.results!.evidence.push({ id: "collection", auditId: selected.website.auditId, checkId: "collection", mode: "live", collectedAt: at, sourceUrl: lighthouse.finalUrl,
      observed: { requestedUrl: business.website, finalUrl: lighthouse.finalUrl, status: "200", redirects: JSON.stringify([lighthouse.finalUrl]) } });
    expect(calculateScoreSnapshot(buildAssessmentInput(selected)).scores.website.value).toBe(80);
    selected.website.results!.evidence.at(-1)!.observed.redirects = "[]";
    expect(calculateScoreSnapshot(buildAssessmentInput(selected)).scores.website.value).toBeNull();
  });
  it("scores a separately collected complete publishing window without replacing the recent-post sample", async () => {
    const selected = fixture(); selected.cutoff = "2026-11-01T12:00:00.000Z";
    const original = JSON.stringify(selected.facebook.results!.facebook!.posts);
    const posts = selected.facebook.results!.facebook!.posts.items;
    const publishing = await collectFacebookPostWindow(async () => ({ data: posts.map(item => ({ id: item.id, created_time: item.createdTime! })) }), "123", selected.cutoff);
    selected.facebook.results!.facebook!.publishing = publishing;
    selected.facebook.results!.evidence.push({ id: "window", auditId: selected.facebook.auditId, checkId: "facebook:publishing-window", mode: "live", sourceUrl: "https://www.facebook.com/123", collectedAt: selected.cutoff,
      observed: { status: publishing.status, truncated: String(publishing.truncated), items: JSON.stringify(publishing.items), coverage: JSON.stringify(publishing.coverage) } });
    const snapshot = calculateScoreSnapshot(buildAssessmentInput({ ...selected, policyVersion: "seo-spy-score-v1.1" }));
    expect(snapshot.scores.social.value).toBe(90); expect(snapshot.scores.overall.value).toBe(87);
    expect(snapshot.reportingCutoff).toBe(at);
    expect(JSON.stringify(selected.facebook.results!.facebook!.posts)).toBe(original);
    selected.facebook.results!.evidence[0]!.sourceUrl = "https://www.facebook.com/999";
    expect(calculateScoreSnapshot(buildAssessmentInput({ ...selected, policyVersion: "seo-spy-score-v1.1" })).scores.social.value).toBeNull();
  });
  it("keeps missing or conflicting complete-window proof unavailable", async () => {
    const selected = fixture(); selected.cutoff = "2026-11-01T12:00:00.000Z";
    const publishing = await collectFacebookPostWindow(async () => ({ data: [] }), "123", selected.cutoff);
    selected.facebook.results!.facebook!.publishing = publishing;
    selected.facebook.results!.evidence.push({ id: "window", auditId: selected.facebook.auditId, checkId: "facebook:publishing-window", mode: "live", sourceUrl: "https://www.facebook.com/123", collectedAt: selected.cutoff,
      observed: { status: publishing.status, truncated: String(publishing.truncated), items: JSON.stringify(publishing.items), coverage: JSON.stringify(publishing.coverage) } });
    expect(calculateScoreSnapshot(buildAssessmentInput({ ...selected, policyVersion: "seo-spy-score-v1.1" })).scores.social.value).toBeNull();
    selected.facebook.results!.facebook!.posts.items = [];
    expect(calculateScoreSnapshot(buildAssessmentInput({ ...selected, policyVersion: "seo-spy-score-v1.1" })).scores.social.value).toBe(60);
  });
  it("merges complementary markup only after establishing the same observed business identity", () => {
    const selected = fixture();
    selected.facts.values.preferred.name = "Confirmed & Accounting";
    selected.facebook.results!.facebook!.profile.name!.value = "Confirmed & Accounting";
    selected.website.results!.evidence[0]!.observed.entities = JSON.stringify([
      { name: "Confirmed &amp; Accounting", url: business.website, phone: null, hours: null },
      { name: "Confirmed & Accounting", url: business.website, phone: "702-555-1212", hours: null },
    ]);
    expect(calculateScoreSnapshot(buildAssessmentInput(selected)).scores.consistency.value).toBe(100);
  });
});

describe("bounded structured business observations", () => {
  it("extracts schema.org facts without interpreting source strings as instructions", () => {
    const entities = extractWebsiteBusinessEntities(load(`<script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "AccountingService", name: business.name, url: business.website, telephone: "702-555-1212" }] })}</script>`));
    expect(entities).toEqual([{ name: business.name, url: business.website, phone: "702-555-1212", hours: null }]);
  });
  it("keeps absent, malformed, oversized and unsupported markup unknown", () => {
    expect(extractWebsiteBusinessEntities(load('<script type="application/ld+json">invalid</script>'))).toEqual([]);
    expect(extractWebsiteBusinessEntities(load(`<script type="application/ld+json">${" ".repeat(32769)}</script>`))).toEqual([]);
    expect(extractWebsiteBusinessEntities(load('<h1>Accounting</h1><p>7025551212</p>'))).toEqual([]);
  });
});
