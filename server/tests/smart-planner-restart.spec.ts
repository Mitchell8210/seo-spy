import "reflect-metadata";
import { jest } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import request from "supertest";
import { configureApp } from "../src/configure-app.js";
import { PlannerController } from "../src/modules/smart-planner/planner.controller.js";
import { SQLitePlannerRepository } from "../src/modules/smart-planner/planner.repository.js";
import { PlannerService } from "../src/modules/smart-planner/planner.service.js";
import { PlannerSourcesService, type PlannerSourceProjection } from "../src/modules/smart-planner/planner-sources.js";
import { PersistenceModule } from "../src/persistence/persistence.module.js";
import { SMART_PLANNER_REPOSITORY } from "../src/persistence/repositories.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { SQLiteBusinessRepository } from "../src/persistence/sqlite/sqlite.repositories.js";

const businessId = "demo-guzman";
const base = `/api/businesses/${businessId}/smart-planner`;
const mutation = (expectedRevision: number) => ({ expectedRevision, mutationId: randomUUID() });

describe("Smart Planner HTTP state after a complete Nest application restart", () => {
  let directory: string;
  let databasePath: string;
  let app: INestApplication | undefined;
  let projection: PlannerSourceProjection;
  let network: { mockRestore(): void };
  async function open() {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PersistenceModule],
      controllers: [PlannerController],
      providers: [PlannerService, SQLitePlannerRepository, { provide: SMART_PLANNER_REPOSITORY, useExisting: SQLitePlannerRepository },
        { provide: PlannerSourcesService, useValue: { read: async (id: string) => structuredClone(id === businessId ? projection : { ...projection, tasks: [] }) } }],
    }).overrideProvider(ConfigService).useValue(new ConfigService({ NODE_ENV: "test", DATABASE_PATH: databasePath })).compile();
    app = configureApp(module.createNestApplication());
    app.useLogger(false);
    await app.init();
    return app;
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-planner-restart-"));
    databasePath = join(directory, "application.sqlite");
    projection = { tasks: [{ taskKey: "website:contact", title: "Check contact details", explanation: "Saved evidence", guidance: "Original completed guidance",
      priority: "Urgent", category: "Admin", source: "Website", mode: "saved", destination: `/website?businessId=${businessId}`,
      origin: { kind: "finding", channel: "website", reportIds: ["original-report"], reportHashes: ["a".repeat(64)], findingId: "contact", evidenceRefs: [{ reportId: "original-report", evidenceId: "contact-evidence" }] } }],
      sources: [{ channel: "website", availability: "available", reportIds: ["original-report"] }, { channel: "social", availability: "empty", reportIds: [] }, { channel: "consistency", availability: "empty", reportIds: [] }] };
    network = jest.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("External fetch is forbidden in the restart fixture"); });
  });
  afterEach(async () => {
    await app?.close();
    network.mockRestore();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-planner-restart-")) throw new Error("Unexpected fixture directory");
    await rm(target, { recursive: true, force: true });
  });

  it("retains identities, schedules, preference and completed provenance, and deduplicates an old submission after restart", async () => {
    const firstApp = await open();
    const initial = await request(firstApp.getHttpServer()).get(base).expect(200);
    const sourceId = initial.body.tasks[0].id;
    await request(firstApp.getHttpServer()).patch(`${base}/preferences`).send({ ...mutation(0), useWeekends: true }).expect(200);
    const submission = { ...mutation(1), title: "Review weekend appointments", priority: "Medium", category: "Admin", notes: "Original custom guidance", schedule: { day: "2026-11-07", hour: 11 } };
    const created = await request(firstApp.getHttpServer()).post(`${base}/tasks`).send(submission).expect(201);
    const customId = created.body.tasks.find((task: { mode: string }) => task.mode === "custom").id;
    const completed = await request(firstApp.getHttpServer()).patch(`${base}/tasks/${sourceId}`).send({ ...mutation(2), status: "Done", completionConfirmed: true }).expect(200);
    const originalCompleted = completed.body.tasks.find((task: { id: string }) => task.id === sourceId);
    expect(originalCompleted.completedAt).toEqual(expect.any(String));
    const originalBusiness = (await firstApp.get(SQLiteBusinessRepository).findById(businessId))!;
    await firstApp.get(SQLiteBusinessRepository).upsertBusiness({ ...originalBusiness, id: "other", website: "https://other.example" });
    const originalDatabase = firstApp.get(AppDatabase);
    await firstApp.close(); app = undefined;

    // No service, repository or SQLite connection is reused after close.
    projection.tasks[0].guidance = "A later rendering of the same saved evidence";
    const secondApp = await open();
    expect(secondApp.get(AppDatabase)).not.toBe(originalDatabase);
    const reloaded = await request(secondApp.getHttpServer()).get(base).expect(200);
    expect(reloaded.body).toEqual(completed.body);
    expect(reloaded.body.preferences.useWeekends).toBe(true);
    expect(reloaded.body.tasks.find((task: { id: string }) => task.id === customId)).toMatchObject({ schedule: { day: "2026-11-07", hour: 11 }, guidance: "Original custom guidance" });
    expect(reloaded.body.tasks.find((task: { id: string }) => task.id === sourceId)).toEqual(originalCompleted);
    const retry = await request(secondApp.getHttpServer()).post(`${base}/tasks`).send(submission).expect(201);
    expect(retry.body.revision).toBe(3);
    expect(retry.body.tasks.filter((task: { mode: string }) => task.mode === "custom")).toHaveLength(1);
    const reconciled = await request(secondApp.getHttpServer()).post(`${base}/reconcile`).send({ ...mutation(3), confirmed: true }).expect(200);
    expect(reconciled.body.tasks.find((task: { id: string }) => task.id === sourceId)).toEqual(originalCompleted);

    const otherBase = "/api/businesses/other/smart-planner";
    const other = await request(secondApp.getHttpServer()).get(otherBase).expect(200);
    expect(other.body).toMatchObject({ revision: 0, tasks: [], preferences: { useWeekends: false } });
    await request(secondApp.getHttpServer()).patch(`${otherBase}/tasks/${customId}`).send({ ...mutation(0), schedule: null }).expect(404);
    expect(secondApp.get(AppDatabase).connection().prepare("SELECT COUNT(*) count FROM smart_planner_tasks WHERE business_id=?").get(businessId)?.count).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });
});
