// Prepare one concrete proposal for review; never Apply or enable writes.
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

process.env.LOG_LEVEL = "silent";
process.env.WORDPRESS_WRITES_ENABLED = "false";
process.env.AI_ENABLED = "false";
const { AppModule } = await import("../dist/app.module.js");
const { configureApp } = await import("../dist/configure-app.js");
const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
try {
  await app.listen(0, "127.0.0.1");
  const config = app.get(ConfigService);
  assert.equal(config.get("WORDPRESS_BUSINESS_ID"), "demo-guzman");
  assert.equal(new globalThis.URL(config.getOrThrow("WORDPRESS_SITE_URL")).hostname.replace(/^www\./, ""), "guzmantaxaccounting.com");
  const root = `${await app.getUrl()}/api/wordpress/businesses/demo-guzman`;
  const headers = { authorization: `Bearer ${config.getOrThrow("WORDPRESS_OPERATOR_KEY")}`, "content-type": "application/json" };
  const response = await globalThis.fetch(`${root}/proposals`, { method: "POST", headers, redirect: "error", signal: globalThis.AbortSignal.timeout(40000), body: JSON.stringify({ resource: "media", resourceId: 5522, changes: { altText: "Formularios de impuestos de Estados Unidos, calculadora, bolígrafo y dinero." } }) });
  assert.equal(response.status, 201);
  const proposal = await response.json();
  assert.equal(proposal.before.altText, "");
  assert.equal(proposal.resourceId, 5522);
  await mkdir("reports/wordpress", { recursive: true });
  await writeFile("reports/wordpress/alt-pilot-proposal.json", JSON.stringify(proposal, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ id: proposal.id, businessId: proposal.businessId, siteUrl: proposal.siteUrl, resource: proposal.resource, resourceId: proposal.resourceId, before: proposal.before, changes: proposal.changes, hash: proposal.hash, expiresAt: proposal.expiresAt, writesEnabled: false }, null, 2));
} catch {
  console.error("Alt-text proposal preparation failed; no Apply was requested and writes remain disabled.");
  process.exitCode = 1;
} finally { await app.close(); }
