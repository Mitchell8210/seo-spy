// Explicit read-only capability check. Never logs raw responses, tokens or people.
/* global AbortSignal */
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import { mkdir, writeFile } from "node:fs/promises";
import { URL } from "node:url";
import { ConfigService } from "@nestjs/config";
import { FacebookGraph } from "../dist/modules/facebook/facebook.service.js";
import { validateEnvironment } from "../dist/config/environment.js";

process.loadEnvFile(new URL("../.env", import.meta.url));
const config = new ConfigService(validateEnvironment({ ...process.env,
  MOCK_AI: "true", AI_MODE: "mock", AI_ENABLED: "false", WORDPRESS_WRITES_ENABLED: "false",
}));
const graph = new FacebookGraph(config);
const pageId = "608911535631168";
const report = { checkedAt: new Date().toISOString(), graphVersion: graph.graphVersion,
  readOnly: true, pageId, permissions: [], probes: [] };
const stop = AbortSignal.timeout(180000);
async function probe(label, path, token, params, summarize) {
  try {
    const data = await graph.request(path, token, params, true, stop);
    report.probes.push({ label, status: "accessible", ...summarize(data) });
    return data;
  } catch (error) {
    report.probes.push({ label, status: "unavailable", code: error.code ?? "INVALID_RESPONSE",
      providerCode: error.providerCode, providerSubcode: error.providerSubcode });
    return null;
  }
}
const listSummary = data => ({ count: data.data?.length ?? 0, moreAvailable: Boolean(data.paging?.next) });
const insightsSummary = data => ({ metrics: (data.data ?? []).map(metric => ({
  name: metric.name, period: metric.period, points: metric.values?.length ?? 0,
  values: (metric.values ?? []).map(point => ({ endTime: point.end_time,
    value: typeof point.value === "number" ? point.value :
      point.value && typeof point.value === "object" ? Object.fromEntries(
        Object.entries(point.value).filter(([key, value]) => /^[a-z_]+$/i.test(key) && typeof value === "number")) : null })),
})) });
try {
  const userToken = config.getOrThrow("FACEBOOK_ACCESS_TOKEN");
  if (!userToken) throw new Error("CONFIGURATION_REQUIRED");
  const permissions = await probe("Current token permissions", "me/permissions", userToken, {}, data => ({
    permissions: (data.data ?? []).map(item => ({ permission: item.permission, status: item.status })),
  }));
  if (!permissions) throw new Error("AUTHORIZATION_FAILED");
  report.permissions = (permissions.data ?? []).map(item => ({ permission: item.permission, status: item.status }));
  const pages = await probe("Authorized Page selection", "me/accounts", userToken,
    { fields: "id,access_token", limit: "100" }, listSummary);
  const page = pages?.data?.find(item => item.id === pageId);
  if (!page?.access_token) throw new Error("PAGE_NOT_AUTHORIZED");
  const token = page.access_token;
  const until = Math.floor(Date.now() / 1000);
  const params = { period: "day", since: String(until - 30 * 86400), until: String(until) };
  for (const metric of ["page_post_engagements", "page_actions_post_reactions_total",
    "page_activity_by_action_type", "page_consumptions_by_consumption_type", "page_total_actions",
    "page_website_clicks_logged_in_unique", "page_get_directions_clicks_logged_in_unique",
    "page_cta_clicks_logged_in_total", "page_messages_new_conversations_unique",
    "page_messages_total_messaging_connections", "page_messages_total_messaging_connections_unique",
    "page_daily_follows_unique"]) {
    await probe(metric, `${pageId}/insights`, token, { ...params, metric }, insightsSummary);
  }
  const posts = await probe("Recent post IDs", `${pageId}/posts`, token,
    { fields: "id,created_time", limit: "5" }, listSummary);
  for (const post of (posts?.data ?? []).slice(0, 2)) {
    if (!/^\d+_\d+$/.test(post.id)) continue;
    await probe(`Post ${post.id} interaction counts`, post.id, token,
      { fields: "id,shares,comments.limit(0).summary(true),reactions.type(LIKE).limit(0).summary(true)" },
      data => ({ likes: data.reactions?.summary?.total_count ?? null,
        comments: data.comments?.summary?.total_count ?? null, shares: data.shares?.count ?? null,
        countScope: "lifetime snapshot on this post; not 30-day interaction activity" }));
  }
  await probe("Tagged posts", `${pageId}/tagged`, token,
    { fields: "id,created_time", limit: "5", since: params.since, until: params.until }, listSummary);
  await probe("Mentioned posts", `${pageId}/feed`, token,
    { fields: "id,created_time", filter: "others", limit: "5", since: params.since, until: params.until }, listSummary);
  await probe("Messenger conversation metadata only", `${pageId}/conversations`, token,
    { fields: "id,updated_time", limit: "5" }, listSummary);
} catch (error) {
  report.failure = ["CONFIGURATION_REQUIRED", "AUTHORIZATION_FAILED", "PAGE_NOT_AUTHORIZED"].includes(error.message)
    ? error.message : "PROBE_FAILED";
  process.exitCode = 1;
}
const directory = new URL("../reports/facebook/", import.meta.url);
await mkdir(directory, { recursive: true });
const file = new URL(`contact-capabilities-${report.checkedAt.replace(/[:.]/g, "-")}.json`, directory);
await writeFile(file, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
