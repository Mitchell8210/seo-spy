import { createHash } from "node:crypto";
import { z } from "zod";

const DAY = 86400000, MAX_PAGES = 10, PAGE_SIZE = 25, MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const iso = z.string().datetime();
const reasons = ["complete", "page-limit", "cursor-unavailable", "cursor-loop", "page-size-exceeded", "invalid-response", "request-failed", "aborted", "duplicate-post", "invalid-timestamp", "out-of-window"] as const;
export const facebookSocialHistoryCoverageSchema = z.object({
  version: z.literal("facebook-social-history-v1"), kind: z.literal("queried-window"), since: iso, until: iso, observedAt: iso,
  complete: z.boolean(), exhausted: z.boolean(), reason: z.enum(reasons), pagesRead: z.number().int().min(0).max(MAX_PAGES),
  maxPages: z.literal(MAX_PAGES), itemsLimit: z.literal(MAX_PAGES * PAGE_SIZE),
  ignoredOutOfWindow: z.number().int().min(0).max(MAX_PAGES * PAGE_SIZE), duplicateIds: z.number().int().min(0).max(MAX_PAGES * PAGE_SIZE), invalidTimestamps: z.number().int().min(0).max(MAX_PAGES * PAGE_SIZE),
}).strict().superRefine((value, context) => {
  const since = Date.parse(value.since), until = Date.parse(value.until), observed = Date.parse(value.observedAt);
  if (until - since !== 90 * DAY || until % DAY !== 0 || until > observed || observed >= until + DAY
    || value.complete && (!value.exhausted || value.reason !== "complete" || value.pagesRead === 0 || value.ignoredOutOfWindow || value.duplicateIds || value.invalidTimestamps)
    || !value.complete && value.reason === "complete") context.addIssue({ code: "custom", message: "Incompatible social history coverage proof." });
});
const itemSchema = z.object({ id: z.string().regex(/^\d+_\d+$/), message: z.string().max(100000).nullable(), messageStatus: z.enum(["available", "not-returned", "not-retained"]),
  createdTime: iso.nullable(), url: z.string().regex(/^https:\/\/www\.facebook\.com\/\d+_\d+$/) }).strict().superRefine((item, context) => {
    if ((item.messageStatus === "available") !== (typeof item.message === "string")) context.addIssue({ code: "custom", message: "Message availability must match returned evidence." });
  });
export const facebookSocialHistorySchema = z.object({ status: z.enum(["available", "unavailable"]), items: z.array(itemSchema).max(MAX_PAGES * PAGE_SIZE),
  truncated: z.boolean(), collectedAt: iso, coverage: facebookSocialHistoryCoverageSchema, failureCode: z.string().max(128).optional() }).strict();
export type FacebookSocialHistory = z.infer<typeof facebookSocialHistorySchema>;
type RequestPosts = (path: string, params: Record<string, string>) => Promise<unknown>;
const batchSchema = z.object({
  data: z.array(z.object({ id: z.string().regex(/^\d+_\d+$/), message: z.string().max(100000).optional(), created_time: z.unknown().optional() })).max(100),
  paging: z.object({ next: z.string().max(32768).optional(), cursors: z.object({ after: z.string().min(1).max(4096).optional() }).optional() }).optional(),
});
const normalizedTimestamp = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > 64) return null;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return z.string().datetime({ offset: true }).safeParse(normalized).success ? new Date(normalized).toISOString() : null;
};
export function facebookSocialHistoryWindow(observedAt: string): { since: string; until: string } {
  if (!iso.safeParse(observedAt).success) throw new Error("A valid UTC collection time is required.");
  const until = Math.floor(Date.parse(observedAt) / DAY) * DAY;
  return { since: new Date(until - 90 * DAY).toISOString(), until: new Date(until).toISOString() };
}
export const facebookSocialHistoryItemsHash = (items: FacebookSocialHistory["items"]) => createHash("sha256").update(JSON.stringify(items)).digest("hex");

/** Explicit filtered read, bounded by the caller's shared collection deadline. Never follows provider URLs or retries. */
export async function collectFacebookSocialHistory(request: RequestPosts, pageId: string, observedAt: string, signal?: AbortSignal): Promise<FacebookSocialHistory> {
  if (!/^\d+$/.test(pageId)) throw new Error("A numeric Facebook Page identity is required.");
  const window = facebookSocialHistoryWindow(observedAt);
  const proof: FacebookSocialHistory["coverage"] = { version: "facebook-social-history-v1", kind: "queried-window", ...window, observedAt,
    complete: false, exhausted: false, reason: "page-limit", pagesRead: 0, maxPages: MAX_PAGES, itemsLimit: MAX_PAGES * PAGE_SIZE,
    ignoredOutOfWindow: 0, duplicateIds: 0, invalidTimestamps: 0 };
  const result: FacebookSocialHistory = { status: "available", items: [], truncated: true, collectedAt: observedAt, coverage: proof };
  const seen = new Set<string>(), cursors = new Set<string>();
  let retainedMessageBytes = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let raw: unknown;
    try {
      signal?.throwIfAborted();
      raw = await request(`${pageId}/posts`, { fields: "id,message,created_time", limit: String(PAGE_SIZE), since: String(Date.parse(window.since) / 1000), until: String(Date.parse(window.until) / 1000), ...(cursor ? { after: cursor } : {}) });
      signal?.throwIfAborted();
    } catch {
      proof.reason = signal?.aborted ? "aborted" : "request-failed"; result.status = "unavailable";
      result.failureCode = signal?.aborted ? "SOCIAL_HISTORY_ABORTED" : "SOCIAL_HISTORY_REQUEST_FAILED"; break;
    }
    const parsed = batchSchema.safeParse(raw);
    if (!parsed.success || parsed.data.data.some(item => !item.id.startsWith(`${pageId}_`))) {
      proof.reason = "invalid-response"; result.status = "unavailable"; result.failureCode = "SOCIAL_HISTORY_INVALID_RESPONSE"; break;
    }
    const list = parsed.data; proof.pagesRead++;
    for (const post of list.data.slice(0, PAGE_SIZE)) {
      if (seen.has(post.id)) { proof.duplicateIds++; continue; }
      seen.add(post.id);
      const createdTime = normalizedTimestamp(post.created_time);
      if (createdTime === null) proof.invalidTimestamps++;
      else if (Date.parse(createdTime) < Date.parse(window.since) || Date.parse(createdTime) >= Date.parse(window.until)) { proof.ignoredOutOfWindow++; continue; }
      const messageBytes = typeof post.message === "string" ? Buffer.byteLength(post.message) : 0;
      const retain = typeof post.message === "string" && retainedMessageBytes + messageBytes <= MAX_MESSAGE_BYTES;
      if (retain) retainedMessageBytes += messageBytes;
      result.items.push({ id: post.id, message: retain ? post.message! : null, messageStatus: typeof post.message !== "string" ? "not-returned" : retain ? "available" : "not-retained", createdTime, url: `https://www.facebook.com/${post.id}` });
    }
    if (list.data.length > PAGE_SIZE) { proof.reason = "page-size-exceeded"; break; }
    if (!list.paging?.next) {
      proof.exhausted = true;
      proof.reason = proof.invalidTimestamps ? "invalid-timestamp" : proof.duplicateIds ? "duplicate-post" : proof.ignoredOutOfWindow ? "out-of-window" : "complete";
      proof.complete = proof.reason === "complete"; break;
    }
    const after = list.paging.cursors?.after;
    if (!after) { proof.reason = "cursor-unavailable"; break; }
    if (cursors.has(after)) { proof.reason = "cursor-loop"; break; }
    cursors.add(after); cursor = after;
  }
  result.truncated = !proof.complete;
  return result;
}

export function facebookSocialHistoryEvidence(history: FacebookSocialHistory): Record<string, string> {
  return { status: history.status, truncated: String(history.truncated), coverage: JSON.stringify(history.coverage), itemsHash: facebookSocialHistoryItemsHash(history.items) };
}
export interface VerifiedFacebookSocialHistory { complete: boolean; reason: string; items: FacebookSocialHistory["items"]; since: string | null; until: string | null; observedAt: string | null; contentComplete: boolean }

/** Saved text/history must match its separate hash-bound evidence; legacy samples never establish 90-day zeros. */
export function verifyFacebookSocialHistory(history: unknown, observedEvidence: Record<string, string> | null, pageId: string, assessmentCutoff: string): VerifiedFacebookSocialHistory {
  const unavailable = (reason: string): VerifiedFacebookSocialHistory => ({ complete: false, reason, items: [], since: null, until: null, observedAt: null, contentComplete: false });
  const parsed = facebookSocialHistorySchema.safeParse(history);
  if (!parsed.success || !/^\d+$/.test(pageId) || !iso.safeParse(assessmentCutoff).success) return unavailable("MISSING_OR_INCOMPLETE_SOCIAL_HISTORY");
  const { items, coverage, collectedAt } = parsed.data;
  if (parsed.data.status !== "available" || parsed.data.truncated || !coverage.complete || !coverage.exhausted || collectedAt !== coverage.observedAt
    || Date.parse(collectedAt) > Date.parse(assessmentCutoff) || Date.parse(assessmentCutoff) - Date.parse(collectedAt) > 7 * DAY) return unavailable("SOCIAL_HISTORY_WINDOW_MISMATCH");
  const expected = facebookSocialHistoryWindow(collectedAt);
  if (coverage.since !== expected.since || coverage.until !== expected.until || items.length > coverage.pagesRead * PAGE_SIZE
    || new Set(items.map(item => item.id)).size !== items.length || items.some(item => !item.id.startsWith(`${pageId}_`) || item.url !== `https://www.facebook.com/${item.id}` || item.createdTime === null
      || Date.parse(item.createdTime) < Date.parse(coverage.since) || Date.parse(item.createdTime) >= Date.parse(coverage.until))) return unavailable("SOCIAL_HISTORY_IDENTITY_OR_COVERAGE_MISMATCH");
  if (!observedEvidence || observedEvidence.status !== parsed.data.status || observedEvidence.truncated !== "false" || observedEvidence.itemsHash !== facebookSocialHistoryItemsHash(items)
    || observedEvidence.coverage !== JSON.stringify(coverage)) return unavailable("SOCIAL_HISTORY_EVIDENCE_MISMATCH");
  return { complete: true, reason: "complete", items: structuredClone(items), since: coverage.since, until: coverage.until, observedAt: coverage.observedAt,
    contentComplete: items.every(item => item.messageStatus === "available") };
}
