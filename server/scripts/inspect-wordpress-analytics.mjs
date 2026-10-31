// Explicit analytics discovery. Fixed reads only; no reports, syncs or audits run.
import "reflect-metadata";
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { URL } from "node:url";
import { WordPressClient, WordPressTransport } from "../dist/integrations/wordpress/wordpress.client.js";
import { WebsiteDns } from "../dist/integrations/website/collector.js";

const env = parseEnv(await readFile(new URL("../.env", import.meta.url), "utf8"));
assert.equal(env.WORDPRESS_BUSINESS_ID, "demo-guzman");
assert.equal(env.WORDPRESS_SITE_URL, "https://guzmantaxaccounting.com");
assert.equal(env.WORDPRESS_WRITES_ENABLED, "false");
const connection = { businessId: env.WORDPRESS_BUSINESS_ID, siteUrl: env.WORDPRESS_SITE_URL, username: env.WORDPRESS_USERNAME, applicationPassword: env.WORDPRESS_APPLICATION_PASSWORD };
const client = new WordPressClient(new WebsiteDns(), new WordPressTransport());
const relevant = /analyt|statistic|site.?kit|monster|jetpack|independent|burst|matomo|plausible|slimstat|koko|rank.?math|seo-by-rank-math|traffic|page.?view|search.console|google|exactmetrics|clicky/i;
const report = { checkedAt: new Date().toISOString(), businessId: connection.businessId, siteUrl: connection.siteUrl, policy: "Fixed discovery GETs only; no audit, sync, tracking changes or analytics report execution", requests: [], plugins: [], namespaces: [], routes: [], abilities: [] };
async function get(path) {
  try {
    return await client.request(connection, "GET", path, undefined, diagnostic => report.requests.push({ path, ...diagnostic }));
  } catch { return null; }
}
const index = await get("/wp-json/");
if (index && typeof index === "object") {
  report.namespaces = (index.namespaces ?? []).filter(name => relevant.test(name));
  report.routes = Object.entries(index.routes ?? {}).filter(([path]) => relevant.test(path)).map(([path, value]) => ({ path, endpoints: (value.endpoints ?? []).map(endpoint => ({ methods: endpoint.methods, args: Object.fromEntries(Object.entries(endpoint.args ?? {}).map(([key, arg]) => [key, { type: arg.type, required: arg.required }])) })) }));
}
const plugins = await get("/wp-json/wp/v2/plugins?context=edit");
if (Array.isArray(plugins)) report.plugins = plugins.filter(p => relevant.test(`${p.plugin} ${p.name}`)).map(p => ({ plugin: p.plugin, name: p.name, version: p.version, status: p.status }));
const abilities = await get("/wp-json/wp-abilities/v1/abilities?per_page=100&page=1");
if (Array.isArray(abilities)) report.abilities = abilities.filter(v => relevant.test(v.name ?? "")).map(v => ({ name: v.name, inputSchema: v.input_schema, outputSchema: v.output_schema, annotations: v.meta?.annotations }));
await mkdir("reports/wordpress", { recursive: true });
await writeFile("reports/wordpress/analytics-discovery.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ checkedAt: report.checkedAt, requests: report.requests, plugins: report.plugins, namespaces: report.namespaces, routeCount: report.routes.length, abilityNames: report.abilities.map(v => v.name) }, null, 2));
if (!index || !plugins) process.exitCode = 1;
