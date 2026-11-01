// Explicit, bounded read-only Facebook recheck. Never run during automated tests/startup.
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ConfigService } from "@nestjs/config";
import { validateEnvironment } from "../dist/config/environment.js";
import { FacebookGraph, FacebookError, READ_PERMISSIONS } from "../dist/modules/facebook/facebook.service.js";
import { collectFacebookPostWindow } from "../dist/integrations/facebook/post-coverage.js";

if (!process.argv.includes("--confirmed")) throw new Error("Explicit --confirmed is required for authorized Facebook read-only validation.");
const root = fileURLToPath(new URL("../", import.meta.url));
try { process.loadEnvFile(resolve(root, ".env")); } catch { /* Missing config is handled without printing paths. */ }
process.env.MOCK_AI = "true"; process.env.AI_MODE = "mock"; process.env.AI_ENABLED = "false"; process.env.WORDPRESS_WRITES_ENABLED = "false";
const config = new ConfigService(validateEnvironment(process.env));
const graph = new FacebookGraph(config);
const directory = resolve(root, "reports/facebook");
const receipt = { version: "facebook-scoring-recheck-v1", startedAt: new Date().toISOString(), businessId: config.get("WORDPRESS_BUSINESS_ID"), requests: {}, permissions: [], profile: {}, timezone: null, publishing: null, failure: null, metaAiCalls: 0, aiLedgerUnchanged: false };
const ledgerPath = resolve(root, config.get("AI_USAGE_DB"));
const digestFiles = () => Promise.all(["", ".initialized", "-wal", "-shm", "-journal"].map(async suffix => {
  try { return createHash("sha256").update(await readFile(ledgerPath + suffix)).digest("hex"); }
  catch (error) { if (error.code === "ENOENT") return null; throw new Error("Cannot verify the protected AI ledger.", { cause: error }); }
}));
const before = await digestFiles();
let reserved = false;
const safeError = error => ({ code: error instanceof FacebookError ? error.code : "RECHECK_FAILED", providerCode: error instanceof FacebookError ? error.providerCode ?? null : null, providerSubcode: error instanceof FacebookError ? error.providerSubcode ?? null : null });
async function request(kind, path, token, params = {}) {
  const maximum = kind === "publishing" ? 4 : 1;
  if ((receipt.requests[kind] ?? 0) >= maximum) throw new Error("Further requests are blocked.");
  receipt.requests[kind] = (receipt.requests[kind] ?? 0) + 1;
  return graph.request(path, token, params);
}
try {
  const userToken = config.get("FACEBOOK_ACCESS_TOKEN");
  if (!userToken) throw new Error("A server-configured token is required; browser connections remain cookie-bound.");
  const db = new DatabaseSync(resolve(root, config.get("DATABASE_PATH")), { readOnly: true });
  let pageId;
  try {
    const row = db.prepare("SELECT data_json FROM assessment_records WHERE kind='assessment' AND business_id=? ORDER BY created_at DESC,id LIMIT 1").get(receipt.businessId);
    pageId = row ? JSON.parse(row.data_json).input.expectedAssets.facebookPageId : null;
  } finally { db.close(); }
  if (!/^\d+$/.test(pageId ?? "")) throw new Error("A pinned saved Facebook Page is required.");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "scoring-access-recheck.started.json"), JSON.stringify({ startedAt: receipt.startedAt, businessId: receipt.businessId }), { flag: "wx", mode: 0o600 });
  reserved = true;
  const permissions = await request("permissions", "me/permissions", userToken);
  if (!Array.isArray(permissions.data)) throw new Error("Invalid permission response.");
  receipt.permissions = permissions.data.map(item => ({ permission: String(item.permission).slice(0, 100), status: String(item.status).slice(0, 30) }));
  if (!READ_PERMISSIONS.every(permission => receipt.permissions.some(item => item.permission === permission && item.status === "granted"))) {
    receipt.failure = { code: "FACEBOOK_PERMISSIONS_REQUIRED", providerCode: null, providerSubcode: null };
  } else {
    const pages = await request("pages", "me/accounts", userToken, { fields: "id,name,access_token,tasks", limit: "100" });
    const page = Array.isArray(pages.data) ? pages.data.find(item => item.id === pageId) : null;
    if (!page || typeof page.access_token !== "string" || !page.access_token) throw new Error("The pinned Page is not visible to this token.");
    receipt.pageId = pageId;
    try {
      const profile = await request("profile", pageId, page.access_token, { fields: "id,name,about,description,website,phone,emails,category,hours,location" });
      if (profile.id !== pageId) throw new Error("The returned Page did not match.");
      const collectedAt = new Date().toISOString();
      receipt.profile = Object.fromEntries(["name", "about", "description", "website", "phone", "emails", "category", "hours", "location"].map(name => {
        const value = profile[name] ?? null;
        const missing = value === null || value === "" || typeof value === "object" && Object.keys(value).length === 0;
        return [name, { status: missing ? "missing" : "available", value, collectedAt }];
      }));
    } catch (error) { receipt.profileFailure = safeError(error); }
    try {
      const timezone = await request("timezone", pageId, page.access_token, { fields: "id,timezone" });
      receipt.timezone = { status: timezone.timezone === undefined || timezone.timezone === null ? "missing" : "available", value: timezone.timezone ?? null, collectedAt: new Date().toISOString() };
    } catch (error) { receipt.timezone = { status: "unavailable", ...safeError(error) }; }
    receipt.publishing = await collectFacebookPostWindow((path, params) => request("publishing", path, page.access_token, params), pageId, new Date().toISOString());
  }
} catch (error) {
  receipt.failure = safeError(error); process.exitCode = 1;
} finally {
  receipt.completedAt = new Date().toISOString();
  receipt.aiLedgerUnchanged = JSON.stringify(before) === JSON.stringify(await digestFiles());
  if (reserved) await writeFile(resolve(directory, "scoring-access-recheck.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...receipt, profile: Object.fromEntries(Object.entries(receipt.profile).map(([field, value]) => [field, { status: value.status, ...(field === "hours" ? { value: value.value } : {}) }])), publishing: receipt.publishing ? { status: receipt.publishing.status, count: receipt.publishing.items.length, coverage: receipt.publishing.coverage } : null }, null, 2));
  if (!receipt.aiLedgerUnchanged || receipt.failure) process.exitCode = 1;
}
