// Additive local database migration/recovery. No collection, model calls or site changes.
import "reflect-metadata";
import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

const args = process.argv.slice(2);
assert.ok(args.includes("--confirmed"), "Explicit local migration confirmation is required");
assert.ok(args.every(arg => ["--confirmed", "--workers-stopped"].includes(arg) || /^--recover-audit=/.test(arg)), "Unsupported migration option");
const recoveryId = args.find(arg => arg.startsWith("--recover-audit="))?.slice(16);
if (recoveryId) assert.ok(args.includes("--workers-stopped"), "Stop original workers before closing an interrupted run");
process.env.LOG_LEVEL = "silent";
process.env.MOCK_AI = "true";
process.env.AI_MODE = "mock";
process.env.AI_ENABLED = "false";
process.env.WORDPRESS_WRITES_ENABLED = "false";
const { AppModule } = await import("../dist/app.module.js");
const { AppDatabase } = await import("../dist/persistence/sqlite/app-database.js");
const { SQLiteBusinessRepository, SQLiteAuditRepository } = await import("../dist/persistence/sqlite/sqlite.repositories.js");
const { FileReportStore } = await import("../dist/reports/file-report.store.js");
const { WordPressReportsStore } = await import("../dist/modules/wordpress/wordpress-reports.store.js");
const { WordPressMuseStore } = await import("../dist/modules/wordpress/wordpress-muse.store.js");
const { WordPressActionsStore } = await import("../dist/modules/wordpress/wordpress-actions.store.js");
const { WordPressClient } = await import("../dist/integrations/wordpress/wordpress.client.js");
const { MetaMuseTransport } = await import("../dist/integrations/ai/meta-muse.provider.js");
const { migrateApplicationStorage, recoverInterruptedAudit } = await import("../dist/persistence/sqlite/migrate-storage.js");
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  let externalRequests = 0;
  app.get(WordPressClient).request = async () => { externalRequests++; throw new Error("Migration cannot contact WordPress"); };
  app.get(MetaMuseTransport).post = async () => { externalRequests++; throw new Error("Migration cannot contact Meta"); };
  const ledgerPath = resolve(fileURLToPath(new globalThis.URL("../", import.meta.url)), app.get(ConfigService).get("AI_USAGE_DB") ?? "reports/ai-usage.sqlite");
  const snapshotLedger = async () => {
    const files = {};
    for (const suffix of ["", ".initialized", "-wal", "-shm", "-journal"]) {
      try { files[suffix] = createHash("sha256").update(await readFile(ledgerPath + suffix)).digest("hex"); }
      catch (error) { if (error?.code !== "ENOENT") throw error; files[suffix] = null; }
    }
    return files;
  };
  const before = await snapshotLedger();
  const storage = { database: app.get(AppDatabase), businesses: app.get(SQLiteBusinessRepository), audits: app.get(SQLiteAuditRepository), reports: app.get(FileReportStore), wordpress: app.get(WordPressReportsStore), muse: app.get(WordPressMuseStore), actions: app.get(WordPressActionsStore) };
  const result = recoveryId ? await recoverInterruptedAudit(storage, recoveryId, true) : await migrateApplicationStorage(storage);
  assert.deepEqual(await snapshotLedger(), before, "The protected AI credit ledger must remain unchanged");
  assert.equal(externalRequests, 0);
  console.log(JSON.stringify({ ...result, aiLedgerFilesUnchanged: true, externalRequests }, null, 2));
} catch {
  console.error("SQLite adoption/recovery did not complete. Committed imports and original archives are preserved; inspect invalid records or storage and rerun the additive migration. No external request was made.");
  process.exitCode = 1;
} finally { await app.close(); }
