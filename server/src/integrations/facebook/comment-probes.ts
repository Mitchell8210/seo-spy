import { z } from "zod";
import { createFacebookReportingWindow } from "./reporting-window.js";

type Request = (path: string, params: Record<string, string>) => Promise<Record<string, unknown>>;

/** Explicit schema/access diagnostic, with no comment text or identifiers returned. */
export async function probeFacebookComments(request: Request, pageId: string) {
  if (!/^\d{1,40}$/.test(pageId)) throw new Error("Invalid Page ID");
  const window = createFacebookReportingWindow(new Date());
  const since = String(Date.parse(window.since) / 1000);
  const probes: Record<string, unknown>[] = [];
  const rows = z.object({ data: z.array(z.record(z.string(), z.unknown())).max(100),
    paging: z.object({ next: z.string().optional() }).optional() });
  async function probe(label: string, path: string, params: Record<string, string>, nested: boolean | "selection" = false) {
    try {
      const raw = rows.parse(await request(path, params));
      const comments = nested === "selection" ? [] : nested ? raw.data.flatMap(row => {
        const result = rows.safeParse(row.comments);
        return result.success ? result.data.data : [];
      }) : raw.data;
      probes.push({ label, status: "available", returnedRows: raw.data.length,
        moreAvailable: Boolean(raw.paging?.next),
        ...(nested === true ? { postsWithCommentsField: raw.data.filter(row => rows.safeParse(row.comments).success).length } : {}),
        returnedComments: comments.length,
        commentsWithId: comments.filter(row => typeof row.id === "string").length,
        commentsWithCreatedTime: comments.filter(row => typeof row.created_time === "string" && Number.isFinite(Date.parse(row.created_time))).length,
      });
      return raw;
    } catch (error) {
      const safe = error as { providerCode?: unknown; providerSubcode?: unknown };
      probes.push({ label, status: "unavailable", code: error instanceof z.ZodError ? "INVALID_RESPONSE" : "REQUEST_FAILED",
        ...(typeof safe?.providerCode === "number" ? { providerCode: safe.providerCode } : {}),
        ...(typeof safe?.providerSubcode === "number" ? { providerSubcode: safe.providerSubcode } : {}),
      });
      return null;
    }
  }
  const posts = await probe("Post IDs for target selection", `${pageId}/posts`, { fields: "id", limit: "1" }, "selection");
  const target = posts?.data[0]?.id;
  if (typeof target === "string" && new RegExp(`^${pageId}_\\d+$`).test(target)) {
    await probe("Direct comments with timestamps", `${target}/comments`, { fields: "id,created_time", limit: "5" });
    await probe("Direct stream with period filter", `${target}/comments`, { fields: "id,created_time", filter: "stream", order: "chronological", since, limit: "5" });
  }
  for (const [label, fields] of [
    ["Basic comment field expansion", "id,comments.limit(5){id,created_time}"],
    ["Stream comment field expansion", "id,comments.filter(stream).limit(5){id,created_time}"],
    ["Stream and period field expansion", `id,comments.filter(stream).order(chronological).since(${since}).limit(100){id,created_time}`],
  ]) await probe(label!, `${pageId}/posts`, { fields: fields!, limit: "5" }, true);
  return { pageId, readOnly: true, writesEnabled: false, checkedAt: new Date().toISOString(), probes };
}
