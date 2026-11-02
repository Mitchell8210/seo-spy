import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { AssessmentStore, assessmentHash } from "../src/modules/assessments/assessment.store.js";
import { GoogleCacheStore } from "../src/modules/google/google-cache.store.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { SQLiteAuditRepository, SQLiteBusinessRepository } from "../src/persistence/sqlite/sqlite.repositories.js";

const businessId = "demo-guzman";
const timestamp = "2026-10-31T12:00:00.000Z";
const record = (patch: Partial<{ id: string; businessId: string; createdAt: string; value: number | null }> = {}) => ({ id: randomUUID(), businessId, createdAt: timestamp, value: 0, ...patch });

describe("immutable business-scoped assessment SQLite records and additive v3 migration", () => {
  let directory: string;
  let databasePath: string;
  let ledgerPath: string;
  let config: ConfigService;
  let database: AppDatabase;
  let store: AssessmentStore;
  const open = () => { database = new AppDatabase(config); database.ensureSeeded(); store = new AssessmentStore(database); };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-assessment-store-"));
    databasePath = join(directory, "application.sqlite"); ledgerPath = join(directory, "protected-ai.sqlite");
    config = new ConfigService({ DATABASE_PATH: databasePath, AI_USAGE_DB: ledgerPath });
    open();
  });
  afterEach(async () => {
    database.close();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-assessment-store-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });

  it("preserves every immutable record kind and zero/null values across restart", () => {
    const records = (["assessment", "analysis", "confirmed-facts", "edit-origin"] as const).map((kind, index) => ({ kind, payload: record({ value: index === 0 ? 0 : null }) }));
    for (const { kind, payload } of records) expect(store.write(kind, payload, assessmentHash({ kind, id: payload.id }))).toEqual(payload);
    database.close(); open();
    for (const { kind, payload } of records) {
      expect(store.read(kind, businessId, payload.id)).toEqual(payload);
      expect(store.list(kind, businessId)).toEqual([payload]);
      expect(store.byCacheKey(kind, businessId, assessmentHash({ kind, id: payload.id }))).toEqual(payload);
    }
  });

  it("reuses exact cached work without replacing the original ID, payload or timestamp", () => {
    const original = record();
    const key = assessmentHash({ source: "immutable-source", policy: "version-one" });
    expect(store.write("assessment", original, key)).toEqual(original);
    const repeated = record({ createdAt: "2026-11-01T00:00:00.000Z", value: 99 });
    expect(store.write("assessment", repeated, key)).toEqual(original);
    expect(store.read("assessment", businessId, repeated.id)).toBeNull();
    expect(store.list("assessment", businessId)).toEqual([original]);
    expect(store.write("assessment", original, assessmentHash({ source: "another-key" }))).toEqual(original);
    expect(() => store.write("assessment", { ...original, value: 42 }, assessmentHash({ source: "collision" }))).toThrow("Saved assessments could not be accessed safely.");
    expect(store.read("assessment", businessId, original.id)).toEqual(original);
  });

  it("isolates IDs/cache keys by business and record kind and rejects ownership collisions", () => {
    database.connection().prepare("INSERT INTO businesses(id,created_at,data_json) VALUES(?,?,?)").run("other-business", timestamp, JSON.stringify({ id: "other-business", name: "Other", website: "https://other.example", createdAt: timestamp }));
    const original = record(); const key = assessmentHash("shared-key");
    store.write("assessment", original, key);
    expect(store.read("assessment", "other-business", original.id)).toBeNull();
    expect(store.list("assessment", "other-business")).toEqual([]);
    expect(store.byCacheKey("assessment", "other-business", key)).toBeNull();
    expect(() => store.write("assessment", { ...original, businessId: "other-business" }, key)).toThrow("Saved assessments could not be accessed safely.");
    const other = record({ businessId: "other-business" });
    expect(store.write("assessment", other, key)).toEqual(other);
    expect(store.write("analysis", original, key)).toEqual(original);
    expect(store.read("assessment", businessId, original.id)).toEqual(original);
  });

  it("fails closed on altered payloads, identity or checksums instead of treating corruption as missing work", () => {
    const original = record(); const key = assessmentHash("cached");
    store.write("assessment", original, key);
    database.connection().prepare("UPDATE assessment_records SET data_json=? WHERE kind=? AND id=?").run(JSON.stringify({ ...original, value: 73 }), "assessment", original.id);
    for (const read of [() => store.read("assessment", businessId, original.id), () => store.list("assessment", businessId), () => store.byCacheKey("assessment", businessId, key), () => store.write("assessment", record(), key)]) {
      expect(read).toThrow("Saved assessments could not be accessed safely. No provider call or edit was started.");
    }
    const wrongIdentity = { ...original, id: randomUUID() };
    database.connection().prepare("UPDATE assessment_records SET data_json=?,checksum=? WHERE kind=? AND id=?").run(JSON.stringify(wrongIdentity), assessmentHash(wrongIdentity), "assessment", original.id);
    expect(() => store.read("assessment", businessId, original.id)).toThrow();
  });

  it("bounds record size and validates identity/date/cache keys without exposing filesystem or provider details", () => {
    const original = record();
    for (const [candidate, key] of [[{ ...original, id: "not-a-uuid" }, assessmentHash("valid")], [{ ...original, createdAt: "not-a-date" }, assessmentHash("valid")], [original, "private-provider-key"], [{ ...original, data: "x".repeat(2 * 1024 * 1024) }, assessmentHash("large")]] as const) {
      expect(() => store.write("assessment", candidate, key)).toThrow("Saved assessments could not be accessed safely.");
    }
    expect(store.list("assessment", businessId)).toEqual([]);
    expect(() => store.list("assessment", businessId, 101)).toThrow();
    expect(() => store.read("assessment", businessId, "bad-id")).toThrow();
    database.connection().exec("DROP TABLE assessment_records");
    expect(() => store.read("assessment", businessId, original.id)).toThrow();
    try { store.write("assessment", original, assessmentHash("valid")); } catch (error) { expect(String(error)).not.toContain(databasePath); expect(String(error)).not.toContain("INSERT"); }
  });

  it("migrates v2 to the current schema without rewriting application history, Google caches or any protected AI ledger file", async () => {
    const protectedFiles = ["", ".initialized", "-wal", "-shm", "-journal"];
    const protectedBytes = protectedFiles.map((suffix, index) => Buffer.from(`protected-${suffix}-${index}-must-never-be-opened-as-a-database`));
    for (const [index, suffix] of protectedFiles.entries()) await writeFile(ledgerPath + suffix, protectedBytes[index]);
    const originalBusiness = await new SQLiteBusinessRepository(database).findById(businessId);
    const originalAudit = await new SQLiteAuditRepository(database).latestCompleted(businessId);
    const artifact = { kind: "wordpress-proposal" as const, id: randomUUID(), businessId, createdAt: timestamp, payload: { id: "", businessId, before: { altText: "" }, changes: { altText: "Preserved proposal" } } };
    artifact.payload.id = artifact.id;
    database.insertArtifact(artifact);
    const cached = { key: "a".repeat(64), businessId, provider: "ga4" as const, expiresAt: timestamp, payload: { businessId, provider: "ga4", data: { sessions: 0 } } };
    new GoogleCacheStore(database).write(cached);
    const priorMigrations = database.connection().prepare("SELECT * FROM schema_migrations WHERE version IN (1,2) ORDER BY version").all();
    const priorCounts = database.connection().prepare("SELECT (SELECT COUNT(*) FROM suggestions) suggestions,(SELECT COUNT(*) FROM findings) findings,(SELECT COUNT(*) FROM artifacts) artifacts").get();
    database.connection().exec("BEGIN IMMEDIATE; DROP TABLE smart_planner_mutations; DROP TABLE smart_planner_tasks; DROP TABLE smart_planners; DROP TABLE assessment_records; DELETE FROM schema_migrations WHERE version IN (3,4,5,6); PRAGMA user_version=2; COMMIT;");
    database.close(); open();
    expect(database.connection().prepare("PRAGMA user_version").get()?.user_version).toBe(6);
    expect(database.connection().prepare("SELECT * FROM schema_migrations WHERE version IN (1,2) ORDER BY version").all()).toEqual(priorMigrations);
    expect(database.connection().prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }]);
    expect(await new SQLiteBusinessRepository(database).findById(businessId)).toEqual(originalBusiness);
    expect(await new SQLiteAuditRepository(database).latestCompleted(businessId)).toEqual(originalAudit);
    expect(database.readArtifact(artifact.kind, artifact.id)).toEqual(artifact);
    expect(new GoogleCacheStore(database).read(cached.key)).toEqual(cached);
    expect(database.connection().prepare("SELECT (SELECT COUNT(*) FROM suggestions) suggestions,(SELECT COUNT(*) FROM findings) findings,(SELECT COUNT(*) FROM artifacts) artifacts").get()).toEqual(priorCounts);
    const scored = record(); store.write("assessment", scored, assessmentHash("new-score"));
    database.close(); open();
    expect(store.read("assessment", businessId, scored.id)).toEqual(scored);
    for (const [index, suffix] of protectedFiles.entries()) expect(await readFile(ledgerPath + suffix)).toEqual(protectedBytes[index]);
  });
});
