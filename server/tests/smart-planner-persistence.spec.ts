import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { SQLitePlannerRepository } from "../src/modules/smart-planner/planner.repository.js";
import { checksum, type PlannerRecordTask } from "../src/modules/smart-planner/planner.types.js";
import { AppDatabase, AppDatabaseError } from "../src/persistence/sqlite/app-database.js";
import { SQLiteBusinessRepository } from "../src/persistence/sqlite/sqlite.repositories.js";

const task = (): PlannerRecordTask => {
  const id = randomUUID(), now = new Date().toISOString();
  return { id, taskKey: `custom:${id}`, orderKey: `custom:${id}`, title: "Contact review", explanation: "Original notes", guidance: "Original guidance",
    priority: "Medium", category: "Admin", source: "Custom task", mode: "custom", status: "Needs Action", schedule: { day: "2026-11-02", hour: 9 },
    destination: null, notes: "Original notes", origin: null, sourceChannel: null, sourcePresent: true, completedAt: null, createdAt: now, updatedAt: now };
};
const mutation = (expectedRevision: number) => ({ expectedRevision, mutationId: randomUUID() });

describe("Smart Planner durable SQLite state", () => {
  let directory: string;
  let path: string;
  let databases: AppDatabase[];
  function open() {
    const database = new AppDatabase(new ConfigService({ DATABASE_PATH: path }));
    databases.push(database);
    new SQLiteBusinessRepository(database);
    return { database, repository: new SQLitePlannerRepository(database) };
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-planner-storage-"));
    path = join(directory, "application.sqlite");
    databases = [];
  });
  afterEach(async () => {
    databases.forEach(database => database.close());
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-planner-storage-")) throw new Error("Unexpected fixture directory");
    await rm(target, { recursive: true, force: true });
  });

  it("keeps initial reads read-only and saves schedules, completion timestamps and original guidance through restart", async () => {
    const { database, repository } = open();
    expect(await repository.read("demo-guzman")).toMatchObject({ revision: 0, useWeekends: false, tasks: [] });
    expect(database.connection().prepare("SELECT COUNT(*) count FROM smart_planners").get()?.count).toBe(0);
    const original = task(); original.status = "Done"; original.completedAt = "2026-11-02T12:00:00.000Z";
    const saved = await repository.mutate("demo-guzman", mutation(0), "complete-request", state => { state.useWeekends = true; state.tasks.push(original); });
    database.close();
    const reopened = open();
    expect(await reopened.repository.read("demo-guzman")).toEqual(saved);
    expect(saved.tasks[0]).toMatchObject({ completedAt: original.completedAt, guidance: "Original guidance", status: "Done", schedule: original.schedule });
    expect(await reopened.repository.read("other-business")).toMatchObject({ revision: 0, tasks: [] });
  });

  it("prevents stale writes across connections and retains duplicate receipts after intervening writes and restart", async () => {
    const first = open(), second = open();
    const submission = mutation(0);
    let applied = 0;
    await first.repository.mutate("demo-guzman", submission, "request-a", state => { applied++; state.tasks.push(task()); });
    await expect(second.repository.mutate("demo-guzman", mutation(0), "stale", state => { state.tasks.push(task()); })).rejects.toMatchObject({ status: 409 });
    await second.repository.mutate("demo-guzman", mutation(1), "weekends", state => { state.useWeekends = true; });
    first.database.close(); second.database.close();
    const reopened = open();
    const retried = await reopened.repository.mutate("demo-guzman", submission, "request-a", () => { applied++; });
    expect(applied).toBe(1);
    expect(retried).toMatchObject({ revision: 2, useWeekends: true });
    expect(retried.tasks).toHaveLength(1);
    await expect(reopened.repository.mutate("demo-guzman", submission, "changed-payload", () => {})).rejects.toMatchObject({ status: 409 });
    expect(reopened.database.connection().prepare("SELECT COUNT(*) count FROM smart_planner_mutations").get()?.count).toBe(2);
  });

  it("rolls back failed writes including header revision, task rows and duplicate receipts", async () => {
    const { database, repository } = open();
    const receipt = mutation(0);
    await expect(repository.mutate("demo-guzman", receipt, "invalid", state => {
      state.tasks.push(task(), { ...task(), status: "Done", completedAt: null });
    })).rejects.toBeInstanceOf(AppDatabaseError);
    expect(await repository.read("demo-guzman")).toMatchObject({ revision: 0, tasks: [] });
    expect(database.connection().prepare("SELECT COUNT(*) count FROM smart_planner_mutations").get()?.count).toBe(0);
    const valid = await repository.mutate("demo-guzman", receipt, "valid", state => { state.tasks.push(task()); });
    expect(valid.revision).toBe(1);
  });

  it("rejects corrupt stored checksums without erasing records", async () => {
    const { database, repository } = open();
    await repository.mutate("demo-guzman", mutation(0), "save", state => { state.tasks.push(task()); });
    database.connection().prepare("UPDATE smart_planner_tasks SET checksum='tampered' WHERE business_id=?").run("demo-guzman");
    await expect(repository.read("demo-guzman")).rejects.toBeInstanceOf(AppDatabaseError);
    expect(database.connection().prepare("SELECT COUNT(*) count FROM smart_planner_tasks").get()?.count).toBe(1);
  });

  it("fails closed when an initialized database disappears", async () => {
    const { database, repository } = open();
    await repository.mutate("demo-guzman", mutation(0), "save", state => { state.tasks.push(task()); });
    database.close();
    await unlink(path);
    await expect(repository.read("demo-guzman")).rejects.toBeInstanceOf(AppDatabaseError);
  });

  it.each([1, 2, 3])("upgrades schema %i transactionally while preserving original business, audit, artifact and adjunct data", async version => {
    const { database } = open();
    const db = database.connection();
    db.exec("CREATE TABLE unrelated_adjunct (id TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO unrelated_adjunct VALUES('original','keep');");
    const originalArtifact = JSON.stringify({ original: "immutable archive" });
    db.prepare("INSERT INTO artifacts(kind,id,business_id,created_at,payload_json,checksum) VALUES(?,?,?,?,?,?)").run("audit-report", "original-archive", "demo-guzman", "2026-10-27T00:00:00.000Z", originalArtifact, checksum(originalArtifact));
    const artifacts = db.prepare("SELECT * FROM artifacts ORDER BY id").all();
    const business = db.prepare("SELECT * FROM businesses ORDER BY id").all();
    const audits = db.prepare("SELECT * FROM audits ORDER BY id").all();
    db.exec("DROP TABLE smart_planner_mutations; DROP TABLE smart_planner_tasks; DROP TABLE smart_planners; DELETE FROM schema_migrations WHERE version IN (4,5,6);");
    if (version < 3) db.exec("DROP TABLE assessment_records; DELETE FROM schema_migrations WHERE version=3;");
    if (version < 2) db.exec("DROP TABLE google_reporting_cache; DELETE FROM schema_migrations WHERE version=2;");
    db.exec(`PRAGMA user_version=${version};`);
    const history = db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
    database.close();
    const migrated = open();
    expect(migrated.database.connection().prepare("PRAGMA user_version").get()?.user_version).toBe(6);
    expect(migrated.database.connection().prepare("SELECT * FROM businesses ORDER BY id").all()).toEqual(business);
    expect(migrated.database.connection().prepare("SELECT * FROM audits ORDER BY id").all()).toEqual(audits);
    expect(migrated.database.connection().prepare("SELECT * FROM artifacts ORDER BY id").all()).toEqual(artifacts);
    expect(migrated.database.connection().prepare("SELECT value FROM unrelated_adjunct WHERE id='original'").get()?.value).toBe("keep");
    expect(migrated.database.connection().prepare("SELECT * FROM schema_migrations ORDER BY version").all().slice(0, version)).toEqual(history);
    await migrated.repository.mutate("demo-guzman", mutation(0), "post-migration", state => { state.tasks.push(task()); });
    migrated.database.close();
    const twice = open();
    expect((await twice.repository.read("demo-guzman")).tasks).toHaveLength(1);
    expect(twice.database.connection().prepare("SELECT COUNT(*) count FROM schema_migrations").get()?.count).toBe(6);
  });
});
