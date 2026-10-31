// One separately authorized live model call from an existing saved evidence report.
// No WordPress collection, fresh audit or content change is permitted in this process.
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

const args = process.argv.slice(2);
const argument = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
assert.ok(args.includes("--confirmed"), "One live model call requires explicit authorization");
const reportId = argument("report-id");
const model = argument("model");
const outputTokens = Number(argument("max-output-tokens"));
const inputBytes = Number(argument("max-input-bytes"));
assert.match(reportId ?? "", /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
assert.ok(["muse-spark-1.3", "muse-spark-1.2"].includes(model), "Select an approved Standard-mode model");
assert.ok(Number.isInteger(outputTokens) && outputTokens >= 16 && outputTokens <= 8000);
assert.ok(Number.isInteger(inputBytes) && inputBytes >= 4096 && inputBytes <= 131072);
process.env.LOG_LEVEL = "silent";
process.env.WORDPRESS_WRITES_ENABLED = "false";
process.env.AI_ENABLED = "true";
process.env.AI_MODEL = model;
process.env.AI_MAX_CALLS_PER_PROCESS = "1";
process.env.AI_MAX_CONCURRENCY = "1";
process.env.AI_MAX_OUTPUT_TOKENS = String(outputTokens);
process.env.AI_MAX_INPUT_BYTES = String(inputBytes);
const { AppModule } = await import("../dist/app.module.js");
const { configureApp } = await import("../dist/configure-app.js");
const { WordPressClient } = await import("../dist/integrations/wordpress/wordpress.client.js");
const { MetaMuseTransport } = await import("../dist/integrations/ai/meta-muse.provider.js");
const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
let calls = 0;
try {
  await app.listen(0, "127.0.0.1");
  const config = app.get(ConfigService);
  const business = config.getOrThrow("WORDPRESS_BUSINESS_ID");
  const root = `${await app.getUrl()}/api/wordpress/businesses/${encodeURIComponent(business)}/reports/${reportId}`;
  const headers = { authorization: `Bearer ${config.getOrThrow("WORDPRESS_OPERATOR_KEY")}`, "content-type": "application/json" };
  app.get(WordPressClient).request = async () => { throw new Error("Live WordPress access is forbidden during model evaluation"); };
  const transport = app.get(MetaMuseTransport);
  const send = transport.post.bind(transport);
  transport.post = async (...parameters) => { assert.equal(calls++, 0, "Only one model dispatch is authorized"); return send(...parameters); };
  const api = async (path, method = "GET", body) => {
    const response = await globalThis.fetch(root + path, { method, headers, redirect: "error", signal: globalThis.AbortSignal.timeout(150000), body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    assert.equal(response.status, method === "POST" ? 201 : 200, `Live model evaluation returned ${value.error?.code ?? "unexpected status"}; no retry permitted`);
    return value;
  };
  const evidence = await api("/muse-evidence");
  assert.equal(calls, 0);
  const analysis = await api("/muse-analyses", "POST", { confirmed: true });
  config.set("AI_ENABLED", false);
  assert.deepEqual(await api(`/muse-analyses/${analysis.id}`), analysis);
  assert.equal(calls, 1);
  console.log(JSON.stringify({ analysisId: analysis.id, reportId, businessId: business, model: analysis.model, usage: analysis.usage, sourceHashMatches: evidence.source.contentHash === analysis.sourceHash, savedReadMatches: true, modelDispatches: calls, writesEnabled: false, output: analysis.output, limitations: analysis.limitations }, null, 2));
} catch {
  console.error("Live Muse evaluation did not establish a saved validated analysis. No retry was attempted; inspect the saved report/analysis and provider usage before another request.");
  process.exitCode = 1;
} finally { app.get(ConfigService).set("AI_ENABLED", false); await app.close(); }
