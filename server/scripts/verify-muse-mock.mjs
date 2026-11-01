// Local-only verification. No WordPress collection or real Meta request is permitted.
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

const reportId = process.argv.find(arg => arg.startsWith("--report-id="))?.slice(12);
assert.match(reportId ?? "", /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
process.env.LOG_LEVEL = "silent";
process.env.AI_ENABLED = "false";
process.env.MOCK_AI = "true";
process.env.AI_MODE = "mock";
process.env.WORDPRESS_WRITES_ENABLED = "false";
const { AppModule } = await import("../dist/app.module.js");
const { configureApp } = await import("../dist/configure-app.js");
const { WordPressClient } = await import("../dist/integrations/wordpress/wordpress.client.js");
const { MetaMuseTransport } = await import("../dist/integrations/ai/meta-muse.provider.js");
const { AiUsageStore } = await import("../dist/integrations/ai/ai-usage.store.js");
const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
let forbiddenCalls = 0;
try {
  await app.listen(0, "127.0.0.1");
  app.get(WordPressClient).request = async () => { forbiddenCalls++; throw new Error("External WordPress access is forbidden"); };
  app.get(MetaMuseTransport).post = async () => { forbiddenCalls++; throw new Error("Real model requests are forbidden"); };
  const config = app.get(ConfigService);
  const root = `${await app.getUrl()}/api/wordpress/businesses/${encodeURIComponent(config.getOrThrow("WORDPRESS_BUSINESS_ID"))}/reports/${reportId}`;
  const headers = { authorization: `Bearer ${config.getOrThrow("WORDPRESS_OPERATOR_KEY")}`, "content-type": "application/json" };
  const api = async (path, method = "GET", body) => {
    const response = await globalThis.fetch(root + path, { method, headers, redirect: "error", body: body === undefined ? undefined : JSON.stringify(body), signal: globalThis.AbortSignal.timeout(10000) });
    assert.equal(response.status, method === "POST" ? 201 : 200);
    return response.json();
  };
  const initialUsage = await app.get(AiUsageStore).status();
  const first = await api("/muse-analyses", "POST", { confirmed: true });
  const again = await api("/muse-analyses", "POST", { confirmed: true });
  assert.deepEqual(again, first);
  assert.equal(first.isMock, true);
  assert.equal(first.provider, "mock-fixture");
  assert.equal(first.generationMode, "mock");
  assert.deepEqual(first.usage, { inputTokens: 0, outputTokens: 0 });
  assert.deepEqual(await api(`/muse-analyses/${first.id}`), first);
  assert.deepEqual(await app.get(AiUsageStore).status(), initialUsage);
  assert.equal(forbiddenCalls, 0);
  console.log(JSON.stringify({ reportId, analysisId: first.id, isMock: true, savedReadMatches: true, cacheReused: true, externalRequests: 0, developmentCalls: initialUsage.development.calls, developmentChargedMicros: initialUsage.development.chargedMicros, demoCalls: initialUsage.demo.calls, demoChargedMicros: initialUsage.demo.chargedMicros, writesEnabled: false }, null, 2));
} catch {
  console.error("Local mock verification failed; external requests were blocked by the verification harness.");
  process.exitCode = 1;
} finally { await app.close(); }
