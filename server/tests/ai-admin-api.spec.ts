import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import request from "supertest";
import { AiModule } from "../src/modules/ai/ai.module.js";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import { configureApp } from "../src/configure-app.js";

const adminKey = "administrator-fixture-key-at-least-32-characters";
const operatorKey = "wordpress-operator-fixture-key-at-least-32-characters";
const hash = "a".repeat(64);

describe("local AI administrator API never generates a model response", () => {
  let app: INestApplication;
  let directory: string;
  let usage: AiUsageStore;
  let settings: Record<string, unknown>;
  const send = jest.fn<MetaMuseTransport["post"]>();
  const get = (path: string, token = adminKey) => request(app.getHttpServer()).get(`/api/ai/admin${path}`).set("Host", "localhost:3001").set("Authorization", `Bearer ${token}`);
  const post = (path: string, body: object, token = adminKey) => request(app.getHttpServer()).post(`/api/ai/admin${path}`).set("Host", "localhost:3001").set("Authorization", `Bearer ${token}`).send(body);

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-ai-admin-"));
    settings = { AI_ADMIN_KEY: adminKey, AI_ADMIN_ORIGIN: "http://localhost:5173", AI_MODE: "mock", MOCK_AI: true, AI_ENABLED: false, AI_USAGE_DB: join(directory, "usage.sqlite"), PORT: 3001 };
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AiModule] })
      .overrideProvider(ConfigService).useValue(new ConfigService(settings))
      .overrideProvider(MetaMuseTransport).useValue({ post: send }).compile();
    app = configureApp(module.createNestApplication());
    app.useLogger(false);
    await app.init();
    usage = app.get(AiUsageStore);
  });
  afterEach(async () => {
    expect(send).not.toHaveBeenCalled();
    await app.close();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-ai-admin-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });
  const estimate = () => usage.estimate({ actor: "o".repeat(64), scope: "wordpress:business:report", requestHash: hash, cacheKey: hash, mode: "poc", model: "muse-spark-1.3", maxInputTokens: 1000, maxOutputTokens: 1500, reserveMicros: 7625, priceVersion: "fixture-verified-price-v1", reason: "Verify one essential structured output contract." });

  it("requires a separate administrator key and rejects hostile Hosts/Origins before database access", async () => {
    const inspect = jest.spyOn(usage, "status");
    await get("/status", operatorKey).expect(401);
    await get("/status", "wrong").expect(401);
    await get("/status").set("Host", "attacker.example").expect(403);
    await get("/status").set("Origin", "https://attacker.example").expect(403);
    expect(inspect).not.toHaveBeenCalled();
    settings.AI_ADMIN_KEY = "";
    await get("/status").expect(503);
  });
  it("reports persistent zero usage and mock mode without disclosing credentials or querying billing", async () => {
    const response = await get("/status").expect(200);
    expect(response.body).toMatchObject({ effectiveMode: "mock", providerBillingBalanceVerified: false, usage: { development: { chargedMicros: 0, calls: 0, budgetMicros: 2000000, dailyMicros: 500000, maxCalls: 10 }, demo: { calls: 0, authorization: null } } });
    expect(response.text).not.toContain(adminKey);
    expect(response.text).not.toContain(operatorKey);
  });
  it("binds a single-use approval to the reviewed immutable estimate and maximum cost", async () => {
    const intent = await estimate();
    await get(`/intents/${intent.id}`).expect(200);
    await post(`/intents/${intent.id}/approve`, { confirmed: true, requestHash: "b".repeat(64), reserveMicros: intent.reserveMicros }).expect(409);
    await post(`/intents/${intent.id}/approve`, { confirmed: true, requestHash: hash, reserveMicros: intent.reserveMicros + 1 }).expect(409);
    await post(`/intents/${intent.id}/approve`, { requestHash: hash, reserveMicros: intent.reserveMicros }).expect(400);
    const approved = await post(`/intents/${intent.id}/approve`, { confirmed: true, requestHash: hash, reserveMicros: intent.reserveMicros }).expect(201);
    expect(approved.body.approvedBy).toMatch(/^[a-f0-9]{64}$/);
    expect((await usage.status()).development.calls).toBe(0);
    await usage.reserve(intent.id, { actor: intent.actor, requestHash: hash, mode: "poc" });
    await expect(usage.reserve(intent.id, { actor: intent.actor, requestHash: hash, mode: "poc" })).rejects.toBeDefined();
    expect((await usage.status()).development.calls).toBe(1);
    await post(`/intents/${intent.id}/approve`, { confirmed: true, requestHash: hash, reserveMicros: intent.reserveMicros }).expect(409);
  });
  it("requires explicit bounded demo authorization and preserves separate historical development charges", async () => {
    await post("/demo-authorizations", { budgetMicros: 1000000, dailyMicros: 500000, maxCalls: 2, reason: "Final video recording validation." }).expect(400);
    await post("/demo-authorizations", { confirmed: true, budgetMicros: 148000001, dailyMicros: 500000, maxCalls: 2, reason: "Final video recording validation." }).expect(400);
    const intent = await estimate();
    await usage.approve(intent.id, "fixture-admin");
    const reserved = await usage.reserve(intent.id, { actor: intent.actor, requestHash: hash, mode: "poc" });
    await usage.settle(reserved.id, { status: "failed", errorCode: "AI_PROVIDER_FAILED" });
    const authorization = await post("/demo-authorizations", { confirmed: true, budgetMicros: 1000000, dailyMicros: 500000, maxCalls: 2, reason: "Final video recording validation." }).expect(201);
    expect(authorization.body.reason).toBe("Final video recording validation.");
    const current = await get("/status").expect(200);
    expect(current.body.effectiveMode).toBe("mock");
    expect(current.body.usage.development).toMatchObject({ calls: 1, chargedMicros: 7625 });
    expect(current.body.usage.demo).toMatchObject({ calls: 0, chargedMicros: 0 });
  });
});
