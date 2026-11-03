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
import { MetaMuseProvider } from "../src/integrations/ai/meta-muse.provider.js";
import { PlannerController } from "../src/modules/smart-planner/planner.controller.js";
import { PlannerAiController } from "../src/modules/smart-planner/planner-ai.controller.js";
import { computeWorkloads, defaultAiSettings, offlineAiProposal, type AiPlanOutput } from "../src/modules/smart-planner/planner-ai.domain.js";
import { PlannerAiGateway, PlannerAiGenerationError } from "../src/modules/smart-planner/planner-ai.gateway.js";
import { PlannerAiService } from "../src/modules/smart-planner/planner-ai.service.js";
import { PlannerAiStore } from "../src/modules/smart-planner/planner-ai.store.js";
import { SQLitePlannerRepository } from "../src/modules/smart-planner/planner.repository.js";
import { PLANNER_CLOCK, PlannerService } from "../src/modules/smart-planner/planner.service.js";
import { PlannerSourcesService, type PlannerSourceProjection } from "../src/modules/smart-planner/planner-sources.js";
import { PersistenceModule } from "../src/persistence/persistence.module.js";
import { SMART_PLANNER_REPOSITORY } from "../src/persistence/repositories.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { SQLiteBusinessRepository } from "../src/persistence/sqlite/sqlite.repositories.js";

const base = "/api/businesses/demo-guzman/smart-planner";
const mutation = (expectedRevision: number) => ({ expectedRevision, mutationId: randomUUID() });
interface TaskView { id: string; title: string; status: string; schedule: { day: string; hour: number; minute?: number } | null; completedAt: string | null }
type ProposalView = Awaited<ReturnType<PlannerAiService["generate"]>>;

describe("isolated Muse Smart Planner proposal HTTP workflow", () => {
  let app: INestApplication;
  let directory: string;
  let databasePath: string;
  let revision: number;
  let now: Date;
  let sourceState: PlannerSourceProjection;
  let network: { mockRestore(): void };
  const prepare = jest.fn(() => ({ requestHash: "a".repeat(64), reserveMicros: 100 }));
  const dispatch = jest.fn(async () => { throw new Error("Paid dispatch forbidden in offline API fixtures"); });
  async function start() {
    const database = new AppDatabase(new ConfigService({ NODE_ENV: "test", DATABASE_PATH: databasePath, AI_USAGE_DB: join(directory, "protected-ai.sqlite") }));
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PersistenceModule],
      controllers: [PlannerController, PlannerAiController],
      providers: [PlannerService, SQLitePlannerRepository, PlannerAiStore, PlannerAiGateway, PlannerAiService,
        { provide: SMART_PLANNER_REPOSITORY, useExisting: SQLitePlannerRepository },
        { provide: PLANNER_CLOCK, useValue: () => now },
        { provide: PlannerSourcesService, useValue: { read: async () => structuredClone(sourceState) } },
        { provide: MetaMuseProvider, useValue: { prepare, generate: dispatch } }],
    }).overrideProvider(AppDatabase).useValue(database).compile();
    app = configureApp(module.createNestApplication()); app.useLogger(false); await app.init();
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-planner-ai-api-")); databasePath = join(directory, "application.sqlite");
    revision = 0; now = new Date("2026-11-02T08:00:00.000Z"); prepare.mockClear(); dispatch.mockClear();
    sourceState = { tasks: [], sources: [
      { channel: "website", availability: "empty", reportIds: [] }, { channel: "social", availability: "empty", reportIds: [] }, { channel: "consistency", availability: "empty", reportIds: [] },
    ] };
    network = jest.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Network forbidden in planner fixtures"); });
    await start();
  });
  afterEach(async () => {
    await app.close(); expect(dispatch).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); network.mockRestore();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-planner-ai-api-")) throw new Error("Unexpected fixture directory");
    await rm(target, { recursive: true, force: true });
  });
  async function planner() { return (await request(app.getHttpServer()).get(base).expect(200)).body; }
  async function preference(body: object) {
    const result = await request(app.getHttpServer()).patch(`${base}/preferences`).send({ ...mutation(revision), ...body }).expect(200);
    revision = result.body.revision; return result.body;
  }
  async function create(title: string, extra: object = {}) {
    const result = await request(app.getHttpServer()).post(`${base}/tasks`).send({ ...mutation(revision), title, priority: "Medium", category: "Review", ...extra }).expect(201);
    revision = result.body.revision; return (result.body.tasks as TaskView[]).find(task => task.title === title)!;
  }
  async function setupTasks() { await preference({ timeZone: "UTC" }); return create("Review important content", { notes: "Keep original guidance" }); }
  async function generate(extra: object = {}, body = { ...mutation(revision), mode: "mock", weekStart: "2026-11-02" }) {
    return (await request(app.getHttpServer()).post(`${base}/ai-proposals`).send({ ...body, ...extra }).expect(201)).body as ProposalView;
  }
  async function saveSettings(extra: object) {
    const result = await request(app.getHttpServer()).patch(`${base}/ai-preferences`).send({ ...mutation(revision), settings: { ...defaultAiSettings, ...extra } }).expect(200);
    revision = result.body.plannerRevision; return result.body;
  }

  it("reads defaults and no proposal without creating planner rows or requesting generation", async () => {
    const response = await request(app.getHttpServer()).get(`${base}/ai-preferences`).expect(200);
    expect(response.body).toEqual({ businessId: "demo-guzman", plannerRevision: 0, settings: defaultAiSettings, weeklyBudgetMinutes: 420 });
    expect((await request(app.getHttpServer()).get(`${base}/ai-proposals`).expect(200)).body).toBeNull();
    expect(app.get(AppDatabase).connection().prepare("SELECT COUNT(*) count FROM smart_planners").get()?.count).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("validates complete AI settings, persists a separate workload policy and enforces CAS and mutation identity", async () => {
    const invalid = [{ weeklyAvailableMinutes: 0 }, { weeklyAvailableMinutes: 75 }, { targetUtilization: 100 }, { dailyLimitMinutes: 45 }, { horizonWeeks: 1 }, { horizonWeeks: 53 }, { workingDays: [] }, { workingDays: [1, 1] }, { workingDays: [0] }, { protectExistingSchedules: null }, { unexpected: true }];
    for (const extra of invalid) await request(app.getHttpServer()).patch(`${base}/ai-preferences`).send({ ...mutation(0), settings: { ...defaultAiSettings, ...extra } }).expect(400);
    await request(app.getHttpServer()).patch(`${base}/ai-preferences`).send({ ...mutation(0), settings: null }).expect(400);
    const before = await planner();
    const body = { ...mutation(0), settings: { ...defaultAiSettings, weeklyAvailableMinutes: 900, horizonWeeks: 8 } };
    const saved = (await request(app.getHttpServer()).patch(`${base}/ai-preferences`).send(body).expect(200)).body;
    expect(saved).toMatchObject({ plannerRevision: 1, weeklyBudgetMinutes: 630, settings: body.settings });
    expect((await planner()).preferences).toEqual(before.preferences);
    expect((await request(app.getHttpServer()).patch(`${base}/ai-preferences`).send(body).expect(200)).body).toEqual(saved);
    await request(app.getHttpServer()).patch(`${base}/ai-preferences`).send({ ...body, settings: defaultAiSettings }).expect(409);
    await request(app.getHttpServer()).patch(`${base}/ai-preferences`).send({ ...mutation(0), settings: defaultAiSettings }).expect(409);
    expect((await planner()).revision).toBe(1);
  });

  it("generates and stores an explicitly offline proposal without changing active tasks, preferences or revision", async () => {
    await setupTasks(); const before = await planner(); const proposal = await generate();
    expect(proposal).toMatchObject({ businessId: "demo-guzman", status: "ready", mode: "mock", model: "offline-simulation", stale: false, expired: false, plannerRevision: revision });
    expect(proposal.output?.entries).toHaveLength(1);
    expect(proposal.output?.weeklyWorkloads).toHaveLength(4);
    expect(await planner()).toEqual(before);
    expect((await request(app.getHttpServer()).get(`${base}/ai-proposals/${proposal.id}`).expect(200)).body).toEqual(proposal);
    expect((await request(app.getHttpServer()).get(`${base}/ai-proposals`).expect(200)).body.id).toBe(proposal.id);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("supports both simple planning scopes without saving settings or touching completed tasks during generation", async () => {
    const pending = await setupTasks();
    const scheduled = await create("Manual scheduled task", { schedule: { day: "2026-12-01", hour: 9 } });
    const completed = await create("Completed task");
    const done = await request(app.getHttpServer()).patch(`${base}/tasks/${completed.id}`).send({ ...mutation(revision), status: "Done", completionConfirmed: true }).expect(200);
    revision = done.body.revision;
    const before = await planner();
    const settings = (await request(app.getHttpServer()).get(`${base}/ai-preferences`).expect(200)).body;
    const unscheduled = await generate({ scope: "unscheduled" });
    expect(unscheduled.output?.entries.map(entry => entry.taskId)).toEqual([pending.id]);
    const all = await generate({ scope: "all" });
    expect(new Set(all.output?.entries.map(entry => entry.taskId))).toEqual(new Set([pending.id, scheduled.id]));
    expect(await planner()).toEqual(before);
    expect((await request(app.getHttpServer()).get(`${base}/ai-preferences`).expect(200)).body).toEqual(settings);
    await request(app.getHttpServer()).post(`${base}/ai-proposals`).send({ ...mutation(revision), mode: "mock", weekStart: "2026-11-02", scope: "other" }).expect(400);
    await request(app.getHttpServer()).post(`${base}/ai-proposals`).send({ ...mutation(revision), mode: "mock", weekStart: "2026-11-02", scope: "all", reconsiderTaskIds: [scheduled.id] }).expect(422);
    const applied = await request(app.getHttpServer()).post(`${base}/ai-proposals/${all.id}/apply`).send({ ...mutation(revision), confirmed: true }).expect(201);
    expect(applied.body.tasks.find((task: TaskView) => task.id === completed.id)).toEqual(before.tasks.find((task: TaskView) => task.id === completed.id));
    expect(applied.body.tasks.find((task: TaskView) => task.id === scheduled.id).schedule.day < "2026-12-01").toBe(true);
  });

  it("replays identical generation requests durably and rejects reused IDs with changed content", async () => {
    await setupTasks(); const body = { ...mutation(revision), mode: "mock", weekStart: "2026-11-02" };
    const first = await generate({}, body);
    const replay = await generate({}, body); expect(replay).toEqual(first);
    await request(app.getHttpServer()).post(`${base}/ai-proposals`).send({ ...body, weekStart: "2026-11-09" }).expect(409);
    expect(app.get(AppDatabase).connection().prepare("SELECT COUNT(*) count FROM smart_planner_ai_proposals").get()?.count).toBe(1);
    await app.close(); await start();
    expect(await generate({}, body)).toEqual(first);
  });

  it("stores compact live prompt provenance and reopens it without changing the v1 review/apply contract", async () => {
    await setupTasks();
    jest.spyOn(app.get(PlannerAiGateway), "generate").mockImplementationOnce(async source => ({ output: offlineAiProposal(source), model: "muse-spark-1.3", requestIdentity: "a".repeat(64), accountingAttemptId: "offline-live-attempt" }));
    const proposal = await app.get(PlannerAiService).generate("demo-guzman", { ...mutation(revision), mode: "live", weekStart: "2026-11-02", scope: "all" }, { actor: "a".repeat(64), businessId: "demo-guzman", siteUrl: "https://example.com/" });
    expect(proposal.promptVersion).toBe("seo-impact-roadmap-v3-typed"); expect(proposal.output?.schemaVersion).toBe("planner-muse-proposal-v1");
    await app.close(); await start();
    expect((await request(app.getHttpServer()).get(`${base}/ai-proposals/${proposal.id}`).expect(200)).body.promptVersion).toBe("seo-impact-roadmap-v3-typed");
    // Historical compact-v1 wire responses were never stored; their expanded
    // proposals and original prompt provenance must remain readable.
    const previous = app.get(PlannerAiStore).get("demo-guzman", proposal.id);
    previous.promptVersion = "seo-impact-roadmap-v2-compact";
    app.get(PlannerAiStore).update(previous);
    await app.close(); await start();
    expect((await request(app.getHttpServer()).get(`${base}/ai-proposals/${proposal.id}`).expect(200)).body.promptVersion).toBe("seo-impact-roadmap-v2-compact");
  });

  it("turns over-capacity Muse dates into a persisted reviewable plan without changing tasks until explicit Apply", async () => {
    await setupTasks(); for (let i = 0; i < 5; i++) await create(`Capacity fixture ${i}`);
    await saveSettings({ weeklyAvailableMinutes: 420, targetUtilization: 60 });
    const before = await planner();
    jest.spyOn(app.get(PlannerAiGateway), "generate").mockImplementationOnce(async snapshot => {
      const output = offlineAiProposal(snapshot);
      for (const [i, entry] of output.entries.entries()) {
        const day = `2026-11-0${2 + Math.floor(i / 2)}`;
        entry.proposedStart = { day, hour: 9 + i % 2, minute: 0 }; entry.proposedEnd = { day, hour: 10 + i % 2, minute: 0 }; entry.deferredReason = null;
      }
      output.weeklyWorkloads = computeWorkloads(snapshot, output.entries);
      return { output, model: "muse-spark-1.3", requestIdentity: "c".repeat(64), accountingAttemptId: "offline-capacity-attempt" };
    });
    const proposal = await app.get(PlannerAiService).generate("demo-guzman", { ...mutation(revision), mode: "live", weekStart: "2026-11-02", scope: "all" },
      { actor: "a".repeat(64), businessId: "demo-guzman", siteUrl: "https://example.com/" });
    expect(proposal.status).toBe("ready"); expect(proposal.output!.weeklyWorkloads.every(week => week.totalMinutes <= 240)).toBe(true);
    expect(proposal.output!.tradeoffs[0]).toContain("Review this revised schedule before Apply Plan");
    expect(await planner()).toEqual(before);
    await app.close(); await start();
    expect(app.get(PlannerAiStore).get("demo-guzman", proposal.id).output).toEqual(proposal.output);
    const apply = { ...mutation(revision), confirmed: true };
    const result = (await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send(apply).expect(201)).body;
    expect(result.tasks.filter((task: TaskView) => task.schedule)).toHaveLength(6);
    expect((await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send(apply).expect(201)).body).toEqual(result);
  });

  it("persists explicit completion undo with its history and invalidates an older AI proposal", async () => {
    const task = await setupTasks();
    const done = await request(app.getHttpServer()).patch(`${base}/tasks/${task.id}`).send({ ...mutation(revision), status: "Done", completionConfirmed: true, schedule: { day: "2026-11-02", hour: 10 } }).expect(200);
    revision = done.body.revision;
    await create("Still pending task"); const proposal = await generate();
    const body = mutation(revision);
    const undone = await request(app.getHttpServer()).post(`${base}/tasks/${task.id}/undo-completion`).send(body).expect(200);
    revision = undone.body.revision;
    await app.close(); await start();
    expect((await planner()).tasks.find((item: TaskView) => item.id === task.id)).toMatchObject({ status: "Needs Action", completedAt: null, schedule: { day: "2026-11-02", hour: 10 } });
    expect((await request(app.getHttpServer()).post(`${base}/tasks/${task.id}/undo-completion`).send(body).expect(200)).body).toEqual(undone.body);
    const history = JSON.parse(String(app.get(AppDatabase).connection().prepare("SELECT data_json FROM smart_planner_tasks WHERE id=?").get(task.id)?.data_json)).completionUndoHistory;
    expect(history).toEqual([{ completedAt: done.body.tasks.find((item: TaskView) => item.id === task.id).completedAt, undoneAt: expect.any(String) }]);
    await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(revision), confirmed: true }).expect(409);
  });

  it("keeps custom deletion and its receipt durable after restart and invalidates older AI proposals", async () => {
    const task = await setupTasks(), proposal = await generate();
    const body = { ...mutation(revision), confirmed: true };
    const deleted = await request(app.getHttpServer()).delete(`${base}/tasks/${task.id}`).send(body).expect(200);
    revision = deleted.body.revision;
    await app.close(); await start();
    expect((await planner()).tasks.some((item: TaskView) => item.id === task.id)).toBe(false);
    expect((await request(app.getHttpServer()).delete(`${base}/tasks/${task.id}`).send(body).expect(200)).body).toEqual(deleted.body);
    await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(revision), confirmed: true }).expect(409);
  });

  it("blocks unauthenticated live generation before financial authorization or central dispatch", async () => {
    await setupTasks(); const before = await planner();
    await request(app.getHttpServer()).post(`${base}/ai-proposals`).send({ ...mutation(revision), mode: "live", weekStart: "2026-11-02" }).expect(401);
    expect(prepare).not.toHaveBeenCalled(); expect(await planner()).toEqual(before);
  });

  it("requires explicit confirmation and atomically applies once, retaining original completion and manual schedules", async () => {
    await preference({ timeZone: "UTC" });
    const manual = await create("Protected manual commitment", { schedule: { day: "2026-11-02", hour: 9 } });
    const done = await create("Historical work", { notes: "Original completed guidance", schedule: { day: "2026-11-03", hour: 9 } });
    const completion = await request(app.getHttpServer()).patch(`${base}/tasks/${done.id}`).send({ ...mutation(revision), status: "Done", completionConfirmed: true }).expect(200);
    revision = completion.body.revision;
    await create("Open consequential work");
    const before = await planner(), proposal = await generate();
    await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(revision), confirmed: false }).expect(400);
    const approval = { ...mutation(revision), confirmed: true };
    const applied = (await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send(approval).expect(201)).body;
    revision = applied.revision;
    for (const protectedTask of [manual, done]) expect((applied.tasks as TaskView[]).find(task => task.id === protectedTask.id)).toEqual((before.tasks as TaskView[]).find(task => task.id === protectedTask.id));
    expect((await request(app.getHttpServer()).get(`${base}/ai-proposals/${proposal.id}`).expect(200)).body).toMatchObject({ status: "applied", stale: false, appliedAt: now.toISOString() });
    expect((await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send(approval).expect(201)).body).toEqual(applied);
    await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(revision), confirmed: true }).expect(409);
    await app.close(); await start();
    expect(await planner()).toEqual(applied);
    expect((await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send(approval).expect(201)).body).toEqual(applied);
  });

  it("rejects stale revisions after manual edits and stale source state even without a planner revision change", async () => {
    await setupTasks(); let proposal = await generate();
    await create("New manual task");
    expect((await request(app.getHttpServer()).get(`${base}/ai-proposals/${proposal.id}`).expect(200)).body.stale).toBe(true);
    await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(revision), confirmed: true }).expect(409);
    proposal = await generate(); const before = await planner();
    sourceState.sources[0] = { channel: "website", availability: "failed", reportIds: [] };
    expect((await request(app.getHttpServer()).get(`${base}/ai-proposals/${proposal.id}`).expect(200)).body.stale).toBe(true);
    await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(revision), confirmed: true }).expect(409);
    expect((await planner()).tasks).toEqual(before.tasks);
    expect((await planner()).revision).toBe(revision);
  });

  it("rejects proposals after AI preference changes and after time advances past their start", async () => {
    await setupTasks(); let proposal = await generate();
    await saveSettings({ horizonWeeks: 8 });
    await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(revision), confirmed: true }).expect(409);
    proposal = await generate(); now = new Date("2026-11-02T10:00:00.000Z");
    await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(revision), confirmed: true }).expect(422);
  });

  it("does not leak proposals across businesses or accept missing businesses, IDs or invalid request fields", async () => {
    await setupTasks(); const proposal = await generate();
    const other = "/api/businesses/unregistered-business/smart-planner";
    await request(app.getHttpServer()).get(`${other}/ai-preferences`).expect(404);
    await request(app.getHttpServer()).get(`${other}/ai-proposals/${proposal.id}`).expect(404);
    await request(app.getHttpServer()).post(`${other}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(revision), confirmed: true }).expect(404);
    await request(app.getHttpServer()).get(`${base}/ai-proposals/not-a-uuid`).expect(400);
    await request(app.getHttpServer()).get(`${base}/ai-proposals/${randomUUID()}`).expect(404);
    for (const extra of [{ mode: "fallback" }, { reconsiderTaskIds: ["unknown"] }, { extra: true }, { weekStart: null }]) await request(app.getHttpServer()).post(`${base}/ai-proposals`).send({ ...mutation(revision), mode: "mock", weekStart: "2026-11-02", ...extra }).expect(400);
    await request(app.getHttpServer()).post(`${base}/ai-proposals`).send({ ...mutation(revision), mode: "mock", weekStart: "2026-11-03" }).expect(422);
  });

  it("keeps a planned task protected unless an explicit eligible reconsideration is selected", async () => {
    await preference({ timeZone: "UTC" }); const task = await create("Manually planned", { schedule: { day: "2026-11-02", hour: 9 } });
    await request(app.getHttpServer()).post(`${base}/ai-proposals`).send({ ...mutation(revision), mode: "mock", weekStart: "2026-11-02" }).expect(422);
    await request(app.getHttpServer()).post(`${base}/ai-proposals`).send({ ...mutation(revision), mode: "mock", weekStart: "2026-11-02", reconsiderTaskIds: [task.id] }).expect(422);
    await saveSettings({ protectExistingSchedules: false });
    const proposal = await generate({ reconsiderTaskIds: [task.id] }); expect(proposal.output?.entries[0].taskId).toBe(task.id);
    expect(proposal.tasks.find(item => item.id === task.id)?.protected).toBe(false);
  });

  it("stores invalid output diagnostics without retaining model payload or changing task state", async () => {
    await setupTasks(); const before = await planner();
    jest.spyOn(app.get(PlannerAiGateway), "generate").mockResolvedValueOnce({ output: { arbitrary: "untrusted invalid output" } as unknown as AiPlanOutput, model: "offline-fixture", requestIdentity: null, accountingAttemptId: null });
    const proposal = await generate();
    expect(proposal.status).toBe("invalid"); expect(proposal.output).toBeNull(); expect(proposal.diagnostics.length).toBeGreaterThan(0);
    expect(JSON.stringify(app.get(PlannerAiStore).get("demo-guzman", proposal.id))).not.toContain("untrusted invalid output");
    expect(await planner()).toEqual(before);
  });

  it("persists safe response rejection diagnostics and the accounting link across restart without retry", async () => {
    await setupTasks(); const before = await planner(), body = { ...mutation(revision), mode: "live" as const, weekStart: "2026-11-02" };
    const frontend = { actor: "a".repeat(64), businessId: "demo-guzman", siteUrl: "https://example.com/" };
    const diagnostic = { code: "AI_RESPONSE_MISSING_TASKS", detail: "Muse returned 1 of 2 eligible tasks; every task must be scheduled or explicitly deferred." };
    const receipt = { model: "muse-spark-1.3", requestIdentity: "b".repeat(64), accountingAttemptId: "offline-settled-attempt" };
    const gateway = jest.spyOn(app.get(PlannerAiGateway), "generate").mockRejectedValueOnce(new PlannerAiGenerationError("AI_PLANNING_RESPONSE_INVALID", diagnostic.detail, [diagnostic], receipt));
    const proposal = await app.get(PlannerAiService).generate("demo-guzman", body, frontend);
    expect(proposal.status).toBe("failed"); expect(proposal.diagnostics).toContainEqual(diagnostic);
    expect(app.get(PlannerAiStore).get("demo-guzman", proposal.id)).toMatchObject(receipt);
    expect(await app.get(PlannerAiService).generate("demo-guzman", body, frontend)).toEqual(proposal); expect(gateway).toHaveBeenCalledTimes(1);
    expect((await planner()).tasks).toEqual(before.tasks);
    await app.close(); await start();
    expect(app.get(PlannerAiStore).get("demo-guzman", proposal.id)).toMatchObject({ ...receipt, diagnostics: expect.arrayContaining([diagnostic]) });
  });

  it("records provider failure without automatic retry or leaking exception details", async () => {
    await setupTasks(); const body = { ...mutation(revision), mode: "mock", weekStart: "2026-11-02" };
    const gateway = jest.spyOn(app.get(PlannerAiGateway), "generate").mockRejectedValueOnce(new Error("secret-provider-body-token"));
    const first = await generate({}, body); expect(first.status).toBe("failed"); expect(JSON.stringify(first)).not.toContain("secret-provider-body-token");
    expect(await generate({}, body)).toEqual(first); expect(gateway).toHaveBeenCalledTimes(1);
  });

  it("rolls back all schedules, task updates and planner receipts if proposal audit persistence fails", async () => {
    await setupTasks(); const proposal = await generate(), before = await planner();
    const store = app.get(PlannerAiStore), original = store.update.bind(store);
    const update = jest.spyOn(store, "update").mockImplementationOnce(() => { throw new Error("Injected storage failure"); });
    await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(revision), confirmed: true }).expect(503);
    expect(await planner()).toEqual(before); expect(store.get("demo-guzman", proposal.id).status).toBe("ready");
    update.mockImplementation(original);
    await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(revision), confirmed: true }).expect(201);
  });

  it("holds duplicate concurrent generation requests to one reserved proposal and one gateway call", async () => {
    await setupTasks(); const gateway = app.get(PlannerAiGateway), real = gateway.generate.bind(gateway);
    let release!: () => void; const gate = new Promise<void>(resolveGate => { release = resolveGate; });
    const call = jest.spyOn(gateway, "generate").mockImplementation(async (...args) => { await gate; return real(...args); });
    const body = { ...mutation(revision), mode: "mock", weekStart: "2026-11-02" };
    const pending = request(app.getHttpServer()).post(`${base}/ai-proposals`).send(body).then(response => response);
    for (let attempts = 0; attempts < 40 && call.mock.calls.length === 0; attempts++) await new Promise(resolveWait => setTimeout(resolveWait, 5));
    const duplicate = await generate({}, body); expect(duplicate.status).toBe("generating");
    release(); const completed = await pending; expect(completed.status).toBe(201); expect(completed.body.id).toBe(duplicate.id); expect(call).toHaveBeenCalledTimes(1);
  });

  it("checks scheduling validity on application even when stored output is structurally valid", async () => {
    await setupTasks(); const proposal = await generate(), record = app.get(PlannerAiStore).get("demo-guzman", proposal.id);
    const output = offlineAiProposal(record.snapshot); output.entries[0].proposedEnd!.hour = 17;
    record.output = output; app.get(PlannerAiStore).update(record);
    await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(revision), confirmed: true }).expect(422);
    expect((await planner()).tasks[0].schedule).toBeNull();
  });

  it("requires a confirmed time zone and eligible tasks and rejects a wholly past planning window", async () => {
    await create("Unscheduled task");
    await request(app.getHttpServer()).post(`${base}/ai-proposals`).send({ ...mutation(revision), mode: "mock", weekStart: "2026-11-02" }).expect(422);
    await preference({ timeZone: "UTC" });
    await request(app.getHttpServer()).post(`${base}/ai-proposals`).send({ ...mutation(revision), mode: "mock", weekStart: "2026-09-28" }).expect(422);
    expect(app.get(AppDatabase).connection().prepare("SELECT COUNT(*) count FROM smart_planner_ai_proposals").get()?.count).toBe(0);
  });

  it("rejects an effective weekly budget below one supported slot and rolls back failed settings persistence", async () => {
    await request(app.getHttpServer()).patch(`${base}/ai-preferences`).send({ ...mutation(0), settings: { ...defaultAiSettings, weeklyAvailableMinutes: 60, targetUtilization: 10 } }).expect(422);
    const store = app.get(PlannerAiStore), original = store.saveSettings.bind(store);
    jest.spyOn(store, "saveSettings").mockImplementationOnce((...args) => { original(...args); throw new Error("Injected settings storage failure"); });
    await request(app.getHttpServer()).patch(`${base}/ai-preferences`).send({ ...mutation(0), settings: { ...defaultAiSettings, horizonWeeks: 8 } }).expect(503);
    expect((await planner()).revision).toBe(0); expect(store.settings("demo-guzman")).toEqual(defaultAiSettings);
    expect(app.get(AppDatabase).connection().prepare("SELECT COUNT(*) count FROM smart_planner_mutations").get()?.count).toBe(0);
  });

  it("isolates records and settings from another registered business", async () => {
    await setupTasks(); const proposal = await generate();
    const businesses = app.get(SQLiteBusinessRepository), original = await businesses.findById("demo-guzman");
    await businesses.upsertBusiness({ ...original!, id: "second-business", name: "Second fixture business" });
    const other = "/api/businesses/second-business/smart-planner";
    expect((await request(app.getHttpServer()).get(`${other}/ai-preferences`).expect(200)).body).toMatchObject({ businessId: "second-business", plannerRevision: 0, settings: defaultAiSettings });
    expect((await request(app.getHttpServer()).get(`${other}/ai-proposals`).expect(200)).body).toBeNull();
    await request(app.getHttpServer()).get(`${other}/ai-proposals/${proposal.id}`).expect(404);
    await request(app.getHttpServer()).post(`${other}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(0), confirmed: true }).expect(404);
    expect((await request(app.getHttpServer()).get(other).expect(200)).body.tasks).toEqual([]);
  });

  it("expires unapplied proposals without deleting their audit records or dispatching again", async () => {
    await setupTasks(); const proposal = await generate(); now = new Date("2026-11-10T08:00:00.000Z");
    const expired = (await request(app.getHttpServer()).get(`${base}/ai-proposals/${proposal.id}`).expect(200)).body;
    expect(expired).toMatchObject({ expired: true, status: "ready" });
    await request(app.getHttpServer()).post(`${base}/ai-proposals/${proposal.id}/apply`).send({ ...mutation(revision), confirmed: true }).expect(409);
    expect(app.get(PlannerAiStore).get("demo-guzman", proposal.id).id).toBe(proposal.id);
  });

  it("returns an interrupted generation reservation after restart without automatic provider replay", async () => {
    await setupTasks(); const body = { ...mutation(revision), mode: "mock", weekStart: "2026-11-02" }, proposal = await generate({}, body);
    const record = app.get(PlannerAiStore).get("demo-guzman", proposal.id); record.status = "generating"; record.output = null; app.get(PlannerAiStore).update(record);
    await app.close(); await start();
    const gateway = jest.spyOn(app.get(PlannerAiGateway), "generate");
    expect(await generate({}, body)).toMatchObject({ id: proposal.id, status: "generating", output: null });
    expect(gateway).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });
});
