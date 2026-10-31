import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Audit, Business } from "../src/contracts/domain.js";
import { createDemoBusiness, createSeedAudit } from "../src/fixtures/demo.js";
import { WordPressActionsStore } from "../src/modules/wordpress/wordpress-actions.store.js";
import { WordPressMuseStore } from "../src/modules/wordpress/wordpress-muse.store.js";
import type { WordPressMuseAnalysis } from "../src/modules/wordpress/wordpress-muse.types.js";
import { WordPressReportsStore } from "../src/modules/wordpress/wordpress-reports.store.js";
import type { WordPressEvidenceReport } from "../src/modules/wordpress/wordpress-report.types.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { migrateApplicationStorage, recoverInterruptedAudit, type ApplicationStorage } from "../src/persistence/sqlite/migrate-storage.js";
import { SQLiteAuditRepository, SQLiteBusinessRepository } from "../src/persistence/sqlite/sqlite.repositories.js";
import { FileReportStore } from "../src/reports/file-report.store.js";

const at = "2026-10-29T12:00:00.000Z";
const actor = "a".repeat(64);

function evidence(businessId: string): WordPressEvidenceReport {
  return {
    schemaVersion: "seo-spy.wordpress-evidence.v1", collectionPolicyVersion: "published-unprotected-v1", id: randomUUID(), businessId, siteUrl: "https://example.com",
    startedAt: at, generatedAt: at, availability: "partial", sampleSize: 20,
    content: (["pages", "posts", "media"] as const).map(resource => ({ resource, collectedAt: at, availability: "available", items: resource === "pages" ? [{ id: 7, title: "Fixture published page", link: "https://example.com/page", modifiedAt: "2026-10-29T12:00:00", altText: null }] : [], limitations: ["A bounded fixture sample."] })),
    rankMath: (["pages", "posts"] as const).map(resource => ({ resource, evidence: null, limitations: ["Rank Math fixture evidence unavailable."] })),
    scoring: { seoSpyScore: null, policyVersion: null, storedScoreFreshness: "unknown" }, limitations: ["Fixture only; no external collection."],
  };
}
function analysis(report: WordPressEvidenceReport): WordPressMuseAnalysis {
  return {
    schemaVersion: "seo-spy.wordpress-muse-analysis.v1", id: randomUUID(), businessId: report.businessId, siteUrl: report.siteUrl, reportId: report.id,
    sourceHash: createHash("sha256").update(JSON.stringify(report)).digest("hex"), model: "muse-spark-1.3", promptVersion: "wordpress-muse-prompt-v1", outputSchemaVersion: "wordpress-muse-output-v1",
    startedAt: at, generatedAt: at, usage: { inputTokens: 0, outputTokens: 0 }, requestId: null,
    output: { schemaVersion: "wordpress-muse-output-v1", summary: "Mock migration fixture; source coverage is limited.", summaryEvidenceIds: [`${report.id}:wordpress:pages:7:content`], observations: [], recommendations: [], limitations: ["Mock fixture, not live AI output."], seoSpyScore: null },
    limitations: ["Mock fixture retained exactly during storage migration."], generationMode: "mock", provider: "mock-fixture", isMock: true, cacheKey: "b".repeat(64), fixtureVersion: "muse-development-fixtures-v1",
  };
}
function auditFor(business: Business): Audit {
  const audit = createSeedAudit(business.id);
  audit.createdAt = at;
  audit.startedAt = at;
  audit.completedAt = "2026-10-29T12:01:00.000Z";
  for (const item of audit.results?.evidence ?? []) item.collectedAt = at;
  return audit;
}

describe("additive SQLite storage adoption and explicit interrupted-run recovery", () => {
  let directory: string;
  let databases: AppDatabase[];
  let budgetFile: string;
  const historicalBusiness: Business = { id: "historical-business", name: "Original historical business", website: "https://example.com", createdAt: "2026-01-01T00:00:00.000Z" };
  const configuration = (databasePath: string) => new ConfigService({
    NODE_ENV: "test", DATABASE_PATH: databasePath, REPORTS_DIR: join(directory, "legacy-audits"), WORDPRESS_REPORTS_DIR: join(directory, "legacy-wordpress"),
    WORDPRESS_MUSE_DIR: join(directory, "legacy-muse"), WORDPRESS_ACTIONS_DIR: join(directory, "legacy-actions"), AI_USAGE_DB: budgetFile,
  });
  const openDatabase = (path: string) => { const database = new AppDatabase(configuration(path)); databases.push(database); return database; };
  const target = (): ApplicationStorage => {
    const database = openDatabase(join(directory, "application.sqlite"));
    const config = configuration(join(directory, "application.sqlite"));
    return { database, businesses: new SQLiteBusinessRepository(database), audits: new SQLiteAuditRepository(database), reports: new FileReportStore(config, database), wordpress: new WordPressReportsStore(config, database), muse: new WordPressMuseStore(config, database), actions: new WordPressActionsStore(config, database) };
  };
  async function legacySources(business = historicalBusiness) {
    const config = configuration(":memory:");
    const database = openDatabase(":memory:");
    const reports = new FileReportStore(config, database);
    const audit = auditFor(business);
    const reference = await reports.write(audit, business);
    const report = evidence(business.id);
    const interpretation = analysis(report);
    await new WordPressReportsStore(config, database).publish(report);
    await new WordPressMuseStore(config, database).publish(interpretation);
    const actions = new WordPressActionsStore(config, database);
    const base = { version: "wordpress-proposal-v1", id: randomUUID(), businessId: business.id, actor, siteUrl: report.siteUrl, resource: "media", resourceId: 7, createdAt: at, expiresAt: "2026-10-29T12:15:00.000Z", modified: "2026-10-29T11:00:00", before: { altText: "" }, changes: { altText: "Tax forms in a fixture image" } };
    const proposal = { ...base, hash: createHash("sha256").update(JSON.stringify(base)).digest("hex") };
    const outcome = { id: proposal.id, businessId: business.id, status: "outcome_unknown", verification: "inconclusive", completedAt: at };
    await actions.create(proposal.id, "proposal", proposal);
    await actions.create(proposal.id, "started", { businessId: business.id, actor, proposalHash: proposal.hash, startedAt: at });
    await actions.create(proposal.id, "outcome", outcome);
    const verificationId = randomUUID();
    await actions.create(verificationId, "verification", { id: verificationId, businessId: business.id, actor, proposalId: proposal.id, version: "wordpress-public-verification-v1", completedAt: at, status: "inconclusive" });
    const lockKey = "c".repeat(64);
    await writeFile(join(directory, "legacy-actions", `${lockKey}.target.lock`), "");
    const paths = [join(directory, "legacy-audits", reference.fileName), join(directory, "legacy-wordpress", `${report.id}.json`), join(directory, "legacy-muse", `${interpretation.id}.json`), ...["proposal", "started", "outcome"].map(kind => join(directory, "legacy-actions", `${proposal.id}.${kind}.json`)), join(directory, "legacy-actions", `${verificationId}.verification.json`), join(directory, "legacy-actions", `${lockKey}.target.lock`), budgetFile];
    const snapshots = new Map(await Promise.all(paths.map(async path => [path, await readFile(path)] as const)));
    return { audit, reference, report, interpretation, proposal, outcome, verificationId, lockKey, snapshots };
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-sqlite-migration-"));
    databases = [];
    budgetFile = join(directory, "untouched-ai-usage.sqlite");
    // Deliberately not a SQLite database: application adoption must never open/reset it.
    await writeFile(budgetFile, "Protected existing credit ledger bytes; do not open or change.");
  });
  afterEach(async () => {
    for (const database of databases) database.close();
    const path = resolve(directory);
    if (dirname(path) !== resolve(tmpdir()) || !basename(path).startsWith("seo-spy-sqlite-migration-")) throw new Error("Unexpected test directory");
    await rm(path, { recursive: true, force: true });
  });

  it("imports all legacy report/action sources additively, preserves timestamps/suggestions and is repeatable across restart", async () => {
    const legacy = await legacySources();
    const storage = target();
    const imported = await migrateApplicationStorage(storage);
    expect(imported).toMatchObject({ reports: { imported: 1 }, wordpress: { imported: 1 }, muse: { imported: 1 }, actions: { imported: 4 }, importedBusinesses: 1, importedAudits: 1, existingAudits: 0, interruptedAudits: [] });
    expect(await storage.businesses.findById(historicalBusiness.id)).toEqual(historicalBusiness);
    expect(await storage.audits.findById(legacy.audit.id)).toMatchObject({ createdAt: legacy.audit.createdAt, completedAt: legacy.audit.completedAt, results: { recommendations: legacy.audit.results!.recommendations } });
    expect(await storage.wordpress.read(legacy.report.id)).toEqual(legacy.report);
    expect(await storage.muse.read(legacy.interpretation.id)).toEqual(legacy.interpretation);
    expect(await storage.actions.read(legacy.proposal.id, "outcome")).toEqual(legacy.outcome);
    expect(await storage.actions.reserveTarget(legacy.lockKey)).toBeNull();
    const restarted = target();
    expect(await migrateApplicationStorage(restarted)).toMatchObject({ reports: { imported: 0, existing: 1 }, wordpress: { imported: 0, existing: 1 }, muse: { imported: 0, existing: 1 }, actions: { imported: 0, existing: 4 }, importedBusinesses: 0, importedAudits: 0, existingAudits: 1 });
    const suggestions = restarted.database.connection().prepare("SELECT * FROM suggestions WHERE audit_id=? ORDER BY id").all(legacy.audit.id);
    expect(suggestions).toHaveLength(legacy.audit.results!.recommendations.length);
    expect(suggestions.every(row => row.created_at === legacy.audit.completedAt && row.status === "needs_review")).toBe(true);
    for (const [path, original] of legacy.snapshots) expect(await readFile(path)).toEqual(original);
  });

  it("does not replace the current registered business/site with a historical report snapshot", async () => {
    const oldBusiness = { ...createDemoBusiness(), name: "Historical display name", website: "https://historical.example.com", createdAt: historicalBusiness.createdAt };
    const legacy = await legacySources(oldBusiness);
    const storage = target();
    await storage.businesses.upsertBusiness({ ...oldBusiness, name: "Current registered identity", website: "https://current.example.com", createdAt: at });
    const current = await storage.businesses.findById(oldBusiness.id);
    await migrateApplicationStorage(storage);
    expect(await storage.businesses.findById(oldBusiness.id)).toEqual(current);
    expect((await storage.reports.read(legacy.audit.id))?.business).toEqual(oldBusiness);
  });

  it("preserves an existing mutable runtime audit instead of replacing it with the archived terminal snapshot", async () => {
    const legacy = await legacySources();
    const storage = target();
    await storage.businesses.importBusiness(historicalBusiness);
    const running: Audit = { ...legacy.audit, status: "running", stage: "collecting_evidence", completedAt: null, results: null, warnings: ["Current persisted runtime state."] };
    expect(await storage.audits.createIfIdle(running)).toBe(true);
    const result = await migrateApplicationStorage(storage);
    expect(result).toMatchObject({ importedAudits: 0, existingAudits: 1, interruptedAudits: [expect.objectContaining({ id: running.id, status: "running" })] });
    expect(await storage.audits.findById(running.id)).toEqual(running);
    expect((await storage.reports.read(running.id))?.audit.status).toBe("completed");
  });

  it.each(["queued", "running"] as const)("requires stopped-worker confirmation to close a %s audit without replay, preserving any evidence", async status => {
    const storage = target();
    await storage.businesses.importBusiness(historicalBusiness);
    const fixture = auditFor(historicalBusiness);
    const interrupted: Audit = { ...fixture, status, stage: status === "queued" ? "queued" : "collecting_evidence", startedAt: status === "queued" ? null : fixture.startedAt, completedAt: null, results: status === "queued" ? null : fixture.results };
    await storage.audits.createIfIdle(interrupted);
    const protectedBytes = await readFile(budgetFile);
    await expect(recoverInterruptedAudit(storage, interrupted.id, false)).rejects.toMatchObject({ code: "DATABASE_RECOVERY_CONFIRMATION_REQUIRED" });
    expect(await storage.audits.findById(interrupted.id)).toEqual(interrupted);
    expect(await recoverInterruptedAudit(storage, interrupted.id, true)).toEqual({ auditId: interrupted.id, status: "failed", recovered: true, source: "operator_closed_interrupted_run" });
    const closed = await storage.audits.findById(interrupted.id);
    expect(closed).toMatchObject({ status: "failed", stage: "failed", failure: { code: "SERVER_INTERRUPTED" }, results: interrupted.results });
    expect(closed?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await storage.reports.read(interrupted.id))?.audit).toMatchObject({ status: "failed", failure: { code: "SERVER_INTERRUPTED" }, completedAt: closed?.completedAt });
    expect(await recoverInterruptedAudit(storage, interrupted.id, true)).toEqual({ auditId: interrupted.id, status: "failed", recovered: false });
    expect(await storage.audits.findById(interrupted.id)).toEqual(closed);
    expect((await readdir(join(directory, "legacy-audits"))).filter(name => name.endsWith(".json"))).toHaveLength(1);
    expect(await readFile(budgetFile)).toEqual(protectedBytes);
  });

  it("adopts an already committed terminal snapshot when the worker stopped before updating mutable audit state", async () => {
    const storage = target();
    await storage.businesses.importBusiness(historicalBusiness);
    const terminal = auditFor(historicalBusiness);
    const running: Audit = { ...terminal, status: "running", stage: "preparing_recommendations", completedAt: null };
    await storage.audits.createIfIdle(running);
    const reference = await storage.reports.write(terminal, historicalBusiness);
    const path = join(directory, "legacy-audits", reference.fileName);
    const original = await readFile(path);
    expect(await recoverInterruptedAudit(storage, running.id, true)).toEqual({ auditId: running.id, status: "completed", recovered: true, source: "saved_terminal_report" });
    expect(await storage.audits.findById(running.id)).toMatchObject({ status: "completed", completedAt: terminal.completedAt, failure: null, results: terminal.results, report: reference });
    expect(await recoverInterruptedAudit(storage, running.id, true)).toMatchObject({ recovered: false });
    expect(await readFile(path)).toEqual(original);
    expect((await readdir(dirname(path))).filter(name => name.endsWith(".json"))).toHaveLength(1);
  });
});
