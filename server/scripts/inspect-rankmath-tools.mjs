// Explicit discovery only. Never executes sitewide audits or content mutations.
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
const report = { checkedAt: new Date().toISOString(), transport: "WordPress Abilities REST (no AI or MCP host required)", tools: [] };
try {
  for (const name of ["audit-site-seo", "analyze-post-content"]) {
    const value = await client.request(connection, "GET", `/wp-json/wp-abilities/v1/abilities/rank-math/${name}`);
    assert.equal(value.name, `rank-math/${name}`);
    report.tools.push({ name: value.name, description: value.description, inputSchema: value.input_schema, outputSchema: value.output_schema, annotations: value.meta?.annotations });
  }
} catch {
  report.failure = "Tool definition discovery failed; no execution was attempted.";
  process.exitCode = 1;
}
await mkdir("reports/wordpress", { recursive: true });
await writeFile("reports/wordpress/rankmath-tool-discovery.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
