import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { SQLitePlannerRepository } from "../src/modules/smart-planner/planner.repository.js";
import { checksum, type PlannerRecordTask } from "../src/modules/smart-planner/planner.types.js";
import { AppDatabase, AppDatabaseError } from "../src/persistence/sqlite/app-database.js";
import { SQLiteBusinessRepository } from "../src/persistence/sqlite/sqlite.repositories.js";

const businessId = "demo-guzman";
const at = "2026-11-02T12:00:00.000Z";
function legacyTask(done: boolean): PlannerRecordTask {
  const id = randomUUID();
  return { id, taskKey: `custom:${id}`, orderKey: `custom:${id}`, title: done ? "Original completed work" : "Unscheduled older work",
    explanation: "Original notes", guidance: "Original historical guidance", priority: "Medium", category: "Admin", source: "Custom task", mode: "custom",
    status: done ? "Done" : "Needs Action", schedule: done ? { day: "2026-11-02", hour: 9 } : null, destination: null, notes: "Original notes",
    origin: null, sourceChannel: null, sourcePresent: true, completedAt: done ? at : null, createdAt: at, updatedAt: at };
}

describe("Smart Planner schema 4 to 5 migration and legacy history", () => {
  let directory: string;
  let databasePath: string;
  let ledgerPath: string;
  let databases: AppDatabase[];
  function open() {
    const database = new AppDatabase(new ConfigService({ NODE_ENV: "test", DATABASE_PATH: databasePath, AI_USAGE_DB: ledgerPath }));
    databases.push(database); new SQLiteBusinessRepository(database);
    return { database, repository: new SQLitePlannerRepository(database) };
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-planner-v2-migration-"));
    databasePath = join(directory, "application.sqlite"); ledgerPath = join(directory, "protected-ai.sqlite"); databases = [];
  });
  afterEach(async () => {
    for (const database of databases) database.close();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-planner-v2-migration-")) throw new Error("Unexpected fixture directory");
    await rm(target, { recursive: true, force: true });
  });
  function downgrade(database: AppDatabase) {
    // Reconstruct exactly the supported previous schema, only in this temporary DB.
    database.connection().exec(`BEGIN IMMEDIATE; DROP TABLE smart_planner_ai_proposals; DROP TABLE smart_planner_ai_preferences;
      ALTER TABLE smart_planner_mutations DROP COLUMN result_json;
      ALTER TABLE smart_planner_mutations DROP COLUMN result_checksum;
      ALTER TABLE smart_planner_tasks DROP COLUMN scheduled_minute;
      ALTER TABLE smart_planners DROP COLUMN daily_capacity_minutes;
      ALTER TABLE smart_planners DROP COLUMN max_tasks_per_day;
      ALTER TABLE smart_planners DROP COLUMN horizon_weeks;
      ALTER TABLE smart_planners DROP COLUMN time_zone;
      DELETE FROM schema_migrations WHERE version IN (5,6,7);
      PRAGMA user_version=4; COMMIT;`);
  }

  it("adds planning settings without rewriting legacy task payloads, checksums, IDs or protected state", async () => {
    const protectedSuffixes = ["", ".initialized", "-wal", "-shm"];
    const protectedContent = protectedSuffixes.map(suffix => Buffer.from(`Protected accounting fixture ${suffix} must not be opened`));
    for (const [index, suffix] of protectedSuffixes.entries()) await writeFile(ledgerPath + suffix, protectedContent[index]);
    const first = open(); downgrade(first.database);
    const db = first.database.connection();
    db.prepare("INSERT INTO smart_planners(business_id,revision,use_weekends,created_at,updated_at) VALUES(?,?,?,?,?)").run(businessId, 7, 0, at, at);
    const done = legacyTask(true), pending = legacyTask(false);
    const payloads = [done, pending].map(task => JSON.stringify(task, null, 2));
    for (const [position, task] of [done, pending].entries()) db.prepare("INSERT INTO smart_planner_tasks(id,business_id,task_key,status,scheduled_day,scheduled_hour,position,data_json,checksum) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(task.id, businessId, task.taskKey, task.status, task.schedule?.day ?? null, task.schedule?.hour ?? null, position, payloads[position], checksum(payloads[position]));
    const oldMutationId = randomUUID();
    db.prepare("INSERT INTO smart_planner_mutations(business_id,mutation_id,request_hash,revision,created_at) VALUES(?,?,?,?,?)").run(businessId, oldMutationId, "historical-request-hash", 3, at);
    db.exec("CREATE TABLE unrelated_adjunct(id TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO unrelated_adjunct VALUES('original','preserve');");
    const migrationHistory = db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
    const audits = db.prepare("SELECT * FROM audits ORDER BY id").all();
    const businesses = db.prepare("SELECT * FROM businesses ORDER BY id").all();
    first.database.close();

    const migrated = open();
    expect(migrated.database.connection().prepare("PRAGMA user_version").get()?.user_version).toBe(7);
    expect(migrated.database.connection().prepare("SELECT * FROM schema_migrations ORDER BY version").all().slice(0, 4)).toEqual(migrationHistory);
    expect(migrated.database.connection().prepare("SELECT * FROM audits ORDER BY id").all()).toEqual(audits);
    expect(migrated.database.connection().prepare("SELECT * FROM businesses ORDER BY id").all()).toEqual(businesses);
    expect(migrated.database.connection().prepare("SELECT value FROM unrelated_adjunct WHERE id='original'").get()?.value).toBe("preserve");
    const rows = migrated.database.connection().prepare("SELECT id,data_json,checksum,scheduled_minute FROM smart_planner_tasks ORDER BY position").all();
    expect(rows[0]).toEqual({ id: done.id, data_json: payloads[0], checksum: checksum(payloads[0]), scheduled_minute: 0 });
    expect(rows[1]).toEqual({ id: pending.id, data_json: payloads[1], checksum: checksum(payloads[1]), scheduled_minute: null });
    const state = await migrated.repository.read(businessId);
    expect(state).toMatchObject({ revision: 7, dailyCapacityMinutes: 120, maxTasksPerDay: 3, horizonWeeks: 4, timeZone: null });
    expect(state.tasks).toEqual([done, pending]);
    let duplicateApplied = false;
    const replay = await migrated.repository.mutate(businessId, { expectedRevision: 2, mutationId: oldMutationId }, "historical-request-hash", () => { duplicateApplied = true; });
    expect(duplicateApplied).toBe(false); expect(replay.revision).toBe(7);
    const originalReceipt = migrated.database.connection().prepare("SELECT request_hash,revision,created_at,result_json,result_checksum FROM smart_planner_mutations WHERE mutation_id=?").get(oldMutationId);
    expect(originalReceipt).toEqual({ request_hash: "historical-request-hash", revision: 3, created_at: at, result_json: null, result_checksum: null });

    const saved = await migrated.repository.mutate(businessId, { expectedRevision: 7, mutationId: randomUUID() }, "new-preference-request", current => {
      current.dailyCapacityMinutes = 90; current.maxTasksPerDay = 2; current.horizonWeeks = 2; current.timeZone = "UTC";
      const task = current.tasks.find(task => task.id === pending.id)!;
      task.payloadVersion = 2; task.estimatedDurationMinutes = 30; task.durationEstimateSource = "user"; task.scheduledBy = "manual";
      task.schedule = { day: "2026-11-03", hour: 9, minute: 30 };
    });
    expect(saved.tasks.find(task => task.id === done.id)).toEqual(done);
    migrated.database.close();
    const restarted = open();
    expect(await restarted.repository.read(businessId)).toEqual(saved);
    expect(restarted.database.connection().prepare("SELECT scheduled_minute FROM smart_planner_tasks WHERE id=?").get(pending.id)?.scheduled_minute).toBe(30);
    expect(restarted.database.connection().prepare("SELECT COUNT(*) count FROM schema_migrations").get()?.count).toBe(7);
    for (const [index, suffix] of protectedSuffixes.entries()) expect(await readFile(ledgerPath + suffix)).toEqual(protectedContent[index]);
  });

  it.each(["both", "checksum"])("repairs early schema-5 receipt columns (%s missing) without losing history or settings", async missing => {
    const first = open();
    const task = legacyTask(true);
    const mutation = { expectedRevision: 0, mutationId: randomUUID() };
    await first.repository.mutate(businessId, mutation, "original-request", state => { state.tasks.push(task); });
    const db = first.database.connection();
    const tasks = db.prepare("SELECT * FROM smart_planner_tasks").all();
    db.exec(`BEGIN IMMEDIATE; DROP TABLE smart_planner_ai_proposals; DROP TABLE smart_planner_ai_preferences;
      ${missing === "both" ? "ALTER TABLE smart_planner_mutations DROP COLUMN result_json;" : ""}
      ALTER TABLE smart_planner_mutations DROP COLUMN result_checksum;
      DELETE FROM schema_migrations WHERE version IN (6,7); PRAGMA user_version=5; COMMIT;`);
    const receipts = db.prepare("SELECT business_id,mutation_id,request_hash,revision,created_at FROM smart_planner_mutations").all();
    const history = db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
    first.database.close();
    const repaired = open();
    const connection = repaired.database.connection();
    expect(connection.prepare("PRAGMA user_version").get()?.user_version).toBe(7);
    expect(connection.prepare("SELECT * FROM schema_migrations ORDER BY version").all().slice(0, 5)).toEqual(history);
    expect(connection.prepare("SELECT * FROM smart_planner_tasks").all()).toEqual(tasks);
    expect(connection.prepare("SELECT business_id,mutation_id,request_hash,revision,created_at FROM smart_planner_mutations").all()).toEqual(receipts);
    await repaired.repository.mutate(businessId, mutation, "original-request", () => { throw new Error("Do not replay completed work"); });
    const saved = await repaired.repository.mutate(businessId, { expectedRevision: 1, mutationId: randomUUID() }, "edited-settings", state => {
      state.dailyCapacityMinutes = 180; state.maxTasksPerDay = 5; state.horizonWeeks = 6; state.timeZone = "America/Los_Angeles";
    });
    repaired.database.close();
    expect(await open().repository.read(businessId)).toEqual(saved);
    expect(saved.tasks).toEqual([task]);
  });

  it("fails closed on a stored schedule minute that disagrees with its checksummed payload", async () => {
    const { database, repository } = open();
    const task = legacyTask(true);
    await repository.mutate(businessId, { expectedRevision: 0, mutationId: randomUUID() }, "save-original", state => { state.tasks.push(task); });
    database.connection().prepare("UPDATE smart_planner_tasks SET scheduled_minute=30 WHERE id=?").run(task.id);
    await expect(repository.read(businessId)).rejects.toBeInstanceOf(AppDatabaseError);
    expect(database.connection().prepare("SELECT COUNT(*) count FROM smart_planner_tasks").get()?.count).toBe(1);
  });

  it("replays the original checksummed planning outcome after intervening writes and backend restart", async () => {
    const first = open();
    const submission = { expectedRevision: 0, mutationId: randomUUID() };
    const task = legacyTask(false);
    const outcome = { policyVersion: "planner-balanced-v2" as const, range: { start: "2026-11-02", end: "2026-11-30" }, scheduledCount: 1, remaining: [], overloadedDays: [] };
    await first.repository.mutate(businessId, submission, "original-planning-request", state => {
      state.timeZone = "UTC";
      state.tasks.push({ ...task, payloadVersion: 2, estimatedDurationMinutes: 60, durationEstimateSource: "default", scheduledBy: "auto", schedule: { day: "2026-11-02", hour: 9, minute: 30 } });
      state.mutationResult = outcome;
    });
    await first.repository.mutate(businessId, { expectedRevision: 1, mutationId: randomUUID() }, "another-setting", state => { state.horizonWeeks = 2; });
    first.database.close();
    const restarted = open();
    let applied = false;
    const replay = await restarted.repository.mutate(businessId, submission, "original-planning-request", () => { applied = true; });
    expect(applied).toBe(false);
    expect(replay.revision).toBe(2);
    expect(replay.horizonWeeks).toBe(2);
    expect(replay.mutationResult).toEqual(outcome);
    expect(replay.tasks).toHaveLength(1);
    expect((await restarted.repository.read(businessId)).mutationResult).toBeUndefined();
    restarted.database.connection().prepare("UPDATE smart_planner_mutations SET result_checksum='invalid' WHERE mutation_id=?").run(submission.mutationId);
    await expect(restarted.repository.mutate(businessId, submission, "original-planning-request", () => {})).rejects.toBeInstanceOf(AppDatabaseError);
    expect(restarted.database.connection().prepare("SELECT COUNT(*) count FROM smart_planner_tasks").get()?.count).toBe(1);
  });
});
