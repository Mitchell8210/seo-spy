// Explicit single-post evidence test. No sitewide audit, editing, AI or scoring.
import "reflect-metadata";
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { URL } from "node:url";
import { parseEnv } from "node:util";
import { WordPressClient, WordPressTransport } from "../dist/integrations/wordpress/wordpress.client.js";
import { WebsiteDns } from "../dist/integrations/website/collector.js";
import { analyzeRankMathPost } from "../dist/integrations/wordpress/rankmath-execution.js";

const postId = Number(process.argv.find(arg => arg.startsWith("--post-id="))?.slice(10));
assert.ok(Number.isSafeInteger(postId) && postId > 0, "Use --post-id=<existing-id>");
const env = parseEnv(await readFile(new URL("../.env", import.meta.url), "utf8"));
assert.equal(env.WORDPRESS_BUSINESS_ID, "demo-guzman");
assert.equal(env.WORDPRESS_SITE_URL, "https://guzmantaxaccounting.com");
assert.equal(env.WORDPRESS_WRITES_ENABLED, "false");
const connection = { businessId: env.WORDPRESS_BUSINESS_ID, siteUrl: env.WORDPRESS_SITE_URL, username: env.WORDPRESS_USERNAME, applicationPassword: env.WORDPRESS_APPLICATION_PASSWORD };
const transport = new WordPressTransport();
const send = transport.send.bind(transport);
let executions = 0;
transport.send = (...args) => {
  assert.equal(args[2], "GET");
  assert.ok(["/wp-json/wp-abilities/v1/abilities/rank-math/analyze-post-content", "/wp-json/wp-abilities/v1/abilities/rank-math/analyze-post-content/run"].includes(args[0].pathname));
  if (args[0].pathname.endsWith("/run")) assert.equal(++executions, 1, "No repeat execution allowed");
  return send(...args);
};
const client = new WordPressClient(new WebsiteDns(), transport);
const result = await analyzeRankMathPost((path, method = "GET", observer) => client.request(connection, method, `/wp-json${path}`, undefined, observer), postId);
const report = { businessId: connection.businessId, siteUrl: connection.siteUrl, executions, writesEnabled: false, result };
await mkdir("reports/wordpress", { recursive: true });
await writeFile(`reports/wordpress/post-evidence-${postId}-${Date.now()}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (result.status !== "success") process.exitCode = 1;
