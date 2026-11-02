import "reflect-metadata";
import { jest } from "@jest/globals";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { configureApp } from "../src/configure-app.js";
import { AiAdminController } from "../src/modules/ai/ai-admin.controller.js";
import { AiAdminGuard, aiAdministratorIdentity } from "../src/modules/ai/ai-admin.guard.js";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { AiUsageError } from "../src/integrations/ai/ai-usage.types.js";
import { WORDPRESS_ALT_FUNDING_POLICY_HASH } from "../src/integrations/ai/muse-wordpress-alt-ledger.js";

const adminKey = "offline-ai-administrator-key-at-least-32-characters";
const operatorKey = "offline-wordpress-operator-key-at-least-32-characters";
const admin = aiAdministratorIdentity(adminKey), actor = aiAdministratorIdentity(operatorKey);
const hash = "a".repeat(64), fundingHash = "b".repeat(64), origin = "http://localhost:5173";
const target = { actor, businessId: "offline-business", evidenceContextId: randomUUID(), requestHash: hash,
  model: "muse-spark-1.3", processingMode: "standard", reasoningEffort: "minimal", maxInputTokens: 21792, maxOutputTokens: 1500,
  reserveMicros: 33615, priceVersion: "offline-standard-price-fixture", inputPriceMicrosPerMillion: 1250000, outputPriceMicrosPerMillion: 4250000 };
const activation = () => ({ request: structuredClone(target), confirmed: true, policyHash: WORDPRESS_ALT_FUNDING_POLICY_HASH, fundingHash });
type MockOperation = (...args: unknown[]) => Promise<unknown>;
const operation = () => jest.fn<MockOperation>();

describe("existing guarded AI administrator WordPress-alt funding routes, fake store only", () => {
  let app: INestApplication, config: ConfigService, allowSeparateApproval: boolean;
  let store: {
    prepareWordPressAltFunding: ReturnType<typeof operation>; activateWordPressAltFunding: ReturnType<typeof operation>;
    estimate: ReturnType<typeof operation>; estimateTesting: ReturnType<typeof operation>; estimateWordPressAlt: ReturnType<typeof operation>;
    approve: ReturnType<typeof operation>; reserve: ReturnType<typeof operation>; settle: ReturnType<typeof operation>;
    readIntent: ReturnType<typeof operation>; authorizeDemo: ReturnType<typeof operation>;
  };
  const post = (path: string, body: unknown) => request(app.getHttpServer()).post(`/api/ai/admin/${path}`).set("Host", "localhost:3001").set("Authorization", `Bearer ${adminKey}`).send(body as object);
  beforeEach(async () => {
    allowSeparateApproval = false;
    config = new ConfigService({ AI_ADMIN_KEY: adminKey, AI_ADMIN_ORIGIN: origin, WORDPRESS_OPERATOR_KEY: operatorKey,
      MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false, AI_DEV_BUDGET_MICROS: 0 });
    store = { prepareWordPressAltFunding: operation(), activateWordPressAltFunding: operation(), estimate: operation(), estimateTesting: operation(),
      estimateWordPressAlt: operation(), approve: operation(), reserve: operation(), settle: operation(), readIntent: operation(), authorizeDemo: operation() };
    store.prepareWordPressAltFunding.mockResolvedValue({ policyHash: WORDPRESS_ALT_FUNDING_POLICY_HASH, fundingHash, request: target,
      noAuthorizationCreated: true, noPaidIntentCreated: true, noRequestDispatched: true });
    store.activateWordPressAltFunding.mockResolvedValue({ fundingHash, request: target, approvedAt: "2026-11-02T00:00:00.000Z" });
    const module = await Test.createTestingModule({ controllers: [AiAdminController], providers: [AiAdminGuard,
      { provide: ConfigService, useValue: config }, { provide: AiUsageStore, useValue: store }] }).compile();
    app = configureApp(module.createNestApplication()); app.useLogger(false); await app.init();
  });
  afterEach(async () => {
    for (const method of [store.estimate, store.estimateTesting, store.estimateWordPressAlt, store.reserve, store.settle, store.authorizeDemo]) expect(method).not.toHaveBeenCalled();
    expect(store.approve).toHaveBeenCalledTimes(allowSeparateApproval ? 1 : 0);
    await app.close();
  });

  it.each([undefined, origin])("previews with the existing administrator guard and origin %s using only pure preparation", async requestOrigin => {
    const call = post("wordpress-alt-funding/preview", target);
    if (requestOrigin) call.set("Origin", requestOrigin);
    const result = await call.expect(201);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body).toMatchObject({ fundingHash, noAuthorizationCreated: true, noPaidIntentCreated: true, noRequestDispatched: true });
    expect(store.prepareWordPressAltFunding).toHaveBeenCalledWith(admin, target);
    expect(store.activateWordPressAltFunding).not.toHaveBeenCalled(); expect(store.readIntent).not.toHaveBeenCalled();
    expect(result.text).not.toContain(adminKey); expect(result.text).not.toContain(operatorKey);
  });

  it.each(["preview", "activate"].flatMap(route => ["missing-bearer", "operator-key", "wrong-key", "foreign-host", "foreign-origin", "origin-slash", "missing-admin-config"].map(kind => ({ route, kind }))))("rejects $route / $kind before any store access", async ({ route, kind }) => {
    if (kind === "missing-admin-config") config.set("AI_ADMIN_KEY", "");
    const call = request(app.getHttpServer()).post(`/api/ai/admin/wordpress-alt-funding/${route}`).set("Host", kind === "foreign-host" ? "unrelated.example:3001" : "localhost:3001");
    if (kind !== "missing-bearer") call.set("Authorization", `Bearer ${kind === "operator-key" ? operatorKey : kind === "wrong-key" ? "wrong-key" : adminKey}`);
    if (kind === "foreign-origin") call.set("Origin", "https://unrelated.example");
    if (kind === "origin-slash") call.set("Origin", origin + "/");
    const response = await call.send(route === "preview" ? target : activation());
    expect(response.status).toBe(kind === "missing-admin-config" ? 503 : ["missing-bearer", "operator-key", "wrong-key"].includes(kind) ? 401 : 403);
    expect(store.prepareWordPressAltFunding).not.toHaveBeenCalled(); expect(store.activateWordPressAltFunding).not.toHaveBeenCalled();
    expect(store.readIntent).not.toHaveBeenCalled();
  });

  it.each([
    { actor: adminKey }, { requestHash: "not-a-hash" }, { model: "muse-spark-1.2" }, { processingMode: "contributor" },
    { reasoningEffort: "high" }, { maxOutputTokens: 1501 }, { reserveMicros: 33616 }, { scope: "assessment:unrelated" }, { adminActor: admin },
  ])("rejects malformed or expanded preview fields %j without store access", async extra => {
    expect((await post("wordpress-alt-funding/preview", { ...target, ...extra })).status).toBe(400);
    expect(store.prepareWordPressAltFunding).not.toHaveBeenCalled(); expect(store.activateWordPressAltFunding).not.toHaveBeenCalled();
  });

  it.each([
    { confirmed: false }, { confirmed: "true" }, { confirmed: undefined }, { fundingHash: "not-a-hash" }, { policyHash: "not-a-hash" },
    { automaticApproval: true }, { request: { ...target, changes: { alt_text: "Injected change" } } }, { request: { ...target, reserveMicros: 33616 } },
  ])("rejects missing exact activation confirmation or expanded scope %j", async extra => {
    expect((await post("wordpress-alt-funding/activate", { ...activation(), ...extra })).status).toBe(400);
    expect(store.prepareWordPressAltFunding).not.toHaveBeenCalled(); expect(store.activateWordPressAltFunding).not.toHaveBeenCalled();
  });

  it("delegates only the exact explicit funding activation, leaving paid intent creation and approval separate", async () => {
    const body = activation(), result = await post("wordpress-alt-funding/activate", body).expect(201);
    expect(result.body).toMatchObject({ fundingHash, request: target });
    expect(store.activateWordPressAltFunding).toHaveBeenCalledWith(admin, target, { confirmed: true, policyHash: WORDPRESS_ALT_FUNDING_POLICY_HASH, fundingHash });
    expect(store.prepareWordPressAltFunding).not.toHaveBeenCalled(); expect(store.readIntent).not.toHaveBeenCalled();
    expect(store.approve).not.toHaveBeenCalled();
  });

  it.each(["policyHash", "fundingHash", "requestHash"])("passes syntactically valid changed %s to the exact store check and preserves its rejection", async key => {
    const body = activation();
    if (key === "requestHash") body.request.requestHash = "c".repeat(64);
    else body[key as "policyHash" | "fundingHash"] = "c".repeat(64);
    store.activateWordPressAltFunding.mockRejectedValue(new AiUsageError("AI_APPROVAL_MISMATCH", "Exact funding confirmation did not match."));
    const response = await post("wordpress-alt-funding/activate", body).expect(409);
    expect(response.body.error.code).toBe("AI_APPROVAL_MISMATCH");
    const { request: changed, ...confirmation } = body;
    expect(store.activateWordPressAltFunding).toHaveBeenCalledWith(admin, changed, confirmation);
    expect(store.readIntent).not.toHaveBeenCalled();
  });

  it("requires a separate existing intent approval request even after funding activation", async () => {
    await post("wordpress-alt-funding/activate", activation()).expect(201);
    expect(store.approve).not.toHaveBeenCalled(); expect(store.readIntent).not.toHaveBeenCalled();
    const intentId = randomUUID();
    store.readIntent.mockResolvedValue({ id: intentId, requestHash: hash, reserveMicros: target.reserveMicros });
    store.approve.mockResolvedValue({ id: intentId, approvedBy: admin });
    allowSeparateApproval = true;
    await post(`intents/${intentId}/approve`, { confirmed: true, requestHash: hash, reserveMicros: target.reserveMicros }).expect(201);
    expect(store.readIntent).toHaveBeenCalledWith(intentId); expect(store.approve).toHaveBeenCalledWith(intentId, admin);
    expect(store.activateWordPressAltFunding).toHaveBeenCalledTimes(1);
  });
});
