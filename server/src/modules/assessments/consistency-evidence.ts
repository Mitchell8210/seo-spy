import { z } from "zod";
import type { WebsiteBusinessEntity } from "../../integrations/website/business-facts.js";
import type { AuditReportRecord } from "../../reports/report.types.js";
import { SCORE_POLICY } from "../../scoring/policy.js";
import type { ScoreCriterion, ScoreEvidenceRef } from "../../scoring/scoring.types.js";

export const consistencyWeekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type ConsistencyWeekday = typeof consistencyWeekdays[number];
export interface HoursInterval { opens: string; closes: string }
export type WeeklyHours = Record<ConsistencyWeekday, HoursInterval[]>;
/** Null means unknown. An empty array means explicitly confirmed closed, never an omitted day. */
export type WeeklyHoursObservation = Record<ConsistencyWeekday, HoursInterval[] | null>;
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const interval = z.object({ opens: clock, closes: clock }).strict().refine(value => value.opens < value.closes, { message: "Overnight or zero-length intervals need a separately supported contract." });
const dayHours = z.array(interval).max(2).refine(values => {
  const sorted = [...values].sort((a, b) => a.opens.localeCompare(b.opens));
  return sorted.every((value, index) => index === 0 || sorted[index - 1]!.closes <= value.opens);
}, { message: "Intervals must not overlap." });
export const weeklyHoursSchema = z.object({ mon: dayHours, tue: dayHours, wed: dayHours, thu: dayHours, fri: dayHours, sat: dayHours, sun: dayHours }).strict();
const timeZone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value);
export const sourceHoursReviewSchema = z.object({
  provider: z.enum(["website", "facebook"]), reportId: z.string().uuid(), evidenceIds: z.array(z.string().min(1).max(160)).min(1).max(8),
  field: z.literal("hours"), state: z.enum(["present", "confirmed-absent", "always-open"]), timeZone: timeZone.nullable(),
  observedAt: z.string().datetime({ offset: true }), validFrom: date, validUntil: date.optional(), hours: weeklyHoursSchema.nullable(), notes: z.string().trim().min(10).max(500),
}).strict().superRefine((review, context) => {
  if (review.state === "present" ? review.hours === null : review.hours !== null) context.addIssue({ code: "custom", message: "Presence requires a complete observed week; confirmed absence and always-open require null hours." });
  if (review.state === "always-open" ? review.timeZone !== null : review.timeZone === null) context.addIssue({ code: "custom", message: "Only always-open is timezone independent and must use null timezone." });
  if (review.validUntil && review.validUntil < review.validFrom) context.addIssue({ code: "custom", message: "The source date scope must not end before it starts." });
  if (new Set(review.evidenceIds).size !== review.evidenceIds.length) context.addIssue({ code: "custom", message: "Source review references must be unique." });
});
export type SourceHoursReview = z.infer<typeof sourceHoursReviewSchema>;
export interface BusinessFactCandidate { value: WebsiteBusinessEntity; evidence: ScoreEvidenceRef[] }

/** Decode one layer only. Equal-looking brand/host aliases are never invented here. */
export function normalizeBusinessName(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d{1,7}|#x[\da-f]{1,6});/gi, entity => {
    const key = entity.slice(1, -1).toLowerCase();
    if (named[key] !== undefined) return named[key];
    const point = key.startsWith("#x") ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  }).normalize("NFC").trim().replace(/\s+/g, " ");
}
function canonicalUrl(value: string | null): string | null {
  try {
    if (!value || /[\r\n]/.test(value)) return null;
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}
const dayNames: Record<string, ConsistencyWeekday> = { monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun", mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat", sun: "sun" };
const emptyWeek = (): WeeklyHoursObservation => ({ mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null });
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function sortedIntervals(values: HoursInterval[]): HoursInterval[] | null {
  const unique = [...new Map(values.map(value => [JSON.stringify(value), value])).values()].sort((a, b) => a.opens.localeCompare(b.opens));
  return dayHours.safeParse(unique).success ? unique : null;
}

/** No missing-day-to-closed conversion. Only explicit seven-day reviews can fill unknown days. */
export function normalizeWeeklyHours(value: unknown, format: "schema-org" | "facebook" | "weekly" = "weekly"): WeeklyHoursObservation | null {
  if (format === "weekly") {
    const parsed = weeklyHoursSchema.safeParse(value);
    return parsed.success ? Object.fromEntries(consistencyWeekdays.map(day => [day, sortedIntervals(parsed.data[day])])) as WeeklyHoursObservation : null;
  }
  const result = emptyWeek();
  if (format === "schema-org") {
    if (!Array.isArray(value) || value.length > 98) return null;
    for (const raw of value) {
      const rule = object(raw);
      if (!rule || typeof rule.day !== "string") return null;
      const day = dayNames[rule.day.replace(/^https?:\/\/schema\.org\//i, "").toLowerCase()];
      const parsed = interval.safeParse({ opens: rule.opens, closes: rule.closes });
      if (!day || !parsed.success) return null;
      const hours = sortedIntervals([...(result[day] ?? []), parsed.data]);
      if (!hours) return null;
      result[day] = hours;
    }
    return result;
  }
  const fields = object(value);
  if (!fields || Object.keys(fields).some(key => !/^(?:mon|tue|wed|thu|fri|sat|sun)_[12]_(?:open|close)$/.test(key))) return null;
  for (const day of consistencyWeekdays) {
    const intervals: HoursInterval[] = [];
    for (const index of [1, 2]) {
      const opens = fields[`${day}_${index}_open`], closes = fields[`${day}_${index}_close`];
      if (opens === undefined && closes === undefined) continue;
      const parsed = interval.safeParse({ opens, closes });
      if (!parsed.success) return null;
      intervals.push(parsed.data);
    }
    if (intervals.length) result[day] = sortedIntervals(intervals);
    if (intervals.length && result[day] === null) return null;
  }
  return result;
}
/** Human-readable source values only; arithmetic/comparison continues to use normalized intervals. */
export function formatWeeklyHours(hours: WeeklyHoursObservation | null, observedTimeZone?: string): string {
  if (!hours) return "Not available";
  const labels: Record<ConsistencyWeekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  const days = consistencyWeekdays.map(day => {
    const spans = hours[day];
    return `${labels[day]} ${spans === null ? "Unknown" : spans.length ? spans.map(span => `${span.opens}–${span.closes}`).join(", ") : "Closed"}`;
  }).join("; ");
  return observedTimeZone && canonicalZone(observedTimeZone) ? `${days} · ${observedTimeZone}` : days;
}
function mergeRawHours(left: WebsiteBusinessEntity["hours"], right: WebsiteBusinessEntity["hours"]): { ok: boolean; hours: WebsiteBusinessEntity["hours"] } {
  if (!left?.length) return { ok: true, hours: right ? structuredClone(right) : left ? [] : null };
  if (!right?.length) return { ok: true, hours: structuredClone(left) };
  const a = normalizeWeeklyHours(left, "schema-org"), b = normalizeWeeklyHours(right, "schema-org");
  if (!a || !b) return { ok: false, hours: null };
  const hours: Record<string, string>[] = [];
  for (const day of consistencyWeekdays) {
    if (a[day] && b[day] && JSON.stringify(a[day]) !== JSON.stringify(b[day])) return { ok: false, hours: null };
    for (const span of a[day] ?? b[day] ?? []) hours.push({ day, opens: span.opens, closes: span.closes });
  }
  return { ok: true, hours };
}
/** Merge duplicate markup only when both names and canonical URLs establish one identity. */
export function mergeWebsiteBusinessFacts(candidates: BusinessFactCandidate[]): BusinessFactCandidate | null {
  if (!candidates.length || candidates.length > 100) return null;
  let merged: BusinessFactCandidate | null = null;
  for (const candidate of candidates) {
    if (!merged) { merged = structuredClone(candidate); if (merged.value.name) merged.value.name = normalizeBusinessName(merged.value.name); continue; }
    const left: WebsiteBusinessEntity = merged.value, right: WebsiteBusinessEntity = candidate.value;
    if (!left.name || !right.name || normalizeBusinessName(left.name) !== normalizeBusinessName(right.name)
      || !canonicalUrl(left.url) || canonicalUrl(left.url) !== canonicalUrl(right.url)) return null;
    if (left.phone?.trim() && right.phone?.trim() && left.phone.trim() !== right.phone.trim()) return null;
    const hours = mergeRawHours(left.hours, right.hours);
    if (!hours.ok) return null;
    merged = { value: { name: normalizeBusinessName(left.name), url: canonicalUrl(left.url), phone: left.phone?.trim() || right.phone?.trim() || null, hours: hours.hours },
      evidence: [...new Map([...merged.evidence, ...candidate.evidence].map(ref => [JSON.stringify([ref.reportId, ref.evidenceId]), ref])).values()] };
  }
  return merged;
}

export interface HoursEvidenceSource { report: AuditReportRecord; evidenceRefs: ScoreEvidenceRef[]; hours: unknown }
export interface HoursConsistencyInput {
  businessId: string; cutoff: string; preferredHours: WeeklyHours | null; preferredTimeZone: string;
  website: HoursEvidenceSource; facebook: HoursEvidenceSource; reviews: SourceHoursReview[];
}
type HoursCriterion = ScoreCriterion & { applicable: true; observations: { website: string | null; facebook: string | null } };
const stamp = (value: string) => z.string().datetime({ offset: true }).safeParse(value).success ? Date.parse(value) : Number.NaN;
const fresh = (value: string, cutoff: string) => Number.isFinite(stamp(value)) && stamp(value) <= stamp(cutoff) && stamp(cutoff) - stamp(value) <= SCORE_POLICY.maxSourceAgeMs;
function canonicalZone(value: string): string | null { try { return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone; } catch { return null; } }
function localDate(value: string, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function sourceValid(source: HoursEvidenceSource, provider: "website" | "facebook", businessId: string, cutoff: string): boolean {
  const report = source.report;
  if (report.schemaVersion !== "seo-spy.audit-report.v1" || report.business.id !== businessId || report.audit.businessId !== businessId || report.audit.id !== report.reportId || report.auditId !== report.reportId
    || report.audit.mode !== "live" || !["completed", "partial"].includes(report.audit.status) || !report.results
    || (provider === "facebook" ? report.audit.scope !== "facebook" : !["homepage", "lighthouse"].includes(report.audit.scope)) || !source.evidenceRefs.length) return false;
  return source.evidenceRefs.every(ref => ref.reportId === report.reportId && report.results!.evidence.some(item => item.id === ref.evidenceId && item.auditId === report.auditId && item.mode === "live" && fresh(item.collectedAt, cutoff)
    && (provider === "facebook" ? item.checkId === "facebook:profile:hours" : item.checkId === "business-facts")));
}
type ZonedHoursReview = Omit<SourceHoursReview, "state" | "timeZone"> & { state: "present" | "confirmed-absent"; timeZone: string };
function reviewed(source: HoursEvidenceSource, provider: "website" | "facebook", input: HoursConsistencyInput): ZonedHoursReview | null {
  const candidates = input.reviews.filter(review => review.reportId === source.report.reportId && review.provider === provider && review.field === "hours");
  if (candidates.length !== 1) return null;
  const parsed = sourceHoursReviewSchema.safeParse(candidates[0]);
  if (!parsed.success) return null;
  const review = parsed.data;
  if (review.state === "always-open" || review.timeZone === null) return null;
  if (!fresh(review.observedAt, input.cutoff) || canonicalZone(review.timeZone) !== canonicalZone(input.preferredTimeZone)) return null;
  const date = localDate(input.cutoff, review.timeZone);
  if (review.validFrom > date || review.validUntil && review.validUntil < date) return null;
  if (!sourceValid({ ...source, evidenceRefs: review.evidenceIds.map(evidenceId => ({ reportId: review.reportId, evidenceId })) }, provider, input.businessId, input.cutoff)) return null;
  return { ...review, state: review.state, timeZone: review.timeZone };
}
function anyKnown(hours: WeeklyHoursObservation | null): boolean { return !!hours && consistencyWeekdays.some(day => hours[day] !== null); }
function compatible(raw: WeeklyHoursObservation | null, observed: WeeklyHoursObservation): boolean {
  return !raw || consistencyWeekdays.every(day => raw[day] === null || JSON.stringify(raw[day]) === JSON.stringify(observed[day]));
}

/** Explicit operator source attestations remain separate evidence; API omissions alone never fail a criterion. */
export function hoursConsistencyCriterion(input: HoursConsistencyInput): HoursCriterion {
  const refs = [...new Map([...input.website.evidenceRefs, ...input.facebook.evidenceRefs].map(ref => [JSON.stringify([ref.reportId, ref.evidenceId]), ref])).values()];
  const unknown = (reason: string): HoursCriterion => ({ id: "hours", outcome: "unknown", confirmation: "unconfirmed", applicable: true, evidence: refs, observations: { website: null, facebook: null }, reason });
  if (!Number.isFinite(stamp(input.cutoff)) || !canonicalZone(input.preferredTimeZone) || !weeklyHoursSchema.safeParse(input.preferredHours).success) return unknown("CONFIRMED_HOURS_REQUIRED");
  if (input.website.report.reportId === input.facebook.report.reportId || !sourceValid(input.website, "website", input.businessId, input.cutoff) || !sourceValid(input.facebook, "facebook", input.businessId, input.cutoff)) return unknown("HOURS_SOURCE_MISMATCH");
  const websiteRaw = normalizeWeeklyHours(input.website.hours, "schema-org"), facebookRaw = normalizeWeeklyHours(input.facebook.hours, "facebook");
  const websiteReview = reviewed(input.website, "website", input), facebookReview = reviewed(input.facebook, "facebook", input);
  const reviews = [websiteReview, facebookReview];
  for (const review of reviews) for (const evidenceId of review?.evidenceIds ?? []) {
    if (!refs.some(ref => ref.reportId === review!.reportId && ref.evidenceId === evidenceId)) refs.push({ reportId: review!.reportId, evidenceId });
  }
  const raw = [websiteRaw, facebookRaw];
  for (let index = 0; index < 2; index++) {
    const review = reviews[index];
    if (review?.state !== "confirmed-absent") continue;
    if (anyKnown(raw[index])) return unknown("HOURS_REVIEW_CONTRADICTS_SAVED_SOURCE");
    const other = reviews[1 - index];
    if (!anyKnown(raw[1 - index]) && !other) return unknown("HOURS_OTHER_SOURCE_UNKNOWN");
    return { id: "hours", outcome: "fail", confirmation: "confirmed-absence", applicable: true, evidence: refs,
      observations: {
        website: websiteReview?.state === "confirmed-absent" ? `Confirmed absent in operator source review · ${websiteReview.timeZone}` : formatWeeklyHours(websiteReview?.hours ? normalizeWeeklyHours(websiteReview.hours) : websiteRaw, websiteReview?.timeZone),
        facebook: facebookReview?.state === "confirmed-absent" ? `Confirmed absent in operator source review · ${facebookReview.timeZone}` : formatWeeklyHours(facebookReview?.hours ? normalizeWeeklyHours(facebookReview.hours) : facebookRaw, facebookReview?.timeZone),
      },
      reason: "REQUIRED_HOURS_CONFIRMED_ABSENT_BY_OPERATOR_SOURCE_REVIEW" };
  }
  if (!websiteReview || !facebookReview || websiteReview.state !== "present" || facebookReview.state !== "present") return unknown("SOURCE_HOURS_REVIEW_REQUIRED");
  const website = normalizeWeeklyHours(websiteReview.hours), facebook = normalizeWeeklyHours(facebookReview.hours), preferred = normalizeWeeklyHours(input.preferredHours);
  if (!website || !facebook || !preferred || !compatible(websiteRaw, website) || !compatible(facebookRaw, facebook)) return unknown("HOURS_REVIEW_CONTRADICTS_SAVED_SOURCE");
  const matches = JSON.stringify(website) === JSON.stringify(preferred) && JSON.stringify(facebook) === JSON.stringify(preferred);
  return { id: "hours", outcome: matches ? "pass" : "fail", confirmation: "observed", applicable: true, evidence: refs,
    observations: { website: formatWeeklyHours(website, websiteReview.timeZone), facebook: formatWeeklyHours(facebook, facebookReview.timeZone) }, reason: "EXPLICIT_OPERATOR_REVIEW_WITH_MATCHING_TIMEZONE_AND_DATE_SCOPE" };
}

export interface SourceAgreementHoursInput {
  businessId: string; cutoff: string; website: HoursEvidenceSource; facebook: HoursEvidenceSource; reviews: SourceHoursReview[];
}
/** Always-open scopes use UTC calendar dates; they carry no invented local timezone or clipped 24:00 intervals. */
function agreementReview(source: HoursEvidenceSource, provider: "website" | "facebook", input: SourceAgreementHoursInput): SourceHoursReview | null {
  const candidates = input.reviews.filter(review => review.reportId === source.report.reportId && review.provider === provider && review.field === "hours");
  if (candidates.length !== 1) return null;
  const parsed = sourceHoursReviewSchema.safeParse(candidates[0]);
  if (!parsed.success || !fresh(parsed.data.observedAt, input.cutoff)) return null;
  const review = parsed.data;
  const date = localDate(input.cutoff, review.timeZone ?? "UTC");
  if (review.validFrom > date || review.validUntil && review.validUntil < date) return null;
  if (!sourceValid({ ...source, evidenceRefs: review.evidenceIds.map(evidenceId => ({ reportId: review.reportId, evidenceId })) }, provider, input.businessId, input.cutoff)) return null;
  return review;
}
const restricted = (hours: WeeklyHoursObservation | null): boolean => !!hours && consistencyWeekdays.some(day => hours[day] !== null);

/** Compare recorded source claims only; an agreement is not a claim that either source is correct. */
export function sourceAgreementHoursCriterion(input: SourceAgreementHoursInput): HoursCriterion {
  const evidence = [...new Map([...input.website.evidenceRefs, ...input.facebook.evidenceRefs].map(ref => [JSON.stringify([ref.reportId, ref.evidenceId]), ref])).values()];
  const unknown = (reason: string): HoursCriterion => ({ id: "hours", outcome: "unknown", confirmation: "unconfirmed", applicable: true, evidence, observations: { website: null, facebook: null }, reason });
  if (!Number.isFinite(stamp(input.cutoff)) || input.website.report.reportId === input.facebook.report.reportId
    || !sourceValid(input.website, "website", input.businessId, input.cutoff) || !sourceValid(input.facebook, "facebook", input.businessId, input.cutoff)) return unknown("HOURS_SOURCE_MISMATCH");
  const websiteRaw = normalizeWeeklyHours(input.website.hours, "schema-org"), facebookRaw = normalizeWeeklyHours(input.facebook.hours, "facebook");
  const websiteReview = agreementReview(input.website, "website", input), facebookReview = agreementReview(input.facebook, "facebook", input);
  for (const review of [websiteReview, facebookReview]) for (const evidenceId of review?.evidenceIds ?? []) {
    if (!evidence.some(ref => ref.reportId === review!.reportId && ref.evidenceId === evidenceId)) evidence.push({ reportId: review!.reportId, evidenceId });
  }
  if (websiteReview?.state === "always-open" && anyKnown(websiteRaw) || facebookReview?.state === "always-open" && anyKnown(facebookRaw)) return unknown("HOURS_REVIEW_CONTRADICTS_SAVED_SOURCE");
  if (websiteReview?.state === "always-open" && facebookReview?.state === "always-open") return {
    id: "hours", outcome: "pass", confirmation: "observed", applicable: true, evidence,
    observations: { website: "Always open (operator reviewed)", facebook: "Always open (operator reviewed)" }, reason: "SOURCE_HOURS_AGREE_ALWAYS_OPEN" };
  const websiteObserved = websiteReview?.state === "present" ? normalizeWeeklyHours(websiteReview.hours) : websiteRaw;
  const facebookObserved = facebookReview?.state === "present" ? normalizeWeeklyHours(facebookReview.hours) : facebookRaw;
  if (websiteReview?.state === "present" && (!websiteObserved || !compatible(websiteRaw, websiteObserved))
    || facebookReview?.state === "present" && (!facebookObserved || !compatible(facebookRaw, facebookObserved))) return unknown("HOURS_REVIEW_CONTRADICTS_SAVED_SOURCE");
  if (websiteReview?.state === "always-open" && facebookReview?.state !== "confirmed-absent" && restricted(facebookObserved)
    || facebookReview?.state === "always-open" && websiteReview?.state !== "confirmed-absent" && restricted(websiteObserved)) return {
    id: "hours", outcome: "fail", confirmation: "observed", applicable: true, evidence,
    observations: {
      website: websiteReview?.state === "always-open" ? "Always open (operator reviewed)" : formatWeeklyHours(websiteObserved, websiteReview?.timeZone ?? undefined),
      facebook: facebookReview?.state === "always-open" ? "Always open (operator reviewed)" : formatWeeklyHours(facebookObserved, facebookReview?.timeZone ?? undefined),
    }, reason: "SOURCE_HOURS_ALWAYS_OPEN_VS_RESTRICTED" };
  if (!websiteReview || !facebookReview || websiteReview.state !== "present" || facebookReview.state !== "present"
    || websiteReview.timeZone === null || facebookReview.timeZone === null || canonicalZone(websiteReview.timeZone) !== canonicalZone(facebookReview.timeZone)) return unknown("COMPARABLE_SOURCE_HOURS_REQUIRED");
  if (!websiteObserved || !facebookObserved) return unknown("COMPARABLE_SOURCE_HOURS_REQUIRED");
  return { id: "hours", outcome: JSON.stringify(websiteObserved) === JSON.stringify(facebookObserved) ? "pass" : "fail", confirmation: "observed", applicable: true, evidence,
    observations: { website: formatWeeklyHours(websiteObserved, websiteReview.timeZone), facebook: formatWeeklyHours(facebookObserved, facebookReview.timeZone) }, reason: "SOURCE_HOURS_COMPARED_WITH_MATCHING_TIMEZONE_AND_DATE_SCOPE" };
}
