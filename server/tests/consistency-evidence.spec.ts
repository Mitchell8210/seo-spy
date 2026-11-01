import { randomUUID } from "node:crypto";
import type { AuditReportRecord } from "../src/reports/report.types.js";
import type { WebsiteBusinessEntity } from "../src/integrations/website/business-facts.js";
import { formatWeeklyHours, hoursConsistencyCriterion, mergeWebsiteBusinessFacts, normalizeBusinessName, normalizeWeeklyHours, sourceAgreementHoursCriterion, sourceHoursReviewSchema, weeklyHoursSchema,
  type BusinessFactCandidate, type HoursConsistencyInput, type SourceHoursReview, type WeeklyHours } from "../src/modules/assessments/consistency-evidence.js";

const cutoff = "2026-11-01T18:00:00.000Z";
const at = "2026-11-01T12:00:00.000Z";
const business = { id: "business", name: "Tax & Accounting", website: "https://example.com/", createdAt: at };
const rawHours = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(day => ({ day: `https://schema.org/${day}`, opens: "09:00", closes: "18:00" }));
function weekly(): WeeklyHours {
  return { mon: [{ opens: "09:00", closes: "18:00" }], tue: [{ opens: "09:00", closes: "18:00" }], wed: [{ opens: "09:00", closes: "18:00" }], thu: [{ opens: "09:00", closes: "18:00" }], fri: [{ opens: "09:00", closes: "18:00" }], sat: [{ opens: "09:00", closes: "18:00" }], sun: [] };
}
function record(provider: "website" | "facebook"): AuditReportRecord {
  const id = randomUUID();
  return { schemaVersion: "seo-spy.audit-report.v1", reportId: id, auditId: id, generatedAt: at, business,
    audit: { id, businessId: business.id, scope: provider === "website" ? "homepage" : "facebook", mode: "live", status: "partial", stage: "complete", createdAt: at, startedAt: at, completedAt: at, warnings: [], failure: null, scoringVersion: "homepage-v1" },
    results: { findings: [], recommendations: [], scores: [], evidence: [{ id: "hours-evidence", auditId: id, mode: "live", collectedAt: at, checkId: provider === "website" ? "business-facts" : "facebook:profile:hours", sourceUrl: provider === "website" ? business.website : "https://www.facebook.com/123", observed: provider === "website" ? { entities: "saved structured observations" } : { status: "missing" } }] } };
}
function input(): HoursConsistencyInput {
  const website = record("website"), facebook = record("facebook");
  return { businessId: business.id, cutoff, preferredHours: weekly(), preferredTimeZone: "America/Los_Angeles",
    website: { report: website, evidenceRefs: [{ reportId: website.reportId, evidenceId: "hours-evidence" }], hours: rawHours },
    facebook: { report: facebook, evidenceRefs: [{ reportId: facebook.reportId, evidenceId: "hours-evidence" }], hours: null }, reviews: [] };
}
function review(value: HoursConsistencyInput, provider: "website" | "facebook", state: "present" | "confirmed-absent" = "present"): SourceHoursReview {
  return { provider, reportId: value[provider].report.reportId, evidenceIds: ["hours-evidence"], field: "hours", state, timeZone: "America/Los_Angeles", observedAt: cutoff,
    validFrom: "2026-11-01", validUntil: "2026-11-07", hours: state === "present" ? weekly() : null, notes: "The operator reviewed the exact public source and its applicable dates; this is a separate attestation." };
}
function alwaysOpen(value: HoursConsistencyInput, provider: "website" | "facebook"): SourceHoursReview {
  return { ...review(value, provider), state: "always-open", hours: null, timeZone: null };
}
function candidate(value: Partial<WebsiteBusinessEntity>, evidenceId = "facts"): BusinessFactCandidate {
  return { value: { name: business.name, url: business.website, phone: null, hours: null, ...value }, evidence: [{ reportId: "saved-report", evidenceId }] };
}

describe("conservative duplicate structured-business observations", () => {
  it("merges escaped equivalent names and complementary phone/hours for the exact same URL", () => {
    const values = [candidate({ name: "Tax &amp; Accounting" }, "organization"), candidate({ phone: "7253406758", hours: rawHours }, "local-business")];
    const before = JSON.stringify(values);
    const result = mergeWebsiteBusinessFacts(values);
    expect(result?.value).toEqual({ name: business.name, url: business.website, phone: "7253406758", hours: rawHours });
    expect(result?.evidence.map(ref => ref.evidenceId)).toEqual(["organization", "local-business"]);
    expect(JSON.stringify(values)).toBe(before);
  });
  it("decodes one HTML entity layer and normalizes NFC and whitespace without guessing aliases", () => {
    expect(normalizeBusinessName(" Tax &#38;\n Accounting ")).toBe(business.name);
    expect(normalizeBusinessName("Tax &#x26; Accounting")).toBe(business.name);
    expect(normalizeBusinessName("Tax &amp;amp; Accounting")).toBe("Tax &amp; Accounting");
    expect(normalizeBusinessName("Cafe\u0301")).toBe("Café");
    expect(mergeWebsiteBusinessFacts([candidate({}), candidate({ name: "Different Brand" })])).toBeNull();
    expect(mergeWebsiteBusinessFacts([candidate({}), candidate({ name: "tax & accounting" })])).toBeNull();
  });
  it.each(["https://www.example.com/", "http://example.com/", "https://example.com/other", "https://user@example.com/", "https://example.com/?key=value"])("does not merge an unconfirmed URL alias or different destination: %s", url => {
    expect(mergeWebsiteBusinessFacts([candidate({}), candidate({ url })])).toBeNull();
  });
  it("keeps conflicting populated phone/hours unknown and does not infer country-specific phone equivalence", () => {
    expect(mergeWebsiteBusinessFacts([candidate({ phone: "7253406758" }), candidate({ phone: "7025550000" })])).toBeNull();
    expect(mergeWebsiteBusinessFacts([candidate({ phone: "7253406758" }), candidate({ phone: "+17253406758" })])).toBeNull();
    expect(mergeWebsiteBusinessFacts([candidate({ hours: rawHours }), candidate({ hours: [{ day: "Monday", opens: "10:00", closes: "18:00" }] })])).toBeNull();
  });
  it("merges compatible partial-day sets without filling an omitted Sunday", () => {
    const result = mergeWebsiteBusinessFacts([candidate({ hours: rawHours.slice(0, 3) }), candidate({ hours: rawHours.slice(3) })]);
    expect(result?.value.hours).toHaveLength(6);
    expect(normalizeWeeklyHours(result?.value.hours, "schema-org")?.sun).toBeNull();
  });
  it("requires established identity to merge separate candidates and deduplicates evidence references", () => {
    expect(mergeWebsiteBusinessFacts([])).toBeNull();
    expect(mergeWebsiteBusinessFacts([candidate({ name: null }), candidate({ name: null })])).toBeNull();
    expect(mergeWebsiteBusinessFacts([candidate({ url: null }), candidate({ url: null })])).toBeNull();
    expect(mergeWebsiteBusinessFacts([candidate({}), candidate({})])?.evidence).toHaveLength(1);
  });
});

describe("hours observations preserve unknown versus explicitly closed", () => {
  it("retains unknown omitted days in JSON-LD and Facebook observations", () => {
    expect(normalizeWeeklyHours(rawHours, "schema-org")?.sun).toBeNull();
    expect(normalizeWeeklyHours({ mon_1_open: "09:00", mon_1_close: "18:00" }, "facebook")?.tue).toBeNull();
    expect(normalizeWeeklyHours({}, "facebook")?.sun).toBeNull();
    expect(normalizeWeeklyHours(null, "facebook")).toBeNull();
  });
  it("accepts an explicit complete reviewed week with closed days", () => {
    expect(weeklyHoursSchema.safeParse(weekly()).success).toBe(true);
    expect(normalizeWeeklyHours(weekly())?.sun).toEqual([]);
  });
  it("formats readable daily source values without converting omitted days into closed days", () => {
    const observed = normalizeWeeklyHours(rawHours, "schema-org");
    expect(formatWeeklyHours(observed)).toContain("Mon 09:00–18:00");
    expect(formatWeeklyHours(observed)).toContain("Sun Unknown");
    expect(formatWeeklyHours(observed)).not.toContain("Sun Closed");
    expect(formatWeeklyHours(observed)).not.toContain("America/");
    expect(formatWeeklyHours(normalizeWeeklyHours(weekly()), "America/Los_Angeles")).toContain("Sun Closed · America/Los_Angeles");
    expect(formatWeeklyHours(null)).toBe("Not available");
  });
  it.each([
    [{ mon_1_open: "00:00", mon_1_close: "00:00" }, "facebook"],
    [{ mon_1_open: "09:00" }, "facebook"],
    [{ mon_1_open: "18:00", mon_1_close: "09:00" }, "facebook"],
    [{ unexpected: "closed" }, "facebook"],
    [[{ day: "Someday", opens: "09:00", closes: "18:00" }], "schema-org"],
    [[{ day: "Monday", opens: "9:00", closes: "18:00" }], "schema-org"],
  ] as const)("rejects ambiguous/unsupported hours rather than guessing closed intervals", (value, format) => {
    expect(normalizeWeeklyHours(value, format)).toBeNull();
  });
  it("sorts valid split shifts and rejects overlapping intervals", () => {
    const value = weekly(); value.mon = [{ opens: "14:00", closes: "18:00" }, { opens: "09:00", closes: "12:00" }];
    expect(normalizeWeeklyHours(value)?.mon).toEqual([{ opens: "09:00", closes: "12:00" }, { opens: "14:00", closes: "18:00" }]);
    value.mon = [{ opens: "09:00", closes: "15:00" }, { opens: "14:00", closes: "18:00" }];
    expect(normalizeWeeklyHours(value)).toBeNull();
  });
});

describe("explicit operator source-hour reviews", () => {
  it("keeps Facebook API omission unknown and never infers that omitted Sunday is closed", () => {
    const value = input();
    expect(hoursConsistencyCriterion(value)).toMatchObject({ outcome: "unknown", confirmation: "unconfirmed", reason: "SOURCE_HOURS_REVIEW_REQUIRED" });
    value.reviews = [review(value, "facebook")];
    expect(hoursConsistencyCriterion(value).outcome).toBe("unknown");
  });
  it("allows explicit reviewed presence to fill API omissions while retaining separate attestation provenance", () => {
    const value = input(); value.reviews = [review(value, "website"), review(value, "facebook")];
    const before = JSON.stringify(value);
    expect(hoursConsistencyCriterion(value)).toMatchObject({ outcome: "pass", confirmation: "observed", reason: "EXPLICIT_OPERATOR_REVIEW_WITH_MATCHING_TIMEZONE_AND_DATE_SCOPE" });
    expect(hoursConsistencyCriterion(value).observations.website).toContain("Mon 09:00–18:00");
    expect(hoursConsistencyCriterion(value).observations.facebook).toContain("Sun Closed · America/Los_Angeles");
    expect(hoursConsistencyCriterion(value).observations.website).not.toContain('{"mon"');
    expect(value.facebook.report.results!.evidence[0]!.observed.status).toBe("missing");
    expect(JSON.stringify(value)).toBe(before);
  });
  it("can fail required hours from confirmed public absence plus the other source's partial observed hours", () => {
    const value = input(); value.reviews = [review(value, "facebook", "confirmed-absent")];
    const result = hoursConsistencyCriterion(value);
    expect(result).toMatchObject({ outcome: "fail", confirmation: "confirmed-absence", reason: "REQUIRED_HOURS_CONFIRMED_ABSENT_BY_OPERATOR_SOURCE_REVIEW" });
    expect(new Set(result.evidence.map(ref => ref.reportId))).toEqual(new Set([value.website.report.reportId, value.facebook.report.reportId]));
    expect(result.observations.facebook).toContain("operator source review");
  });
  it("retains exact validated review references when an attestation cites another relevant source item", () => {
    const value = input();
    value.facebook.report.results!.evidence.push({ ...value.facebook.report.results!.evidence[0]!, id: "review-linked-hours" });
    value.reviews = [{ ...review(value, "facebook", "confirmed-absent"), evidenceIds: ["review-linked-hours"] }];
    expect(hoursConsistencyCriterion(value).evidence).toContainEqual({ reportId: value.facebook.report.reportId, evidenceId: "review-linked-hours" });
  });
  it("does not fabricate the other source's hours to support a one-sided failure", () => {
    const value = input(); value.website.hours = null; value.reviews = [review(value, "facebook", "confirmed-absent")];
    expect(hoursConsistencyCriterion(value)).toMatchObject({ outcome: "unknown", reason: "HOURS_OTHER_SOURCE_UNKNOWN" });
  });
  it("fails a known complete observed mismatch without changing weights", () => {
    const value = input(); value.reviews = [review(value, "website"), review(value, "facebook")];
    value.reviews[1]!.hours!.sun = [{ opens: "10:00", closes: "14:00" }];
    expect(hoursConsistencyCriterion(value)).toMatchObject({ outcome: "fail", confirmation: "observed" });
  });
  it("does not silently override populated saved observations with contradictory reviews", () => {
    const value = input(); value.reviews = [review(value, "website"), review(value, "facebook")]; value.reviews[0]!.hours!.mon = [];
    expect(hoursConsistencyCriterion(value)).toMatchObject({ outcome: "unknown", reason: "HOURS_REVIEW_CONTRADICTS_SAVED_SOURCE" });
    value.reviews = [review(value, "website", "confirmed-absent")];
    expect(hoursConsistencyCriterion(value).outcome).toBe("unknown");
  });
  it.each(["foreign-report", "foreign-business", "wrong-evidence", "wrong-field", "stale-evidence", "future-evidence", "demo-evidence", "wrong-scope"])("rejects invalid source binding: %s", kind => {
    const value = input(); value.reviews = [review(value, "website"), review(value, "facebook")];
    switch (kind) {
      case "foreign-report": value.facebook.evidenceRefs[0]!.reportId = randomUUID(); break;
      case "foreign-business": value.facebook.report.business = { ...business, id: "other" }; break;
      case "wrong-evidence": value.facebook.evidenceRefs[0]!.evidenceId = "unknown"; break;
      case "wrong-field": value.facebook.report.results!.evidence[0]!.checkId = "facebook:profile:phone"; break;
      case "stale-evidence": value.facebook.report.results!.evidence[0]!.collectedAt = "2026-10-01T00:00:00.000Z"; break;
      case "future-evidence": value.facebook.report.results!.evidence[0]!.collectedAt = "2026-12-01T00:00:00.000Z"; break;
      case "demo-evidence": value.facebook.report.results!.evidence[0]!.mode = "demo"; break;
      case "wrong-scope": value.facebook.report.audit.scope = "homepage"; break;
    }
    expect(hoursConsistencyCriterion(value)).toMatchObject({ outcome: "unknown", reason: "HOURS_SOURCE_MISMATCH" });
  });
  it.each(["wrong-zone", "stale-review", "future-review", "before-scope", "after-scope", "wrong-ref", "duplicate-review"])("keeps incompatible review unknown: %s", kind => {
    const value = input(); value.reviews = [review(value, "website"), review(value, "facebook")];
    switch (kind) {
      case "wrong-zone": value.reviews[1]!.timeZone = "America/New_York"; break;
      case "stale-review": value.reviews[1]!.observedAt = "2026-10-01T00:00:00.000Z"; break;
      case "future-review": value.reviews[1]!.observedAt = "2026-12-01T00:00:00.000Z"; break;
      case "before-scope": value.reviews[1]!.validFrom = "2026-11-02"; break;
      case "after-scope": value.reviews[1]!.validFrom = "2026-10-01"; value.reviews[1]!.validUntil = "2026-10-31"; break;
      case "wrong-ref": value.reviews[1]!.evidenceIds = ["unknown"]; break;
      case "duplicate-review": value.reviews.push(value.reviews[1]!); break;
    }
    expect(hoursConsistencyCriterion(value).outcome).toBe("unknown");
  });
  it("validates exact dates and presence/absence contracts before storing confirmations", () => {
    const value = input();
    expect(sourceHoursReviewSchema.safeParse({ ...review(value, "website"), validFrom: "2026-02-30" }).success).toBe(false);
    expect(sourceHoursReviewSchema.safeParse({ ...review(value, "facebook", "confirmed-absent"), hours: weekly() }).success).toBe(false);
    expect(sourceHoursReviewSchema.safeParse({ ...review(value, "facebook"), hours: null }).success).toBe(false);
    expect(sourceHoursReviewSchema.safeParse({ ...review(value, "facebook"), evidenceIds: ["hours-evidence", "hours-evidence"] }).success).toBe(false);
  });
});

describe("source agreement including explicit public always-open reviews", () => {
  it("compares an explicit 24/7 source claim with bounded saved hours without inventing a timezone or Sunday closure", () => {
    const value = input(); value.reviews = [alwaysOpen(value, "facebook")];
    const before = JSON.stringify(value);
    const result = sourceAgreementHoursCriterion(value);
    expect(result).toMatchObject({ outcome: "fail", confirmation: "observed", reason: "SOURCE_HOURS_ALWAYS_OPEN_VS_RESTRICTED" });
    expect(result.observations.facebook).toBe("Always open (operator reviewed)");
    expect(result.observations.website).toContain("Mon 09:00–18:00");
    expect(result.observations.website).toContain("Sun Unknown");
    expect(result.observations.website).not.toContain("America/");
    expect(JSON.stringify(result)).not.toContain("24:00");
    expect(new Set(result.evidence.map(ref => ref.reportId))).toEqual(new Set([value.website.report.reportId, value.facebook.report.reportId]));
    expect(JSON.stringify(value)).toBe(before);
  });
  it("records agreement when both sources are explicitly reviewed as always open", () => {
    const value = input(); value.website.hours = null;
    value.reviews = [alwaysOpen(value, "website"), alwaysOpen(value, "facebook")];
    expect(sourceAgreementHoursCriterion(value)).toMatchObject({ outcome: "pass", confirmation: "observed", reason: "SOURCE_HOURS_AGREE_ALWAYS_OPEN", observations: { website: "Always open (operator reviewed)", facebook: "Always open (operator reviewed)" } });
  });
  it("does not use missing API hours as absence or a claim of always open", () => {
    const value = input();
    expect(sourceAgreementHoursCriterion(value)).toMatchObject({ outcome: "unknown", reason: "COMPARABLE_SOURCE_HOURS_REQUIRED" });
    value.website.hours = null; value.reviews = [alwaysOpen(value, "facebook")];
    expect(sourceAgreementHoursCriterion(value).outcome).toBe("unknown");
  });
  it("compares normal source weeks only with complete reviews, matching source timezones and date scopes", () => {
    const value = input(); value.reviews = [review(value, "website"), review(value, "facebook")];
    expect(sourceAgreementHoursCriterion(value)).toMatchObject({ outcome: "pass", reason: "SOURCE_HOURS_COMPARED_WITH_MATCHING_TIMEZONE_AND_DATE_SCOPE" });
    value.reviews[1]!.hours!.sun = [{ opens: "10:00", closes: "14:00" }];
    expect(sourceAgreementHoursCriterion(value).outcome).toBe("fail");
    value.reviews[1]!.timeZone = "America/New_York";
    expect(sourceAgreementHoursCriterion(value).outcome).toBe("unknown");
  });
  it("keeps contradictory reviews unknown rather than overriding a known saved source", () => {
    const value = input(); value.reviews = [alwaysOpen(value, "facebook")];
    value.facebook.hours = { mon_1_open: "09:00", mon_1_close: "18:00" };
    expect(sourceAgreementHoursCriterion(value)).toMatchObject({ outcome: "unknown", reason: "HOURS_REVIEW_CONTRADICTS_SAVED_SOURCE" });
    value.reviews = [review(value, "website"), review(value, "facebook")];
    value.reviews[0]!.hours!.mon = [];
    expect(sourceAgreementHoursCriterion(value)).toMatchObject({ outcome: "unknown", reason: "HOURS_REVIEW_CONTRADICTS_SAVED_SOURCE" });
  });
  it.each(["future", "stale", "expired", "different-report", "different-evidence", "duplicate"])("validates pinned always-open review provenance: %s", kind => {
    const value = input(); value.reviews = [alwaysOpen(value, "facebook")];
    switch (kind) {
      case "future": value.reviews[0]!.observedAt = "2026-12-01T00:00:00.000Z"; break;
      case "stale": value.reviews[0]!.observedAt = "2026-10-01T00:00:00.000Z"; break;
      case "expired": value.reviews[0]!.validFrom = "2026-10-01"; value.reviews[0]!.validUntil = "2026-10-31"; break;
      case "different-report": value.reviews[0]!.reportId = randomUUID(); break;
      case "different-evidence": value.reviews[0]!.evidenceIds = ["unknown"]; break;
      case "duplicate": value.reviews.push(value.reviews[0]!); break;
    }
    expect(sourceAgreementHoursCriterion(value).outcome).toBe("unknown");
  });
  it("allows null timezone only for explicit timezone-independent always-open reviews", () => {
    const value = input();
    expect(sourceHoursReviewSchema.safeParse(alwaysOpen(value, "facebook")).success).toBe(true);
    expect(sourceHoursReviewSchema.safeParse({ ...alwaysOpen(value, "facebook"), timeZone: "America/Los_Angeles" }).success).toBe(false);
    expect(sourceHoursReviewSchema.safeParse({ ...alwaysOpen(value, "facebook"), hours: weekly() }).success).toBe(false);
    expect(sourceHoursReviewSchema.safeParse({ ...review(value, "facebook"), timeZone: null }).success).toBe(false);
    expect(sourceHoursReviewSchema.safeParse({ ...review(value, "facebook", "confirmed-absent"), timeZone: null }).success).toBe(false);
  });
  it("does not silently apply source-agreement semantics to the legacy preferred-hours helper", () => {
    const value = input(); value.reviews = [alwaysOpen(value, "facebook")];
    expect(hoursConsistencyCriterion(value).outcome).toBe("unknown");
  });
});
