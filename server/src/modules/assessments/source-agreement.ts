import { z } from "zod";
import type { Business } from "../../contracts/domain.js";
import type { AuditReportRecord } from "../../reports/report.types.js";
import type { ConsistencyScoreInput, ScoreCriterion, ScoreEvidenceRef } from "../../scoring/scoring.types.js";
import type { SourceAgreementFacts } from "./confirmed-facts.js";
import { mergeWebsiteBusinessFacts, normalizeBusinessName, sourceAgreementHoursCriterion } from "./consistency-evidence.js";

const url = (value: unknown): string | null => { try { if (typeof value !== "string") return null; const parsed = new URL(value.trim()); return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash ? parsed.href : null; } catch { return null; } };
const fresh = (value: string, cutoff: string) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(cutoff) && Date.parse(cutoff) - Date.parse(value) <= 7 * 86400000;
const entity = z.object({ name: z.string().max(2048).nullable(), url: z.string().max(2048).nullable(), phone: z.string().max(2048).nullable(), hours: z.array(z.record(z.string(), z.string())).max(98).nullable() });
const phone = (value: unknown, country: SourceAgreementFacts["values"]["country"]): string | null => {
  if (typeof value !== "string" || !/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  const compact = value.trim().replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{6,14}$/.test(compact)) return compact;
  if (country === "international") return null;
  const national = compact.length === 11 && compact.startsWith("1") ? compact.slice(1) : compact;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(national) ? `+1${national}` : null;
};

/** Agreement compares observations; it never chooses an authoritative business name. */
export function buildSourceAgreement(business: Business, website: AuditReportRecord, facebook: AuditReportRecord, facts: SourceAgreementFacts, cutoff: string): ConsistencyScoreInput {
  const revision = { revision: facts.id, confirmedBy: facts.confirmedBy, confirmedAt: facts.createdAt, sourceAttestation: { websiteReportId: facts.values.websiteReportId, facebookReportId: facts.values.facebookReportId } };
  const allowedUrls = new Set([url(business.website)]);
  for (const item of website.results!.evidence) {
    if (item.checkId !== "collection" || !fresh(item.collectedAt, cutoff) || url(item.observed.requestedUrl) !== url(business.website) || !/^2\d\d$/.test(item.observed.status ?? "")) continue;
    const final = url(item.observed.finalUrl);
    try {
      const redirects: unknown = JSON.parse(item.observed.redirects ?? "[]");
      if (final && final === url(item.sourceUrl) && (final === url(business.website) || Array.isArray(redirects) && redirects.length > 0 && redirects.length <= 5 && redirects.every(item => url(item) !== null) && url(redirects.at(-1)) === final)) allowedUrls.add(final);
    } catch { /* Unverified aliases remain untrusted. */ }
  }
  const candidates = website.results!.evidence.flatMap(item => {
    if (item.checkId !== "business-facts" || !fresh(item.collectedAt, cutoff) || typeof item.observed.entities !== "string" || Buffer.byteLength(item.observed.entities) > 65536) return [];
    try {
      const parsed = z.array(entity).max(10).safeParse(JSON.parse(item.observed.entities));
      return parsed.success ? parsed.data.filter(value => value.url && allowedUrls.has(url(value.url))).map(value => ({ value, evidence: [{ reportId: website.reportId, evidenceId: item.id }] })) : [];
    } catch { return []; }
  });
  const observed = mergeWebsiteBusinessFacts(candidates);
  const fb = facebook.results!.facebook!;
  const field = (name: string): string | null => { const value = fb.profile[name]; return value?.status === "available" && typeof value.value === "string" && value.value.trim() && fresh(value.collectedAt, cutoff) ? value.value : null; };
  const refs = (name: string): ScoreEvidenceRef[] => [...observed?.evidence ?? [], ...facebook.results!.evidence.filter(item => item.checkId === `facebook:profile:${name}` && fresh(item.collectedAt, cutoff)).map(item => ({ reportId: facebook.reportId, evidenceId: item.id }))];
  const compare = (id: string, left: string | null, right: string | null, evidence: ScoreEvidenceRef[], normalize = (value: string) => value): ScoreCriterion & { applicable: true } => ({ id, applicable: true,
    outcome: left && right ? normalize(left) === normalize(right) ? "pass" : "fail" : "unknown", confirmation: left && right ? "observed" : "unconfirmed", evidence, observations: { website: left, facebook: right } });
  const hours = sourceAgreementHoursCriterion({ businessId: business.id, cutoff,
    website: { report: website, evidenceRefs: observed?.evidence ?? [], hours: observed?.value.hours ?? null },
    facebook: { report: facebook, evidenceRefs: facebook.results!.evidence.filter(item => item.checkId === "facebook:profile:hours").map(item => ({ reportId: facebook.reportId, evidenceId: item.id })), hours: fb.profile.hours?.status === "available" ? fb.profile.hours.value : null },
    reviews: facts.values.sourceReviews });
  return { comparisonMode: "source-agreement", websiteReportId: website.reportId, facebookReportId: facebook.reportId, facts: revision, applicability: null, criteria: [
    compare("business-name", observed?.value.name ?? null, field("name"), refs("name"), value => normalizeBusinessName(value).toLocaleLowerCase("en-US")),
    compare("phone", phone(observed?.value.phone, facts.values.country), phone(field("phone"), facts.values.country), refs("phone")),
    compare("website-url", url(observed?.value.url), url(field("website")), refs("website")), hours,
  ] };
}
