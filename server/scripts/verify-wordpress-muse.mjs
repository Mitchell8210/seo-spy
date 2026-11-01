// Execute only an individually administrator-approved intent; never enable live mode here.
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

const args = process.argv.slice(2);
assert.ok(args.includes("--confirmed"), "An explicit essential proof-of-concept request is required");
assert.ok(args.every(arg => arg === "--confirmed" || /^--(?:report-id|intent-id)=/.test(arg)), "Only an existing report and approved intent may be selected");
const argument = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const reportId = argument("report-id");
const intentId = argument("intent-id");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
assert.match(reportId ?? "", uuid);
assert.match(intentId ?? "", uuid);
process.env.LOG_LEVEL = "silent";
process.env.WORDPRESS_WRITES_ENABLED = "false";
const { AppModule } = await import("../dist/app.module.js");
const { configureApp } = await import("../dist/configure-app.js");
const { WordPressClient } = await import("../dist/integrations/wordpress/wordpress.client.js");
const { MetaMuseTransport } = await import("../dist/integrations/ai/meta-muse.provider.js");
const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
let calls = 0;
try {
  const config = app.get(ConfigService);
  assert.equal(config.get("MOCK_AI"), false, "An administrator must explicitly disable mock mode first");
  assert.equal(config.get("AI_ENABLED"), true, "Real analysis must be explicitly enabled by an administrator");
  assert.ok(["poc", "demo"].includes(config.get("AI_MODE")), "An explicit live mode is required");
  await app.listen(0, "127.0.0.1");
  const business = config.getOrThrow("WORDPRESS_BUSINESS_ID");
  const root = `${await app.getUrl()}/api/wordpress/businesses/${encodeURIComponent(business)}/reports/${reportId}`;
  const headers = { authorization: `Bearer ${config.getOrThrow("WORDPRESS_OPERATOR_KEY")}`, "content-type": "application/json" };
  app.get(WordPressClient).request = async () => { throw new Error("WordPress collection is forbidden during model evaluation"); };
  const transport = app.get(MetaMuseTransport);
  const send = transport.post.bind(transport);
  transport.post = async (...parameters) => { assert.equal(calls++, 0, "Only the approved dispatch may be attempted"); return send(...parameters); };
  const api = async (path, method = "GET", body) => {
    const response = await globalThis.fetch(root + path, { method, headers, redirect: "error", signal: globalThis.AbortSignal.timeout(150000), body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(response.status, method === "POST" ? 201 : 200, "Approved evaluation failed; inspect the ledger without retrying");
    return response.json();
  };
  const analysis = await api("/muse-analyses", "POST", { confirmed: true, intentId });
  assert.equal(analysis.isMock, false);
  config.set("AI_ENABLED", false);
  assert.deepEqual(await api(`/muse-analyses/${analysis.id}`), analysis);
  console.log(JSON.stringify({ analysisId: analysis.id, reportId, model: analysis.model, usage: analysis.usage, usageAttemptId: analysis.usageAttemptId, generationMode: analysis.generationMode, isMock: analysis.isMock, modelDispatches: calls, cacheReused: calls === 0, savedReadMatches: true, writesEnabled: false, output: analysis.output }, null, 2));
} catch {
  console.error("Approved Muse evaluation did not establish a saved result. No retry was attempted. Inspect persistent usage, any original analysis, and provider billing before requesting another approval.");
  process.exitCode = 1;
} finally { app.get(ConfigService).set("AI_ENABLED", false); await app.close(); }
