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
import { SQLiteBusinessRepository } from "../src/persistence/sqlite/sqlite.repositories.js";

const base = "/api/businesses/demo-guzman/smart-planner";
const mutation = (expectedRevision: number) => ({ expectedRevision, mutationId: randomUUID() });
const custom = (expectedRevision: number) => ({ ...mutation(expectedRevision), title: "  Review contact details  ", priority: "Medium", category: "Admin", notes: "Original custom notes" });
function sourceProjection(): PlannerSourceProjection {
  return { tasks: [{ taskKey: "website:contact", title: "Check contact details", explanation: "Saved finding", guidance: "Original saved guidance", priority: "Urgent", category: "Admin", source: "Website", mode: "saved", destination: "/website?businessId=demo-guzman",
    origin: { kind: "finding", channel: "website", reportIds: ["saved-report-1"], reportHashes: ["a".repeat(64)], findingId: "contact", evidenceRefs: [{ reportId: "saved-report-1", evidenceId: "contact-evidence" }] } }],
    sources: [{ channel: "website", availability: "available", reportIds: ["saved-report-1"] }, { channel: "social", availability: "unavailable", reportIds: [] }, { channel: "consistency", availability: "unavailable", reportIds: [] }] };
}

describe("Smart Planner offline HTTP contract", () => {
  let app: INestApplication;
  let projection: PlannerSourceProjection;
  let network: { mockRestore(): void };
  beforeEach(async () => {
    projection = sourceProjection();
    network = jest.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Network is forbidden in Smart Planner fixtures"); });
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PersistenceModule],
      controllers: [PlannerController],
      providers: [PlannerService, SQLitePlannerRepository, { provide: SMART_PLANNER_REPOSITORY, useExisting: SQLitePlannerRepository },
        { provide: PLANNER_CLOCK, useValue: () => new Date("2026-11-02T08:00:00.000Z") },
        { provide: PlannerSourcesService, useValue: { read: async () => structuredClone(projection) } }],
    }).compile();
    app = configureApp(module.createNestApplication());
    app.useLogger(false);
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });

  it("projects stable source IDs without creating planner rows and publishes documented API fields", async () => {
    const first = await request(app.getHttpServer()).get(base).expect(200);
    const second = await request(app.getHttpServer()).get(base).expect(200);
    expect(second.body).toEqual(first.body);
    expect(first.body).toMatchObject({ businessId: "demo-guzman", revision: 0, preferences: { useWeekends: false } });
    expect(first.body.tasks[0]).toMatchObject({ status: "Needs Action", completedAt: null, mode: "saved", origin: projection.tasks[0].origin });
    expect(app.get(AppDatabase).connection().prepare("SELECT COUNT(*) count FROM smart_planners").get()?.count).toBe(0);
    const openApi = await request(app.getHttpServer()).get("/api/docs-json").expect(200);
    expect(openApi.body.paths["/api/businesses/{businessId}/smart-planner/tasks"]).toHaveProperty("post");
    expect(openApi.body.components.schemas.PlannerTaskResponseDto.properties).toHaveProperty("completedAt");
    expect(openApi.body.components.schemas.PlannerTaskResponseDto.properties).toHaveProperty("estimatedDurationMinutes");
    expect(openApi.body.components.schemas.PlannerScheduleDto.properties).toHaveProperty("minute");
    expect(openApi.body.components.schemas.PlannerPreferencesResponseDto.properties).toHaveProperty("timeZone");
    expect(openApi.body.components.schemas.PlannerResponseDto.properties).toHaveProperty("planning");
  });

  it("retains exact completed identity, timestamp, provenance and guidance through ordinary refresh and reconciliation", async () => {
    const read = await request(app.getHttpServer()).get(base).expect(200);
    const id = read.body.tasks[0].id;
    await request(app.getHttpServer()).patch(`${base}/tasks/${id}`).send({ ...mutation(0), status: "Done" }).expect(400);
    const done = await request(app.getHttpServer()).patch(`${base}/tasks/${id}`).send({ ...mutation(0), status: "Done", completionConfirmed: true }).expect(200);
    expect(done.body.tasks[0].completedAt).toEqual(expect.any(String));
    projection.tasks[0].guidance = "Different rendering of old evidence must not replace original completion guidance";
    expect((await request(app.getHttpServer()).get(base).expect(200)).body.tasks[0]).toEqual(done.body.tasks[0]);
    const reconciled = await request(app.getHttpServer()).post(`${base}/reconcile`).send({ ...mutation(1), confirmed: true }).expect(200);
    expect(reconciled.body.tasks[0]).toEqual(done.body.tasks[0]);
    projection.tasks[0].origin.reportIds = ["saved-report-2"];
    projection.tasks[0].origin.reportHashes = ["b".repeat(64)];
    projection.tasks[0].origin.evidenceRefs = [{ reportId: "saved-report-2", evidenceId: "contact-evidence" }];
    const newer = await request(app.getHttpServer()).get(base).expect(200);
    expect(newer.body.tasks).toHaveLength(2);
    expect(newer.body.tasks.find((task: { id: string }) => task.id === id)).toEqual(done.body.tasks[0]);
    expect(newer.body.tasks.find((task: { id: string }) => task.id !== id)).toMatchObject({ status: "Needs Action", completedAt: null });
    await request(app.getHttpServer()).patch(`${base}/tasks/${id}`).send({ ...mutation(2), status: "Needs Action" }).expect(400);
  });

  it.each(["pending", "unavailable", "failed"] as const)("preserves scheduled source tasks when their channel is %s", async availability => {
    const read = await request(app.getHttpServer()).get(base).expect(200);
    const id = read.body.tasks[0].id;
    const saved = await request(app.getHttpServer()).patch(`${base}/tasks/${id}`).send({ ...mutation(0), schedule: { day: "2026-11-02", hour: 10 } }).expect(200);
    projection.tasks = [];
    projection.sources[0].availability = availability;
    const refreshed = await request(app.getHttpServer()).post(`${base}/reconcile`).send({ ...mutation(1), confirmed: true }).expect(200);
    expect(refreshed.body.tasks).toEqual(saved.body.tasks);
    projection.sources[0].availability = "empty";
    const authoritativeEmpty = await request(app.getHttpServer()).get(base).expect(200);
    expect(authoritativeEmpty.body.tasks).toHaveLength(0);
    expect(app.get(AppDatabase).connection().prepare("SELECT COUNT(*) count FROM smart_planner_tasks").get()?.count).toBe(1);
  });

  it("allows manual overlap, validates weekend preference and clears weekend schedules atomically", async () => {
    const first = await request(app.getHttpServer()).post(`${base}/tasks`).send({ ...custom(0), schedule: { day: "2026-11-02", hour: 10 } }).expect(201);
    const second = await request(app.getHttpServer()).post(`${base}/tasks`).send({ ...custom(1), schedule: { day: "2026-11-02", hour: 10 } }).expect(201);
    expect(second.body.tasks.filter((task: { mode: string }) => task.mode === "custom")).toHaveLength(2);
    const id = first.body.tasks.find((task: { mode: string }) => task.mode === "custom").id;
    await request(app.getHttpServer()).patch(`${base}/tasks/${id}`).send({ ...mutation(2), schedule: { day: "2026-11-07", hour: 9 } }).expect(400);
    await request(app.getHttpServer()).patch(`${base}/preferences`).send({ ...mutation(2), useWeekends: true }).expect(200);
    await request(app.getHttpServer()).patch(`${base}/tasks/${id}`).send({ ...mutation(3), schedule: { day: "2026-11-07", hour: 9 } }).expect(200);
    const cleared = await request(app.getHttpServer()).patch(`${base}/preferences`).send({ ...mutation(4), useWeekends: false }).expect(200);
    expect(cleared.body.revision).toBe(5);
    expect(cleared.body.tasks.find((task: { id: string }) => task.id === id).schedule).toBeNull();
    expect(cleared.body.tasks.filter((task: { mode: string }) => task.mode === "custom")).toHaveLength(2);
  });

  it("rejects unknown fields, invalid required nulls, dates, hours, enums and empty updates without changing revision", async () => {
    const invalid = [
      { title: "" }, { title: null }, { priority: null }, { priority: "High" }, { category: "Other" }, { notes: null },
      { schedule: {} }, { schedule: { day: "2026-02-30", hour: 9 } }, { schedule: { day: "2026-11-02", hour: 17 } },
      { schedule: { day: "2026-11-02", hour: "9" } }, { schedule: { day: null, hour: 9 } }, { destination: "/admin" },
      { origin: { findingId: "browser-claim" } }, { expectedRevision: null }, { mutationId: null },
    ];
    for (const patch of invalid) await request(app.getHttpServer()).post(`${base}/tasks`).send({ ...custom(0), ...patch }).expect(400);
    const read = await request(app.getHttpServer()).get(base).expect(200);
    await request(app.getHttpServer()).patch(`${base}/tasks/${read.body.tasks[0].id}`).send(mutation(0)).expect(400);
    await request(app.getHttpServer()).post(`${base}/auto-plan`).send({ ...mutation(0), weekStart: "2026-11-03" }).expect(400);
    await request(app.getHttpServer()).post(`${base}/reconcile`).send({ ...mutation(0), confirmed: false }).expect(400);
    expect((await request(app.getHttpServer()).get(base).expect(200)).body.revision).toBe(0);
  });

  it("makes duplicate custom submissions idempotent and rejects stale revisions and changed duplicate bodies", async () => {
    const submission = custom(0);
    const first = await request(app.getHttpServer()).post(`${base}/tasks`).send(submission).expect(201);
    await request(app.getHttpServer()).patch(`${base}/preferences`).send({ ...mutation(1), useWeekends: true }).expect(200);
    const duplicate = await request(app.getHttpServer()).post(`${base}/tasks`).send(submission).expect(201);
    expect(duplicate.body.revision).toBe(2);
    expect(duplicate.body.tasks.filter((task: { mode: string }) => task.mode === "custom")).toEqual(first.body.tasks.filter((task: { mode: string }) => task.mode === "custom"));
    const changed = await request(app.getHttpServer()).post(`${base}/tasks`).send({ ...submission, title: "Changed request" }).expect(409);
    expect(changed.body.error.code).toBe("PLANNER_MUTATION_MISMATCH");
    const stale = await request(app.getHttpServer()).post(`${base}/tasks`).send(custom(0)).expect(409);
    expect(stale.body.error.code).toBe("PLANNER_REVISION_CONFLICT");
  });

  it("persists Auto Plan without moving existing schedules or scheduling completed tasks", async () => {
    const fixed = await request(app.getHttpServer()).post(`${base}/tasks`).send({ ...custom(0), schedule: { day: "2026-11-03", hour: 11 } }).expect(201);
    const fixedId = fixed.body.tasks.find((task: { mode: string }) => task.mode === "custom").id;
    const readId = fixed.body.tasks.find((task: { mode: string }) => task.mode === "saved").id;
    await request(app.getHttpServer()).patch(`${base}/tasks/${readId}`).send({ ...mutation(1), status: "Done", completionConfirmed: true }).expect(200);
    await request(app.getHttpServer()).post(`${base}/tasks`).send({ ...custom(2), title: "Pending new task", priority: "Urgent" }).expect(201);
    await request(app.getHttpServer()).patch(`${base}/preferences`).send({ ...mutation(3), timeZone: "UTC" }).expect(200);
    const scheduled = await request(app.getHttpServer()).post(`${base}/auto-plan`).send({ ...mutation(4), weekStart: "2026-11-02" }).expect(200);
    expect(scheduled.body.revision).toBe(5);
    expect(scheduled.body.tasks.find((task: { id: string }) => task.id === fixedId).schedule).toMatchObject({ day: "2026-11-03", hour: 11 });
    expect(scheduled.body.tasks.find((task: { id: string }) => task.id === readId)).toMatchObject({ status: "Done", schedule: null });
    expect(scheduled.body.tasks.find((task: { title: string }) => task.title === "Pending new task").schedule).toEqual({ day: "2026-11-02", hour: 9, minute: 0 });
    expect((await request(app.getHttpServer()).get(base).expect(200)).body.tasks).toEqual(scheduled.body.tasks);
  });

  it("does not overlap Auto Plan assignments for distinct exact origins sharing a legacy finding key", async () => {
    await request(app.getHttpServer()).post(`${base}/reconcile`).send({ ...mutation(0), confirmed: true }).expect(200);
    projection.tasks[0].origin.reportIds = ["saved-report-2"];
    projection.tasks[0].origin.reportHashes = ["b".repeat(64)];
    projection.tasks[0].origin.evidenceRefs = [{ reportId: "saved-report-2", evidenceId: "contact-evidence" }];
    // A still-active source operation prevents retirement of the first origin.
    projection.sources[0].availability = "pending";
    projection.sources[0].reportIds = ["saved-report-2"];
    await request(app.getHttpServer()).patch(`${base}/preferences`).send({ ...mutation(1), timeZone: "UTC" }).expect(200);
    const scheduled = await request(app.getHttpServer()).post(`${base}/auto-plan`).send({ ...mutation(2), weekStart: "2026-11-02" }).expect(200);
    expect(scheduled.body.tasks).toHaveLength(2);
    const schedules = scheduled.body.tasks.map((task: { schedule: { day: string; hour: number } }) => `${task.schedule.day}:${task.schedule.hour}`);
    expect(new Set(schedules).size).toBe(2);
    expect(new Set(scheduled.body.tasks.map((task: { id: string }) => task.id)).size).toBe(2);
  });

  it("isolates registered businesses and never resolves another business's task UUID", async () => {
    const businesses = app.get(SQLiteBusinessRepository);
    const original = (await businesses.findById("demo-guzman"))!;
    await businesses.upsertBusiness({ ...original, id: "other", website: "https://other.example" });
    const created = await request(app.getHttpServer()).post(`${base}/tasks`).send(custom(0)).expect(201);
    const id = created.body.tasks.find((task: { mode: string }) => task.mode === "custom").id;
    await request(app.getHttpServer()).patch(`/api/businesses/other/smart-planner/tasks/${id}`).send({ ...mutation(0), status: "Done", completionConfirmed: true }).expect(404);
    const other = await request(app.getHttpServer()).get("/api/businesses/other/smart-planner").expect(200);
    expect(other.body.tasks.some((task: { id: string }) => task.id === id)).toBe(false);
    expect(other.body.revision).toBe(0);
    await request(app.getHttpServer()).get("/api/businesses/unregistered/smart-planner").expect(404);
  });
});
