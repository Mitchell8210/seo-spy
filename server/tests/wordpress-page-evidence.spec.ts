import { jest } from "@jest/globals";
import { Test } from "@nestjs/testing";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { Audit, Business } from "../src/contracts/domain.js";
import { MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import { WebsiteCollector, type CollectedPage } from "../src/integrations/website/collector.js";
import { WordPressClient } from "../src/integrations/wordpress/wordpress.client.js";
import { AUDIT_REPOSITORY, BUSINESS_REPOSITORY, type AuditRepository } from "../src/persistence/repositories.js";
import { FileReportStore } from "../src/reports/file-report.store.js";
import { WordPressModule } from "../src/modules/wordpress/wordpress.module.js";
import { WordPressPageEvidenceService } from "../src/modules/wordpress/wordpress-page-evidence.service.js";
import { WordPressFixService } from "../src/modules/wordpress/wordpress-fix.service.js";
import { operatorIdentity } from "../src/modules/wordpress/wordpress.guard.js";
import { configureApp } from "../src/configure-app.js";

const businessId = "demo-guzman", siteUrl = "https://example.com", pageUrl = `${siteUrl}/page/`;
const sourceUrl = `${siteUrl}/full.png`, variantUrl = `${siteUrl}/crop.webp`;
const operator = "offline-page-evidence-operator-fixture", actor = operatorIdentity(operator);
const description = "A blue calculator beside a notebook.";
const input = { confirmed: true, mediaId: 7, pageResource: "pages", pageId: 9 };

describe("explicit page-scoped WordPress media evidence with disposable SQLite", () => {
  let app: INestApplication, directory: string, reports: FileReportStore, audits: AuditRepository, service: WordPressPageEvidenceService, fixes: WordPressFixService;
  let business: Business, media: Record<string, unknown>, page: Record<string, unknown>, publicPage: CollectedPage;
  let transport: ReturnType<typeof jest.fn<WordPressClient["request"]>>, collector: ReturnType<typeof jest.fn<WebsiteCollector["collect"]>>;
  let model: ReturnType<typeof jest.fn<MetaMuseTransport["post"]>>;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-page-evidence-"));
    const config = new ConfigService({ NODE_ENV: "test", DATABASE_PATH: join(directory, "application.sqlite"), REPORTS_DIR: join(directory, "reports"),
      WORDPRESS_BUSINESS_ID: businessId, WORDPRESS_SITE_URL: siteUrl, WORDPRESS_USERNAME: "offline-user", WORDPRESS_APPLICATION_PASSWORD: "offline-password",
      WORDPRESS_OPERATOR_KEY: operator, WORDPRESS_ACTIONS_DIR: join(directory, "actions"), WORDPRESS_REPORTS_DIR: join(directory, "wordpress"),
      WORDPRESS_MUSE_DIR: join(directory, "muse"), WORDPRESS_WRITES_ENABLED: false, AI_USAGE_DB: join(directory, "usage.sqlite"),
      MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false, AI_DEV_BUDGET_MICROS: 0 });
    business = { id: businessId, name: "Offline page evidence business", website: siteUrl, createdAt: new Date().toISOString() };
    media = { id: 7, type: "attachment", status: "inherit", media_type: "image", post: 9, source_url: sourceUrl, alt_text: "", modified_gmt: "2026-11-02T00:00:00",
      media_details: { sizes: { large: { source_url: variantUrl, width: 1024, height: 1024 } } } };
    page = { id: 9, type: "page", status: "publish", link: pageUrl, modified_gmt: "2026-11-02T00:00:00",
      content: { protected: false, rendered: `<img class="wp-image-7" src="${variantUrl}" alt="">` } };
    const html = `<h1>Bookkeeping</h1><img class="wp-image-7" src="data:image/png;base64,AAAA" data-src="${variantUrl}" data-srcset="${variantUrl} 1024w, ${sourceUrl} 1254w" alt="">`;
    publicPage = { requestedUrl: pageUrl, finalUrl: pageUrl, status: 200, contentType: "text/html; charset=utf-8", body: Buffer.from(html),
      collectedAt: new Date().toISOString(), bytes: Buffer.byteLength(html), redirects: [], robots: "" };
    transport = jest.fn<WordPressClient["request"]>().mockImplementation(async (_connection, method, path) => {
      if (!["GET", "OPTIONS"].includes(method)) throw new Error("Writes forbidden in page evidence tests");
      if (path.startsWith("/wp-json/wp/v2/media/7")) return method === "OPTIONS" ? { endpoints: [{ methods: ["POST"], args: { alt_text: { type: "string" } } }] } : structuredClone(media);
      if (path.startsWith("/wp-json/wp/v2/pages/9")) return structuredClone(page);
      if (path.startsWith("/wp-json/wp/v2/users/me")) return { id: 1, capabilities: { upload_files: true, edit_posts: true } };
      throw new Error("Unexpected fixture target");
    });
    collector = jest.fn<WebsiteCollector["collect"]>().mockImplementation(async () => structuredClone(publicPage));
    model = jest.fn<MetaMuseTransport["post"]>().mockRejectedValue(new Error("Model inference forbidden"));
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), WordPressModule] })
      .overrideProvider(ConfigService).useValue(config)
      .overrideProvider(WordPressClient).useValue({ request: transport })
      .overrideProvider(WebsiteCollector).useValue({ collect: collector })
      .overrideProvider(MetaMuseTransport).useValue({ post: model })
      .overrideProvider(BUSINESS_REPOSITORY).useValue({ findById: async (id: string) => id === businessId ? structuredClone(business) : null, connections: async () => [] }).compile();
    app = configureApp(module.createNestApplication()); app.useLogger(false); await app.init();
    reports = app.get(FileReportStore); audits = app.get(AUDIT_REPOSITORY); service = app.get(WordPressPageEvidenceService); fixes = app.get(WordPressFixService);
  });
  afterEach(async () => {
    expect(model).not.toHaveBeenCalled();
    expect(transport.mock.calls.every(call => ["GET", "OPTIONS"].includes(call[1]))).toBe(true);
    await app.close();
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    await rm(directory, { recursive: true });
  });

  async function enroll(result: Awaited<ReturnType<WordPressPageEvidenceService["collect"]>>, purpose = "informative", verifiedDescription = description) {
    return fixes.enroll(businessId, actor, { ...input, reportId: result.reportId, findingId: result.findingId, evidenceId: result.evidenceId, purpose, verifiedDescription });
  }

  it.each(["missing-bearer", "wrong-bearer", "foreign-host", "foreign-origin"])("rejects %s HTTP collection before any provider request", async kind => {
    const call = request(app.getHttpServer()).post(`/api/wordpress/businesses/${businessId}/fix-operator/page-evidence`)
      .set("Host", kind === "foreign-host" ? "unrelated.example:3001" : "localhost:3001");
    if (kind !== "missing-bearer") call.set("Authorization", `Bearer ${kind === "wrong-bearer" ? "invalid-operator" : operator}`);
    if (kind === "foreign-origin") call.set("Origin", "https://unrelated.example");
    const response = await call.send(input);
    expect(response.status).toBe(kind === "missing-bearer" || kind === "wrong-bearer" ? 401 : 403);
    expect(transport).not.toHaveBeenCalled(); expect(collector).not.toHaveBeenCalled();
    expect(await reports.list(businessId)).toEqual([]);
  });

  it.each([
    { mediaId: 7, pageResource: "pages", pageId: 9 },
    { ...input, confirmed: false },
    { ...input, arbitrarySourceUrl: sourceUrl },
    { ...input, pageId: 0 },
  ])("rejects invalid HTTP collection body without provider calls: %j", async body => {
    const response = await request(app.getHttpServer()).post(`/api/wordpress/businesses/${businessId}/fix-operator/page-evidence`)
      .set("Host", "localhost:3001").set("Authorization", `Bearer ${operator}`).send(body);
    expect(response.status).toBe(400);
    expect(transport).not.toHaveBeenCalled(); expect(collector).not.toHaveBeenCalled();
    expect(await reports.list(businessId)).toEqual([]);
  });

  it("publishes the exact immutable report through the authenticated HTTP operator route", async () => {
    const response = await request(app.getHttpServer()).post(`/api/wordpress/businesses/${businessId}/fix-operator/page-evidence`)
      .set("Host", "localhost:3001").set("Authorization", `Bearer ${operator}`).set("Origin", "http://localhost:5173").send(input);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ businessId, fixable: false, requiresOperatorPurposeConfirmation: true,
      binding: { target: { mediaId: 7, pageResource: "pages", pageId: 9, pageUrl, sourceUrl, currentAlt: "" } }, modelRequests: 0, wordPressWrites: 0 });
    const saved = (await reports.read(response.body.reportId))!;
    expect(saved.audit.scope).toBe("wordpress-page");
    expect(saved.results!.findings[0].id).toBe(response.body.findingId);
    expect(saved.results!.evidence[0].id).toBe(response.body.evidenceId);
    expect(JSON.parse(saved.results!.evidence[0].observed.wordpressMediaBinding)).toEqual(response.body.binding);
    expect(collector).toHaveBeenCalledTimes(1);
    expect(await audits.findById(response.body.reportId)).toBeNull();
  });

  it("reads archived page evidence, summaries and analysis over HTTP without an audit job or provider calls", async () => {
    const result = await service.collect(businessId, input);
    expect(await audits.findById(result.reportId)).toBeNull();
    const original = JSON.stringify(await reports.read(result.reportId));
    const remoteReads = transport.mock.calls.length, publicReads = collector.mock.calls.length;
    const base = `/api/audits/${result.reportId}`;
    const download = await request(app.getHttpServer()).get(`${base}/report`).expect(200);
    expect(download.body).toMatchObject({ reportId: result.reportId, audit: { scope: "wordpress-page" },
      results: { findings: [expect.objectContaining({ id: result.findingId, evidenceIds: [result.evidenceId] })], evidence: [expect.objectContaining({ id: result.evidenceId, sourceUrl: pageUrl })] } });
    const summary = await request(app.getHttpServer()).get(`${base}/evidence-summary`).expect(200);
    expect(summary.body).toMatchObject({ auditId: result.reportId, findings: [expect.objectContaining({ id: result.findingId, evidenceIds: [result.evidenceId] })] });
    expect(summary.body.findings[0].sourceLabel).toContain("WordPress page HTML");
    expect(summary.body.findings[0].sourceLabel).toContain(pageUrl);
    expect(summary.body.findings[0].sourceLabel).not.toContain("Homepage HTML");
    const analysis = await request(app.getHttpServer()).get(`${base}/website-analysis`).expect(200);
    expect(analysis.body).toMatchObject({ auditId: result.reportId, findings: [expect.objectContaining({ id: result.findingId, evidenceIds: [result.evidenceId] })],
      recommendations: [expect.objectContaining({ findingId: result.findingId })] });
    expect(transport).toHaveBeenCalledTimes(remoteReads);
    expect(collector).toHaveBeenCalledTimes(publicReads);
    expect(JSON.stringify(await reports.read(result.reportId))).toBe(original);
  });

  it("persists a new exact public-page/media binding with independent immutable IDs and no edit authority", async () => {
    const result = await service.collect(businessId, input);
    expect(result).toMatchObject({ businessId, fixable: false, purpose: "unreviewed", requiresOperatorPurposeConfirmation: true, modelRequests: 0, wordPressWrites: 0,
      binding: { businessId, siteUrl, version: "wordpress-page-media-v1", mediaParentId: 9, publicCollectedAt: publicPage.collectedAt,
        target: { mediaId: 7, pageId: 9, pageResource: "pages", sourceUrl, pageUrl, currentAlt: "", modified: "2026-11-02T00:00:00" }, renderedUrls: expect.arrayContaining([variantUrl]) } });
    expect(new Set([result.reportId, result.findingId, result.evidenceId]).size).toBe(3);
    expect(collector).toHaveBeenCalledTimes(1);
    expect(collector).toHaveBeenCalledWith(pageUrl, undefined, siteUrl);
    const saved = (await reports.read(result.reportId))!;
    expect(saved.audit).toMatchObject({ scope: "wordpress-page", mode: "live", status: "completed" });
    expect(saved.results!.scores).toEqual([]);
    expect(saved.results!.evidence[0]).toMatchObject({ id: result.evidenceId, sourceUrl: pageUrl, collectedAt: publicPage.collectedAt });
    expect(JSON.parse(saved.results!.evidence[0].observed.wordpressMediaBinding)).toEqual(result.binding);
    expect(saved.results!.findings[0]).toMatchObject({ id: result.findingId, evidenceIds: [result.evidenceId], status: "needs_review" });
    expect(saved.results!.findings[0].explanation).toContain("not a confirmed defect");
    // Page-scoped evidence is an immutable report artifact, not a queued audit
    // or a replacement for the Website dashboard's homepage investigation.
    expect(await audits.findById(result.reportId)).toBeNull();
    expect((await fixes.capability(businessId, actor, result.reportId, result.findingId)).fixable).toBe(false);
  });

  it("requires purpose confirmation before the exact saved recommendation becomes eligible", async () => {
    const result = await service.collect(businessId, input);
    const evidence = await enroll(result);
    expect(evidence.target).toMatchObject({ mediaId: 7, pageId: 9, currentAlt: "" });
    const capability = await fixes.capability(businessId, actor, result.reportId, result.findingId);
    expect(capability).toMatchObject({ fixable: true, writesEnabled: false, savedGeneration: null });
    const unrelated = await fixes.capability(businessId, actor, randomUUID(), result.findingId);
    expect(unrelated.fixable).toBe(false);
  });

  it.each(["decorative", "functional", "unknown"])("does not enable a %s image with empty alt", async purpose => {
    const result = await service.collect(businessId, input);
    await enroll(result, purpose, "");
    expect((await fixes.capability(businessId, actor, result.reportId, result.findingId)).fixable).toBe(false);
  });

  it("rejects a response whose resource type does not match the exact page endpoint", async () => {
    page.type = "post";
    await expect(service.collect(businessId, input)).rejects.toThrow();
    expect(collector).not.toHaveBeenCalled();
  });

  it("does not rewrite an existing report or replace the homepage selected by the dashboard", async () => {
    const now = new Date().toISOString(), id = randomUUID();
    const homepage: Audit = { id, businessId, scope: "homepage", mode: "live", status: "completed", stage: "complete", createdAt: now, startedAt: now, completedAt: now,
      warnings: [], failure: null, scoringVersion: "homepage-v1", results: { scores: [], evidence: [], findings: [], recommendations: [] } };
    const reference = await reports.write(homepage, business); await audits.save({ ...homepage, report: reference });
    const before = JSON.stringify(await reports.read(id));
    const result = await service.collect(businessId, input);
    expect(result.reportId).not.toBe(id);
    expect(JSON.stringify(await reports.read(id))).toBe(before);
    expect((await audits.latestCompleted(businessId))!.id).toBe(id);
    expect((await fixes.capability(businessId, actor, id, result.findingId)).fixable).toBe(false);
    const saved = (await reports.read(result.reportId))!;
    const original = JSON.stringify(saved);
    saved.results!.evidence[0].observed.wordpressMediaBinding = "forged replacement";
    await reports.write({ ...saved.audit, results: saved.results }, saved.business);
    expect(JSON.stringify(await reports.read(result.reportId))).toBe(original);
  });

  it.each([{}, { confirmed: false }, { confirmed: true, pageId: 0 }, { confirmed: true, unexpectedTarget: sourceUrl }])("requires exact explicit collection input without provider calls: %j", async changes => {
    const body = Object.keys(changes).length ? { ...input, ...changes } : { mediaId: 7, pageResource: "pages", pageId: 9 };
    await expect(service.collect(businessId, body)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled(); expect(collector).not.toHaveBeenCalled();
  });

  it.each(["parent", "page-id", "media-id", "private", "foreign-page", "foreign-source", "foreign-size", "unregistered-source", "missing-id", "conflicting-id", "missing-alt", "changed-alt", "redirect", "http-failure"])("rejects %s evidence before publication", async kind => {
    if (kind === "parent") media.post = 10;
    if (kind === "page-id") page.id = 10;
    if (kind === "media-id") media.id = 8;
    if (kind === "private") page.content = { protected: true, rendered: "" };
    if (kind === "foreign-page") page.link = "https://unrelated.example/page/";
    if (kind === "foreign-source") media.source_url = "https://unrelated.example/full.png";
    if (kind === "foreign-size") media.media_details = { sizes: { large: { source_url: "https://unrelated.example/crop.webp" } } };
    if (kind === "unregistered-source") publicPage.body = Buffer.from('<img class="wp-image-7" src="https://example.com/full-1024x1024.png" alt="">');
    if (kind === "missing-id") publicPage.body = Buffer.from(`<img src="${variantUrl}" alt="">`);
    if (kind === "conflicting-id") publicPage.body = Buffer.from(`<img class="wp-image-8" src="${variantUrl}" alt="">`);
    if (kind === "missing-alt") publicPage.body = Buffer.from(`<img class="wp-image-7" src="${variantUrl}">`);
    if (kind === "changed-alt") publicPage.body = Buffer.from(`<img class="wp-image-7" src="${variantUrl}" alt="Other value">`);
    if (kind === "redirect") publicPage.finalUrl = `${siteUrl}/unrelated/`;
    if (kind === "http-failure") publicPage.status = 503;
    const before = await reports.list(businessId);
    await expect(service.collect(businessId, input)).rejects.toThrow();
    expect(await reports.list(businessId)).toEqual(before);
  });

  it.each(["alt", "modified", "sizes", "page-modified", "parent"])("rejects %s changing during collection without saving stale evidence", async kind => {
    collector.mockImplementationOnce(async () => {
      if (kind === "alt") media.alt_text = "Changed remotely";
      if (kind === "modified") media.modified_gmt = "2026-11-02T00:01:00";
      if (kind === "sizes") media.media_details = { sizes: { large: { source_url: variantUrl }, medium: { source_url: `${siteUrl}/another-crop.webp` } } };
      if (kind === "page-modified") page.modified_gmt = "2026-11-02T00:01:00";
      if (kind === "parent") media.post = 10;
      return structuredClone(publicPage);
    });
    const before = await reports.list(businessId);
    await expect(service.collect(businessId, input)).rejects.toThrow();
    expect(await reports.list(businessId)).toEqual(before);
    expect(collector).toHaveBeenCalledTimes(1);
  });

  it.each(["alt", "modified", "sizes", "page-modified", "parent"])("rejects stale saved %s metadata at enrollment without rewriting its source", async kind => {
    const result = await service.collect(businessId, input);
    const before = JSON.stringify(await reports.read(result.reportId));
    if (kind === "alt") media.alt_text = "Changed remotely";
    if (kind === "modified") media.modified_gmt = "2026-11-02T00:01:00";
    if (kind === "sizes") media.media_details = { sizes: { large: { source_url: variantUrl }, medium: { source_url: `${siteUrl}/another-crop.webp` } } };
    if (kind === "page-modified") page.modified_gmt = "2026-11-02T00:01:00";
    if (kind === "parent") media.post = 10;
    await expect(enroll(result)).rejects.toThrow();
    expect(JSON.stringify(await reports.read(result.reportId))).toBe(before);
    expect((await fixes.capability(businessId, actor, result.reportId, result.findingId)).fixable).toBe(false);
  });

  it.each([
    ["stale evidence", -8 * 86400000],
    ["future evidence", 3600000],
    ["metadata/public collection skew", -5 * 60000],
  ])("rejects %s at enrollment", async (_label, offset) => {
    publicPage.collectedAt = new Date(Date.now() + Number(offset)).toISOString();
    const result = await service.collect(businessId, input);
    await expect(enroll(result)).rejects.toThrow();
    expect((await fixes.capability(businessId, actor, result.reportId, result.findingId)).fixable).toBe(false);
  });

  it("rejects a foreign business before public collection", async () => {
    await expect(service.collect("foreign-business", input)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled(); expect(collector).not.toHaveBeenCalled();
  });
});
