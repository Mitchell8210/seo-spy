// Run only after approval of the exact saved proposal ID/hash. One remote write maximum.
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

const args = process.argv.slice(2);
assert.ok(args.includes("--confirmed"), "Exact user approval is required");
const suppliedId = args.find(arg => arg.startsWith("--proposal-id="))?.slice(14);
const suppliedHash = args.find(arg => arg.startsWith("--proposal-hash="))?.slice(16);
const selected = JSON.parse(await readFile("reports/wordpress/alt-pilot-proposal.json", "utf8"));
assert.equal(selected.id, suppliedId);
assert.equal(selected.hash, suppliedHash);
assert.equal(selected.businessId, "demo-guzman");
assert.equal(selected.resource, "media");
assert.equal(selected.resourceId, 5522);
assert.equal(selected.before.altText, "");
assert.deepEqual(selected.changes, { altText: "Formularios de impuestos de Estados Unidos, calculadora, bolígrafo y dinero." });

process.env.LOG_LEVEL = "silent";
process.env.WORDPRESS_WRITES_ENABLED = "false";
process.env.AI_ENABLED = "false";
const { AppModule } = await import("../dist/app.module.js");
const { configureApp } = await import("../dist/configure-app.js");
const { WordPressClient } = await import("../dist/integrations/wordpress/wordpress.client.js");
const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
let config;
let remoteWrites = 0;
let result = { proposalId: selected.id, checkedAt: new Date().toISOString(), businessId: selected.businessId, mediaId: selected.resourceId, before: selected.before.altText, after: selected.changes.altText, outcome: null, publicVerification: null };
try {
  await app.listen(0, "127.0.0.1");
  config = app.get(ConfigService);
  assert.equal(config.get("WORDPRESS_BUSINESS_ID"), selected.businessId);
  assert.equal(config.get("WORDPRESS_SITE_URL"), selected.siteUrl);
  const client = app.get(WordPressClient);
  const request = client.request.bind(client);
  client.request = async (connection, method, path, body, observer) => {
    assert.ok(!path.includes("audit-site-seo/run"), "Fresh audit forbidden");
    if (method === "POST") {
      assert.equal(path, "/wp-json/wp/v2/media/5522");
      assert.equal(connection.siteUrl, selected.siteUrl);
      assert.deepEqual(body, { alt_text: selected.changes.altText });
      assert.equal(remoteWrites++, 0, "Only one remote write is authorized");
    }
    return request(connection, method, path, body, observer);
  };
  const root = `${await app.getUrl()}/api/wordpress/businesses/demo-guzman`;
  const headers = { authorization: `Bearer ${config.getOrThrow("WORDPRESS_OPERATOR_KEY")}`, "content-type": "application/json" };
  const api = async (path, method = "GET", body) => {
    const response = await globalThis.fetch(root + path, { method, headers, redirect: "error", signal: globalThis.AbortSignal.timeout(90000), body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(response.status, method === "POST" ? 201 : 200, "Unexpected pilot API response; inspect original receipt without retrying");
    return response.json();
  };
  const saved = await api(`/proposals/${selected.id}`);
  assert.equal(saved.hash, selected.hash);
  assert.deepEqual(saved.before, selected.before);
  assert.deepEqual(saved.changes, selected.changes);
  if (saved.executionStarted || saved.outcome) {
    result.outcome = saved.outcome;
    throw new Error("Prior execution must be inspected, not resent");
  }
  assert.ok(Date.parse(saved.expiresAt) > Date.now(), "Proposal expired; new review required");
  config.set("WORDPRESS_WRITES_ENABLED", true);
  try { result.outcome = await api(`/proposals/${selected.id}/apply`, "POST", { proposalHash: selected.hash, confirmed: true }); }
  finally { config.set("WORDPRESS_WRITES_ENABLED", false); }
  assert.equal(result.outcome.status, "applied");
  assert.equal(result.outcome.verification, "verified_stored_fields");
  const replay = await api(`/proposals/${selected.id}/apply`, "POST", { proposalHash: selected.hash, confirmed: true });
  assert.deepEqual(replay, result.outcome);
  assert.equal(remoteWrites, 1);
  assert.deepEqual((await api(`/proposals/${selected.id}`)).outcome, result.outcome);
  result.publicVerification = await api(`/proposals/${selected.id}/verifications`, "POST", { pageResource: "pages", pageId: 1513 });
  assert.deepEqual(await api(`/proposals/${selected.id}/verifications/${result.publicVerification.id}`), result.publicVerification);
  assert.equal((await api("/connection")).writesEnabled, false);
  result = { ...result, completed: true, remoteWrites, duplicateApplyReturnedSameReceipt: true, writesEnabled: false };
} catch {
  result = { ...result, completed: false, remoteWrites, limitation: "Pilot did not establish every verification result. Inspect the original proposal/execution record; no automatic write retry or restoration was attempted." };
  process.exitCode = 1;
} finally {
  config?.set("WORDPRESS_WRITES_ENABLED", false);
  await app.close();
  await writeFile("reports/wordpress/alt-pilot-result.json", JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}
