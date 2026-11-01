import { z } from "zod";

const DAY = 86400000;
const MAX_PAGES = 4;
const PAGE_SIZE = 25;
const reasons = ["complete", "page-limit", "cursor-unavailable", "cursor-loop", "page-size-exceeded", "invalid-response", "request-failed", "aborted", "duplicate-post", "invalid-timestamp", "out-of-window"] as const;
const iso = z.string().datetime();
export const facebookPostCoverageSchema = z.object({
  version: z.literal("facebook-post-coverage-v1"), kind: z.literal("queried-window"), since: iso, until: iso, observedAt: iso,
  complete: z.boolean(), exhausted: z.boolean(), reason: z.enum(reasons),
  pagesRead: z.number().int().min(0).max(MAX_PAGES), maxPages: z.literal(MAX_PAGES), itemsLimit: z.literal(MAX_PAGES * PAGE_SIZE),
  ignoredOutOfWindow: z.number().int().min(0).max(MAX_PAGES * PAGE_SIZE), duplicateIds: z.number().int().min(0).max(MAX_PAGES * PAGE_SIZE), invalidTimestamps: z.number().int().min(0).max(MAX_PAGES * PAGE_SIZE),
}).strict().superRefine((value, context) => {
  const since = Date.parse(value.since), until = Date.parse(value.until), observed = Date.parse(value.observedAt);
  if (until - since !== 28 * DAY || until % DAY !== 0 || until > observed || observed >= until + DAY
    || value.complete && (!value.exhausted || value.reason !== "complete" || value.pagesRead === 0 || value.ignoredOutOfWindow || value.duplicateIds || value.invalidTimestamps)
    || !value.complete && value.reason === "complete") context.addIssue({ code: "custom", message: "Incompatible publishing coverage proof." });
});
export type FacebookPostCoverage = z.infer<typeof facebookPostCoverageSchema>;
export interface FacebookWindowPost { id: string; message: string | null; createdTime: string | null; url: string }
export interface FacebookPostWindow {
  status: "available" | "unavailable";
  items: FacebookWindowPost[];
  truncated: boolean;
  collectedAt: string;
  coverage: FacebookPostCoverage;
  failureCode?: string;
}
type RequestPosts = (path: string, params: Record<string, string>) => Promise<unknown>;
const batchSchema = z.object({
  data: z.array(z.object({ id: z.string().regex(/^\d+_\d+$/), message: z.string().max(100000).optional(), created_time: z.unknown().optional() })).max(100),
  paging: z.object({ next: z.string().max(32768).optional(), cursors: z.object({ after: z.string().min(1).max(4096).optional() }).optional() }).optional(),
});
const normalizedTimestamp = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > 64) return null;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  if (!z.string().datetime({ offset: true }).safeParse(normalized).success || !Number.isFinite(Date.parse(normalized))) return null;
  return new Date(normalized).toISOString();
};

/** Four complete UTC weeks; collection time is not the reporting cutoff. */
export function facebookPublishingWindow(observedAt: string): { since: string; until: string } {
  if (!iso.safeParse(observedAt).success) throw new Error("A valid UTC collection time is required.");
  const until = Math.floor(Date.parse(observedAt) / DAY) * DAY;
  return { since: new Date(until - 28 * DAY).toISOString(), until: new Date(until).toISOString() };
}

/** Explicit filtered read only. Never follows paging URLs, assumes sort order, or retries a failed request. */
export async function collectFacebookPostWindow(request: RequestPosts, pageId: string, observedAt: string, signal?: AbortSignal): Promise<FacebookPostWindow> {
  if (!/^\d+$/.test(pageId)) throw new Error("A numeric Facebook Page identity is required.");
  const window = facebookPublishingWindow(observedAt);
  const proof: FacebookPostCoverage = { version: "facebook-post-coverage-v1", kind: "queried-window", ...window, observedAt,
    complete: false, exhausted: false, reason: "page-limit", pagesRead: 0, maxPages: MAX_PAGES, itemsLimit: MAX_PAGES * PAGE_SIZE,
    ignoredOutOfWindow: 0, duplicateIds: 0, invalidTimestamps: 0 };
  const result: FacebookPostWindow = { status: "available", items: [], truncated: true, collectedAt: observedAt, coverage: proof };
  const seen = new Set<string>(); const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let raw: unknown;
    try {
      signal?.throwIfAborted();
      raw = await request(`${pageId}/posts`, { fields: "id,message,created_time", limit: String(PAGE_SIZE), since: String(Date.parse(window.since) / 1000), until: String(Date.parse(window.until) / 1000), ...(cursor ? { after: cursor } : {}) });
      signal?.throwIfAborted();
    } catch {
      proof.reason = signal?.aborted ? "aborted" : "request-failed";
      result.status = "unavailable"; result.failureCode = signal?.aborted ? "POST_WINDOW_ABORTED" : "POST_WINDOW_REQUEST_FAILED";
      break;
    }
    const parsed = batchSchema.safeParse(raw);
    if (!parsed.success || parsed.data.data.some(item => !item.id.startsWith(`${pageId}_`))) {
      proof.reason = "invalid-response"; result.status = "unavailable"; result.failureCode = "POST_WINDOW_INVALID_RESPONSE"; break;
    }
    const list = parsed.data; proof.pagesRead++;
    for (const post of list.data.slice(0, PAGE_SIZE)) {
      if (seen.has(post.id)) { proof.duplicateIds++; continue; }
      seen.add(post.id);
      const createdTime = normalizedTimestamp(post.created_time);
      if (createdTime === null) proof.invalidTimestamps++;
      else if (Date.parse(createdTime) < Date.parse(window.since) || Date.parse(createdTime) >= Date.parse(window.until)) { proof.ignoredOutOfWindow++; continue; }
      result.items.push({ id: post.id, message: post.message ?? null, createdTime, url: `https://www.facebook.com/${post.id}` });
    }
    if (list.data.length > PAGE_SIZE) { proof.reason = "page-size-exceeded"; break; }
    if (!list.paging?.next) {
      proof.exhausted = true;
      proof.reason = proof.invalidTimestamps ? "invalid-timestamp" : proof.duplicateIds ? "duplicate-post" : proof.ignoredOutOfWindow ? "out-of-window" : "complete";
      proof.complete = proof.reason === "complete";
      break;
    }
    const after = list.paging.cursors?.after;
    if (!after) { proof.reason = "cursor-unavailable"; break; }
    if (cursors.has(after)) { proof.reason = "cursor-loop"; break; }
    cursors.add(after); cursor = after;
  }
  result.truncated = !proof.complete;
  return result;
}

export interface VerifiedPublishingCoverage { complete: boolean; reason: string; periods: { startAt: string; endAt: string; count: number }[] }
const storedPostsSchema = z.object({ status: z.literal("available"), items: z.array(z.object({ id: z.string().regex(/^\d+_\d+$/), message: z.string().max(100000).nullable(), createdTime: iso.nullable(), url: z.string().url() })).max(MAX_PAGES * PAGE_SIZE),
  truncated: z.literal(false), collectedAt: iso, coverage: facebookPostCoverageSchema });

/** Saved proof and actual saved evidence must agree; legacy samples never prove zero activity. */
export function verifyFacebookPostCoverage(posts: unknown, observedEvidence: Record<string, string> | null, reportingCutoff: string, assessmentCutoff: string): VerifiedPublishingCoverage {
  const unavailable = (reason: string): VerifiedPublishingCoverage => ({ complete: false, reason, periods: [] });
  const parsed = storedPostsSchema.safeParse(posts);
  if (!parsed.success) return unavailable("MISSING_OR_INCOMPLETE_POST_COVERAGE");
  const { coverage, items } = parsed.data;
  if (!coverage.complete || !coverage.exhausted || !iso.safeParse(reportingCutoff).success || !iso.safeParse(assessmentCutoff).success
    || coverage.until !== reportingCutoff || parsed.data.collectedAt !== coverage.observedAt || Date.parse(coverage.observedAt) > Date.parse(assessmentCutoff)) return unavailable("POST_COVERAGE_WINDOW_MISMATCH");
  if (!observedEvidence || observedEvidence.status !== "available" || observedEvidence.truncated !== "false") return unavailable("POST_COVERAGE_EVIDENCE_MISMATCH");
  try {
    const savedProof = facebookPostCoverageSchema.safeParse(JSON.parse(observedEvidence.coverage));
    if (!savedProof.success || JSON.stringify(savedProof.data) !== JSON.stringify(coverage) || JSON.stringify(JSON.parse(observedEvidence.items)) !== JSON.stringify(items)) return unavailable("POST_COVERAGE_EVIDENCE_MISMATCH");
  } catch { return unavailable("POST_COVERAGE_EVIDENCE_MISMATCH"); }
  if (new Set(items.map(item => item.id)).size !== items.length || new Set(items.map(item => item.id.split("_")[0])).size > 1
    || items.some(item => item.createdTime === null || Date.parse(item.createdTime) < Date.parse(coverage.since) || Date.parse(item.createdTime) >= Date.parse(coverage.until)
      || item.url !== `https://www.facebook.com/${item.id}`)) return unavailable("INVALID_POST_WINDOW_ITEMS");
  const start = Date.parse(coverage.since);
  const periods = Array.from({ length: 4 }, (_, index) => {
    const periodStart = start + index * 7 * DAY; const periodEnd = periodStart + 7 * DAY;
    return { startAt: new Date(periodStart).toISOString(), endAt: new Date(periodEnd).toISOString(), count: items.filter(item => Date.parse(item.createdTime!) >= periodStart && Date.parse(item.createdTime!) < periodEnd).length };
  });
  return { complete: true, reason: "COMPLETE_QUERIED_POST_WINDOW", periods };
}
