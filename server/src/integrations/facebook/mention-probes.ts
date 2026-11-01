import { z } from "zod";
import { createFacebookReportingWindow } from "./reporting-window.js";

type Request = (path: string, params: Record<string, string>) => Promise<Record<string, unknown>>;
const id = z.string().regex(/^\d+(?:_\d+)*$/).max(128);
const timestamp = z.string().max(64).refine(value => Number.isFinite(Date.parse(value)));
const tag = z.object({ id: z.string().regex(/^\d+$/), type: z.string().max(80).optional() });
const tags = z.union([z.array(tag).max(100), z.record(z.string().regex(/^\d+$/), z.array(tag).max(100))]);
const row = z.object({ id, created_time: timestamp.optional(), message_tags: tags.nullable().optional(),
  from: z.object({ id: z.string().regex(/^\d+$/) }).nullable().optional() });
const rows = z.object({ data: z.array(row).max(100), paging: z.object({ next: z.string().optional() }).optional() });

/** Bounded capability checks; raw people, text, mention targets and paging URLs never leave memory. */
export async function probeFacebookMentions(request: Request, pageId: string, now = new Date()) {
  if (!/^\d{1,40}$/.test(pageId)) throw new Error("Invalid Page ID");
  const window = createFacebookReportingWindow(now);
  const start = Date.parse(window.since), end = Date.parse(window.until);
  const probes: Record<string, unknown>[] = [];
  const knownAuthors = new Set<string>();
  function summarize(raw: unknown, pagePosts: boolean) {
    const parsed = rows.parse(raw);
    if (pagePosts && parsed.data.some(item => !item.id.startsWith(`${pageId}_`))) throw new Error("Wrong Page post");
    const inWindow = parsed.data.filter(item => item.created_time && Date.parse(item.created_time) >= start && Date.parse(item.created_time) < end);
    let targetMentionRecords = 0, targetMentionsWithoutAuthor = 0, selfAuthoredMentionsExcluded = 0;
    for (const item of inWindow) {
      const values = Array.isArray(item.message_tags) ? item.message_tags : Object.values(item.message_tags ?? {}).flat();
      if (!values.some(value => value.id === pageId)) continue;
      if (item.from?.id === pageId) { selfAuthoredMentionsExcluded++; continue; }
      targetMentionRecords++;
      if (item.from?.id) knownAuthors.add(item.from.id);
      else targetMentionsWithoutAuthor++;
    }
    return { parsed, summary: { returnedRecords: parsed.data.length, recordsInWindow: inWindow.length,
      recordsWithTimestamps: parsed.data.filter(item => item.created_time !== undefined).length,
      recordsWithMentionTagsField: parsed.data.filter(item => item.message_tags !== undefined && item.message_tags !== null).length,
      recordsWithAuthorId: parsed.data.filter(item => item.from !== undefined && item.from !== null).length,
      targetMentionRecords, targetMentionsWithoutAuthor, selfAuthoredMentionsExcluded,
      moreAvailable: Boolean(parsed.paging?.next), uniquePeople: null } };
  }
  async function probe(label: string, path: string, params: Record<string, string>, pagePosts = false, nodeId?: string) {
    try {
      const response = await request(path, params);
      if (nodeId && response.id !== nodeId) throw new Error("Wrong comment target");
      const { parsed, summary } = summarize(nodeId ? { data: [response] } : response, pagePosts);
      probes.push({ label, status: "available", ...summary });
      return parsed;
    } catch (error) {
      const safe = error as { providerCode?: unknown; providerSubcode?: unknown };
      probes.push({ label, status: "unavailable", code: error instanceof z.ZodError ? "INVALID_RESPONSE" : "REQUEST_FAILED",
        ...(typeof safe?.providerCode === "number" ? { providerCode: safe.providerCode } : {}),
        ...(typeof safe?.providerSubcode === "number" ? { providerSubcode: safe.providerSubcode } : {}),
      });
      return null;
    }
  }
  const bounds = { since: String(start / 1000), until: String(end / 1000) };
  for (const edge of ["tagged", "feed"]) {
    const params = { ...bounds, limit: "25", ...(edge === "feed" ? { filter: "others" } : {}) };
    await probe(`${edge}: timestamp access`, `${pageId}/${edge}`, { ...params, fields: "id,created_time" });
    await probe(`${edge}: mention tags and author IDs`, `${pageId}/${edge}`, { ...params, fields: "id,created_time,message_tags,from{id}" });
  }
  // Do not restrict post creation dates: a new comment may mention the Page on an old post.
  const posts = await probe("Recent Page posts for comment targets", `${pageId}/posts`, { fields: "id", limit: "5" }, true);
  let directComments = 0;
  for (const post of posts?.data.slice(0, 5) ?? []) {
    const comments = await probe(`Comments on ${post.id}: mention tags and author IDs`, `${post.id}/comments`,
      { ...bounds, fields: "id,created_time,message_tags,from{id}", filter: "stream", order: "chronological", limit: "25" });
    for (const comment of comments?.data ?? []) {
      if (directComments >= 2) break;
      if (!comment.created_time || Date.parse(comment.created_time) < start || Date.parse(comment.created_time) >= end) continue;
      directComments++;
      await probe(`Direct comment node ${directComments}: mention tags and author IDs`, comment.id,
        { fields: "id,created_time,message_tags,from{id}" }, false, comment.id);
    }
  }
  return { pageId, checkedAt: now.toISOString(), readOnly: true, writesEnabled: false,
    window: { since: window.since, until: window.until, requestedDays: 30, timeZone: window.timeZone }, probes,
    uniqueKnownMentionAuthorsInSample: knownAuthors.size, uniquePeopleMentioningBusiness: null,
    limitations: ["Capability sample only: at most 25 records per tagged/feed/comment read, five recent post comment streams and two direct comment-node checks, with no pagination follow-up.",
      "Only explicit message_tags IDs matching the selected business Page are treated as mention evidence. Ordinary text, visitor posts or comments alone do not establish a mention.",
      "A unique author is not necessarily a person; author IDs may identify other Pages. Missing author IDs or mention fields remain unknown, not zero people.",
      "Empty results do not verify mention/author field availability or complete Facebook-wide coverage. Private, hidden, deleted and inaccessible content is not established.",
      "No names, message text, author IDs, comment IDs, mention-target lists or provider paging URLs are returned or saved. The existing frontend metric is unchanged."],
  };
}
