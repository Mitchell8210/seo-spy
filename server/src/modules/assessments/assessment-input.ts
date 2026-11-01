import { createHash } from "node:crypto";
import { z } from "zod";
import type { Business, Evidence } from "../../contracts/domain.js";
import type { FacebookField, FacebookReport } from "../../integrations/facebook/types.js";
import type { AuditReportRecord } from "../../reports/report.types.js";
import { ScoringInputError } from "../../scoring/calculator.js";
import { SCORE_POLICY } from "../../scoring/policy.js";
import type { ConfirmedRevision, ScoreAssessmentInput, ScoreCriterion, ScoreEvidenceRef, ScoreProfile, ScoreSource, SocialScoreInput } from "../../scoring/scoring.types.js";
import { confirmedFactsSchema, type ConfirmedScoringFacts } from "./confirmed-facts.js";

export interface AssessmentInputSelection { business: Business; website: AuditReportRecord | null; facebook: AuditReportRecord | null; cutoff: string; profile: ScoreProfile; facts: ConfirmedScoringFacts | null }
const profileFields = { "business-name": ["name"], description: ["about", "description"], "website-link": ["website"], "contact-route": ["phone", "emails"], category: ["category"] } as const;
const ids = Object.keys(profileFields) as (keyof typeof profileFields)[];
const entitySchema = z.object({ name: z.string().max(2048).nullable(), url: z.string().max(2048).nullable(), phone: z.string().max(2048).nullable(), hours: z.array(z.record(z.string(), z.string())).max(98).nullable() });
type Entity = z.infer<typeof entitySchema>;
const timestamp = (value: string) => z.string().datetime({ offset: true }).safeParse(value).success ? Date.parse(value) : Number.NaN;
const populated = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const normalizedName = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ");
const canonicalUrl = (value: unknown): string | null => {
  try { if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) return null; const url = new URL(value.trim()); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? url.href : null; } catch { return null; }
};
const fresh = (date: string, cutoff: string) => Number.isFinite(timestamp(date)) && timestamp(date) <= timestamp(cutoff) && timestamp(cutoff) - timestamp(date) <= SCORE_POLICY.maxSourceAgeMs;
const ref = (reportId: string, evidenceId: string): ScoreEvidenceRef => ({ reportId, evidenceId });
const revision = (facts: ConfirmedScoringFacts): ConfirmedRevision => ({ revision: facts.id, confirmedBy: facts.confirmedBy, confirmedAt: facts.createdAt });
function safeFacts(facts: ConfirmedScoringFacts | null, businessId: string, cutoff: string): ConfirmedScoringFacts | null {
  if (!facts) return null;
  const checked = confirmedFactsSchema.safeParse(facts);
  if (!checked.success || checked.data.businessId !== businessId || timestamp(checked.data.createdAt) > timestamp(cutoff)) throw new ScoringInputError("INVALID_CONFIRMED_FACTS");
  return checked.data;
}
function validateReport(record: AuditReportRecord, business: Business, provider: ScoreSource["provider"]) {
  if (record.schemaVersion !== "seo-spy.audit-report.v1" || record.business.id !== business.id || canonicalUrl(record.business.website) !== canonicalUrl(business.website)
    || record.reportId !== record.auditId || record.audit.id !== record.auditId || record.audit.businessId !== business.id || record.audit.mode !== "live"
    || !["completed", "partial"].includes(record.audit.status) || !record.results || (provider === "website" ? !["homepage", "lighthouse"].includes(record.audit.scope) : record.audit.scope !== "facebook" || !record.results.facebook)
    || record.results.evidence.some(item => item.auditId !== record.auditId || item.mode !== "live") || new Set(record.results.evidence.map(item => item.id)).size !== record.results.evidence.length) throw new ScoringInputError("SOURCE_MISMATCH");
}
function originalSource(record: AuditReportRecord, provider: ScoreSource["provider"], asset: string, collectedAt: string, synthetic: string[]): ScoreSource {
  return { reportId: record.reportId, reportHash: createHash("sha256").update(JSON.stringify(record)).digest("hex"), businessId: record.business.id,
    schemaVersion: record.schemaVersion, provider, mode: "live", asset, collectedAt,
    selectionReason: "Latest saved usable live report selected by business and channel; no collection was triggered.",
    evidenceIds: [...new Set([...record.results!.evidence.map(item => item.id), ...synthetic])] };
}
const fieldReady = (field: FacebookField | undefined, cutoff: string): field is FacebookField => !!field && field.status === "available" && fresh(field.collectedAt, cutoff);
function profileCriterion(id: keyof typeof profileFields, fb: FacebookReport, record: AuditReportRecord, facts: ConfirmedScoringFacts | null, cutoff: string): ScoreCriterion {
  const observed = profileFields[id].filter(name => {
    const field = fb.profile[name];
    if (!fieldReady(field, cutoff)) return false;
    if (id === "website-link") return canonicalUrl(field.value) !== null;
    if (id === "contact-route") {
      if (name === "emails") return Array.isArray(field.value) && field.value.some(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
      return populated(field.value) && /^[+\d\s().-]+$/.test(field.value) && field.value.replace(/\D/g, "").length >= 7 && field.value.replace(/\D/g, "").length <= 15;
    }
    return populated(field.value);
  });
  if (observed.length) return { id, outcome: "pass", confirmation: "observed", evidence: observed.map(name => ref(record.reportId, `facebook-profile:${name}`)) };
  const absence = facts?.values.profileAbsences.find(item => item.criterion === id && item.reportId === record.reportId);
  const supporting = absence?.evidenceIds.map(evidenceId => record.results!.evidence.find(item => item.id === evidenceId));
  // An aggregate description/contact absence must confirm each alternative, not only one API field.
  if (supporting && supporting.every((item): item is Evidence => !!item && fresh(item.collectedAt, cutoff)) && profileFields[id].every(name => supporting.some(item => item.checkId === `facebook:profile:${name}`))) {
    return { id, outcome: "fail", confirmation: "confirmed-absence", evidence: absence!.evidenceIds.map(evidenceId => ref(record.reportId, evidenceId)) };
  }
  return { id, outcome: "unknown", confirmation: "unconfirmed", evidence: [], reason: "API omission does not establish visible absence." };
}
function publishing(fb: FacebookReport, reportId: string, cutoff: string): SocialScoreInput["publishing"] {
  const end = timestamp(cutoff), start = end - 4 * SCORE_POLICY.periodMs;
  const dates = fb.posts.items.map(item => item.createdTime === null ? Number.NaN : timestamp(item.createdTime));
  const uniqueIds = new Set(fb.posts.items.map(item => item.id)).size === fb.posts.items.length;
  const trustworthyTimestamps = dates.every(date => Number.isFinite(date) && date <= end) && uniqueIds;
  const complete = fb.posts.status === "available" && fb.summary.postsInWindowComplete && !fb.posts.truncated && trustworthyTimestamps
    && timestamp(fb.window.since) <= start && timestamp(fb.window.until) >= end && fresh(fb.posts.collectedAt, cutoff);
  return { complete, truncated: fb.posts.truncated, trustworthyTimestamps, periods: [0, 1, 2, 3].map(index => {
    const periodStart = start + index * SCORE_POLICY.periodMs, periodEnd = periodStart + SCORE_POLICY.periodMs;
    return { startAt: new Date(periodStart).toISOString(), endAt: new Date(periodEnd).toISOString(), count: dates.filter(date => date >= periodStart && date < periodEnd).length,
      evidence: [ref(reportId, "facebook-posts")] };
  }) };
}
function entityFrom(record: AuditReportRecord, facts: ConfirmedScoringFacts, cutoff: string): { value: Entity; evidence: ScoreEvidenceRef[] } | null {
  const candidates: { value: Entity; evidence: ScoreEvidenceRef[] }[] = [];
  for (const item of record.results!.evidence.filter(item => item.checkId === "business-facts" && fresh(item.collectedAt, cutoff))) {
    const raw = item.observed.entities;
    if (typeof raw !== "string" || Buffer.byteLength(raw) > 65536) continue;
    try {
      const parsed = z.array(entitySchema).max(10).safeParse(JSON.parse(raw) as unknown);
      if (!parsed.success) continue;
      for (const value of parsed.data) {
        const names = [facts.values.preferred.name, ...facts.values.preferred.aliases].map(normalizedName);
        const urls = facts.values.preferred.websiteUrls.map(canonicalUrl);
        if (value.name && names.includes(normalizedName(value.name)) || value.url && urls.includes(canonicalUrl(value.url))) candidates.push({ value, evidence: [ref(record.reportId, item.id)] });
      }
    } catch { /* Malformed markup remains unknown, never a scored failure. */ }
  }
  const distinct = new Map<string, { value: Entity; evidence: ScoreEvidenceRef[] }>();
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate.value);
    const old = distinct.get(key);
    if (old) old.evidence.push(...candidate.evidence); else distinct.set(key, candidate);
  }
  return distinct.size === 1 ? [...distinct.values()][0] : null;
}
/** Explicit country context only; arbitrary digit strings and extensions are never equated. */
export function normalizeConfirmedPhone(value: unknown, country: ConfirmedScoringFacts["values"]["preferred"]["country"]): string | null {
  if (!populated(value)) return null;
  const raw = value.trim();
  if (country === "international") return /^\+[1-9]\d{6,14}$/.test(raw) ? raw : null;
  if (!/^\+?[\d\s().-]+$/.test(raw)) return null;
  const compact = raw.replace(/[\s().-]/g, "");
  const national = compact.startsWith("+1") ? compact.slice(2) : compact.startsWith("1") && compact.length === 11 ? compact.slice(1) : compact;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(national) ? `+1${national}` : null;
}
function comparison(id: string, website: string | null, facebook: string | null, approved: string[], evidence: ScoreEvidenceRef[]): ScoreCriterion & { applicable: boolean } {
  if (!website || !facebook) return { id, outcome: "unknown", confirmation: "unconfirmed", evidence, applicable: true, observations: { website, facebook }, reason: "Comparable observations are missing." };
  return { id, outcome: approved.includes(website) && approved.includes(facebook) ? "pass" : "fail", confirmation: "observed", evidence, applicable: true, observations: { website, facebook } };
}

/** Immutable saved-report adapter. Reads no providers and never creates business confirmations. */
export function buildAssessmentInput(selection: AssessmentInputSelection): ScoreAssessmentInput {
  const { business, website, facebook, cutoff, profile } = selection;
  if (!Number.isFinite(timestamp(cutoff))) throw new ScoringInputError("INVALID_SCORING_INPUT");
  const facts = safeFacts(selection.facts, business.id, cutoff);
  if (website) validateReport(website, business, "website");
  if (facebook) validateReport(facebook, business, "facebook");
  const lh = website?.results?.lighthouse;
  const fb = facebook?.results?.facebook;
  const bindings = website?.results?.evidence.filter(item => {
    if (!lh || item.checkId !== "collection" || !fresh(item.collectedAt, cutoff) || canonicalUrl(item.observed.requestedUrl) !== canonicalUrl(business.website)
      || canonicalUrl(item.observed.finalUrl) !== canonicalUrl(lh.requestedUrl) || canonicalUrl(item.sourceUrl) !== canonicalUrl(lh.requestedUrl)
      || canonicalUrl(lh.finalUrl) !== canonicalUrl(lh.requestedUrl) || !/^2\d\d$/.test(item.observed.status ?? "")) return false;
    if (canonicalUrl(lh.requestedUrl) === canonicalUrl(business.website)) return true;
    try { const chain: unknown = JSON.parse(item.observed.redirects ?? "null"); return Array.isArray(chain) && chain.length > 0 && chain.length <= 5 && chain.every(item => canonicalUrl(item) !== null) && canonicalUrl(chain.at(-1)) === canonicalUrl(lh.requestedUrl); } catch { return false; }
  }) ?? [];
  const sources: ScoreSource[] = [];
  if (website) sources.push(originalSource(website, "website", business.website, lh?.fetchedAt ?? website.results!.evidence[0]?.collectedAt ?? "unknown",
    lh ? lh.categories.map(item => `lighthouse-category:${item.id}`) : []));
  if (facebook && fb) sources.push(originalSource(facebook, "facebook", fb.pageId, fb.collectedAt, [...Object.keys(fb.profile).map(name => `facebook-profile:${name}`), "facebook-posts"]));
  const result: ScoreAssessmentInput = { businessId: business.id, cutoff, profile, expectedAssets: { websiteUrl: business.website, facebookPageId: fb?.pageId ?? null }, sources,
    website: website && lh ? { sourceReportId: website.reportId, auditId: website.auditId, requestedUrl: lh.requestedUrl, finalUrl: lh.finalUrl, strategy: lh.strategy, lighthouseVersion: lh.lighthouseVersion, fetchedAt: lh.fetchedAt,
      categories: lh.categories.map(item => ({ id: item.id, score: item.score, availability: item.availability })),
      ...(bindings.length === 1 ? { pageBinding: { requestedUrl: bindings[0]!.observed.requestedUrl!, finalUrl: bindings[0]!.observed.finalUrl!, evidence: ref(website.reportId, bindings[0]!.id) } } : {}) } : null,
    social: facebook && fb ? { sourceReportId: facebook.reportId, profile: ids.map(id => profileCriterion(id, fb, facebook, facts, cutoff)),
      goal: facts && facts.values.publishingTarget !== null ? { ...revision(facts), targetPostsPerPeriod: facts.values.publishingTarget } : null,
      publishing: publishing(fb, facebook.reportId, cutoff) } : null,
    consistency: null };
  if (website && facebook && fb && facts) {
    const selected = entityFrom(website, facts, cutoff);
    const profileValue = (name: string): string | null => fieldReady(fb.profile[name], cutoff) && populated(fb.profile[name].value) ? fb.profile[name].value as string : null;
    const evidence = (field: string) => [...selected?.evidence ?? [], ref(facebook.reportId, `facebook-profile:${field}`)];
    const preferred = facts.values.preferred;
    const names = [preferred.name, ...preferred.aliases].map(normalizedName);
    const urls = preferred.websiteUrls.map(canonicalUrl).filter((value): value is string => value !== null);
    const websiteName = selected?.value.name;
    const facebookName = profileValue("name");
    const websitePhone = normalizeConfirmedPhone(selected?.value.phone, preferred.country);
    const facebookPhone = normalizeConfirmedPhone(profileValue("phone"), preferred.country);
    const websiteUrl = canonicalUrl(selected?.value.url);
    const facebookUrl = canonicalUrl(profileValue("website"));
    result.consistency = { websiteReportId: website.reportId, facebookReportId: facebook.reportId, facts: revision(facts), applicability: preferred.hoursApplicable && preferred.phoneApplicable ? null : revision(facts), criteria: [
      comparison("business-name", websiteName ? normalizedName(websiteName) : null, facebookName ? normalizedName(facebookName) : null, names, evidence("name")),
      { ...comparison("phone", websitePhone, facebookPhone, preferred.phones, evidence("phone")), applicable: preferred.phoneApplicable },
      comparison("website-url", websiteUrl && urls.includes(canonicalUrl(business.website) ?? "") ? websiteUrl : null, facebookUrl, urls, evidence("website")),
      { id: "hours", outcome: "unknown", confirmation: "unconfirmed", applicable: preferred.hoursApplicable, evidence: [...selected?.evidence ?? []], reason: "Facebook source timezone and comparable date scope are not recorded; preferred timezone alone is not an observed source timezone." },
    ] };
  }
  return result;
}
