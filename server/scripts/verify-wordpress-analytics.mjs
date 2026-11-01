// Explicit fixed analytics configuration reads. Never syncs, audits or mutates.
import "reflect-metadata";
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { URL, URLSearchParams } from "node:url";
import { WordPressClient, WordPressTransport } from "../dist/integrations/wordpress/wordpress.client.js";
import { WebsiteDns } from "../dist/integrations/website/collector.js";

const env = parseEnv(await readFile(new URL("../.env", import.meta.url), "utf8"));
assert.equal(env.WORDPRESS_BUSINESS_ID, "demo-guzman");
assert.equal(env.WORDPRESS_SITE_URL, "https://guzmantaxaccounting.com");
assert.equal(env.WORDPRESS_WRITES_ENABLED, "false");
const connection = { businessId: env.WORDPRESS_BUSINESS_ID, siteUrl: env.WORDPRESS_SITE_URL, username: env.WORDPRESS_USERNAME, applicationPassword: env.WORDPRESS_APPLICATION_PASSWORD };
const client = new WordPressClient(new WebsiteDns(), new WordPressTransport());
const report = { checkedAt: new Date().toISOString(), businessId: connection.businessId, writesEnabled: false, requests: [] };
function metrics(value) {
  if (Array.isArray(value)) return { type: "array", length: value.length, items: value.slice(0, 5).map(metrics) };
  if (!value || typeof value !== "object") return { type: value === null ? "null" : typeof value };
  const output = { type: "object", fields: Object.keys(value).filter(k => /^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(k)).slice(0, 50) };
  const numbers = ["clicks", "impressions", "ctr", "position", "rowCount"];
  output.numeric = Object.fromEntries(numbers.filter(k => typeof value[k] === "number" && Number.isFinite(value[k])).map(k => [k, value[k]]));
  if (Array.isArray(value.metricHeaders)) output.metricHeaders = value.metricHeaders.map(v => ({ name: ["totalUsers", "sessions", "screenPageViews", "engagementRate"].includes(v.name) ? v.name : "other", type: v.type }));
  if (Array.isArray(value.metricValues)) output.metricValues = value.metricValues.map(v => typeof v.value === "string" && /^-?\d+(\.\d+)?$/.test(v.value) ? Number(v.value) : null);
  for (const key of ["reports", "rows", "totals"]) if (Array.isArray(value[key])) output[key] = value[key].slice(0, 5).map(metrics);
  if (value.metadata && typeof value.metadata === "object") output.metadata = Object.fromEntries(["currencyCode", "timeZone", "subjectToThresholding", "dataLossFromOtherRow", "emptyReason"].filter(k => Object.hasOwn(value.metadata, k)).map(k => [k, value.metadata[k]]));
  return output;
}
const query = new URLSearchParams({ startDate: "2026-10-03", endDate: "2026-10-30", metrics: "totalUsers,sessions,screenPageViews,engagementRate", limit: "1" });
const searchQuery = new URLSearchParams({ startDate: "2026-10-03", endDate: "2026-10-30", rowLimit: "1" });
const reportMode = process.argv.includes("--reports");
const cachedMode = process.argv.includes("--cached");
const summaryMode = process.argv.includes("--cached-summary");
const paths = summaryMode ? ["/wp-json/rankmath/v1/an/analyticsSummary"] : cachedMode ? [
  "/wp-json/google-site-kit/v1/core/user/data/authentication",
  "/wp-json/rankmath/v1/an/dashboard",
  "/wp-json/rankmath/v1/an/analyticsSummary",
  "/wp-json/rankmath/v1/an/postsSummary",
] : reportMode ? [
  `/wp-json/google-site-kit/v1/modules/analytics-4/data/report?${query.toString()}`,
  `/wp-json/google-site-kit/v1/modules/search-console/data/searchanalytics?${searchQuery.toString()}`,
] : [
  "/wp-json/google-site-kit/v1/core/site/data/connection",
  "/wp-json/google-site-kit/v1/core/modules/data/list",
  "/wp-json/google-site-kit/v1/modules/analytics-4/data/settings",
  "/wp-json/google-site-kit/v1/modules/search-console/data/settings",
];
function summary(value) {
  if (Array.isArray(value)) return { type: "array", length: value.length, items: value.slice(0, 15).map(summary) };
  if (!value || typeof value !== "object") return { type: value === null ? "null" : typeof value };
  const keys = Object.keys(value).filter(k => /^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(k)).slice(0, 70);
  const output = { type: "object", fields: keys };
  const flags = ["connected", "active", "setupComplete", "setupCompleted", "verified", "hasConnectedAdmins", "resettable", "hasAccess", "useSnippet", "anonymizeIP", "accountID", "propertyID", "webDataStreamID", "measurementID", "ownerID"];
  output.configuration = Object.fromEntries(flags.filter(k => Object.hasOwn(value, k)).map(k => [k, typeof value[k] === "boolean" ? value[k] : value[k] !== null && value[k] !== "" && value[k] !== 0]));
  if (typeof value.slug === "string" && /^[a-z0-9-]{1,50}$/.test(value.slug)) output.slug = value.slug;
  for (const key of ["authenticated", "needsReauthentication"]) if (typeof value[key] === "boolean") output[key] = value[key];
  for (const key of ["requiredScopes", "grantedScopes", "unsatisfiedScopes"]) if (Array.isArray(value[key])) output[key] = value[key].filter(v => typeof v === "string" && /^https:\/\/www\.googleapis\.com\/auth\/[a-zA-Z0-9._-]+$/.test(v));
  return output;
}
function cached(value, depth = 0) {
  if (depth > 5) return { type: "bounded" };
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean" || value === null) return value;
  if (typeof value === "string") {
    if (["n/a", "N/A", "--", "—", "Not available", "No data"].includes(value)) return { availability: "unavailable", marker: value };
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    if (/^-?\d{1,3}(,\d{3})*(\.\d+)?%?$/.test(value)) return { formattedNumber: Number(value.replace(/[,%]/g, "")), percent: value.endsWith("%") };
    return { type: "string", empty: value === "" };
  }
  if (Array.isArray(value)) return { type: "array", length: value.length, items: value.slice(0, 5).map(v => cached(v, depth + 1)) };
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => /^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(key) && !/token|password|secret|email|account|user|credential/i.test(key)).slice(0, 45).map(([key, v]) => [key, cached(v, depth + 1)]));
  return { type: typeof value };
}
for (const path of paths) {
  const request = { path, diagnostic: null, result: null };
  try {
    const value = await client.request(connection, "GET", path, undefined, diagnostic => { request.diagnostic = diagnostic; });
    request.result = (cachedMode || summaryMode) && path.includes("/rankmath/") ? cached(value) : (reportMode ? metrics : summary)(value);
  }
  catch { /* Safe diagnostic already captured; never log response/error text. */ }
  report.requests.push(request);
}
await mkdir("reports/wordpress", { recursive: true });
await writeFile(`reports/wordpress/analytics-${summaryMode ? "cached-summary" : cachedMode ? "cached" : reportMode ? "metrics" : "access"}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
