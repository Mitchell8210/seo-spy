import { z } from "zod";
import { createFacebookReportingWindow } from "./reporting-window.js";

type Request = (path: string, params: Record<string, string>) => Promise<Record<string, unknown>>;
type Source = "tagged" | "feed" | "comment";
const identifier = z.string().regex(/^\d+(?:_\d+)*$/).max(128);
const timestamp = z.string().max(64).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/)
  .refine(value => Number.isFinite(Date.parse(value)));
const tag = z.object({ id: z.string().regex(/^\d+$/), type: z.string().max(80).optional() });
const tags = z.union([z.array(tag).max(100), z.record(z.string().regex(/^\d+$/), z.array(tag).max(100))]);
const record = z.object({ id: identifier, created_time: timestamp.optional(), message_tags: tags.nullable().optional(),
  from: z.object({ id: z.string().regex(/^\d+$/) }).nullable().optional() });
const paging = z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().min(1).max(4096).optional() }).optional() }).optional();
const records = z.object({ data: z.array(record).max(100), paging });
const posts = z.object({ data: z.array(z.object({ id: identifier, comments: records.optional() })).max(25), paging });
class SearchFailure extends Error {
  constructor(readonly code: string) { super(code); }
}

/** Explicit bounded historical search. Identifiers/content stay ephemeral and never appear in output. */
export async function probeFacebookMentionHistory(request: Request, pageId: string, now = new Date(), mode: "all" | "feed" = "all") {
  if (!/^\d{1,40}$/.test(pageId)) throw new Error("Invalid Page ID");
  const window = createFacebookReportingWindow(now);
  const start = Date.parse(window.since), end = Date.parse(window.until);
  const fields = "id,created_time,message_tags,from{id}";
  const result = { pageId, checkedAt: now.toISOString(), readOnly: true, writesEnabled: false,
    positiveControlFound: false, directControlVerified: false, controlSource: null as Source | null,
    controlIn30DayWindow: null as boolean | null, authorIdAvailable: null as boolean | null,
    authorTypeEstablished: false, uniquePeopleMentioningBusiness: null,
    postsScanned: 0, commentsScanned: 0, taggedRecordsScanned: 0, feedRecordsScanned: 0,
    recordsWithTagMetadata: 0, recordsWithAuthorIds: 0, selfAuthoredMentionsExcluded: 0,
    requestsMade: 0, postListingComplete: false, commentStreamsComplete: false,
    taggedListingComplete: false, feedListingComplete: false, boundReached: false,
    errorCode: null as string | null, providerCode: null as number | null, providerSubcode: null as number | null,
    limitations: ["Historical capability search, not a 30-day mentions or unique-people total. No time filter is applied to discovery.",
      "Bounds: 3 tagged pages, 10 feed pages, 10 pages/250 Page posts, 3 pages per comment stream, 150 provider requests, one direct positive-control read.",
      "Feed records are not assumed to be visitor-authored. Listing completeness is limited to content accessible to this Page token.",
      "Only explicit structured tags matching the selected Page establish a candidate. Plain text is not requested or matched. Page-self-authored mentions are excluded.",
      "Author IDs do not establish that an author is a person rather than another Page. Missing metadata and inaccessible content remain unknown.",
      "Only aggregate diagnostics are returned. Names, message text, author/comment/record IDs and provider paging URLs are not returned or saved."],
  };
  let directAttempted = false;
  const hasTarget = (item: z.infer<typeof record>) => {
    const values = Array.isArray(item.message_tags) ? item.message_tags : Object.values(item.message_tags ?? {}).flat();
    return values.some(value => value.id === pageId);
  };
  async function read(path: string, params: Record<string, string>) {
    if (result.requestsMade >= 150) { result.boundReached = true; throw new SearchFailure("MENTION_REQUEST_LIMIT"); }
    result.requestsMade++;
    return request(path, params);
  }
  function nextCursor(value: z.infer<typeof paging>, seen: Set<string>) {
    if (!value?.next) return undefined;
    const cursor = value.cursors?.after;
    if (!cursor || seen.has(cursor)) throw new SearchFailure("INCOMPLETE_MENTION_PAGING");
    seen.add(cursor);
    return cursor;
  }
  async function observe(item: z.infer<typeof record>, source: Source) {
    if (item.message_tags !== undefined && item.message_tags !== null) result.recordsWithTagMetadata++;
    if (item.from?.id) result.recordsWithAuthorIds++;
    if (!hasTarget(item)) return false;
    if (item.from?.id === pageId) { result.selfAuthoredMentionsExcluded++; return false; }
    result.positiveControlFound = true;
    result.controlSource = source;
    const date = item.created_time ? Date.parse(item.created_time) : null;
    result.controlIn30DayWindow = date === null ? null : date >= start && date < end;
    result.authorIdAvailable = !!item.from?.id;
    if (!directAttempted) {
      directAttempted = true;
      const direct = record.parse(await read(item.id, { fields }));
      if (direct.id !== item.id) throw new SearchFailure("MENTION_CONTROL_TARGET_MISMATCH");
      result.directControlVerified = hasTarget(direct) && direct.from?.id !== pageId;
      result.authorIdAvailable = !!direct.from?.id;
      if (direct.created_time) {
        const created = Date.parse(direct.created_time);
        result.controlIn30DayWindow = created >= start && created < end;
      }
    }
    return true;
  }
  async function searchEdge(source: "tagged" | "feed") {
    let after: string | undefined;
    const cursors = new Set<string>(), seen = new Set<string>();
    for (let batch = 0; batch < (source === "feed" ? 10 : 3); batch++) {
      const response = records.parse(await read(`${pageId}/${source}`, { fields, limit: "25",
        ...(source === "feed" ? { filter: "others" } : {}), ...(after ? { after } : {}) }));
      if (response.data.length > 25) throw new SearchFailure("INVALID_MENTION_RESPONSE");
      for (const item of response.data) {
        if (seen.has(item.id)) throw new SearchFailure("DUPLICATE_MENTION_RECORDS");
        seen.add(item.id);
        if (source === "tagged") result.taggedRecordsScanned++; else result.feedRecordsScanned++;
        if (await observe(item, source)) return true;
      }
      after = nextCursor(response.paging, cursors);
      if (!after) {
        if (source === "tagged") result.taggedListingComplete = true; else result.feedListingComplete = true;
        return false;
      }
    }
    result.boundReached = true;
    return false;
  }
  const seenComments = new Set<string>();
  async function searchComments(postId: string, first?: z.infer<typeof records>) {
    let after: string | undefined;
    const cursors = new Set<string>();
    for (let batch = 0; batch < 3; batch++) {
      const response = batch === 0 && first ? first : records.parse(await read(`${postId}/comments`, {
        fields, filter: "stream", order: "chronological", limit: "100", ...(after ? { after } : {}),
      }));
      for (const item of response.data) {
        if (seenComments.has(item.id)) throw new SearchFailure("DUPLICATE_MENTION_RECORDS");
        seenComments.add(item.id);
        result.commentsScanned++;
        if (await observe(item, "comment")) return { found: true, complete: false };
      }
      after = nextCursor(response.paging, cursors);
      if (!after) return { found: false, complete: true };
    }
    result.boundReached = true;
    return { found: false, complete: false };
  }
  try {
    if (mode === "feed") { await searchEdge("feed"); return result; }
    if (await searchEdge("tagged") || await searchEdge("feed")) return result;
    let after: string | undefined;
    const cursors = new Set<string>(), seenPosts = new Set<string>();
    let streamsComplete = true;
    for (let batch = 0; batch < 10; batch++) {
      const response = posts.parse(await read(`${pageId}/posts`, {
        fields: "id,comments.filter(stream).order(chronological).limit(100){id,created_time,message_tags,from{id}}",
        limit: "25", ...(after ? { after } : {}),
      }));
      for (const post of response.data) {
        if (!new RegExp(`^${pageId}_\\d+$`).test(post.id) || seenPosts.has(post.id)) throw new SearchFailure("INVALID_MENTION_POST_TARGET");
        seenPosts.add(post.id);
        result.postsScanned++;
        const outcome = await searchComments(post.id, post.comments);
        streamsComplete = streamsComplete && outcome.complete;
        if (outcome.found) return result;
      }
      after = nextCursor(response.paging, cursors);
      if (!after) {
        result.postListingComplete = true;
        result.commentStreamsComplete = streamsComplete;
        return result;
      }
    }
    result.boundReached = true;
  } catch (error) {
    const safe = error as { code?: unknown; providerCode?: unknown; providerSubcode?: unknown };
    result.errorCode = error instanceof SearchFailure ? error.code : error instanceof z.ZodError ? "INVALID_MENTION_RESPONSE" :
      ["PROVIDER_REJECTED", "PROVIDER_UNAVAILABLE", "EMPTY_RESPONSE", "RESPONSE_TOO_LARGE"].includes(String(safe?.code)) ? String(safe.code) : "MENTION_SEARCH_FAILED";
    if (typeof safe?.providerCode === "number" && Number.isSafeInteger(safe.providerCode)) result.providerCode = safe.providerCode;
    if (typeof safe?.providerSubcode === "number" && Number.isSafeInteger(safe.providerSubcode)) result.providerSubcode = safe.providerSubcode;
  }
  return result;
}

export function probeFacebookMentionFeedHistory(request: Request, pageId: string, now = new Date()) {
  return probeFacebookMentionHistory(request, pageId, now, "feed");
}
