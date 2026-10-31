// Explicit read-only live collection. Creates a local report, never a remote edit/audit.
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
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
  const businessId = config.getOrThrow("WORDPRESS_BUSINESS_ID");
  const root = `${await app.getUrl()}/api/wordpress/businesses/${encodeURIComponent(businessId)}`;
  const headers = { authorization: `Bearer ${config.getOrThrow("WORDPRESS_OPERATOR_KEY")}`, "content-type": "application/json" };
  async function api(path, method = "GET", body) {
    const response = await globalThis.fetch(root + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: globalThis.AbortSignal.timeout(600000) });
    assert.equal(response.status, method === "POST" ? 201 : 200, "Unexpected evidence API response");
    return response.json();
  }
  assert.equal((await api("/connection")).writesEnabled, false);
  const report = await api("/reports", "POST", { sampleSize: 20 });
  assert.deepEqual(await api(`/reports/${report.id}`), report);
  assert.ok((await api("/reports?limit=1")).reports.some(item => item.id === report.id));
  const prepared = await api(`/reports/${report.id}/muse-evidence`);
  assert.equal(prepared.source.reportId, report.id);
  assert.equal(prepared.business.id, businessId);
  assert.equal(prepared.trust.modelExecutionEnabled, false);
  assert.equal(prepared.scoring.seoSpyScore, null);
  console.log(JSON.stringify({ id: report.id, businessId, generatedAt: report.generatedAt, availability: report.availability,
    content: report.content.map(section => ({ resource: section.resource, availability: section.availability, count: section.items.length })),
    rankMath: report.rankMath.map(section => ({ resource: section.resource, availability: section.evidence?.availability ?? "unavailable", storedScoreCount: section.evidence?.scores.items.length ?? 0 })),
    savedReadMatches: true, museEvidencePreparedWithoutModelCall: true, evidenceReferences: prepared.observations.length, writesEnabled: false, seoSpyScore: report.scoring.seoSpyScore }, null, 2));
} catch {
  console.error("WordPress report verification failed. Inspect sanitized API/storage errors; no edits or fresh audits were requested.");
  process.exitCode = 1;
} finally { await app.close(); }
