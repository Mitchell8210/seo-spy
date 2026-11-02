import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import ts from "typescript";
import { configureApp } from "../src/configure-app.js";
import { PlannerController } from "../src/modules/smart-planner/planner.controller.js";
import { SQLitePlannerRepository } from "../src/modules/smart-planner/planner.repository.js";
import { PlannerService } from "../src/modules/smart-planner/planner.service.js";
import { PlannerSourcesService, type PlannerSourceProjection } from "../src/modules/smart-planner/planner-sources.js";
import { PersistenceModule } from "../src/persistence/persistence.module.js";
import { SMART_PLANNER_REPOSITORY } from "../src/persistence/repositories.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";

interface ClientSession {
  start(): () => void;
  getSnapshot(): { loading: boolean; saving: boolean; tasks: { id: string; status: string; title: string }[]; error: string | null; message: string };
  serverId(taskKey: string): string | undefined;
  mutate(method: "POST" | "PATCH", suffix: string, body: object, message: string): Promise<boolean>;
  refresh(): Promise<boolean>;
}

describe("Actual frontend planner transport against the offline Nest API", () => {
  let app: INestApplication;
  let base: string;
  let loseAcknowledgement: boolean;
  let calls: string[];
  const projection: PlannerSourceProjection = { tasks: [], sources: [
    { channel: "website", availability: "empty", reportIds: [] }, { channel: "social", availability: "empty", reportIds: [] }, { channel: "consistency", availability: "empty", reportIds: [] },
  ] };
  beforeEach(async () => {
    loseAcknowledgement = false; calls = [];
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PersistenceModule], controllers: [PlannerController],
      providers: [PlannerService, SQLitePlannerRepository, { provide: SMART_PLANNER_REPOSITORY, useExisting: SQLitePlannerRepository },
        { provide: PlannerSourcesService, useValue: { read: async () => structuredClone(projection) } }],
    }).compile();
    app = configureApp(module.createNestApplication()); app.useLogger(false);
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterEach(async () => { await app.close(); });

  function session(): ClientSession {
    const modules = new Map<string, Record<string, unknown>>();
    const localFetch = async (input: string, init: RequestInit) => {
      if (!input.startsWith("/api/businesses/demo-guzman/smart-planner")) throw new Error("Only the local planner API is permitted");
      calls.push(input);
      const response = await fetch(`${base}${input}`, init);
      if (loseAcknowledgement && init.method === "POST" && input.endsWith("/tasks")) {
        loseAcknowledgement = false;
        await response.arrayBuffer();
        throw new Error("Fixture connection lost after the database commit");
      }
      return response;
    };
    function load(name: string): Record<string, unknown> {
      const key = name.replace(/^\.\//, "");
      const existing = modules.get(key); if (existing) return existing;
      if (!["plannerApi", "plannerSession"].includes(key)) throw new Error("Unexpected browser dependency");
      const output: Record<string, unknown> = {}; modules.set(key, output);
      const content = ts.transpileModule(readFileSync(new URL(`../../client/src/services/${key}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      new Function("exports", "require", "fetch", "crypto", content)(output, load, localFetch, { randomUUID });
      return output;
    }
    const Constructor = load("plannerSession").PlannerSession as new (businessId: string) => ClientSession;
    return new Constructor("demo-guzman");
  }
  async function ready(client: ClientSession) {
    for (let attempt = 0; attempt < 100 && client.getSnapshot().loading; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(client.getSnapshot().loading).toBe(false);
    expect(client.getSnapshot().error).toBeNull();
  }
  it("loads and saves with the real response contract and safely retries a lost creation acknowledgement", async () => {
    const client = session(), stop = client.start();
    try {
      await ready(client);
      loseAcknowledgement = true;
      const input = { title: "Review saved business facts", priority: "Medium", category: "Admin", notes: "Original guidance", schedule: { day: "2026-11-02", hour: 9 } };
      expect(await client.mutate("POST", "/tasks", input, "Saved")).toBe(false);
      expect(client.getSnapshot().tasks).toHaveLength(0); // Never acknowledge an uncertain save.
      expect(await client.mutate("POST", "/tasks", input, "Saved")).toBe(true);
      expect(client.getSnapshot().tasks).toHaveLength(1);
      const task = client.getSnapshot().tasks[0];
      const serverId = client.serverId(task.id)!;
      expect(await client.mutate("PATCH", `/tasks/${serverId}`, { status: "Done", completionConfirmed: true }, "Completed")).toBe(true);
      expect(await client.refresh()).toBe(true);
      expect(client.getSnapshot().tasks[0].status).toBe("Done");
      const rows = app.get(AppDatabase).connection().prepare("SELECT COUNT(*) count FROM smart_planner_tasks").get();
      expect(rows?.count).toBe(1);
      expect(calls.every(path => path.startsWith("/api/businesses/demo-guzman/smart-planner"))).toBe(true);
    } finally { stop(); }
  });
  it("refetches a real revision conflict without replaying the intended action", async () => {
    const client = session(), stop = client.start();
    try {
      await ready(client);
      const response = await fetch(`${base}/api/businesses/demo-guzman/smart-planner/preferences`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ useWeekends: true, expectedRevision: 0, mutationId: randomUUID() }) });
      expect(response.status).toBe(200);
      expect(await client.mutate("PATCH", "/preferences", { useWeekends: false }, "Saved")).toBe(false);
      expect(client.getSnapshot().error).toMatch(/conflicted/);
      expect((await app.get(SQLitePlannerRepository).read("demo-guzman")).useWeekends).toBe(true);
      expect(await client.mutate("PATCH", "/preferences", { useWeekends: false }, "Saved")).toBe(true);
      expect((await app.get(SQLitePlannerRepository).read("demo-guzman")).useWeekends).toBe(false);
    } finally { stop(); }
  });
});
