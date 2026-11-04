import "reflect-metadata";
import { jest } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { configureApp } from "../src/configure-app.js";
import { PlannerController } from "../src/modules/smart-planner/planner.controller.js";
import { SQLitePlannerRepository } from "../src/modules/smart-planner/planner.repository.js";
import { PLANNER_CLOCK, PlannerService } from "../src/modules/smart-planner/planner.service.js";
import { PlannerSourcesService, type PlannerSourceProjection } from "../src/modules/smart-planner/planner-sources.js";
import { PersistenceModule } from "../src/persistence/persistence.module.js";
import { SMART_PLANNER_REPOSITORY } from "../src/persistence/repositories.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";

const base = "/api/businesses/demo-guzman/smart-planner";
const mutation = (expectedRevision: number) => ({ expectedRevision, mutationId: randomUUID() });
const custom = (title: string, estimatedDurationMinutes = 60) => ({ title, estimatedDurationMinutes, priority: "Medium", category: "Review" });
interface TaskView {
  id: string; title: string; status: string; estimatedDurationMinutes: number; durationEstimateSource: string; scheduledBy: string | null;
  schedule: { day: string; hour: number; minute?: number } | null;
}

describe("Smart Planner V2 durations, workload preferences and multiweek HTTP behavior", () => {
  let app: INestApplication;
  let now: Date;
  let revision: number;
  let network: { mockRestore(): void };
  const sources: PlannerSourceProjection = { tasks: [], sources: [
    { channel: "website", availability: "empty", reportIds: [] },
    { channel: "social", availability: "empty", reportIds: [] },
    { channel: "consistency", availability: "empty", reportIds: [] },
  ] };
  beforeEach(async () => {
    now = new Date("2026-11-02T08:00:00.000Z"); revision = 0;
    network = jest.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Provider requests are forbidden in planner API fixtures"); });
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PersistenceModule], controllers: [PlannerController],
      providers: [PlannerService, SQLitePlannerRepository, { provide: SMART_PLANNER_REPOSITORY, useExisting: SQLitePlannerRepository },
        { provide: PLANNER_CLOCK, useValue: () => now }, { provide: PlannerSourcesService, useValue: { read: async () => structuredClone(sources) } }],
    }).compile();
    app = configureApp(module.createNestApplication()); app.useLogger(false); await app.init();
  });
  afterEach(async () => { await app.close(); expect(fetch).not.toHaveBeenCalled(); network.mockRestore(); });
  async function preferences(body: object) {
    const result = await request(app.getHttpServer()).patch(`${base}/preferences`).send({ ...mutation(revision), ...body }).expect(200);
    revision = result.body.revision; return result.body;
  }
  async function create(body: object) {
    const result = await request(app.getHttpServer()).post(`${base}/tasks`).send({ ...mutation(revision), ...body }).expect(201);
    revision = result.body.revision; return result.body;
  }

  it("returns durable defaults without creating rows and requires explicit time-zone confirmation before planning", async () => {
    const initial = await request(app.getHttpServer()).get(base).expect(200);
    expect(initial.body.preferences).toEqual({ useWeekends: false, dailyCapacityMinutes: 120, maxTasksPerDay: 3, horizonWeeks: 4, timeZone: null });
    await request(app.getHttpServer()).post(`${base}/auto-plan`).send({ ...mutation(0), weekStart: "2026-11-02" }).expect(400);
    expect(app.get(AppDatabase).connection().prepare("SELECT COUNT(*) count FROM smart_planners").get()?.count).toBe(0);
    const saved = await preferences({ timeZone: "UTC", dailyCapacityMinutes: 90, maxTasksPerDay: 2, horizonWeeks: 2 });
    expect(saved.preferences).toEqual({ useWeekends: false, dailyCapacityMinutes: 90, maxTasksPerDay: 2, horizonWeeks: 2, timeZone: "UTC" });
    const partial = await preferences({ useWeekends: true });
    expect(partial.preferences).toEqual({ ...saved.preferences, useWeekends: true });
  });

  it("validates preference bounds, increments, time zones, unknown fields and required nulls atomically", async () => {
    const invalid = [
      {}, { dailyCapacityMinutes: null }, { dailyCapacityMinutes: 0 }, { dailyCapacityMinutes: 45 }, { dailyCapacityMinutes: 510 },
      { dailyCapacityMinutes: "120" }, { maxTasksPerDay: 0 }, { maxTasksPerDay: 17 }, { maxTasksPerDay: 1.5 },
      { horizonWeeks: 0 }, { horizonWeeks: 13 }, { horizonWeeks: null }, { timeZone: null }, { timeZone: "Not/A_Time_Zone" },
      { useWeekends: null }, { capacity: 120 },
    ];
    for (const body of invalid) await request(app.getHttpServer()).patch(`${base}/preferences`).send({ ...mutation(0), ...body }).expect(400);
    expect((await request(app.getHttpServer()).get(base).expect(200)).body.revision).toBe(0);
  });

  it("persists explicit estimates and half-hour schedules while enforcing the visible working window", async () => {
    const defaultTask = await create({ title: "Default estimate", priority: "Low", category: "Content" });
    expect(defaultTask.tasks[0]).toMatchObject({ estimatedDurationMinutes: 60, durationEstimateSource: "default", scheduledBy: null });
    const halfHour = await create({ ...custom("Half-hour task", 30), schedule: { day: "2026-11-02", hour: 16, minute: 30 } });
    expect(halfHour.tasks.find((task: TaskView) => task.title === "Half-hour task")).toMatchObject({ estimatedDurationMinutes: 30, durationEstimateSource: "user", scheduledBy: "manual", schedule: { day: "2026-11-02", hour: 16, minute: 30 } });
    const halfHourId = halfHour.tasks.find((task: TaskView) => task.title === "Half-hour task").id;
    await request(app.getHttpServer()).patch(`${base}/tasks/${halfHourId}`).send({ ...mutation(revision), estimatedDurationMinutes: 60 }).expect(400);
    const unchanged = await request(app.getHttpServer()).get(base).expect(200);
    expect(unchanged.body.revision).toBe(revision);
    expect(unchanged.body.tasks.find((task: TaskView) => task.id === halfHourId)).toMatchObject({ estimatedDurationMinutes: 30, schedule: { day: "2026-11-02", hour: 16, minute: 30 } });
    for (const duration of [null, 0, 45, 150, 241, "90"]) await request(app.getHttpServer()).post(`${base}/tasks`).send({ ...mutation(revision), ...custom("Invalid estimate"), estimatedDurationMinutes: duration }).expect(400);
    await request(app.getHttpServer()).post(`${base}/tasks`).send({ ...mutation(revision), ...custom("Beyond the grid", 60), schedule: { day: "2026-11-02", hour: 16, minute: 30 } }).expect(400);
    await request(app.getHttpServer()).post(`${base}/tasks`).send({ ...mutation(revision), ...custom("Quarter-hour start", 30), schedule: { day: "2026-11-02", hour: 9, minute: 15 } }).expect(400);
    expect((await request(app.getHttpServer()).get(base).expect(200)).body.tasks).toHaveLength(2);
  });

  it("allows estimate edits for pending work but preserves completed estimate, timestamp and guidance", async () => {
    const original = await create({ ...custom("Original work", 30), notes: "Keep this original guidance" });
    const id = original.tasks[0].id;
    const edited = await request(app.getHttpServer()).patch(`${base}/tasks/${id}`).send({ ...mutation(revision), estimatedDurationMinutes: 90 }).expect(200);
    revision = edited.body.revision;
    expect(edited.body.tasks[0]).toMatchObject({ estimatedDurationMinutes: 90, durationEstimateSource: "user" });
    const completed = await request(app.getHttpServer()).patch(`${base}/tasks/${id}`).send({ ...mutation(revision), status: "Done", completionConfirmed: true }).expect(200);
    revision = completed.body.revision;
    await request(app.getHttpServer()).patch(`${base}/tasks/${id}`).send({ ...mutation(revision), estimatedDurationMinutes: 60 }).expect(400);
    const reloaded = await request(app.getHttpServer()).get(base).expect(200);
    expect(reloaded.body.tasks[0]).toEqual(completed.body.tasks[0]);
    const reconciled = await request(app.getHttpServer()).post(`${base}/reconcile`).send({ ...mutation(revision), confirmed: true }).expect(200);
    expect(reconciled.body.tasks[0]).toEqual(completed.body.tasks[0]);
  });

  it("rolls twelve one-hour tasks into week two without exceeding either daily limit", async () => {
    await preferences({ timeZone: "UTC" });
    for (let index = 0; index < 12; index++) await create(custom(`Task ${String(index).padStart(2, "0")}`));
    const submission = { ...mutation(revision), weekStart: "2026-11-02" };
    const planned = await request(app.getHttpServer()).post(`${base}/auto-plan`).send(submission).expect(200);
    expect(planned.body.planning).toMatchObject({ policyVersion: "planner-balanced-v2", range: { start: "2026-11-02", end: "2026-11-30" }, scheduledCount: 12, remaining: [] });
    const tasks = planned.body.tasks as TaskView[];
    expect(tasks.filter(task => task.schedule!.day < "2026-11-09")).toHaveLength(10);
    expect(tasks.filter(task => task.schedule!.day >= "2026-11-09")).toHaveLength(2);
    expect(tasks.every(task => task.scheduledBy === "auto")).toBe(true);
    const days = new Map<string, TaskView[]>();
    for (const task of tasks) days.set(task.schedule!.day, [...(days.get(task.schedule!.day) ?? []), task]);
    for (const daily of days.values()) {
      expect(daily.length).toBeLessThanOrEqual(3);
      expect(daily.reduce((sum, task) => sum + task.estimatedDurationMinutes, 0)).toBeLessThanOrEqual(120);
      const starts = daily.map(task => task.schedule!.hour * 60 + (task.schedule!.minute ?? 0)).sort((a, b) => a - b);
      for (let index = 1; index < starts.length; index++) expect(starts[index] - starts[index - 1]).toBeGreaterThanOrEqual(60);
    }
    const duplicate = await request(app.getHttpServer()).post(`${base}/auto-plan`).send(submission).expect(200);
    expect(duplicate.body.tasks).toEqual(planned.body.tasks);
    expect(duplicate.body.revision).toBe(planned.body.revision);
    expect(duplicate.body.planning).toEqual(planned.body.planning);
  });

  it("reports oversized and horizon-overflow tasks without hiding them or raising configured limits", async () => {
    await preferences({ timeZone: "UTC", horizonWeeks: 1 });
    await create(custom("Too large for the budget", 180));
    for (let index = 0; index < 11; index++) await create(custom(`Capacity task ${index}`));
    const planned = await request(app.getHttpServer()).post(`${base}/auto-plan`).send({ ...mutation(revision), weekStart: "2026-11-02" }).expect(200);
    const large = planned.body.tasks.find((task: TaskView) => task.title === "Too large for the budget");
    expect(large.schedule).toBeNull();
    expect(planned.body.planning.remaining).toContainEqual({ taskId: large.id, reason: "duration_exceeds_daily_capacity" });
    expect(planned.body.planning.scheduledCount).toBe(10);
    expect(planned.body.tasks).toHaveLength(12);
    expect(planned.body.tasks.filter((task: TaskView) => task.schedule === null)).toHaveLength(2);
    expect(planned.body.preferences.dailyCapacityMinutes).toBe(120);
  });

  it("keeps manually overlapping over-capacity work and places new automatic work on another day", async () => {
    await preferences({ timeZone: "UTC", dailyCapacityMinutes: 60, maxTasksPerDay: 1, horizonWeeks: 1 });
    const schedule = { day: "2026-11-02", hour: 9, minute: 0 };
    await create({ ...custom("Manual one", 30), schedule });
    await create({ ...custom("Manual two", 90), schedule });
    await create(custom("New automatic task", 30));
    const planned = await request(app.getHttpServer()).post(`${base}/auto-plan`).send({ ...mutation(revision), weekStart: "2026-11-02" }).expect(200);
    expect(planned.body.planning.overloadedDays).toContain("2026-11-02");
    for (const title of ["Manual one", "Manual two"]) expect(planned.body.tasks.find((task: TaskView) => task.title === title)).toMatchObject({ schedule, scheduledBy: "manual" });
    expect(planned.body.tasks.find((task: TaskView) => task.title === "New automatic task").schedule.day).not.toBe("2026-11-02");
  });

  it("uses the confirmed time zone and backend clock to avoid elapsed slots and wholly past horizons", async () => {
    now = new Date("2026-11-02T18:10:00.000Z"); // 10:10 in Los Angeles after the fall DST transition.
    await preferences({ timeZone: "America/Los_Angeles" });
    await create({ ...custom("Current day work", 30), priority: "Urgent" });
    await request(app.getHttpServer()).post(`${base}/auto-plan`).send({ ...mutation(revision), weekStart: "2026-10-05" }).expect(400);
    const planned = await request(app.getHttpServer()).post(`${base}/auto-plan`).send({ ...mutation(revision), weekStart: "2026-11-02" }).expect(200);
    const schedule = planned.body.tasks[0].schedule;
    expect(schedule.day).toBe("2026-11-02");
    expect(schedule.hour * 60 + (schedule.minute ?? 0)).toBeGreaterThanOrEqual(10 * 60 + 30);
  });

  it("does not move prior assignments when preferences change and rejects a concurrent stale planning mutation", async () => {
    await preferences({ timeZone: "UTC" });
    const manual = { day: "2026-11-03", hour: 9, minute: 30 };
    await create({ ...custom("Keep this placement", 90), schedule: manual });
    await preferences({ dailyCapacityMinutes: 30, maxTasksPerDay: 1 });
    await create(custom("Needs planning", 30));
    const submissions = [mutation(revision), mutation(revision)];
    const outcomes = await Promise.all(submissions.map(body => request(app.getHttpServer()).post(`${base}/auto-plan`).send({ ...body, weekStart: "2026-11-02" })));
    expect(outcomes.map(result => result.status).sort()).toEqual([200, 409]);
    const latest = await request(app.getHttpServer()).get(base).expect(200);
    expect(latest.body.tasks.find((task: TaskView) => task.title === "Keep this placement")).toMatchObject({ schedule: manual, scheduledBy: "manual" });
  });
});
