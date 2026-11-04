import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { jest } from "@jest/globals";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { configureApp } from "../src/configure-app.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { FacebookPostsStore } from "../src/modules/facebook/facebook-posts.store.js";
import { FacebookPostsService } from "../src/modules/facebook/facebook-posts.service.js";
import { FacebookPostsController } from "../src/modules/facebook/facebook-posts.controller.js";
import { similarFacebookPost } from "../src/modules/facebook/facebook-post-uniqueness.js";
import { FacebookGraph, FacebookService } from "../src/modules/facebook/facebook.service.js";
import { MetaMuseProvider, type MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import type { FileReportStore } from "../src/reports/file-report.store.js";
import type { InvestigationInterpretationStore } from "../src/reporting/investigation-interpretation.store.js";
import type { AssessmentService } from "../src/modules/assessments/assessment.service.js";
import type { BusinessRepository } from "../src/persistence/repositories.js";
import { createDemoResults } from "../src/fixtures/demo.js";

const session = "a".repeat(64), businessId = "fixture-business", pageId = "12345", origin = "http://localhost:5173";
const reportId = randomUUID(), at = new Date().toISOString();
const business = { id: businessId, name: "Fixture Accounting", website: "https://example.com/", createdAt: at };
describe("Facebook post exact approval and durable publication", () => {
  let database: AppDatabase, store: FacebookPostsStore, service: FacebookPostsService, config: ConfigService;
  const graph = jest.fn<FacebookGraph["request"]>(), generate = jest.fn<MetaMuseProvider["generateFrontend"]>();
  let granted: string[], authorized: boolean, tasks: string[];
  const facebook = { credential: async () => ({ token: "private-user-token" }), requirePermissions: async () => granted,
    settings: () => ({ redirectUri: "http://localhost:3001/api/facebook/callback" }) } as unknown as FacebookService;
  beforeEach(() => {
    config = new ConfigService({ NODE_ENV: "test", DATABASE_PATH: ":memory:", FACEBOOK_POSTS_ENABLED: true });
    database = new AppDatabase(config); store = new FacebookPostsStore(database);
    const results = createDemoResults(reportId, at);
    results.findings[0] = { ...results.findings[0]!, id: "posting-finding", checkId: "facebook:posting-inactivity", explanation: "Restart posting after reviewing the saved activity." };
    const report = { business, auditId: reportId, audit: { businessId, scope: "facebook", mode: "live", status: "completed" }, results: { ...results, facebook: { pageId, pageName: business.name } } };
    service = new FacebookPostsService(store, { read: async () => report, list: async () => [{ auditId: reportId, mode: "live", scope: "facebook", status: "completed" }] } as unknown as FileReportStore,
      { saved: () => null } as unknown as InvestigationInterpretationStore, { latest: async () => ({ assessment: null }) } as unknown as AssessmentService,
      facebook, { request: graph } as unknown as FacebookGraph, { generateFrontend: generate } as unknown as MetaMuseProvider, config,
      { findById: async (id: string) => id === businessId ? business : null } as unknown as BusinessRepository);
    granted = ["pages_manage_posts"]; authorized = true; tasks = ["CREATE_CONTENT"];
    graph.mockReset(); generate.mockReset();
    graph.mockImplementation(async (path, _token, params, _proof, _signal, method) => {
      if (path === "me/accounts") return { data: authorized ? [{ id: pageId, name: business.name, access_token: "private-page-token", tasks }] : [] };
      if (method === "POST") return { id: `${pageId}_99` };
      return { id: path, message: params?.message ?? "Reviewed exact text", permalink_url: `https://www.facebook.com/${pageId}/posts/99` };
    });
    generate.mockResolvedValue({ output: { message: "Welcome! Visit https://example.com/ to learn more." }, model: "muse-spark-1.3", attemptId: randomUUID(), requestId: null, usage: { inputTokens: 100, outputTokens: 40 } });
  });
  afterEach(() => database.onApplicationShutdown());
  const draft = () => service.generate(session, businessId, reportId, "posting-finding", "posting-finding");
  async function proposal() { const value = await draft(); return service.propose(session, businessId, value.id, "Reviewed exact text"); }
  const writes = () => graph.mock.calls.filter(call => call[5] === "POST");
  it("generates once from saved evidence, keeps secrets out of input and reads without providers", async () => {
    const first = await draft(), second = await draft();
    expect(first).toEqual(second); expect(generate).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
    expect(JSON.stringify(generate.mock.calls[0])).not.toMatch(/private-user-token|private-page-token/);
    expect(first).not.toHaveProperty("actor");
    graph.mockClear(); generate.mockClear();
    expect(await service.saved(session, businessId, first.id)).toEqual(first);
    expect(await service.saved("b".repeat(64), businessId, first.id)).toBeNull();
    expect(graph).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it("publishes the reviewed exact text once and independently verifies the returned Page post", async () => {
    const value = await proposal();
    const result = await service.publish(session, businessId, value.id, value.approvalHash!);
    expect(result).toMatchObject({ status: "published", text: "Reviewed exact text", postId: `${pageId}_99`, verified: true });
    expect(writes()).toHaveLength(1); expect(writes()[0]).toEqual([`${pageId}/feed`, "private-page-token", { message: "Reviewed exact text", published: "true" }, true, undefined, "POST"]);
    expect(await service.publish(session, businessId, value.id, value.approvalHash!)).toEqual(result);
    expect(writes()).toHaveLength(1);
  });
  it("lists only executed actions for the matching browser/business without provider requests", async () => {
    expect(await service.history(session, businessId)).toEqual({ businessId, items: [] });
    const value = await proposal();
    expect((await service.history(session, businessId)).items).toEqual([]);
    const result = await service.publish(session, businessId, value.id, value.approvalHash!);
    expect(result.completedAt).toEqual(expect.any(String)); expect(result.executedAt).toEqual(expect.any(String));
    graph.mockClear(); generate.mockClear();
    expect((await service.history(session, businessId)).items).toEqual([result]);
    expect((await service.history("b".repeat(64), businessId)).items).toEqual([]);
    expect((await service.history(session, "other-business")).items).toEqual([]);
    expect(graph).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it("supports successive separately approved unique posts while retaining all receipts and resuming the newest draft", async () => {
    const first = await proposal();
    await service.publish(session, businessId, first.id, first.approvalHash!);
    const messages = ["Keep your business records organized throughout the year. Explore our website when you are ready to connect.",
      "What would you like to hear from our team? Share general topics for future updates and stay connected with our Page."];
    let previousId = first.id;
    for (const message of messages) {
      generate.mockResolvedValueOnce({ output: { message }, model: "muse-spark-1.3", attemptId: randomUUID(), requestId: null, usage: { inputTokens: 100, outputTokens: 40 } });
      const next = await service.generate(session, businessId, reportId, "posting-finding", "posting-finding", previousId);
      expect(next.id).not.toBe(previousId); expect(next.previousPostId).toBe(previousId);
      expect(next.status).toBe("draft"); expect(next.approvalHash).toBeNull();
      expect(await service.saved(session, businessId, undefined, reportId, "posting-finding")).toEqual(next);
      const exact = await service.propose(session, businessId, next.id, message);
      await service.publish(session, businessId, exact.id, exact.approvalHash!);
      previousId = exact.id;
    }
    expect(writes()).toHaveLength(3); expect(generate).toHaveBeenCalledTimes(3);
    expect((await service.history(session, businessId)).items).toHaveLength(3);
    expect((await service.saved(session, businessId, first.id))?.text).toBe("Reviewed exact text");
    expect(generate.mock.calls[1]![0].input).toMatchObject({ previousPosts: ["Reviewed exact text"] });
  });
  it("deduplicates concurrent next-draft clicks and replayed requests by their predecessor", async () => {
    const first = await proposal(); await service.publish(session, businessId, first.id, first.approvalHash!);
    const next = () => service.generate(session, businessId, reportId, "posting-finding", "posting-finding", first.id);
    const [a, b] = await Promise.all([next(), next()]);
    expect(a.id).toBe(b.id); expect(generate).toHaveBeenCalledTimes(2);
    expect((await next()).id).toBe(a.id); expect(generate).toHaveBeenCalledTimes(2);
    expect(writes()).toHaveLength(1);
  });
  it("discards an unpublished draft, invalidates its approval and creates a new attempt only on explicit generation", async () => {
    const first = await proposal();
    graph.mockClear(); generate.mockClear();
    const discarded = await service.discard(session, businessId, first.id);
    expect(discarded).toMatchObject({ status: "discarded", approvalHash: null, expiresAt: null });
    expect(discarded.discardedAt).toBeTruthy();
    expect(await service.discard(session, businessId, first.id)).toEqual(discarded);
    expect((await service.saved(session, businessId, undefined, reportId, "posting-finding"))?.status).toBe("discarded");
    expect((await service.history(session, businessId)).items).toEqual([]);
    expect((await service.publish(session, businessId, first.id, first.approvalHash!)).status).toBe("discarded");
    expect(graph).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
    generate.mockResolvedValueOnce({ output: { message: "Share a general topic you would like our team to cover in a future community update." }, model: "muse-spark-1.3", attemptId: randomUUID(), requestId: null, usage: { inputTokens: 100, outputTokens: 40 } });
    const next = await service.generate(session, businessId, reportId, "posting-finding", "posting-finding", first.id);
    expect(next.id).not.toBe(first.id); expect(next.status).toBe("draft");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![0].input).toMatchObject({ previousPosts: [first.text] });
    expect((await service.saved(session, businessId, first.id))?.status).toBe("discarded");
    expect(writes()).toHaveLength(0);
  });
  it("does not allow another browser to discard a draft or permit discarding a published result", async () => {
    const value = await proposal();
    await expect(service.discard("b".repeat(64), businessId, value.id)).rejects.toThrow(/not found/);
    await service.publish(session, businessId, value.id, value.approvalHash!);
    await expect(service.discard(session, businessId, value.id)).rejects.toThrow(/Only an unpublished draft/);
    expect((await service.saved(session, businessId, value.id))?.status).toBe("published");
  });
  it("blocks a new post while the previous one is a draft or has an uncertain publication outcome", async () => {
    const value = await proposal();
    await expect(service.generate(session, businessId, reportId, "posting-finding", "posting-finding", value.id)).rejects.toThrow(/Finish the current post/);
    graph.mockImplementation(async path => { if (path === "me/accounts") return { data: [{ id: pageId, name: business.name, access_token: "private-page-token", tasks }] }; throw new Error(); });
    await service.publish(session, businessId, value.id, value.approvalHash!);
    await expect(service.generate(session, businessId, reportId, "posting-finding", "posting-finding", value.id)).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("rejects reused human text and flags repeated model text without another automatic request", async () => {
    const first = await proposal(); await service.publish(session, businessId, first.id, first.approvalHash!);
    generate.mockResolvedValueOnce({ output: { message: "REVIEWED, exact text!!!" }, model: "muse-spark-1.3", attemptId: randomUUID(), requestId: null, usage: { inputTokens: 100, outputTokens: 40 } });
    const next = await service.generate(session, businessId, reportId, "posting-finding", "posting-finding", first.id);
    expect(next.error).toMatch(/too similar/);
    await expect(service.propose(session, businessId, next.id, next.text)).rejects.toThrow(/too similar/);
    expect(generate).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(1);
    const edited = await service.propose(session, businessId, next.id, "Share your ideas for future updates with our team. We look forward to hearing from our community.");
    expect(edited.error).toBeNull(); expect(edited.approvalHash).toBeTruthy();
  });
  it("checks duplicates again at dispatch even after an exact-text proposal was saved", async () => {
    const first = await proposal(); await service.publish(session, businessId, first.id, first.approvalHash!);
    const next = await service.generate(session, businessId, reportId, "posting-finding", "posting-finding", first.id);
    const exact = await service.propose(session, businessId, next.id, "An original community conversation: tell us what you would like to learn about our team.");
    // A separately recorded action after proposal creation must also be considered at dispatch.
    const actor = (await import("../src/reporting/investigation-interpretation.js")).interpretationHash({ facebookSession: session });
    store.change(actor, businessId, first.id, value => ({ ...value, text: exact.text }));
    await expect(service.publish(session, businessId, exact.id, exact.approvalHash!)).rejects.toThrow(/too similar/);
    expect(writes()).toHaveLength(1);
  });
  it("rejects altered and expired approvals without a write", async () => {
    const value = await proposal();
    await expect(service.publish(session, businessId, value.id, "f".repeat(64))).rejects.toThrow();
    const spy = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60000);
    try { await expect(service.publish(session, businessId, value.id, value.approvalHash!)).rejects.toThrow(); } finally { spy.mockRestore(); }
    expect(writes()).toHaveLength(0);
  });
  it.each(["permission", "page", "task", "gate"])("fails closed on missing %s", async kind => {
    const value = await proposal();
    if (kind === "permission") granted = [];
    if (kind === "page") authorized = false;
    if (kind === "task") tasks = ["ANALYZE"];
    if (kind === "gate") config.set("FACEBOOK_POSTS_ENABLED", false);
    await expect(service.publish(session, businessId, value.id, value.approvalHash!)).rejects.toThrow(); expect(writes()).toHaveLength(0);
  });
  it("reserves atomically under double-click and preserves unknown outcomes across service recreation", async () => {
    const value = await proposal();
    graph.mockImplementation(async path => { if (path === "me/accounts") return { data: [{ id: pageId, name: business.name, access_token: "private-page-token", tasks }] }; throw new Error("timeout"); });
    await Promise.allSettled([service.publish(session, businessId, value.id, value.approvalHash!), service.publish(session, businessId, value.id, value.approvalHash!)]);
    expect(writes()).toHaveLength(1);
    const recreated = new FacebookPostsStore(database);
    const saved = await service.saved(session, businessId, value.id);
    expect(saved?.status).toBe("outcome_unknown");
    await expect(service.discard(session, businessId, value.id)).rejects.toThrow(/Only an unpublished draft/);
    expect((await service.history(session, businessId)).items[0]?.status).toBe("outcome_unknown");
    expect(recreated.read("wrong-actor", businessId, value.id)).toBeNull();
    expect((await service.publish(session, businessId, value.id, value.approvalHash!)).status).toBe("outcome_unknown"); expect(writes()).toHaveLength(1);
  });
  it("retains acknowledged publication when readback fails", async () => {
    const value = await proposal();
    graph.mockImplementation(async (path, _token, _params, _proof, _signal, method) => {
      if (path === "me/accounts") return { data: [{ id: pageId, name: business.name, access_token: "private-page-token", tasks }] };
      if (method === "POST") return { id: `${pageId}_99` }; throw new Error();
    });
    expect(await service.publish(session, businessId, value.id, value.approvalHash!)).toMatchObject({ status: "published", verified: false, postId: `${pageId}_99` });
  });
  it("never automatically repeats failed AI generation or accepts an unrelated recommendation", async () => {
    await expect(service.generate(session, businessId, reportId, "unrelated", "other-finding")).rejects.toThrow();
    generate.mockRejectedValue(new Error()); expect((await draft()).status).toBe("generation_failed");
    expect((await draft()).status).toBe("generation_failed"); expect(generate).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
  });
  it("requires same-origin JSON, a session cookie and explicit confirmed approval at HTTP boundary", async () => {
    const module = await Test.createTestingModule({ controllers: [FacebookPostsController], providers: [
      { provide: FacebookPostsService, useValue: service }, { provide: FacebookService, useValue: facebook }, { provide: ConfigService, useValue: config },
    ] }).compile();
    const app = module.createNestApplication(); configureApp(app); await app.init();
    try {
      const body = { businessId, reportId, recommendationId: "posting-finding", findingId: "posting-finding" };
      const empty = await request(app.getHttpServer()).get("/api/facebook/posts")
        .query({ businessId, reportId, recommendationId: "posting-finding" })
        .set("Host", "localhost:5173").set("Cookie", `seo_spy_facebook_test=${session}`).expect(200);
      expect(empty.headers["content-type"]).toMatch(/application\/json/);
      expect(empty.text).toBe("null");
      expect(JSON.parse(empty.text)).toBeNull();
      const history = await request(app.getHttpServer()).get("/api/facebook/posts/history").query({ businessId })
        .set("Host", "localhost:5173").set("Cookie", `seo_spy_facebook_test=${session}`).expect(200);
      expect(history.body).toEqual({ businessId, items: [] });
      await request(app.getHttpServer()).get("/api/facebook/posts/history").query({ businessId }).set("Host", "localhost:5173").expect(400);
      expect(generate).not.toHaveBeenCalled(); expect(graph).not.toHaveBeenCalled();
      await request(app.getHttpServer()).post("/api/facebook/posts/draft").set("Host", "localhost:5173").set("Origin", "https://evil.example").send(body).expect(400);
      await request(app.getHttpServer()).post("/api/facebook/posts/draft").set("Host", "localhost:5173").set("Origin", origin).send(body).expect(400);
      const result = await request(app.getHttpServer()).post("/api/facebook/posts/draft").set("Host", "localhost:5173").set("Origin", origin).set("Cookie", `seo_spy_facebook_test=${session}`).send(body).expect(201);
      await request(app.getHttpServer()).post("/api/facebook/posts/publish").set("Host", "localhost:5173").set("Origin", origin).set("Cookie", `seo_spy_facebook_test=${session}`).send({ businessId, id: result.body.id, approvalHash: "a".repeat(64), confirmed: false }).expect(400);
      expect(writes()).toHaveLength(0);
    } finally { await app.close(); }
  });
});

it("recognizes copied content despite punctuation, casing, spacing and tiny wording changes", () => {
  const text = "Keeping your records organized can make planning easier. Take a moment this week to review your documents and visit https://example.com/.";
  expect(similarFacebookPost(text, text.toUpperCase().replaceAll(" ", "  "))).toBe(true);
  expect(similarFacebookPost(text, text.replace("this week", "next week"))).toBe(true);
  expect(similarFacebookPost(text, "Tell us which general topics you would like our team to cover in future community updates.")).toBe(false);
});

it("accounts the Facebook task through the real shared ledger and rejects mismatched scope before dispatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-spy-facebook-post-ai-"));
  const config = new ConfigService({ NODE_ENV: "test", AI_USAGE_DB: join(directory, "usage.sqlite"), MODEL_API_KEY: "offline-fixture-key", AI_ENABLED: false, MOCK_AI: true, AI_MODE: "mock" });
  const ledger = new AiUsageStore(config), transport = jest.fn<MetaMuseTransport["post"]>();
  const provider = new MetaMuseProvider(config, { post: transport } as unknown as MetaMuseTransport, ledger);
  transport.mockResolvedValue({ status: 200, requestId: "fixture", body: JSON.stringify({ status: "completed", model: "muse-spark-1.3", usage: { input_tokens: 100, output_tokens: 40 },
    output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ message: "Welcome to Fixture Accounting. Visit https://example.com/." }) }] }] }) });
  const input = { reasoningEffort: "minimal" as const, instructions: "Draft a reviewed business post.", input: { schemaVersion: "facebook-post-input-v1", businessId, requestId: "fixture-request", siteUrl: business.website, businessName: business.name, pageId, recommendation: "Restart regular posting." }, schema: { type: "object", properties: { message: { type: "string" } } } };
  const context = { actor: "a".repeat(64), businessId, siteUrl: business.website, resourceKey: "fixture-request", task: "facebook-post" as const };
  try {
    await expect(provider.generateFrontend(input, { ...context, businessId: "another-business" })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    const output = await provider.generateFrontend(input, context);
    expect(output.attemptId).toBeTruthy(); expect(transport).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(transport.mock.calls[0]![0]);
    expect(payload.store).toBe(false); expect(payload.tools).toEqual([]); expect(payload.max_output_tokens).toBe(1500);
    const status = await ledger.status();
    expect(status.development).toMatchObject({ budgetMicros: 25000000, calls: 1 });
    expect(status.recentAttempts[0]).toMatchObject({ id: output.attemptId, status: "success" });
  } finally {
    ledger.onModuleDestroy();
    const target = resolve(directory);
    assert.ok(dirname(target) === resolve(tmpdir()) && basename(target).startsWith("seo-spy-facebook-post-ai-"), "Unexpected fixture cleanup path");
    await rm(target, { recursive: true, force: true });
  }
});
