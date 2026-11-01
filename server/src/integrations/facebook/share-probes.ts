import { z } from "zod";
import { createFacebookReportingWindow } from "./reporting-window.js";

type Request = (path: string, params: Record<string, string>) => Promise<Record<string, unknown>>;
const count = z.number().int().nonnegative().safe();
const timestamp = z.string().max(64).refine(value => Number.isFinite(Date.parse(value)));
const paging = z.object({ next: z.string().optional() }).optional();
const posts = z.object({ data: z.array(z.object({ id: z.string().regex(/^\d+_\d+$/) })).max(100), paging });
type Outcome = { label: string; status: "available" | "empty" | "unavailable"; data?: unknown;
  code?: string; providerCode?: number; providerSubcode?: number };

/** Explicit capability probes only; visible shared posts do not establish all shares. */
export async function probeFacebookShares(request: Request, pageId: string, now = new Date()) {
  if (!/^\d{1,40}$/.test(pageId)) throw new Error("Invalid Page ID");
  const window = createFacebookReportingWindow(now);
  const probes: Outcome[] = [];
  async function probe<T>(label: string, path: string, params: Record<string, string>, parse: (raw: Record<string, unknown>) => T) {
    try {
      const data = parse(await request(path, params));
      probes.push({ label, status: Array.isArray(data) && data.length === 0 ? "empty" : "available", data });
      return data;
    } catch (error) {
      const safe = error as { code?: unknown; providerCode?: unknown; providerSubcode?: unknown };
      probes.push({ label, status: "unavailable", code:
        ["PROVIDER_REJECTED", "PROVIDER_UNAVAILABLE", "RESPONSE_TOO_LARGE", "EMPTY_RESPONSE"].includes(String(safe?.code)) ? String(safe.code) : "INVALID_RESPONSE",
        ...(typeof safe?.providerCode === "number" ? { providerCode: safe.providerCode } : {}),
        ...(typeof safe?.providerSubcode === "number" ? { providerSubcode: safe.providerSubcode } : {}),
      });
      return null;
    }
  }
  const sample = await probe("Recent Page post sample", `${pageId}/posts`, { fields: "id", limit: "5" }, raw => {
    const result = posts.parse(raw);
    if (result.data.some(post => !post.id.startsWith(`${pageId}_`))) throw new Error("Wrong Page");
    return { postIds: result.data.slice(0, 5).map(post => post.id), moreAvailable: Boolean(result.paging?.next) };
  });
  for (const postId of sample?.postIds ?? []) {
    await probe(`Post ${postId}: lifetime share field`, postId, { fields: "id,shares" }, raw => {
      const result = z.object({ id: z.literal(postId), shares: z.object({ count }).optional() }).parse(raw);
      return { count: result.shares?.count ?? null, omitted: !result.shares };
    });
    // Two distinct planned probes isolate edge access from timestamp-field support.
    await probe(`Post ${postId}: sharedposts basic access`, `${postId}/sharedposts`, { fields: "id", limit: "5" }, raw => {
      const result = z.object({ data: z.array(z.object({ id: z.string().max(128) })).max(100), paging }).parse(raw);
      return { returnedSharePosts: result.data.length, moreAvailable: Boolean(result.paging?.next) };
    });
    await probe(`Post ${postId}: sharedposts timestamps`, `${postId}/sharedposts`, { fields: "id,created_time", limit: "25" }, raw => {
      const result = z.object({ data: z.array(z.object({ id: z.string().max(128), created_time: timestamp.optional() })).max(100), paging }).parse(raw);
      return { returnedSharePosts: result.data.length, timestampedSharePosts: result.data.filter(item => item.created_time !== undefined).length,
        observedSharePostsInWindow: result.data.filter(item => item.created_time && Date.parse(item.created_time) >= Date.parse(window.since) && Date.parse(item.created_time) < Date.parse(window.until)).length,
        moreAvailable: Boolean(result.paging?.next), complete30DayShareCount: null };
    });
  }
  return { checkedAt: now.toISOString(), pageId, readOnly: true, writesEnabled: false,
    window: { since: window.since, until: window.until, requestedDays: 30, timeZone: window.timeZone }, probes,
    complete30DayShareCount: null,
    limitations: ["Capability test of at most five recent Page posts, including posts older than the reporting window.",
      "Basic edge access and timestamp support are separate planned requests, not retries. No paging URLs are followed.",
      "Empty sharedposts lists and omitted share fields do not establish zero shares. Returned visible share posts do not prove complete sharing coverage.",
      "No shared-post identifiers, sharing-account identities, text, credentials or paging URLs are returned. No report or UI value is changed."],
  };
}
