import { z } from "zod";

// Deliberately explicit local diagnostics, never invoked by collection or rendering.
export const CONTACT_METRIC_CANDIDATES = [
  "page_post_engagements", "page_actions_post_reactions_total",
  "page_activity_by_action_type", "page_consumptions_by_consumption_type",
  "page_total_actions", "page_website_clicks_logged_in_unique",
  "page_get_directions_clicks_logged_in_unique", "page_cta_clicks_logged_in_total",
  "page_messages_new_conversations_unique", "page_messages_total_messaging_connections",
  "page_messages_total_messaging_connections_unique",
] as const;
type Request = (path: string, params: Record<string, string>) => Promise<Record<string, unknown>>;
const count = z.number().int().nonnegative();
const list = z.object({ data: z.array(z.object({ id: z.string().regex(/^\d+(?:_\d+)?$/) })).max(100),
  paging: z.object({ next: z.string().optional() }).optional() });
const insights = z.object({ data: z.array(z.object({ name: z.string().max(128), period: z.string().max(32),
  values: z.array(z.object({ end_time: z.string().max(64).optional(),
    value: z.union([z.number().finite().nonnegative(), z.record(z.string().regex(/^[a-z_]+$/i), z.number().finite().nonnegative())]),
  })).max(100),
})).max(5) });
type Probe = { label: string; status: "available" | "empty" | "unavailable";
  data?: unknown; code?: string; providerCode?: number; providerSubcode?: number };

export async function probeFacebookContactMetrics(request: Request, pageId: string, now = new Date()) {
  if (!/^\d{1,40}$/.test(pageId)) throw new Error("Invalid Page ID");
  const probes: Probe[] = [];
  async function probe<T>(label: string, path: string, params: Record<string, string>, parse: (data: Record<string, unknown>) => T) {
    try {
      const data = parse(await request(path, params));
      probes.push({ label, status: Array.isArray(data) && data.length === 0 ? "empty" : "available", data });
      return data;
    } catch (error) {
      // Never forward raw Meta bodies, error messages, URLs or arbitrary error properties.
      const safe = error as { code?: unknown; providerCode?: unknown; providerSubcode?: unknown };
      probes.push({ label, status: "unavailable",
        code: ["PROVIDER_REJECTED", "PROVIDER_UNAVAILABLE", "RESPONSE_TOO_LARGE", "EMPTY_RESPONSE"].includes(String(safe?.code))
          ? String(safe.code) : "INVALID_RESPONSE",
        ...(typeof safe?.providerCode === "number" ? { providerCode: safe.providerCode } : {}),
        ...(typeof safe?.providerSubcode === "number" ? { providerSubcode: safe.providerSubcode } : {}),
      });
      return null;
    }
  }
  const until = Math.floor(now.getTime() / 1000);
  const window = { since: String(until - 30 * 86400), until: String(until) };
  for (const metric of CONTACT_METRIC_CANDIDATES) {
    await probe(metric, `${pageId}/insights`, { ...window, period: "day", metric }, raw => {
      const data = insights.parse(raw).data;
      if (data.some(item => item.name !== metric || item.period !== "day")) throw new Error("Mismatched insight");
      return data;
    });
  }
  const posts = await probe("Recent posts (bounded sample)", `${pageId}/posts`, { fields: "id", limit: "5" }, raw => {
    const data = list.parse(raw);
    if (data.data.some(post => !post.id.startsWith(`${pageId}_`))) throw new Error("Wrong Page post");
    return data.data.slice(0, 5);
  });
  for (const post of (posts ?? []).slice(0, 2)) {
    // Individual probes isolate a rejected field; LIKE is not all reaction types.
    await probe(`Post ${post.id}: likes`, `${post.id}/reactions`,
      { type: "LIKE", limit: "0", summary: "true" }, raw =>
        z.object({ summary: z.object({ total_count: count }) }).parse(raw).summary);
    await probe(`Post ${post.id}: comments`, `${post.id}/comments`,
      { limit: "0", summary: "true" }, raw =>
        z.object({ summary: z.object({ total_count: count }) }).parse(raw).summary);
    await probe(`Post ${post.id}: shares`, post.id, { fields: "id,shares" }, raw => {
      const data = z.object({ id: z.literal(post.id), shares: z.object({ count }).optional() }).parse(raw);
      return { count: data.shares?.count ?? null, omitted: !data.shares };
    });
  }
  for (const edge of ["tagged", "feed"] as const) {
    await probe(edge === "tagged" ? "Tagged posts" : "Visitor feed posts", `${pageId}/${edge}`,
      { ...window, fields: "id", limit: "5", ...(edge === "feed" ? { filter: "others" } : {}) }, raw => {
        const data = list.parse(raw);
        return { returnedPosts: data.data.length, moreAvailable: Boolean(data.paging?.next), uniquePeople: null };
      });
  }
  await probe("Messenger conversation metadata", `${pageId}/conversations`, { fields: "id", limit: "5" }, raw => {
    // Count only. Never return conversation IDs, participants or message bodies.
    const data = z.object({ data: z.array(z.object({ id: z.string() })).max(100),
      paging: z.object({ next: z.string().optional() }).optional() }).parse(raw);
    return { returnedConversations: data.data.length, moreAvailable: Boolean(data.paging?.next), messageCount: null };
  });
  return { checkedAt: now.toISOString(), pageId, readOnly: true, writesEnabled: false, window, probes,
    limitations: ["Candidate metrics are probes, not guaranteed current API support.",
      "Post likes, comments and shares are lifetime snapshots on at most two posts, not 30-day Page activity totals.",
      "Empty insight arrays and omitted shares are not confirmed zero activity.",
      "Visitor/tagged posts do not establish all mentions or unique people. Conversations do not count messages.",
      "No raw content, people, conversation identifiers, credentials or paging URLs are returned."],
  };
}
