import { load } from "cheerio";
import { randomUUID } from "node:crypto";
import { extractWebsiteBusinessEntities } from "../src/integrations/website/business-facts.js";
import { buildAssessmentInput, normalizeConfirmedPhone } from "../src/modules/assessments/assessment-input.js";
import { confirmedFactsSchema } from "../src/modules/assessments/confirmed-facts.js";
import { calculateScoreSnapshot } from "../src/scoring/calculator.js";
import type { AuditReportRecord } from "../src/reports/report.types.js";
import type { FacebookReport } from "../src/integrations/facebook/types.js";

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
