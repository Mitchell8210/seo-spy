import { ConflictException, HttpException, Injectable } from "@nestjs/common";
import type { DatabaseSync } from "node:sqlite";
import { AppDatabase, AppDatabaseError } from "../../persistence/sqlite/app-database.js";
import { checksum, defaultPlanningPreferences, planningOutcomeSchema, sourceTaskId, taskSchema, validPlannerTimeZone, type PlannerMutation, type PlannerRepository, type PlannerRecordTask, type PlannerState } from "./planner.types.js";

const invalid = () => new AppDatabaseError("DATABASE_RECORD_INVALID", "The saved planner could not be accessed safely.");
const MAX_RESULT_BYTES = 4 * 1024 * 1024;
const conflict = (code = "PLANNER_REVISION_CONFLICT") => new ConflictException({ code, message: "The planner changed in another session. Your action was not applied. Refresh and review before submitting again." });
const empty = (businessId: string): PlannerState => ({ businessId, revision: 0, useWeekends: false, ...defaultPlanningPreferences, createdAt: null, updatedAt: null, tasks: [] });
const validPreferences = (value: { dailyCapacityMinutes: number; maxTasksPerDay: number; horizonWeeks: number; timeZone: string | null }) => Number.isInteger(value.dailyCapacityMinutes) && value.dailyCapacityMinutes >= 30 && value.dailyCapacityMinutes <= 480 && value.dailyCapacityMinutes % 30 === 0
  && Number.isInteger(value.maxTasksPerDay) && value.maxTasksPerDay >= 1 && value.maxTasksPerDay <= 16 && Number.isInteger(value.horizonWeeks) && value.horizonWeeks >= 1 && value.horizonWeeks <= 12 && (value.timeZone === null || typeof value.timeZone === "string" && validPlannerTimeZone(value.timeZone));
const validIdentity = (businessId: string, task: PlannerRecordTask) => task.mode === "custom"
  ? task.taskKey === `custom:${task.id}`
  : task.id === sourceTaskId(businessId, task.origin) && task.taskKey === `${task.orderKey}@${task.id}`;

@Injectable()
export class SQLitePlannerRepository implements PlannerRepository {
  constructor(private readonly database: AppDatabase) {}
  private mutationTransaction<T>(operation: (db: DatabaseSync) => T): T {
    let rejection: HttpException | undefined;
    try {
      return this.database.withTransaction(db => {
        try { return operation(db); }
        catch (error) { if (error instanceof HttpException) rejection = error; throw error; }
      });
    } catch (error) {
      // AppDatabase deliberately hides SQL errors. Restore only application-authored
      // HTTP rejections after rollback, without changing that shared safety boundary.
      throw rejection ?? error;
    }
  }
  private load(db: DatabaseSync, businessId: string): PlannerState {
    const row = db.prepare("SELECT * FROM smart_planners WHERE business_id=?").get(businessId);
    if (!row) return empty(businessId);
    const planning = { dailyCapacityMinutes: Number(row.daily_capacity_minutes), maxTasksPerDay: Number(row.max_tasks_per_day), horizonWeeks: Number(row.horizon_weeks), timeZone: row.time_zone as string | null };
    if (!validPreferences(planning)) throw invalid();
    if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || ![0, 1].includes(Number(row.use_weekends)) || typeof row.created_at !== "string" || typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.created_at)) || !Number.isFinite(Date.parse(row.updated_at))) throw invalid();
    const tasks = db.prepare("SELECT * FROM smart_planner_tasks WHERE business_id=? ORDER BY position,id").all(businessId).map(item => {
      if (typeof item.data_json !== "string" || Buffer.byteLength(item.data_json) > 128 * 1024 || item.checksum !== checksum(item.data_json)) throw invalid();
      let data: unknown;
      try { data = JSON.parse(item.data_json) as unknown; } catch { throw invalid(); }
      const parsed = taskSchema.safeParse(data);
      if (!parsed.success) throw invalid();
      const task = parsed.data;
      if (!validIdentity(businessId, task)) throw invalid();
      if (task.id !== item.id || task.taskKey !== item.task_key || task.status !== item.status || (task.schedule?.day ?? null) !== item.scheduled_day || (task.schedule?.hour ?? null) !== item.scheduled_hour) throw invalid();
      if ((task.schedule ? task.schedule.minute ?? 0 : null) !== item.scheduled_minute) throw invalid();
      return task;
    });
    if (new Set(tasks.map(task => task.id)).size !== tasks.length || new Set(tasks.map(task => task.taskKey)).size !== tasks.length) throw invalid();
    return { businessId, revision: Number(row.revision), useWeekends: row.use_weekends === 1, ...planning, createdAt: row.created_at, updatedAt: row.updated_at, tasks };
  }
  async read(businessId: string): Promise<PlannerState> {
    // Keep header and tasks from one SQLite snapshot across application connections.
    return this.database.withTransaction(db => this.load(db, businessId));
  }
  async mutate(businessId: string, mutation: PlannerMutation, requestHash: string, apply: (state: PlannerState) => void): Promise<PlannerState> {
    return this.mutationTransaction(db => {
      const state = this.load(db, businessId);
      const originalTasks = state.tasks.map(task => ({ id: task.id, mode: task.mode }));
      const receipt = db.prepare("SELECT request_hash,result_json,result_checksum FROM smart_planner_mutations WHERE business_id=? AND mutation_id=?").get(businessId, mutation.mutationId);
      if (receipt) {
        if (receipt.request_hash !== requestHash) throw conflict("PLANNER_MUTATION_MISMATCH");
        if (receipt.result_json !== null) {
          if (typeof receipt.result_json !== "string" || Buffer.byteLength(receipt.result_json) > MAX_RESULT_BYTES || receipt.result_checksum !== checksum(receipt.result_json)) throw invalid();
          const parsed = planningOutcomeSchema.safeParse(JSON.parse(receipt.result_json) as unknown);
          if (!parsed.success) throw invalid();
          state.mutationResult = parsed.data;
        } else if (receipt.result_checksum !== null) throw invalid();
        return state; // Durable idempotency, including after other writes and restarts.
      }
      if (state.revision !== mutation.expectedRevision) throw conflict();
      apply(state);
      if (!validPreferences(state)) throw invalid();
      if (state.tasks.length > 10000) throw invalid();
      const now = new Date().toISOString();
      state.revision++; state.createdAt ??= now; state.updatedAt = now;
      db.prepare("INSERT INTO smart_planners(business_id,revision,use_weekends,created_at,updated_at,daily_capacity_minutes,max_tasks_per_day,horizon_weeks,time_zone) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(business_id) DO UPDATE SET revision=excluded.revision,use_weekends=excluded.use_weekends,updated_at=excluded.updated_at,daily_capacity_minutes=excluded.daily_capacity_minutes,max_tasks_per_day=excluded.max_tasks_per_day,horizon_weeks=excluded.horizon_weeks,time_zone=excluded.time_zone").run(businessId, state.revision, Number(state.useWeekends), state.createdAt, now, state.dailyCapacityMinutes, state.maxTasksPerDay, state.horizonWeeks, state.timeZone);
      const upsert = db.prepare("INSERT INTO smart_planner_tasks(id,business_id,task_key,status,scheduled_day,scheduled_hour,scheduled_minute,position,data_json,checksum) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,scheduled_day=excluded.scheduled_day,scheduled_hour=excluded.scheduled_hour,scheduled_minute=excluded.scheduled_minute,position=excluded.position,data_json=excluded.data_json,checksum=excluded.checksum WHERE smart_planner_tasks.business_id=excluded.business_id");
      state.tasks.forEach((item, position) => {
        const parsed = taskSchema.safeParse(item);
        if (!parsed.success) throw invalid();
        const task = parsed.data;
        if (!validIdentity(businessId, task)) throw invalid();
        const payload = JSON.stringify(task);
        if (Buffer.byteLength(payload) > 128 * 1024) throw invalid();
        const result = upsert.run(task.id, businessId, task.taskKey, task.status, task.schedule?.day ?? null, task.schedule?.hour ?? null, task.schedule ? task.schedule.minute ?? 0 : null, position, payload, checksum(payload));
        if (result.changes !== 1) throw invalid();
      });
      const retainedIds = new Set(state.tasks.map(task => task.id));
      for (const task of originalTasks) if (!retainedIds.has(task.id)) {
        // Report/history tasks may never disappear through a collection rewrite.
        if (task.mode !== "custom") throw invalid();
        if (db.prepare("DELETE FROM smart_planner_tasks WHERE business_id=? AND id=?").run(businessId, task.id).changes !== 1) throw invalid();
      }
      const result = state.mutationResult ? JSON.stringify(planningOutcomeSchema.parse(state.mutationResult)) : null;
      if (result !== null && Buffer.byteLength(result) > MAX_RESULT_BYTES) throw invalid();
      db.prepare("INSERT INTO smart_planner_mutations(business_id,mutation_id,request_hash,revision,created_at,result_json,result_checksum) VALUES(?,?,?,?,?,?,?)").run(businessId, mutation.mutationId, requestHash, state.revision, now, result, result === null ? null : checksum(result));
      return state;
    });
  }
}
