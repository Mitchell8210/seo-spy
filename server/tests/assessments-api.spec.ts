import "reflect-metadata";
import { jest } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";
import type { Audit, Business } from "../src/contracts/domain.js";
import { MetaMuseProvider } from "../src/integrations/ai/meta-muse.provider.js";
import { GoogleTransport } from "../src/integrations/google/google-transport.js";
import { WordPressClient } from "../src/integrations/wordpress/wordpress.client.js";
import { WebsiteCollector } from "../src/integrations/website/collector.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { SQLiteBusinessRepository } from "../src/persistence/sqlite/sqlite.repositories.js";
import { FileReportStore } from "../src/reports/file-report.store.js";

const businessId = "demo-guzman";
const prefix = `/api/businesses/${businessId}`;
const operator = "private-assessment-operator-fixture-at-least-32-characters";
function websiteAudit(at: string): Audit {
  const id = randomUUID();
  return { id, businessId, mode: "live", scope: "lighthouse", strategy: "mobile", status: "completed", stage: "complete", createdAt: at, startedAt: at, completedAt: at,
    warnings: ["Homepage only."], failure: null, scoringVersion: "lighthouse-v1", results: {
      scores: [], evidence: [{ id: "html-evidence", auditId: id, checkId: "image-alt", mode: "live", collectedAt: at, sourceUrl: "https://example.com/", observed: { count: "1", emptyCount: "1" } }],
      findings: [{ id: "alt-review", auditId: id, checkId: "image-alt", evidenceIds: ["html-evidence"], severity: "low", source: "website", title: "Review the homepage image alternative", explanation: "Empty alternatives may be intentional.", status: "needs_review" }],
      recommendations: [{ id: "alt-action", auditId: id, findingId: "alt-review", title: "Inspect the image in context", explanation: "Use the saved source evidence first.", recommendedChange: "Confirm whether the image is informative before proposing text.", purpose: "Support visitors.", status: "needs_review" }],
      lighthouse: { provider: "google-pagespeed-insights", strategy: "mobile", requestedUrl: "https://example.com/", finalUrl: "https://example.com/", fetchedAt: at, lighthouseVersion: "13.0.0",
        categories: [{ id: "seo", title: "SEO", score: 80, availability: "measured", auditIds: [] }, { id: "performance", title: "Performance", score: 60, availability: "measured", auditIds: [] }, { id: "accessibility", title: "Accessibility", score: 100, availability: "measured", auditIds: [] }, { id: "best-practices", title: "Best Practices", score: 90, availability: "measured", auditIds: [] }],
        metrics: [], checks: [], warnings: [] },
    } };
}

describe("assessment HTTP API with saved evidence, protected mocks and real SQLite", () => {
  let app: INestApplication;
  let directory: string;
  let settings: Record<string, unknown>;
  let business: Business;
  let audit: Audit;
  let database: AppDatabase;
  let reports: FileReportStore;
  let generate: ReturnType<typeof jest.fn<MetaMuseProvider["generate"]>>;
  let wordpress: ReturnType<typeof jest.fn<WordPressClient["request"]>>;
  let google: ReturnType<typeof jest.fn<GoogleTransport["post"]>>;
  let collect: ReturnType<typeof jest.fn<WebsiteCollector["collect"]>>;
  const get = (path: string, key = operator) => request(app.getHttpServer()).get(path).set("Host", "localhost:3001").set("Authorization", `Bearer ${key}`);
  const post = (path: string, body: object, key = operator) => request(app.getHttpServer()).post(path).set("Host", "localhost:3001").set("Authorization", `Bearer ${key}`).send(body);
  const create = () => post(`${prefix}/assessments`, { confirmed: true, websiteReportId: audit.id });
  const noProviders = () => { expect(generate).not.toHaveBeenCalled(); expect(wordpress).not.toHaveBeenCalled(); expect(google).not.toHaveBeenCalled(); expect(collect).not.toHaveBeenCalled(); };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-assessment-api-"));
    const at = new Date(Date.now() - 3600000).toISOString();
    business = { id: businessId, name: "Fixture Business", website: "https://example.com/", createdAt: at };
    audit = websiteAudit(at);
    settings = { NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_PATH: ":memory:", REPORTS_DIR: join(directory, "reports"), AI_USAGE_DB: join(directory, "ai.sqlite"),
      WORDPRESS_OPERATOR_KEY: operator, WORDPRESS_BUSINESS_ID: businessId, WORDPRESS_SITE_URL: "https://example.com", WORDPRESS_FRONTEND_ORIGIN: "http://localhost:5173",
      WORDPRESS_USERNAME: "private-fixture-user", WORDPRESS_APPLICATION_PASSWORD: "private-fixture-password", WORDPRESS_WRITES_ENABLED: false,
      WORDPRESS_ACTIONS_DIR: join(directory, "actions"), WORDPRESS_REPORTS_DIR: join(directory, "wordpress"), WORDPRESS_MUSE_DIR: join(directory, "muse"),
      MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false, MODEL_API_KEY: "private-fixture-api-key-unused", PORT: 3001 };
    generate = jest.fn<MetaMuseProvider["generate"]>().mockRejectedValue(new Error("Unexpected live model call"));
    wordpress = jest.fn<WordPressClient["request"]>().mockRejectedValue(new Error("Unexpected WordPress call"));
    google = jest.fn<GoogleTransport["post"]>().mockRejectedValue(new Error("Unexpected Google call"));
    collect = jest.fn<WebsiteCollector["collect"]>().mockRejectedValue(new Error("Unexpected collection"));
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ConfigService).useValue(new ConfigService(settings))
      .overrideProvider(MetaMuseProvider).useValue({ generate })
      .overrideProvider(WordPressClient).useValue({ request: wordpress })
      .overrideProvider(GoogleTransport).useValue({ post: google })
      .overrideProvider(WebsiteCollector).useValue({ collect }).compile();
    app = configureApp(module.createNestApplication()); app.useLogger(false); await app.init();
    database = app.get(AppDatabase); reports = app.get(FileReportStore);
    await app.get(SQLiteBusinessRepository).upsertBusiness(business);
    await reports.write(audit, business);
  });
  afterEach(async () => {
    await app.close();
    const target = resolve(directory), allowed = resolve(tmpdir());
    if (dirname(target) !== allowed || !basename(target).startsWith("seo-spy-assessment-api-")) throw new Error("Unsafe test cleanup path");
    await rm(target, { recursive: true, force: true });
  });

  it("requires confirmation/operator access and rejects unrelated businesses before analysis", async () => {
    await post(`${prefix}/assessments`, { confirmed: true }, "wrong-key").expect(401);
    await post(`${prefix}/assessments`, {}).expect(400);
    await post(`${prefix}/assessments`, { confirmed: false }).expect(400);
    const rejected = await post("/api/businesses/unbound/assessments", { confirmed: true });
    expect([403, 404]).toContain(rejected.status);
    noProviders();
  });
  it("rejects foreign origins and non-loopback operator Hosts", async () => {
    await post(`${prefix}/assessments`, { confirmed: true }).set("Origin", "https://attacker.invalid").expect(403);
    await post(`${prefix}/assessments`, { confirmed: true }).set("Host", "attacker.invalid").expect(403);
    noProviders();
  });
  it("keeps latest/dashboard reads cost-free and does not publish an assessment implicitly", async () => {
    const before = database.connection().prepare("SELECT COUNT(*) count FROM assessment_records").get()?.count;
    await get(`${prefix}/assessments/latest`).expect(200);
    await request(app.getHttpServer()).get(`${prefix}/dashboard`).expect(200);
    expect(database.connection().prepare("SELECT COUNT(*) count FROM assessment_records").get()?.count).toBe(before);
    noProviders();
  });
  it("creates an immutable Website score snapshot and reads it without mutating the source archive", async () => {
    const original = await reports.read(audit.id);
    const created = await create().expect(201);
    expect(created.body).toMatchObject({ businessId });
    expect(created.body.snapshot.scores.website).toMatchObject({ value: 79, availability: "available", coverage: { knownWeight: 100, requiredWeight: 100 } });
    expect(created.body.snapshot.scores.social.value).toBeNull();
    expect(created.body.snapshot.scores.consistency.value).toBeNull();
    expect(created.body.snapshot.scores.overall.value).toBeNull();
    const latest = await get(`${prefix}/assessments/latest`).expect(200);
    expect(latest.body.assessment.scores.website.value).toBe(79);
    const dashboard = await get(`${prefix}/dashboard`).expect(200);
    expect(dashboard.body.assessment.id).toBe(created.body.id);
    expect(created.body.id).toMatch(/^[a-f0-9-]{36}$/);
    const read = await get(`${prefix}/assessments/${created.body.id}`).expect(200);
    expect(read.body).toEqual(created.body);
    expect(await reports.read(audit.id)).toEqual(original);
    expect(JSON.stringify(created.body)).not.toContain("private-fixture");
    noProviders();
  });
  it("generates labeled mock recommendations only after an explicit POST and caches the exact assessment", async () => {
    const created = await create().expect(201);
    const path = `${prefix}/assessments/${created.body.id}/muse-analyses`;
    const first = await post(path, { confirmed: true }).expect(201);
    expect(first.body).toMatchObject({ businessId, assessmentId: created.body.id, isMock: true, provider: "mock-fixture", generationMode: "mock", usage: { inputTokens: 0, outputTokens: 0 } });
    expect(first.body.output.recommendations[0]).toMatchObject({ reportId: audit.id, findingId: "alt-review" });
    const second = await post(path, { confirmed: true }).expect(201);
    expect(second.body.id).toBe(first.body.id);
    const saved = await get(`${path}/${first.body.id}`).expect(200);
    expect(saved.body).toEqual(first.body);
    noProviders();
  });
  it("rejects unconfirmed mock generation and an analysis ID under another assessment", async () => {
    const created = await create().expect(201);
    await post(`${prefix}/assessments/${created.body.id}/muse-analyses`, {}).expect(400);
    await get(`${prefix}/assessments/${created.body.id}/muse-analyses/${randomUUID()}`).expect(404);
    noProviders();
  });
  it("overlays expired eligibility without rewriting the historical snapshot or generating analysis", async () => {
    const created = await create().expect(201);
    const originalNow = Date.now;
    const spy = jest.spyOn(Date, "now").mockReturnValue(originalNow() + 8 * 86400000);
    try {
      const latest = await get(`${prefix}/assessments/latest`).expect(200);
      expect(latest.body.assessment.scores.website.value).toBeNull();
      expect(latest.body.assessment.scores.website.reasons).toContain("STALE_INPUT");
      const original = await get(`${prefix}/assessments/${created.body.id}`).expect(200);
      expect(original.body.snapshot.scores.website.value).toBe(79);
    } finally { spy.mockRestore(); }
    noProviders();
  });
  it("does not turn a missing report, wrong profile or live mode request into a provider call", async () => {
    await post(`${prefix}/assessments`, { confirmed: true, websiteReportId: randomUUID() }).expect(404);
    await post(`${prefix}/assessments`, { confirmed: true, profile: "unknown-profile" }).expect(400);
    const created = await create().expect(201);
    settings.AI_MODE = "poc"; settings.MOCK_AI = false; settings.AI_ENABLED = true;
    const response = await post(`${prefix}/assessments/${created.body.id}/muse-analyses`, { confirmed: true });
    expect(response.status).toBeGreaterThanOrEqual(400);
    noProviders();
  });
  it("stores explicitly confirmed business facts as immutable revisions without calling sources", async () => {
    const input = { confirmed: true, publishingTarget: 1, preferred: { name: "Fixture Business", aliases: [], country: "US", phones: ["+17025551212"], websiteUrls: ["https://example.com/"], timeZone: "America/Los_Angeles", hours: null, hoursApplicable: false }, profileAbsences: [] };
    const created = await post(`${prefix}/scoring-facts`, input).expect(201);
    expect(created.body).toMatchObject({ businessId });
    const latest = await get(`${prefix}/scoring-facts`).expect(200);
    expect(latest.text).toContain(created.body.id);
    expect(created.text).not.toContain(operator);
    noProviders();
  });
  it("persists a source-agreement revision without preferred facts and pins its evidence pair", async () => {
    const at = audit.completedAt!;
    const facebook: Audit = { ...structuredClone(audit), id: randomUUID(), scope: "facebook", scoringVersion: "facebook-v1" };
    delete facebook.strategy;
    facebook.results = { scores: [], findings: [], recommendations: [], evidence: [{ id: "saved-hours", auditId: facebook.id, checkId: "facebook:profile:hours", mode: "live", collectedAt: at, sourceUrl: "https://www.facebook.com/123", observed: { status: "missing" } }], facebook: {
      provider: "facebook-graph", version: "facebook-v1", graphVersion: "v26.0", pageId: "123", pageName: business.name, collectedAt: at,
      profile: { hours: { status: "missing", value: null, collectedAt: at } }, window: { since: at, until: at, requestedDays: 30 },
      posts: { status: "available", items: [], truncated: false, collectedAt: at }, metrics: [],
      summary: { followersStart: null, followersEnd: null, followersChange: null, latestPostAt: null, postsInWindow: 0, postsInWindowComplete: true },
      coverage: { profileFieldsAvailable: 0, profileFieldsMissing: 1, profileFieldsUnavailable: 0, metricsAvailable: 0, metricsRequested: 0, postsLimit: 50 }, limitations: [],
    } };
    await reports.write(facebook, business);
    const input = { confirmed: true, comparisonMode: "source-agreement", country: "international", confirmedPhone: "+17025551212", websiteReportId: audit.id, facebookReportId: facebook.id,
      sourceReviews: [{ provider: "facebook", reportId: facebook.id, evidenceIds: ["saved-hours"], field: "hours", state: "always-open", timeZone: null, hours: null, observedAt: at, validFrom: at.slice(0, 10), notes: "Operator observed Always open on the public Page." }], notes: "Approved agreement comparison; no preferred business name is known." };
    const created = await post(`${prefix}/scoring-facts`, input).expect(201);
    expect(created.body.schemaVersion).toBe("seo-spy.confirmed-scoring-facts.v2");
    expect(created.body.values.preferred).toBeUndefined();
    const read = await get(`${prefix}/scoring-facts`).expect(200);
    expect(read.body.facts).toEqual(created.body);
    await post(`${prefix}/scoring-facts`, { ...input, sourceReviews: [{ ...input.sourceReviews[0], reportId: randomUUID() }] }).expect(400);
    await post(`${prefix}/scoring-facts`, { ...input, sourceReviews: [{ ...input.sourceReviews[0], evidenceIds: ["not-in-archive"] }] }).expect(400);
    expect((await get(`${prefix}/scoring-facts`)).body.facts.id).toBe(created.body.id);
    noProviders();
  });
});
