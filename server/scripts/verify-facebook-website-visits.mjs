// Explicit one-shot read-only Google validation against the running local backend.
/* global fetch, AbortSignal */
import process from "node:process";
import console from "node:console";
import { URL, fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { validateEnvironment } from "../dist/config/environment.js";

if (!process.argv.includes("--confirmed")) throw new Error("Explicit --confirmed is required for a live Google read.");
process.loadEnvFile(new URL("../.env", import.meta.url));
const config = validateEnvironment({ ...process.env, MOCK_AI: "true", AI_MODE: "mock", AI_ENABLED: "false", WORDPRESS_WRITES_ENABLED: "false", AI_DEV_BUDGET_MICROS: "0" });
const businessId = config.GOOGLE_BUSINESS_ID || config.WORDPRESS_BUSINESS_ID;
const operator = config.GOOGLE_OPERATOR_KEY || config.WORDPRESS_OPERATOR_KEY;
if (!businessId || !operator) throw new Error("Server-only Google business/operator setup is required.");
const base = "http://localhost:3001";
const savedUrl = `${base}/api/businesses/${encodeURIComponent(businessId)}/facebook-report`;
const get = async (url, headers) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(60000), redirect: "error" });
  if (!response.ok) throw new Error(`Local reporting request failed (HTTP ${response.status}); no automatic retry.`);
  return response.json();
};
const saved = await get(savedUrl);
if (saved.businessId !== businessId || saved.report?.business.id !== businessId || saved.report.results.facebook.window.basis !== "complete-provider-days") throw new Error("No compatible saved business report.");
const { since, until } = saved.report.results.facebook.window;
const directory = new URL("../reports/google/", import.meta.url);
await mkdir(directory, { recursive: true });
const ledgerPath = resolve(fileURLToPath(new URL("../", import.meta.url)), config.AI_USAGE_DB);
async function ledgerSnapshot() {
  return Promise.all(["", ".initialized", "-wal", "-shm", "-journal"].map(async suffix => {
    try { return createHash("sha256").update(await readFile(ledgerPath + suffix)).digest("hex"); }
    catch (error) { if (error.code === "ENOENT") return null; throw new Error("Cannot verify protected AI ledger.", { cause: error }); }
  }));
}
const before = await ledgerSnapshot();
await writeFile(new URL(`facebook-visits-${saved.report.reportId}.started.json`, directory), JSON.stringify({ startedAt: new Date().toISOString(), reportId: saved.report.reportId, since, until, maximumReportRequests: 1 }), { flag: "wx" });
const url = new URL(`${base}/api/businesses/${encodeURIComponent(businessId)}/google/facebook-visits`);
url.searchParams.set("since", since); url.searchParams.set("until", until);
const visits = await get(url, { Authorization: `Bearer ${operator}` });
const refreshed = await get(savedUrl);
const after = await ledgerSnapshot();
const receipt = { reportId: saved.report.reportId, visits, savedReadMatches: JSON.stringify(refreshed.websiteVisits) === JSON.stringify(visits), metaLedgerUnchanged: JSON.stringify(before) === JSON.stringify(after) };
await writeFile(new URL(`facebook-visits-${saved.report.reportId}.json`, directory), JSON.stringify(receipt, null, 2), { flag: "wx" });
console.log(JSON.stringify(receipt, null, 2));
if (visits.status !== "available" || !receipt.savedReadMatches || !receipt.metaLedgerUnchanged) process.exitCode = 1;
