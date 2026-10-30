import { mkdir, writeFile } from "node:fs/promises";
import { URL } from "node:url";
import console from "node:console";

// Explicit bounded live diagnostics, not an exhaustive API compatibility claim.
// Store only allowlisted summaries; never save tokens, provider bodies or paging URLs.
export async function testAllPermissions(graph, config) {
  const token = config.getOrThrow("FACEBOOK_ACCESS_TOKEN");
  if (!token) throw new Error("Missing configured token");
  const report = {
    checkedAt: new Date().toISOString(),
    graphVersion: config.getOrThrow("FACEBOOK_GRAPH_VERSION"),
    readOnly: true,
    permissions: [],
    probes: [],
    pages: [],
  };
  const probe = async (
    label,
    permission,
    path,
    accessToken,
    params,
    summarize,
  ) => {
    try {
      const data = await graph.request(path, accessToken, params);
      const result = {
        label,
        permission,
        status: "accessible",
        ...summarize(data),
      };
      report.probes.push(result);
      return data;
    } catch (error) {
      report.probes.push({
        label,
        permission,
        status: "unavailable",
        code: error.code ?? "INVALID_RESPONSE",
        providerCode: error.providerCode,
        providerSubcode: error.providerSubcode,
      });
      return null;
    }
  };
  const permissionData = await graph.request("me/permissions", token);
  report.permissions = (permissionData.data ?? []).map((p) => ({
    permission: p.permission,
    status: p.status,
  }));
  const pages = await probe(
    "List managed Pages (first 5)",
    "pages_show_list",
    "me/accounts",
    token,
    { fields: "id,name,tasks,access_token", limit: "5" },
    (data) => ({
      count: data.data?.length ?? 0,
      moreAvailable: Boolean(data.paging?.next),
    }),
  );
  const businesses = await probe(
    "List business portfolios (first 5)",
    "business_management",
    "me/businesses",
    token,
    { fields: "id,name", limit: "5" },
    (data) => ({
      count: data.data?.length ?? 0,
      moreAvailable: Boolean(data.paging?.next),
    }),
  );
  for (const business of (businesses?.data ?? []).slice(0, 2)) {
    if (!/^\d+$/.test(business.id)) continue;
    for (const edge of ["owned_pages", "client_pages"]) {
      await probe(
        `Business ${business.id} ${edge}`,
        "business_management",
        `${business.id}/${edge}`,
        token,
        { fields: "id,name", limit: "5" },
        (data) => ({
          count: data.data?.length ?? 0,
          moreAvailable: Boolean(data.paging?.next),
        }),
      );
    }
  }
  const fields = [
    "name",
    "about",
    "description",
    "website",
    "phone",
    "emails",
    "hours",
    "location",
    "category",
    "category_list",
    "link",
    "username",
    "picture",
    "cover",
    "followers_count",
    "fan_count",
    "is_published",
    "is_verified",
    "verification_status",
    "overall_star_rating",
    "rating_count",
  ];
  const metrics = [
    "page_post_engagements",
    "page_media_view",
    "page_total_media_view_unique",
    "page_views_total",
    "page_follows",
    "page_daily_follows_unique",
    "page_daily_unfollows_unique",
    "page_actions_post_reactions_total",
    "page_video_views",
    "page_video_view_time",
    "page_impressions",
    "page_impressions_unique",
  ];
  const now = Math.floor(Date.now() / 1000);
  for (const page of (pages?.data ?? []).slice(0, 2)) {
    if (!/^\d+$/.test(page.id) || !page.access_token) continue;
    report.pages.push({
      id: page.id,
      name: page.name,
      tasks: page.tasks ?? [],
    });
    const pageToken = page.access_token;
    for (let i = 0; i < fields.length; i += 2) {
      await Promise.all(
        fields.slice(i, i + 2).map((field) =>
          probe(
            `Page ${page.id} field ${field}`,
            "pages_read_engagement",
            page.id,
            pageToken,
            { fields: `id,${field}` },
            (data) => ({
              present: Object.hasOwn(data, field),
              nonempty:
                data[field] !== undefined &&
                data[field] !== null &&
                data[field] !== "" &&
                (typeof data[field] !== "object" ||
                  Object.keys(data[field]).length > 0),
              ...(typeof data[field] === "number"
                ? { value: data[field] }
                : {}),
            }),
          ),
        ),
      );
    }
    const posts = await probe(
      `Page ${page.id} recent posts`,
      "pages_read_engagement",
      `${page.id}/posts`,
      pageToken,
      { fields: "id,created_time,message,permalink_url", limit: "5" },
      (data) => ({
        count: data.data?.length ?? 0,
        oldestReturned: data.data?.at(-1)?.created_time,
        newestReturned: data.data?.[0]?.created_time,
        moreAvailable: Boolean(data.paging?.next),
      }),
    );
    for (const edge of ["feed", "tagged", "ratings"]) {
      await probe(
        `Page ${page.id} user content ${edge}`,
        "pages_read_user_content",
        `${page.id}/${edge}`,
        pageToken,
        {
          limit: "5",
          ...(edge === "feed" || edge === "tagged"
            ? { fields: "id,created_time" }
            : {}),
        },
        (data) => ({
          count: data.data?.length ?? 0,
          moreAvailable: Boolean(data.paging?.next),
        }),
      );
    }
    const firstPost = posts?.data?.[0];
    if (firstPost && /^\d+_\d+$/.test(firstPost.id)) {
      for (const edge of ["comments", "reactions"]) {
        await probe(
          `Post ${firstPost.id} ${edge}`,
          edge === "comments"
            ? "pages_read_user_content"
            : "pages_read_engagement",
          `${firstPost.id}/${edge}`,
          pageToken,
          { fields: "id", limit: "5", summary: "true" },
          (data) => ({
            count: data.data?.length ?? 0,
            total: data.summary?.total_count,
            moreAvailable: Boolean(data.paging?.next),
          }),
        );
      }
      for (const metric of [
        "post_total_media_view",
        "post_total_media_view_unique",
        "post_impressions",
        "post_engaged_users",
      ]) {
        await probe(
          `Post insight ${metric}`,
          "read_insights",
          `${firstPost.id}/insights`,
          pageToken,
          { metric, period: "lifetime" },
          summarizeInsights,
        );
      }
    }
    for (let i = 0; i < metrics.length; i += 2) {
      await Promise.all(
        metrics.slice(i, i + 2).map((metric) =>
          probe(
            `Page ${page.id} insight ${metric}`,
            "read_insights",
            `${page.id}/insights`,
            pageToken,
            {
              metric,
              period: "day",
              since: String(now - 30 * 86400),
              until: String(now),
            },
            summarizeInsights,
          ),
        ),
      );
    }
    console.log(`Completed read-only probes for Page ${page.id}.`);
  }
  const dir = new URL("../reports/facebook/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const file = new URL(
    `permissions-${report.checkedAt.replace(/[:.]/g, "-")}.json`,
    dir,
  );
  await writeFile(file, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(
    JSON.stringify({ reportFile: file.pathname, ...report }, null, 2),
  );
  return report;
}

function summarizeInsights(data) {
  return {
    metrics: (data.data ?? []).map((metric) => ({
      name: metric.name,
      period: metric.period,
      points: metric.values?.length ?? 0,
      values: (metric.values ?? []).map((point) => ({
        end_time: point.end_time,
        value: typeof point.value === "number" ? point.value : undefined,
      })),
    })),
  };
}
