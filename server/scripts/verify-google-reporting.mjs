// Explicit one-shot connectivity check. Never used by automated tests/startup.
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

if (!process.argv.includes("--confirmed")) {
  throw new Error("Requires --confirmed and administrator authorization for one Google request per API.");
}
process.env.LOG_LEVEL = "silent";
process.env.MOCK_AI = "true";
process.env.AI_MODE = "mock";
process.env.AI_ENABLED = "false";
process.env.WORDPRESS_WRITES_ENABLED = "false";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(root, "reports/google");
const { AppModule } = await import("../dist/app.module.js");
const { configureApp } = await import("../dist/configure-app.js");
const { GOOGLE_TOKEN_PROVIDER } = await import("../dist/integrations/google/google-auth.js");
const { GoogleTransport } = await import("../dist/integrations/google/google-transport.js");
const { MetaMuseTransport } = await import("../dist/integrations/ai/meta-muse.provider.js");
const calls = { oauth: 0, ga4: 0, searchConsole: 0, meta: 0 };
MetaMuseTransport.prototype.post = async () => {
  calls.meta += 1;
  throw new Error("Meta transport is prohibited during Google verification.");
};
const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
let receipt;
let ledgerBefore;
let ledgerPath;
let reserved = false;
async function ledgerSnapshot() {
  return Promise.all(["", ".initialized", "-wal", "-shm", "-journal"].map(async suffix => {
    try { return createHash("sha256").update(await readFile(ledgerPath + suffix)).digest("hex"); }
    catch (error) { if (error.code === "ENOENT") return null; throw new Error("Cannot verify protected AI ledger.", { cause: error }); }
  }));
}
try {
  const config = app.get(ConfigService);
  const businessId = config.get("GOOGLE_BUSINESS_ID") || config.get("WORDPRESS_BUSINESS_ID");
  const operator = config.get("GOOGLE_OPERATOR_KEY") || config.get("WORDPRESS_OPERATOR_KEY");
  if (!businessId || !operator || !config.get("GA4_PROPERTY_ID") || !config.get("GSC_SITE_URL")) {
    throw new Error("Google targets, business binding and local operator key must be configured first.");
  }
  await app.get(GOOGLE_TOKEN_PROVIDER).authorizationCacheKey(); // Local credential validation only.
  ledgerPath = resolve(root, config.get("AI_USAGE_DB"));
  ledgerBefore = await ledgerSnapshot();
  const transport = app.get(GoogleTransport);
  const post = transport.post.bind(transport);
  transport.post = async (destination, body, options) => {
    const kind = destination === "https://oauth2.googleapis.com/token" ? "oauth"
      : destination.startsWith("https://analyticsdata.googleapis.com/") ? "ga4"
        : destination.startsWith("https://www.googleapis.com/webmasters/") ? "searchConsole" : null;
    if (!kind || calls[kind] >= 1) throw new Error("Verification forbids additional upstream attempts.");
    calls[kind] += 1;
    return post(destination, body, options);
  };
  await app.listen(0, "127.0.0.1");
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(resolve(directory, "connectivity-verification.started.json"), JSON.stringify({ startedAt: new Date().toISOString(), maximumDataCallsPerApi: 1 }), { flag: "wx", mode: 0o600 });
    reserved = true;
  } catch { throw new Error("A connectivity run is already reserved. Inspect its receipt; do not rerun automatically."); }
  const base = await app.getUrl();
  receipt = { startedAt: new Date().toISOString(), calls, results: {}, cacheVerified: {}, metaLedgerUnchanged: false };
  for (const [provider, path] of [
    ["ga4", `/api/businesses/${encodeURIComponent(businessId)}/google/ga4`],
    ["searchConsole", `/api/businesses/${encodeURIComponent(businessId)}/google/search-console?days=30&view=queries`],
  ]) {
    async function get() {
      const response = await globalThis.fetch(`${base}${path}`, { headers: { authorization: `Bearer ${operator}` }, signal: globalThis.AbortSignal.timeout(45000) });
      if (!response.ok) return { httpStatus: response.status, availability: "unavailable", error: { code: "LOCAL_API_REJECTED" } };
      return response.json();
    }
    const result = await get();
    // Only allow sanitized fields; no raw headers, authentication, paths or provider bodies.
    receipt.results[provider] = { availability: result.availability, error: result.error ?? null, fetchedAt: result.fetchedAt ?? null, data: result.data ?? null, cache: result.cache ?? null };
    const count = calls[provider];
    if (result.cache?.expiresAt) {
      const cached = await get();
      receipt.cacheVerified[provider] = cached.cache?.hit === true && calls[provider] === count;
    } else receipt.cacheVerified[provider] = false;
  }
} catch {
  // Never print raw exceptions: upstream bodies/credential paths may be sensitive.
  console.error("Google verification could not finish. Check local configuration and the sanitized receipt if one exists. No automatic retry was attempted.");
  process.exitCode = 1;
} finally {
  await app.close();
  if (reserved && receipt) {
    receipt.completedAt = new Date().toISOString();
    receipt.metaLedgerUnchanged = JSON.stringify(ledgerBefore) === JSON.stringify(await ledgerSnapshot());
    await writeFile(resolve(directory, "connectivity-verification.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify(receipt, null, 2));
    if (!receipt.metaLedgerUnchanged || calls.meta || Object.values(receipt.results).some(result => result.availability === "unavailable")) process.exitCode = 1;
  }
}
