import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { SQLiteAuditRepository, SQLiteBusinessRepository } from "../src/persistence/sqlite/sqlite.repositories.js";
import { GoogleCacheError, GoogleCacheStore, type GoogleCacheEntry } from "../src/modules/google/google-cache.store.js";

const key = "a".repeat(64);
const timestamp = "2026-10-31T12:00:00.000Z";
const entry = (patch: Partial<GoogleCacheEntry> = {}): GoogleCacheEntry => ({
  key, businessId: "business-one", provider: "ga4", expiresAt: timestamp,
  payload: { businessId: "business-one", provider: "ga4", data: { sessions: 0, activeUsers: 0, pageViews: 0 }, lastAttempt: { status: "success" } },
  ...patch,
});

describe("persistent Google response cache and additive schema migration", () => {
  let directory: string;
  let path: string;
  let ledgerPath: string;
  let databases: AppDatabase[];
  const make = () => {
    const database = new AppDatabase(new ConfigService({ DATABASE_PATH: path, AI_USAGE_DB: ledgerPath }));
    databases.push(database);
    return database;
  };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-google-cache-"));
    path = join(directory, "application.sqlite");
    ledgerPath = join(directory, "protected-ledger.sqlite");
    databases = [];
  });
  afterEach(async () => {
    for (const database of databases) database.close();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-google-cache-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });

  it("persists exact zero/null payloads and returns expired entries for service-level stale handling", () => {
    const database = make();
    const cache = new GoogleCacheStore(database);
    expect(cache.read(key)).toBeNull();
    const original = entry();
    cache.write(original);
    expect(cache.read(key)).toEqual(original);
    database.close();
    expect(new GoogleCacheStore(make()).read(key)).toEqual(original);
    const empty = entry({ payload: { businessId: "business-one", provider: "ga4", data: null, availability: "unavailable" } });
    cache.write(empty);
    expect(cache.read(key)).toEqual(empty);
  });

  it("retains caller-supplied prior data when updating a negative-cache response without creating a fresh result", () => {
    const cache = new GoogleCacheStore(make());
    cache.write(entry());
    const failure = entry({ expiresAt: "2026-10-31T12:01:00.000Z", payload: { businessId: "business-one", provider: "ga4", data: { sessions: 0 }, stale: true, collectedAt: timestamp, lastAttempt: { status: "failed", error: { code: "GOOGLE_PERMISSION_DENIED" } } } });
    cache.write(failure);
    expect(cache.read(key)).toEqual(failure);
    expect(cache.read("b".repeat(64))).toBeNull();
  });

  it("isolates keys and refuses moving a cached key between businesses or providers", () => {
    const cache = new GoogleCacheStore(make());
    const original = entry();
    cache.write(original);
    expect(() => cache.write(entry({ businessId: "another", payload: { businessId: "another", provider: "ga4" } }))).toThrow(GoogleCacheError);
    expect(() => cache.write(entry({ provider: "search-console", payload: { businessId: "business-one", provider: "search-console" } }))).toThrow(GoogleCacheError);
    expect(cache.read(key)).toEqual(original);
    const another = entry({ key: "b".repeat(64), businessId: "another", provider: "search-console", payload: { businessId: "another", provider: "search-console", rows: [] } });
    cache.write(another);
    expect(cache.read(another.key)).toEqual(another);
    expect(cache.read(key)).toEqual(original);
  });

  it("rejects invalid keys, scope mismatches, unsafe dates, oversized payloads and unserializable data", () => {
    const cache = new GoogleCacheStore(make());
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const candidate of [entry({ key: "../private-key" }), entry({ businessId: "" }), entry({ businessId: "bad\nbusiness" }), entry({ expiresAt: "not-a-date" }), entry({ payload: [] }), entry({ payload: { businessId: "other" } }), entry({ payload: { provider: "search-console" } }), entry({ payload: { huge: "x".repeat(1024 * 1024) } }), entry({ payload: cyclic })]) expect(() => cache.write(candidate)).toThrow(GoogleCacheError);
    expect(() => cache.read("private-key")).toThrow(GoogleCacheError);
    expect(cache.read(key)).toBeNull();
  });

  it("fails closed on checksum corruption or altered scope/expiry metadata without exposing database details", () => {
    const database = make();
    const cache = new GoogleCacheStore(database);
    cache.write(entry());
    database.connection().prepare("UPDATE google_reporting_cache SET data_json=? WHERE key=?").run(JSON.stringify({ private: "private provider response" }), key);
    expect(() => cache.read(key)).toThrow(GoogleCacheError);
    cache.write(entry());
    database.connection().prepare("UPDATE google_reporting_cache SET business_id=? WHERE key=?").run("other-business", key);
    expect(() => cache.read(key)).toThrow(GoogleCacheError);
    database.connection().prepare("UPDATE google_reporting_cache SET business_id=?,expires_at=? WHERE key=?").run("business-one", "bad-expiry", key);
    expect(() => cache.read(key)).toThrow("The Google response cache could not be accessed safely.");
    try { cache.read(key); } catch (error) { expect(String(error)).not.toContain(path); expect(String(error)).not.toContain("private provider"); }
  });

  it("does not turn database failures into cache misses or allow file fallback", () => {
    const database = make();
    const cache = new GoogleCacheStore(database);
    cache.write(entry());
    database.connection().exec("DROP TABLE google_reporting_cache");
    expect(() => cache.read(key)).toThrow(GoogleCacheError);
    expect(() => cache.write(entry())).toThrow(GoogleCacheError);
  });

  it("migrates a v1 application database transactionally without changing original history or the separate credit ledger", async () => {
    await writeFile(ledgerPath, "protected accounting state must not be opened");
    const database = make();
    const businesses = new SQLiteBusinessRepository(database);
    const audits = new SQLiteAuditRepository(database);
    const business = await businesses.findById("demo-guzman");
    const audit = await audits.latestCompleted("demo-guzman");
    const source = { kind: "wordpress-evidence" as const, id: "historical", businessId: "demo-guzman", createdAt: timestamp, payload: { id: "historical", businessId: "demo-guzman", collectedAt: timestamp, score: null } };
    database.insertArtifact(source);
    const originalMigration = database.connection().prepare("SELECT * FROM schema_migrations WHERE version=1").get();
    const originalCounts = database.connection().prepare("SELECT (SELECT COUNT(*) FROM suggestions) suggestions,(SELECT COUNT(*) FROM findings) findings").get();
    // Reconstruct the previous schema exactly, retaining all records and its original migration date.
    database.connection().exec("BEGIN IMMEDIATE; DROP TABLE smart_planner_mutations; DROP TABLE smart_planner_tasks; DROP TABLE smart_planners; DROP TABLE assessment_records; DROP TABLE google_reporting_cache; DELETE FROM schema_migrations WHERE version IN (2,3,4,5,6); PRAGMA user_version=1; COMMIT;");
    database.close();
    const migrated = make();
    expect(migrated.connection().prepare("PRAGMA user_version").get()?.user_version).toBe(6);
    expect(migrated.connection().prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }]);
    expect(migrated.connection().prepare("SELECT * FROM schema_migrations WHERE version=1").get()).toEqual(originalMigration);
    expect(await new SQLiteBusinessRepository(migrated).findById("demo-guzman")).toEqual(business);
    expect(await new SQLiteAuditRepository(migrated).latestCompleted("demo-guzman")).toEqual(audit);
    expect(migrated.connection().prepare("SELECT (SELECT COUNT(*) FROM suggestions) suggestions,(SELECT COUNT(*) FROM findings) findings").get()).toEqual(originalCounts);
    expect(migrated.readArtifact(source.kind, source.id)).toEqual(source);
    new GoogleCacheStore(migrated).write(entry());
    migrated.close();
    const reopened = make();
    expect(reopened.connection().prepare("SELECT COUNT(*) count FROM schema_migrations").get()?.count).toBe(6);
    expect(new GoogleCacheStore(reopened).read(key)).toEqual(entry());
    expect(await readFile(ledgerPath, "utf8")).toBe("protected accounting state must not be opened");
  });
});
