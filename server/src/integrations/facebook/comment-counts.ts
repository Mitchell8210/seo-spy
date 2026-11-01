import { z } from "zod";
import type { FacebookReportingWindow } from "./reporting-window.js";

export type FacebookCommentRequest = (path: string, params: Record<string, string>) => Promise<Record<string, unknown>>;
export interface FacebookCommentPosts {
  status: "available" | "missing" | "unavailable";
  items: { id: string }[];
  truncated: boolean;
}
export interface FacebookCommentCounts {
  basis: "reporting-window";
  since: string;
  until: string;
  timeZone: "America/Los_Angeles";
  status: "available" | "unavailable";
  total: number | null;
  observedTotal: number;
  complete: boolean;
  postsCollected: number;
  postsChecked: number;
  collectedAt: string;
  failureCode?: string;
}

const timestamp = z.string().max(64)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/)
  .refine(value => Number.isFinite(Date.parse(value)));
const page = z.object({
  data: z.array(z.object({ id: z.string().regex(/^\d+(?:_\d+)*$/).max(128), created_time: timestamp })).max(100),
  paging: z.object({
    next: z.string().optional(),
    cursors: z.object({ after: z.string().min(1).max(4096).optional() }).optional(),
  }).optional(),
});
const expandedPosts = z.object({
  data: z.array(z.object({ id: z.string().regex(/^\d+_\d+$/), comments: page.optional() })).max(25),
  paging: page.shape.paging,
});
class CollectionFailure extends Error {
  constructor(readonly code: string) { super(code); }
}

/** Counts API-visible comments/replies; does not establish hidden/deleted comment coverage. */
export async function collectFacebookCommentCounts(
  request: FacebookCommentRequest,
  pageId: string,
  posts: FacebookCommentPosts,
  window: FacebookReportingWindow,
): Promise<FacebookCommentCounts> {
  const result: FacebookCommentCounts = {
    basis: "reporting-window", since: window.since, until: window.until, timeZone: "America/Los_Angeles",
    status: "unavailable", total: null, observedTotal: 0, complete: false,
    postsCollected: posts.items.length, postsChecked: 0, collectedAt: new Date().toISOString(),
  };
  const unavailable = (failureCode: string) => ({ ...result, failureCode });
  const since = Date.parse(window.since);
  const until = Date.parse(window.until);
  if (!/^\d{1,40}$/.test(pageId) || !Number.isFinite(since) || !Number.isFinite(until) || since >= until ||
      window.requestedDays !== 30 || window.timeZone !== "America/Los_Angeles" || window.basis !== "complete-provider-days")
    return unavailable("INVALID_COMMENT_REQUEST");
  if (posts.status !== "available" || posts.items.length > 50)
    return unavailable("INCOMPLETE_POST_COVERAGE");
  const postIds = posts.items.map(post => post.id);
  if (postIds.some(id => !new RegExp(`^${pageId}_\\d+$`).test(id)) || new Set(postIds).size !== postIds.length)
    return unavailable("INVALID_POST_TARGETS");
  const seenComments = new Set<string>();
  let requests = 0;
  async function boundedRequest(path: string, params: Record<string, string>) {
    if (requests >= 150) throw new CollectionFailure("COMMENT_REQUEST_LIMIT");
    requests++;
    return request(path, params);
  }
  async function countPostComments(postId: string, firstPage?: z.infer<typeof page>) {
    const seenCursors = new Set<string>();
    let after: string | undefined;
    for (let batch = 0; batch < 5; batch++) {
      const response: z.infer<typeof page> = batch === 0 && firstPage ? firstPage :
        page.parse(await boundedRequest(`${postId}/comments`, {
          fields: "id,created_time", filter: "stream", order: "chronological", since: String(since / 1000),
          limit: "100", ...(after ? { after } : {}),
        }));
      for (const comment of response.data) {
        if (seenComments.has(comment.id)) throw new CollectionFailure("DUPLICATE_COMMENT_IDS");
        seenComments.add(comment.id);
        const created = Date.parse(comment.created_time);
        if (created >= since && created < until) result.observedTotal++;
      }
      if (!response.paging?.next) {
        result.postsChecked++;
        return;
      }
      after = response.paging.cursors?.after;
      if (!after || seenCursors.has(after)) throw new CollectionFailure("INCOMPLETE_COMMENT_PAGING");
      seenCursors.add(after);
    }
    throw new CollectionFailure("COMMENT_PAGE_LIMIT");
  }
  try {
    if (!posts.truncated) {
      for (const postId of postIds) await countPostComments(postId);
    } else {
      // A recent-post sample cannot prove activity coverage on older posts. Enumerate
      // a separate bounded history with comments embedded, preserving the UI sample.
      result.postsCollected = 0;
      const seenPosts = new Set<string>();
      const seenCursors = new Set<string>();
      let after: string | undefined;
      let exhausted = false;
      for (let batch = 0; batch < 10; batch++) {
        const response = expandedPosts.parse(await boundedRequest(`${pageId}/posts`, {
          fields: `id,comments.filter(stream).order(chronological).since(${since / 1000}).limit(100){id,created_time}`,
          limit: "25", ...(after ? { after } : {}),
        }));
        for (const post of response.data) {
          if (!new RegExp(`^${pageId}_\\d+$`).test(post.id) || seenPosts.has(post.id))
            throw new CollectionFailure("INVALID_POST_TARGETS");
          if (seenPosts.size >= 250) throw new CollectionFailure("COMMENT_POST_LIMIT");
          seenPosts.add(post.id);
          result.postsCollected++;
          await countPostComments(post.id, post.comments);
        }
        if (!response.paging?.next) { exhausted = true; break; }
        after = response.paging.cursors?.after;
        if (!after || seenCursors.has(after)) throw new CollectionFailure("INCOMPLETE_POST_PAGING");
        seenCursors.add(after);
      }
      if (!exhausted) throw new CollectionFailure("COMMENT_POST_PAGE_LIMIT");
    }
  } catch (error) {
    // Raw provider errors can contain credentials/content. Never return them.
    return unavailable(error instanceof CollectionFailure ? error.code : "COMMENT_COLLECTION_FAILED");
  }
  return { ...result, status: "available", total: result.observedTotal, complete: true };
}
