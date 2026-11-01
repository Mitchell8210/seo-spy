// Explicit live, read-only verification through the compiled module's HTTP API.
// Never creates proposals, applies changes or triggers a Rank Math audit.
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

process.env.LOG_LEVEL = "silent";
process.env.WORDPRESS_WRITES_ENABLED = "false";
const { AppModule } = await import("../dist/app.module.js");
const { configureApp } = await import("../dist/configure-app.js");
const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
const report = { checkedAt: new Date().toISOString(), policy: "Module GET requests only; writes and fresh audits disabled", requests: [], content: {}, rankMath: {} };
try {
  await app.listen(0, "127.0.0.1");
  const config = app.get(ConfigService);
  const business = config.getOrThrow("WORDPRESS_BUSINESS_ID");
  const token = config.getOrThrow("WORDPRESS_OPERATOR_KEY");
  const root = `/api/wordpress/businesses/${encodeURIComponent(business)}`;
  async function get(path, { key = token, expected = 200 } = {}) {
    const response = await globalThis.fetch(`${await app.getUrl()}${path}`, {
      headers: { authorization: `Bearer ${key}` },
      redirect: "error", signal: globalThis.AbortSignal.timeout(120000),
    });
    const value = await response.json();
    report.requests.push({ method: "GET", path, status: response.status, code: value.error?.code ?? null });
    console.log(JSON.stringify(report.requests.at(-1)));
    assert.equal(response.status, expected, `Unexpected HTTP status on ${path}`);
    return value;
  }
  report.connection = await get(`${root}/connection`);
  assert.equal(report.connection.authenticated, true);
  assert.equal(report.connection.writesEnabled, false);
  await get(`${root}/connection`, { key: "invalid-operator-key", expected: 401 });
  await get("/api/wordpress/businesses/unregistered-business/connection", { expected: 404 });
  for (const resource of ["pages", "posts", "media"]) {
    const list = await get(`${root}/content/${resource}?page=1&perPage=3`);
    const item = list.items[0];
    report.content[resource] = { sampledIds: list.items.map(item => item.id), representative: null };
    if (!item) continue;
    const { content } = await get(`${root}/content/${resource}/${item.id}`);
    const fields = resource === "media" ? ["title", "alt_text", "caption", "description", "slug"] : ["title", "content", "excerpt", "slug"];
    report.content[resource].representative = {
      id: content.id, modifiedGmt: content.modified_gmt ?? null,
      originalFieldsAvailable: Object.fromEntries(fields.map(field => [field, typeof content[field] === "string" || typeof content[field]?.raw === "string"])),
    };
    if (resource !== "media") report.rankMath[resource] = (await get(`${root}/rank-math/evidence?resource=${resource}&id=${item.id}`)).evidence;
  }
  report.completed = true;
} catch (error) {
  // Do not log raw exceptions or remote content; errors can contain private data.
  report.completed = false;
  report.failure = error instanceof assert.AssertionError ? error.message : "Verification failed; inspect sanitized request outcomes and network access.";
  process.exitCode = 1;
} finally {
  await app.close();
  await mkdir("reports/wordpress", { recursive: true });
  await writeFile("reports/wordpress/module-verification.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
