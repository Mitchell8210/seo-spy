// Run only after explicit authorization for one fresh audit of this bound site.
// Reuse the same request ID to inspect/replay; never replace it to retry uncertainty.
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

const requestId = process.argv.find(arg => arg.startsWith("--request-id="))?.slice("--request-id=".length);
if (!process.argv.includes("--confirmed") || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId ?? "")) {
  console.error("Requires explicit audit authorization, --confirmed and --request-id=<uuid-v4>.");
  process.exit(1);
}
process.env.LOG_LEVEL = "silent";
process.env.WORDPRESS_WRITES_ENABLED = "false";
const { AppModule } = await import("../dist/app.module.js");
const { configureApp } = await import("../dist/configure-app.js");
const { WordPressTransport } = await import("../dist/integrations/wordpress/wordpress.client.js");
const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
const config = app.get(ConfigService);
const report = { checkedAt: new Date().toISOString(), requestId, requests: [], remoteAuditDispatches: 0 };
try {
  assert.equal(config.get("WORDPRESS_BUSINESS_ID"), "demo-guzman");
  assert.equal(config.get("WORDPRESS_SITE_URL"), "https://guzmantaxaccounting.com");
  const transport = app.get(WordPressTransport);
  const send = transport.send.bind(transport);
  transport.send = (...args) => {
    assert.equal(args[2], "GET", "This diagnostic permits only remote GET requests");
    if (args[0].pathname.endsWith("/audit-site-seo/run")) {
      report.remoteAuditDispatches++;
      assert.equal(report.remoteAuditDispatches, 1, "Refusing a second remote audit dispatch");
    }
    return send(...args);
  };
  await app.listen(0, "127.0.0.1");
  const root = "/api/wordpress/businesses/demo-guzman";
  async function json(method, path, body) {
    const response = await globalThis.fetch(`${await app.getUrl()}${root}${path}`, {
      method, redirect: "error", signal: globalThis.AbortSignal.timeout(90000),
      headers: { authorization: `Bearer ${config.getOrThrow("WORDPRESS_OPERATOR_KEY")}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    report.requests.push({ method, path, status: response.status });
    assert.equal(response.ok, true, `HTTP ${response.status} on ${path}; inspect saved reservation before any retry`);
    return response.json();
  }
  config.set("WORDPRESS_WRITES_ENABLED", true);
  try {
    report.outcome = await json("POST", "/rank-math/audits", { requestId, confirmed: true });
    const dispatches = report.remoteAuditDispatches;
    assert.deepEqual(await json("POST", "/rank-math/audits", { requestId, confirmed: true }), report.outcome);
    assert.equal(report.remoteAuditDispatches, dispatches);
    report.replayVerified = true;
  } finally { config.set("WORDPRESS_WRITES_ENABLED", false); }
  const dispatches = report.remoteAuditDispatches;
  const receipt = await json("GET", `/rank-math/audits/${requestId}`);
  assert.deepEqual(receipt.outcome, report.outcome);
  assert.equal(report.remoteAuditDispatches, dispatches);
  report.receiptVerified = true;
  report.writesEnabledAfter = (await json("GET", "/connection")).writesEnabled;
  assert.equal(report.writesEnabledAfter, false);
  report.completed = true;
} catch {
  report.completed = false;
  report.failure = "Audit verification incomplete. Inspect the existing reservation/receipt; do not create another request ID to retry.";
  process.exitCode = 1;
} finally {
  config.set("WORDPRESS_WRITES_ENABLED", false);
  await app.close();
  await mkdir("reports/wordpress", { recursive: true });
  await writeFile(`reports/wordpress/audit-verification-${requestId}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
