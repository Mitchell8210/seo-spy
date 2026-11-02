import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PlannerAiStore, type AiProposalRecord } from "../src/modules/smart-planner/planner-ai.store.js";
import { defaultAiSettings, makeAiSnapshot, offlineAiProposal, PLANNER_AI_PROMPT_VERSION, PLANNER_AI_SCHEMA_VERSION, snapshotHash } from "../src/modules/smart-planner/planner-ai.domain.js";
import { SQLitePlannerRepository } from "../src/modules/smart-planner/planner.repository.js";
import type { PlannerResponseDto } from "../src/modules/smart-planner/planner.dto.js";
import { checksum, type PlannerRecordTask } from "../src/modules/smart-planner/planner.types.js";
import { AppDatabase, AppDatabaseError } from "../src/persistence/sqlite/app-database.js";
import { SQLiteBusinessRepository } from "../src/persistence/sqlite/sqlite.repositories.js";

const businessId = "demo-guzman", at = "2026-11-02T08:00:00.000Z";
function task(): PlannerRecordTask {
  const id = randomUUID();
  return { id, taskKey: `custom:${id}`, orderKey: `custom:${id}`, title: "Original work", explanation: "Original notes", guidance: "Original guidance",
    priority: "Medium", category: "Review", source: "Custom task", mode: "custom", status: "Needs Action", schedule: null,
    destination: null, notes: "Keep notes", origin: null, sourceChannel: null, sourcePresent: true, completedAt: null, createdAt: at, updatedAt: at };
}
describe("Smart Planner AI schema 7 migration and immutable proposal durability", () => {
  let directory: string, path: string, ledgerPath: string, databases: AppDatabase[];
  function open() {
    const database = new AppDatabase(new ConfigService({ NODE_ENV: "test", DATABASE_PATH: path, AI_USAGE_DB: ledgerPath })); databases.push(database);
    new SQLiteBusinessRepository(database); return { database, repository: new SQLitePlannerRepository(database), store: new PlannerAiStore(database) };
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-planner-ai-migration-")); path = join(directory, "application.sqlite"); ledgerPath = join(directory, "protected-ai.sqlite"); databases = [];
  });
  afterEach(async () => {
    for (const database of databases) database.close();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-planner-ai-migration-")) throw new Error("Unexpected fixture directory");
    await rm(target, { recursive: true, force: true });
  });
  it("adds AI tables to schema 6 without rewriting planner records, source archives, adjunct tables or protected ledger files", async () => {
    const suffixes = ["", ".initialized", "-wal", "-shm"], contents = suffixes.map(suffix => Buffer.from(`Protected fixture ${suffix}`));
    for (const [i, suffix] of suffixes.entries()) await writeFile(ledgerPath + suffix, contents[i]);
    const first = open(), pending = task();
    const done = { ...task(), status: "Done" as const, completedAt: at, schedule: { day: "2026-11-02", hour: 9 } };
    await first.repository.mutate(businessId, { expectedRevision: 0, mutationId: randomUUID() }, "old-request", state => {
      state.tasks.push(pending, done); state.timeZone = "UTC";
    });
    const db = first.database.connection();
    db.exec("BEGIN IMMEDIATE; DROP TABLE smart_planner_ai_proposals; DROP TABLE smart_planner_ai_preferences; DELETE FROM schema_migrations WHERE version=7; PRAGMA user_version=6; CREATE TABLE unrelated_adjunct(id TEXT PRIMARY KEY,value TEXT); INSERT INTO unrelated_adjunct VALUES('old','preserved'); COMMIT;");
    const plannerRows = db.prepare("SELECT * FROM smart_planners").all(), taskRows = db.prepare("SELECT * FROM smart_planner_tasks ORDER BY id").all();
    const receipts = db.prepare("SELECT * FROM smart_planner_mutations ORDER BY mutation_id").all();
    const businesses = db.prepare("SELECT * FROM businesses ORDER BY id").all(), audits = db.prepare("SELECT * FROM audits ORDER BY id").all();
    const history = db.prepare("SELECT * FROM schema_migrations ORDER BY version").all(); first.database.close();
    const upgraded = open(), connection = upgraded.database.connection();
    expect(connection.prepare("PRAGMA user_version").get()?.user_version).toBe(7);
    expect(connection.prepare("SELECT * FROM schema_migrations ORDER BY version").all().slice(0, 6)).toEqual(history);
    expect(connection.prepare("SELECT * FROM smart_planners").all()).toEqual(plannerRows);
    expect(connection.prepare("SELECT * FROM smart_planner_tasks ORDER BY id").all()).toEqual(taskRows);
    expect(connection.prepare("SELECT * FROM smart_planner_mutations ORDER BY mutation_id").all()).toEqual(receipts);
    expect(connection.prepare("SELECT * FROM businesses ORDER BY id").all()).toEqual(businesses);
    expect(connection.prepare("SELECT * FROM audits ORDER BY id").all()).toEqual(audits);
    expect(connection.prepare("SELECT value FROM unrelated_adjunct WHERE id='old'").get()?.value).toBe("preserved");
    expect(upgraded.store.settings(businessId)).toEqual(defaultAiSettings);
    expect(upgraded.store.latest(businessId)).toBeNull();
    const saved = await upgraded.repository.read(businessId); expect(saved.tasks).toEqual([pending, done]); upgraded.database.close();
    const second = open(); expect(await second.repository.read(businessId)).toEqual(saved);
    expect(second.database.connection().prepare("SELECT COUNT(*) count FROM schema_migrations").get()?.count).toBe(7);
    for (const [i, suffix] of suffixes.entries()) expect(await readFile(ledgerPath + suffix)).toEqual(contents[i]);
  });

  it("initializes fresh databases and persists bounded snapshots, settings and validated proposals across repeated reopen", async () => {
    const first = open(), original = task();
    await first.repository.mutate(businessId, { expectedRevision: 0, mutationId: randomUUID() }, "task", state => { state.tasks.push(original); state.timeZone = "UTC"; });
    const state: PlannerResponseDto = { businessId, revision: 1, preferences: { useWeekends: false, dailyCapacityMinutes: 120, maxTasksPerDay: 3, horizonWeeks: 4, timeZone: "UTC" },
      tasks: [{ ...original, estimatedDurationMinutes: 60, durationEstimateSource: "legacy-default", scheduledBy: null }], sources: [] };
    const settings = { ...defaultAiSettings, horizonWeeks: 8 }; first.store.saveSettings(businessId, settings);
    const snapshot = makeAiSnapshot(state, settings, "2026-11-02", [], new Date(at));
    const record: AiProposalRecord = { id: randomUUID(), businessId, mutationId: randomUUID(), requestHash: checksum("generation"), createdAt: at, expiresAt: "2026-11-09T08:00:00.000Z",
      promptVersion: PLANNER_AI_PROMPT_VERSION, schemaVersion: PLANNER_AI_SCHEMA_VERSION, mode: "mock", model: "offline-simulation", status: "ready", snapshot, snapshotHash: snapshotHash(snapshot), output: offlineAiProposal(snapshot), diagnostics: [],
      appliedAt: null, applicationMutationId: null, applicationRequestHash: null, requestIdentity: null, accountingAttemptId: null };
    expect(first.store.reserve(record)).toMatchObject({ record, created: true }); first.database.close();
    const second = open(); expect(second.store.settings(businessId)).toEqual(settings); expect(second.store.get(businessId, record.id)).toEqual(record);
    expect(second.store.reserve(record)).toMatchObject({ record, created: false }); second.database.close();
    const third = open(); expect(third.store.findMutation(businessId, record.mutationId)).toEqual(record);
    expect(third.database.connection().prepare("SELECT COUNT(*) count FROM schema_migrations").get()?.count).toBe(7);
  });

  it("fails closed on corrupt checksums and malformed saved settings", () => {
    const { database, store } = open(); store.saveSettings(businessId, defaultAiSettings);
    database.connection().prepare("UPDATE smart_planner_ai_preferences SET checksum=? WHERE business_id=?").run("bad", businessId);
    expect(() => store.settings(businessId)).toThrow(AppDatabaseError);
    const data = JSON.stringify({ ...defaultAiSettings, horizonWeeks: 0 });
    database.connection().prepare("UPDATE smart_planner_ai_preferences SET data_json=?,checksum=? WHERE business_id=?").run(data, checksum(data), businessId);
    expect(() => store.settings(businessId)).toThrow(AppDatabaseError);
  });
});
