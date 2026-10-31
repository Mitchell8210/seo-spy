import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AppDatabase, AppDatabaseError } from "../src/persistence/sqlite/app-database.js";
import { SQLiteAuditRepository, SQLiteBusinessRepository } from "../src/persistence/sqlite/sqlite.repositories.js";
import { createDemoBusiness, createSeedAudit } from "../src/fixtures/demo.js";
import type { Audit } from "../src/contracts/domain.js";

describe("SQLite application records and immutable artifacts", () => {
  let directory: string;
  let path: string;
  let databases: AppDatabase[];
  const make = () => {
    const database = new AppDatabase(new ConfigService({ DATABASE_PATH: path }));
    databases.push(database);
    return database;
  };
  const queued = (businessId = "demo-guzman"): Audit => ({ ...createSeedAudit(businessId), status: "queued", stage: "queued", startedAt: null, completedAt: null, results: null });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-application-db-"));
    path = join(directory, "application.sqlite");
    databases = [];
  });
  afterEach(async () => {
    for (const database of databases) database.close();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-application-db-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });

  it("persists business identity, connections and one original demo audit across restart", async () => {
    const database = make();
    const businesses = new SQLiteBusinessRepository(database);
    const audits = new SQLiteAuditRepository(database);
    const business = await businesses.findById("demo-guzman");
    const demo = await audits.latestCompleted("demo-guzman");
    expect(demo?.mode).toBe("demo");
    expect(demo?.createdAt).toBe("2026-10-27T00:00:00.000Z");
    const connections = await businesses.connections("demo-guzman");
    database.close();
    const reopened = make();
    expect(await new SQLiteBusinessRepository(reopened).findById("demo-guzman")).toEqual(business);
    expect(await new SQLiteBusinessRepository(reopened).connections("demo-guzman")).toEqual(connections);
    expect(await new SQLiteAuditRepository(reopened).latestCompleted("demo-guzman")).toEqual(demo);
    expect(reopened.connection().prepare("SELECT COUNT(*) count FROM audits").get()?.count).toBe(1);
  });
  it("preserves registered creation dates and ignores historical business snapshots during import", async () => {
    const businesses = new SQLiteBusinessRepository(make());
    const original = (await businesses.findById("demo-guzman"))!;
    await businesses.upsertBusiness({ ...original, name: "Updated name", createdAt: "2026-10-31T00:00:00.000Z" });
    expect(await businesses.findById(original.id)).toMatchObject({ name: "Updated name", createdAt: original.createdAt });
    expect(await businesses.importBusiness({ ...original, website: "https://different.example", createdAt: "2026-01-01T00:00:00.000Z" })).toBe(false);
    expect((await businesses.findById(original.id))?.website).toBe(original.website);
  });
  it("stores another registered business and rejects cross-business connection records atomically", async () => {
    const database = make();
    const businesses = new SQLiteBusinessRepository(database);
    const business = { ...createDemoBusiness(), id: "other", website: "https://other.example" };
    await businesses.upsertBusiness(business);
    await businesses.saveConnections("other", [{ id: "other-web", businessId: "other", platform: "website", status: "connected", mode: "live", identity: business.website }]);
    await expect(businesses.saveConnections("other", [{ id: "bad", businessId: "demo-guzman", platform: "facebook", status: "connected", mode: "demo", identity: "bad" }])).rejects.toBeInstanceOf(AppDatabaseError);
    expect(await businesses.connections("other")).toHaveLength(1);
    await expect(businesses.saveConnections("missing", [])).rejects.toBeInstanceOf(AppDatabaseError);
  });
  it("persists stages, status, timestamps and suggestions in one transaction", async () => {
    const database = make();
    const audits = new SQLiteAuditRepository(database);
    const audit = queued();
    expect(await audits.createIfIdle(audit)).toBe(true);
    audit.status = "running"; audit.stage = "evaluating_checks"; audit.startedAt = "2026-10-31T20:00:00.000Z";
    await audits.save(audit);
    expect(await audits.active(audit.businessId)).toEqual(audit);
    const complete = createSeedAudit(audit.businessId);
    complete.id = audit.id;
    complete.createdAt = audit.createdAt;
    complete.startedAt = audit.startedAt;
    for (const item of complete.results!.evidence) item.auditId = audit.id;
    for (const item of complete.results!.findings) item.auditId = audit.id;
    for (const item of complete.results!.recommendations) item.auditId = audit.id;
    await audits.save(complete);
    expect(await audits.active(audit.businessId)).toBeNull();
    const suggestions = database.connection().prepare("SELECT id,status,created_at,data_json FROM suggestions WHERE audit_id=?").all(audit.id);
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]).toMatchObject({ status: "needs_review", created_at: complete.completedAt });
    database.close();
    const reopened = new SQLiteAuditRepository(make());
    expect(await reopened.findById(audit.id)).toEqual(complete);
  });
  it("prevents duplicate active work across two database connections", async () => {
    const first = new SQLiteAuditRepository(make());
    const second = new SQLiteAuditRepository(make());
    const audit = queued();
    expect(await first.createIfIdle(audit)).toBe(true);
    expect(await second.createIfIdle(queued())).toBe(false);
    expect(await second.active(audit.businessId)).toEqual(audit);
    const ended = { ...audit, status: "failed" as const, stage: "failed" as const, completedAt: new Date().toISOString(), failure: { code: "TEST", message: "Controlled failure" } };
    await first.save(ended);
    expect(await second.createIfIdle(queued())).toBe(true);
  });
  it("keeps Facebook activity separate from the Website dashboard and active duplicate gate", async () => {
    const audits = new SQLiteAuditRepository(make());
    const website = queued();
    const facebook = { ...queued(), scope: "facebook" as const, mode: "live" as const, scoringVersion: "facebook-v1" as const };
    expect(await audits.createIfIdle(website)).toBe(true);
    expect(await audits.createIfIdle(facebook)).toBe(true);
    expect((await audits.active(website.businessId))?.id).toBe(website.id);
    expect(await audits.createIfIdle({ ...facebook, id: randomUUID() })).toBe(false);
    await audits.save({ ...facebook, status: "failed", stage: "failed", completedAt: new Date().toISOString() });
    expect((await audits.latestCompleted(website.businessId))?.scope).toBe("demo");
  });
  it("preserves interrupted work without automatically replaying it on restart", async () => {
    const database = make();
    const audit = queued();
    await new SQLiteAuditRepository(database).createIfIdle(audit);
    database.close();
    const reopened = new SQLiteAuditRepository(make());
    expect(await reopened.listInterruptedAudits()).toEqual([audit]);
    expect(await reopened.createIfIdle(queued())).toBe(false);
    expect((await reopened.findById(audit.id))?.status).toBe("queued");
  });
  it("retains the last completed results when a newer audit fails", async () => {
    const audits = new SQLiteAuditRepository(make());
    const old = await audits.latestCompleted("demo-guzman");
    const audit = queued();
    await audits.createIfIdle(audit);
    await audits.save({ ...audit, status: "failed", stage: "failed", completedAt: new Date().toISOString(), failure: { code: "FIXTURE", message: "Unavailable" } });
    expect(await audits.latestCompleted("demo-guzman")).toEqual(old);
  });
  it("does not permit audit identity changes or terminal-to-active replay", async () => {
    const audits = new SQLiteAuditRepository(make());
    const seed = (await audits.latestCompleted("demo-guzman"))!;
    await expect(audits.save({ ...seed, businessId: "different" })).rejects.toBeInstanceOf(AppDatabaseError);
    await expect(audits.save({ ...seed, createdAt: "2020-01-01T00:00:00.000Z" })).rejects.toBeInstanceOf(AppDatabaseError);
    await expect(audits.save({ ...seed, status: "queued", stage: "queued", completedAt: null })).rejects.toBeInstanceOf(AppDatabaseError);
    expect(await audits.findById(seed.id)).toEqual(seed);
  });
  it("imports terminal snapshots idempotently without overwriting an existing record", async () => {
    const audits = new SQLiteAuditRepository(make());
    const audit = createSeedAudit("demo-guzman");
    expect(await audits.importAudit(audit)).toBe(true);
    expect(await audits.importAudit(audit)).toBe(false);
    await expect(audits.importAudit({ ...audit, warnings: ["different"] })).rejects.toMatchObject({ code: "DATABASE_IMPORT_CONFLICT" });
    await expect(audits.importAudit(queued())).rejects.toBeInstanceOf(AppDatabaseError);
  });
  it("rejects malformed persisted audit JSON and mismatching relational metadata", async () => {
    const database = make();
    const audits = new SQLiteAuditRepository(database);
    const seed = (await audits.latestCompleted("demo-guzman"))!;
    database.connection().prepare("UPDATE audits SET data_json='{}' WHERE id=?").run(seed.id);
    await expect(audits.findById(seed.id)).rejects.toBeInstanceOf(AppDatabaseError);
  });
  it("preserves original immutable artifact payloads and business-scoped date order after restart", () => {
    const database = make();
    const first = { kind: "wordpress-evidence" as const, id: randomUUID(), businessId: "business", createdAt: "2026-10-30T00:00:00.000Z", payload: { source: "first" } };
    const last = { ...first, id: randomUUID(), createdAt: "2026-10-31T00:00:00.000Z", payload: { source: "last" } };
    expect(database.insertArtifact(first)).toBe(true);
    expect(database.insertArtifact(last)).toBe(true);
    expect(database.insertArtifact({ ...first, payload: { source: "changed" } })).toBe(false);
    expect(database.listArtifacts("wordpress-evidence", "business", 1)).toEqual([last]);
    expect(database.listArtifacts("wordpress-evidence", "other")).toEqual([]);
    database.close();
    expect(make().readArtifact(first.kind, first.id)).toEqual(first);
  });
  it("uses analysis IDs rather than source report IDs for Muse artifacts", () => {
    const database = make();
    const artifact = { kind: "wordpress-muse" as const, id: randomUUID(), businessId: "business", createdAt: "2026-10-31T00:00:00.000Z", payload: {} as Record<string, unknown> };
    artifact.payload = { id: artifact.id, reportId: randomUUID(), businessId: "business" };
    expect(database.insertArtifact(artifact)).toBe(true);
    expect(database.readArtifact(artifact.kind, artifact.id)).toEqual(artifact);
  });
  it("supports artifact operations inside an outer atomic import and rolls all records back on failure", () => {
    const database = make();
    const artifact = { kind: "audit-report" as const, id: randomUUID(), businessId: "legacy-unregistered", createdAt: "2026-10-31T00:00:00.000Z", payload: { schema: "fixture" } };
    expect(() => database.withTransaction(() => { database.insertArtifact(artifact); throw new Error("Fixture rollback"); })).toThrow(AppDatabaseError);
    expect(database.readArtifact(artifact.kind, artifact.id)).toBeNull();
    expect(database.withTransaction(() => database.insertArtifact(artifact))).toBe(true);
  });
  it("rejects artifact identity mismatches, checksum corruption and invalid date/size", () => {
    const database = make();
    const artifact = { kind: "wordpress-evidence" as const, id: randomUUID(), businessId: "business", createdAt: "2026-10-31T00:00:00.000Z", payload: { businessId: "wrong" } };
    expect(() => database.insertArtifact(artifact)).toThrow(AppDatabaseError);
    artifact.payload = { businessId: "business" };
    expect(() => database.insertArtifact({ ...artifact, createdAt: "not-date" })).toThrow(AppDatabaseError);
    database.insertArtifact(artifact);
    database.connection().prepare("UPDATE artifacts SET payload_json=? WHERE id=?").run('{"tampered":true}', artifact.id);
    expect(() => database.readArtifact(artifact.kind, artifact.id)).toThrow(AppDatabaseError);
  });
  it("preserves valid fractional/nonfractional UTC timestamps and sorts their actual times", () => {
    const database = make();
    const first = { kind: "wordpress-evidence" as const, id: randomUUID(), businessId: "business", createdAt: "2026-10-31T00:00:00Z", payload: { original: true } };
    const later = { ...first, id: randomUUID(), createdAt: "2026-10-31T00:00:00.001Z" };
    database.insertArtifact(first); database.insertArtifact(later);
    expect(database.listArtifacts(first.kind, first.businessId)).toEqual([later, first]);
    expect(database.readArtifact(first.kind, first.id)?.createdAt).toBe(first.createdAt);
  });
  it("rejects an existing corrupt database instead of silently replacing it", async () => {
    await writeFile(path, "not a SQLite database");
    expect(() => make().connection()).toThrow(AppDatabaseError);
  });
  it("rejects newer unknown schemas and missing initialized database files", async () => {
    const database = make();
    database.connection().exec("PRAGMA user_version=999");
    database.close();
    expect(() => make().connection()).toThrow(AppDatabaseError);
    await unlink(path);
    expect(() => make().connection()).toThrow(AppDatabaseError);
  });
  it("requires test mode for in-memory databases and refuses an empty preexisting database", async () => {
    const blank = new DatabaseSync(path); blank.close();
    expect(() => make().connection()).toThrow(AppDatabaseError);
  });
  it("rejects the protected AI ledger path before opening or changing it", () => {
    expect(() => new AppDatabase(new ConfigService({ DATABASE_PATH: path, AI_USAGE_DB: path }))).toThrow(AppDatabaseError);
    expect(() => new AppDatabase(new ConfigService({ DATABASE_PATH: "reports/ai-usage.sqlite" }))).toThrow(AppDatabaseError);
  });
});
