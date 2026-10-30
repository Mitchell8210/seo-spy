import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditResults, Evidence } from "../../contracts/domain.js";
import {
  FacebookGraph,
  FacebookError,
} from "../../modules/facebook/facebook.service.js";
import {
  FacebookCollectionError,
  type FacebookField,
  type FacebookMetric,
  type FacebookReport,
} from "./types.js";
import { analyzeFacebook } from "./analyze.js";

const idSchema = z.string().regex(/^\d+$/);
const paging = z
  .object({
    next: z.string().optional(),
    cursors: z.object({ after: z.string().max(4096).optional() }).optional(),
  })
  .optional();
const pageList = z.object({
  data: z
    .array(
      z.object({
        id: idSchema,
        name: z.string().max(1024),
        access_token: z.string().max(8192).optional(),
      }),
    )
    .max(100),
  paging,
});
const date = z
  .string()
  .max(64)
  .refine((value) => Number.isFinite(Date.parse(value)));
const postList = z.object({
  data: z
    .array(
      z.object({
        id: z.string().regex(/^\d+_\d+$/),
        message: z.string().max(100000).optional(),
        created_time: date.optional(),
      }),
    )
    .max(100),
  paging,
});
const metricData = z.object({
  data: z
    .array(
      z.object({
        name: z.string(),
        period: z.literal("day"),
        values: z
          .array(
            z.object({
              value: z.number().finite().nonnegative(),
              end_time: date,
            }),
          )
          .max(100),
      }),
    )
    .max(10),
});
const profileSchemas = {
  name: z.string().max(1024),
  about: z.string().max(20000),
  description: z.string().max(30000),
  website: z.string().max(4096),
  phone: z.string().max(512),
  emails: z.array(z.string().max(512)).max(50),
  hours: z.record(
    z.string().regex(/^(mon|tue|wed|thu|fri|sat|sun)_[12]_(open|close)$/),
    z.string().max(128),
  ),
  location: z.object({
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    zip: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }),
  category: z.string().max(1024),
  username: z.string().max(1024),
  followers_count: z.number().int().nonnegative(),
  fan_count: z.number().int().nonnegative(),
  is_published: z.boolean(),
  is_verified: z.boolean(),
  overall_star_rating: z.number().nonnegative(),
  rating_count: z.number().int().nonnegative(),
};
const metricNames = [
  "page_follows",
  "page_daily_follows_unique",
  "page_daily_unfollows_unique",
  "page_media_view",
  "page_views_total",
  "page_post_engagements",
  "page_video_views",
];
const errorCode = (error: unknown) =>
  error instanceof FacebookError
    ? `${error.code}${error.providerCode ? `_${error.providerCode}` : ""}`
    : error instanceof z.ZodError
      ? "INVALID_RESPONSE"
      : "COLLECTION_UNAVAILABLE";

export async function collectFacebookReport(
  graph: FacebookGraph,
  userToken: string,
  pageId: string,
  auditId: string,
  signal?: AbortSignal,
): Promise<{ results: AuditResults; warnings: string[]; partial: boolean }> {
  if (!idSchema.safeParse(pageId).success || !userToken)
    throw new FacebookCollectionError(
      "FACEBOOK_CONFIGURATION_REQUIRED",
      "A user access token and numeric Page ID are required.",
    );
  const deadline = AbortSignal.timeout(120000);
  const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const collectedAt = new Date().toISOString();
  const until = new Date();
  const since = new Date(until.getTime() - 30 * 86400000);
  const request = async (
    path: string,
    token: string,
    params: Record<string, string>,
  ) => {
    stop.throwIfAborted();
    const result = await graph.request(path, token, params, true, stop);
    stop.throwIfAborted();
    return result;
  };
  let selected: z.infer<typeof pageList>["data"][number] | undefined;
  let cursor: string | undefined;
  try {
    for (let batch = 0; batch < 5; batch++) {
      const list = pageList.parse(
        await request("me/accounts", userToken, {
          fields: "id,name,access_token",
          limit: "25",
          ...(cursor ? { after: cursor } : {}),
        }),
      );
      selected = list.data.find((page) => page.id === pageId);
      if (selected || !list.paging?.next || !list.paging.cursors?.after) break;
      cursor = list.paging.cursors.after;
    }
  } catch {
    throw new FacebookCollectionError(
      "FACEBOOK_AUTHORIZATION_FAILED",
      "Authorized Pages could not be read. Reconnect with a valid user token.",
    );
  }
  if (!selected?.access_token)
    throw new FacebookCollectionError(
      "FACEBOOK_PAGE_NOT_AUTHORIZED",
      "The selected Page was not authorized within the bounded Page listing.",
    );
  const token = selected.access_token;
  const warnings: string[] = [];
  const results: AuditResults = {
    evidence: [],
    findings: [],
    recommendations: [],
    scores: ["website", "social", "consistency", "overall"].map((category) => ({
      category: category as "website" | "social" | "consistency" | "overall",
      value: null,
      maximum: 100,
      availability: "unavailable",
      scoringVersion: "facebook-v1",
    })),
  };
  const evidence = (
    checkId: string,
    observed: Record<string, string>,
  ): Evidence => {
    const item: Evidence = {
      id: randomUUID(),
      auditId,
      checkId,
      sourceUrl: `https://www.facebook.com/${pageId}`,
      collectedAt: new Date().toISOString(),
      observed,
      mode: "live",
    };
    results.evidence.push(item);
    return item;
  };
  const profile: Record<string, FacebookField> = {};
  for (const [field, schema] of Object.entries(profileSchemas)) {
    try {
      const response = await request(pageId, token, { fields: `id,${field}` });
      const raw = response[field];
      const value =
        raw === undefined || raw === null ? null : schema.parse(raw);
      const missing =
        value === null ||
        value === "" ||
        (typeof value === "object" && Object.keys(value).length === 0);
      profile[field] = {
        status: missing ? "missing" : "available",
        value,
        collectedAt: new Date().toISOString(),
      };
      evidence(`facebook:profile:${field}`, {
        status: profile[field].status,
        value: JSON.stringify(value),
      });
    } catch (error) {
      profile[field] = {
        status: "unavailable",
        value: null,
        collectedAt: new Date().toISOString(),
        failureCode: errorCode(error),
      };
      evidence(`facebook:profile:${field}`, {
        status: "unavailable",
        failureCode: errorCode(error),
      });
      warnings.push(
        `Profile field ${field} unavailable (${errorCode(error)}).`,
      );
    }
  }
  const posts: FacebookReport["posts"] = {
    status: "available",
    items: [],
    truncated: false,
    collectedAt: new Date().toISOString(),
  };
  cursor = undefined;
  try {
    for (let batch = 0; batch < 2; batch++) {
      const list = postList.parse(
        await request(`${pageId}/posts`, token, {
          fields: "id,message,created_time",
          limit: "25",
          ...(cursor ? { after: cursor } : {}),
        }),
      );
      for (const post of list.data.slice(0, 25))
        if (!posts.items.some((item) => item.id === post.id))
          posts.items.push({
            id: post.id,
            message: post.message ?? null,
            createdTime: post.created_time
              ? new Date(post.created_time).toISOString()
              : null,
            url: `https://www.facebook.com/${post.id}`,
          });
      posts.truncated = Boolean(list.paging?.next) || list.data.length > 25;
      cursor = list.paging?.cursors?.after;
      if (!posts.truncated || !cursor) break;
    }
  } catch (error) {
    posts.status = "unavailable";
    posts.failureCode = errorCode(error);
    posts.truncated = true;
    warnings.push(`Post collection incomplete (${errorCode(error)}).`);
  }
  evidence("facebook:posts", {
    status: posts.status,
    items: JSON.stringify(posts.items),
    truncated: String(posts.truncated),
  });
  const knownDates = posts.items
    .flatMap((post) => (post.createdTime ? [post.createdTime] : []))
    .sort();
  const latestPostAt = knownDates.at(-1) ?? null;
  const metrics: FacebookMetric[] = [];
  for (const name of metricNames) {
    const metric: FacebookMetric = {
      name,
      period: "day",
      status: "unavailable",
      points: [],
      total: null,
      aggregation: name === "page_follows" ? "snapshot" : "sum",
      collectedAt: new Date().toISOString(),
    };
    try {
      const response = metricData.parse(
        await request(`${pageId}/insights`, token, {
          metric: name,
          period: "day",
          since: String(Math.floor(since.getTime() / 1000)),
          until: String(Math.floor(until.getTime() / 1000)),
        }),
      );
      const values = response.data.find((item) => item.name === name)?.values;
      metric.points = (values ?? [])
        .map((point) => ({
          endTime: new Date(point.end_time).toISOString(),
          value: point.value,
        }))
        .sort((a, b) => a.endTime.localeCompare(b.endTime));
      if (
        new Set(metric.points.map((point) => point.endTime)).size !==
        metric.points.length
      )
        throw new Error("Duplicate periods");
      metric.status = metric.points.length ? "available" : "missing";
      if (metric.status === "available" && metric.aggregation === "sum")
        metric.total = metric.points.reduce(
          (sum, point) => sum + point.value,
          0,
        );
      if (metric.status === "missing")
        warnings.push(`Insight ${name} returned no measurements.`);
    } catch (error) {
      metric.points = [];
      metric.failureCode = errorCode(error);
      warnings.push(`Insight ${name} unavailable (${errorCode(error)}).`);
    }
    metrics.push(metric);
    evidence(`facebook:insight:${name}`, {
      status: metric.status,
      metric: JSON.stringify(metric),
      requestedSince: since.toISOString(),
      requestedUntil: until.toISOString(),
    });
  }
  if (signal?.aborted)
    throw new FacebookCollectionError(
      "SERVER_STOPPING",
      "Facebook collection was interrupted.",
    );
  const followers =
    metrics.find((metric) => metric.name === "page_follows")?.points ?? [];
  const followersStart = followers[0]?.value ?? null;
  const followersEnd = followers.at(-1)?.value ?? null;
  results.facebook = {
    provider: "facebook-graph",
    version: "facebook-v1",
    graphVersion: graph.graphVersion,
    pageId,
    pageName: selected.name,
    collectedAt,
    window: {
      since: since.toISOString(),
      until: until.toISOString(),
      requestedDays: 30,
    },
    profile,
    posts,
    metrics,
    summary: {
      followersStart,
      followersEnd,
      followersChange:
        followers.length > 1 && followersStart !== null && followersEnd !== null
          ? followersEnd - followersStart
          : null,
      latestPostAt,
      postsInWindow:
        posts.status === "available"
          ? posts.items.filter(
              (post) =>
                post.createdTime &&
                Date.parse(post.createdTime) >= since.getTime() &&
                Date.parse(post.createdTime) <= until.getTime(),
            ).length
          : null,
      postsInWindowComplete:
        posts.status === "available" &&
        !posts.truncated &&
        posts.items.every((post) => post.createdTime !== null),
    },
    coverage: {
      profileFieldsAvailable: Object.values(profile).filter(
        (field) => field.status === "available",
      ).length,
      profileFieldsMissing: Object.values(profile).filter(
        (field) => field.status === "missing",
      ).length,
      profileFieldsUnavailable: Object.values(profile).filter(
        (field) => field.status === "unavailable",
      ).length,
      metricsAvailable: metrics.filter(
        (metric) => metric.status === "available",
      ).length,
      metricsRequested: metrics.length,
      postsLimit: 50,
    },
    limitations: [
      "Read-only Facebook evidence; no overall or social score is defined.",
      "Daily metrics retain Meta period boundaries; the latest period may be incomplete. Totals cover returned periods only.",
      "Follower change compares the first and last returned snapshots; it is not a sum or a causal growth estimate.",
      "At most 50 recent posts are collected. Visibility and missing fields do not establish completeness of the public Page.",
      "Website consistency, visual image quality, comments, publishing and profile edits were not evaluated.",
    ],
  };
  if (posts.truncated)
    warnings.push(
      "Recent posts are bounded or incomplete; the saved list is not a complete posting history.",
    );
  const analysis = analyzeFacebook(results.facebook, auditId, results.evidence);
  results.facebook.analysisVersion = analysis.version;
  results.findings = analysis.findings;
  results.recommendations = analysis.recommendations;
  return { results, warnings, partial: warnings.length > 0 };
}
