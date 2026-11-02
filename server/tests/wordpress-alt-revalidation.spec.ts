import { jest } from "@jest/globals";
import { Test } from "@nestjs/testing";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { Business } from "../src/contracts/domain.js";
import { MetaMuseProvider, MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import { WebsiteCollector, type CollectedPage } from "../src/integrations/website/collector.js";
import { WordPressClient } from "../src/integrations/wordpress/wordpress.client.js";
import { BUSINESS_REPOSITORY } from "../src/persistence/repositories.js";
import { FileReportStore } from "../src/reports/file-report.store.js";
import { WordPressModule } from "../src/modules/wordpress/wordpress.module.js";
import { WordPressPageEvidenceService } from "../src/modules/wordpress/wordpress-page-evidence.service.js";
import { WordPressFixService } from "../src/modules/wordpress/wordpress-fix.service.js";
import { WordPressFixStore } from "../src/modules/wordpress/wordpress-fix.store.js";
import { operatorIdentity } from "../src/modules/wordpress/wordpress.guard.js";
import { configureApp } from "../src/configure-app.js";

const businessId = "demo-guzman", siteUrl = "https://example.com", pageUrl = `${siteUrl}/bookkeeping/`;
const sourceUrl = `${siteUrl}/original.png`, variantUrl = `${siteUrl}/registered-crop.webp`;
const operator = "offline-alt-revalidation-operator-fixture", actor = operatorIdentity(operator);
const spanishDescription = "Guzman ofrece ayuda en español para comprender cartas del IRS y conocer las opciones de respuesta.";
const englishDescription = "A blue calculator beside a notebook.";
const prefix = `/api/wordpress/businesses/${businessId}/fix-operator/`;

describe("read-only alt context revalidation and reviewed Spanish enrollment", () => {
  let app: INestApplication, directory: string, fixes: WordPressFixService, store: WordPressFixStore, reports: FileReportStore;
  let media: Record<string, unknown>, page: Record<string, unknown>, publicPage: CollectedPage;
  let transport: ReturnType<typeof jest.fn<WordPressClient["request"]>>, collector: ReturnType<typeof jest.fn<WebsiteCollector["collect"]>>;
  let model: ReturnType<typeof jest.fn<MetaMuseTransport["post"]>>;
  let source: Awaited<ReturnType<WordPressPageEvidenceService["collect"]>>;
  const post = (path: string, body: unknown) => request(app.getHttpServer()).post(prefix + path).set("Host", "localhost:3001").set("Authorization", `Bearer ${operator}`).send(body as object);
  const enrollment = (extra: Record<string, unknown> = {}) => ({ confirmed: true, reportId: source.reportId, findingId: source.findingId, evidenceId: source.evidenceId,
    mediaId: 7, pageResource: "pages", pageId: 9, purpose: "informative", verifiedDescription: englishDescription, ...extra });
  const snapshot = async () => JSON.stringify({ records: store.list(businessId, actor), report: await reports.read(source.reportId), reports: await reports.list(businessId) });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-alt-revalidation-"));
    const config = new ConfigService({ NODE_ENV: "test", DATABASE_PATH: join(directory, "application.sqlite"), REPORTS_DIR: join(directory, "reports"),
      WORDPRESS_BUSINESS_ID: businessId, WORDPRESS_SITE_URL: siteUrl, WORDPRESS_USERNAME: "offline-user", WORDPRESS_APPLICATION_PASSWORD: "offline-password",
      WORDPRESS_OPERATOR_KEY: operator, WORDPRESS_ACTIONS_DIR: join(directory, "actions"), WORDPRESS_REPORTS_DIR: join(directory, "wordpress"),
      WORDPRESS_MUSE_DIR: join(directory, "muse"), WORDPRESS_WRITES_ENABLED: false, AI_USAGE_DB: join(directory, "usage.sqlite"),
      MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false, AI_DEV_BUDGET_MICROS: 0 });
    const business: Business = { id: businessId, name: "Offline Guzman fixture", website: siteUrl, createdAt: new Date().toISOString() };
    media = { id: 7, type: "attachment", status: "inherit", media_type: "image", post: 9, source_url: sourceUrl, alt_text: "", modified_gmt: "2026-11-02T00:00:00",
      media_details: { sizes: { large: { source_url: variantUrl, width: 1024, height: 1024 } } } };
    page = { id: 9, type: "page", status: "publish", link: pageUrl, modified_gmt: "2026-11-02T00:00:00", title: { rendered: "Ayuda con cartas del IRS &amp; contabilidad" },
      content: { protected: false, rendered: `<h1>Ayuda con cartas del IRS</h1><p>Atención en español.</p><script>Do not expose this script.</script><img class="wp-image-7" src="${variantUrl}" alt="">` } };
    const html = `<h1>Ayuda con cartas del IRS</h1><img class="wp-image-7" src="data:image/png;base64,AAAA" data-src="${variantUrl}" data-srcset="${variantUrl} 1024w, ${sourceUrl} 1254w" alt="">`;
    publicPage = { requestedUrl: pageUrl, finalUrl: pageUrl, status: 200, contentType: "text/html; charset=utf-8", body: Buffer.from(html),
      collectedAt: new Date().toISOString(), bytes: Buffer.byteLength(html), redirects: [], robots: "" };
    transport = jest.fn<WordPressClient["request"]>().mockImplementation(async (_connection, method, path) => {
      if (!["GET", "OPTIONS"].includes(method)) throw new Error("WordPress writes forbidden in revalidation tests");
      if (path.startsWith("/wp-json/wp/v2/media/7")) return method === "OPTIONS" ? { endpoints: [{ methods: ["POST"], args: { alt_text: { type: "string" } } }] } : structuredClone(media);
      if (path.startsWith("/wp-json/wp/v2/pages/9")) return structuredClone(page);
      if (path.startsWith("/wp-json/wp/v2/users/me")) return { id: 1, capabilities: { upload_files: true, edit_posts: true } };
      throw new Error("Unexpected offline target");
    });
    collector = jest.fn<WebsiteCollector["collect"]>().mockImplementation(async () => structuredClone(publicPage));
    model = jest.fn<MetaMuseTransport["post"]>().mockRejectedValue(new Error("Real inference forbidden"));
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), WordPressModule] })
      .overrideProvider(ConfigService).useValue(config)
      .overrideProvider(WordPressClient).useValue({ request: transport })
      .overrideProvider(WebsiteCollector).useValue({ collect: collector })
      .overrideProvider(MetaMuseTransport).useValue({ post: model })
      .overrideProvider(BUSINESS_REPOSITORY).useValue({ findById: async (id: string) => id === businessId ? structuredClone(business) : null, connections: async () => [] }).compile();
    app = configureApp(module.createNestApplication()); app.useLogger(false); await app.init();
    fixes = app.get(WordPressFixService); store = app.get(WordPressFixStore); reports = app.get(FileReportStore);
    source = await app.get(WordPressPageEvidenceService).collect(businessId, { confirmed: true, mediaId: 7, pageResource: "pages", pageId: 9 });
    transport.mockClear(); collector.mockClear();
  });
  afterEach(async () => {
    expect(model).not.toHaveBeenCalled();
    expect(transport.mock.calls.some(call => call[1] === "POST")).toBe(false);
    jest.restoreAllMocks(); await app.close();
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    await rm(directory, { recursive: true });
  });

  it("revalidates an expired context without renewing confirmation, changing evidence or permitting generation", async () => {
    const record = await fixes.enroll(businessId, actor, enrollment());
    const before = await snapshot();
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60000);
    const response = await post("revalidation", { confirmed: true, evidenceId: record.id });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ evidenceId: record.id, reviewExpired: true, reviewExpiresAt: record.expiresAt,
      requiresNewOperatorConfirmation: true, eligibleForGeneration: false, confirmationRenewed: false, modelRequests: 0, wordPressWrites: 0 });
    expect(response.body.renderedUrls).toContain(variantUrl);
    expect(await snapshot()).toBe(before);
    expect((await fixes.capability(businessId, actor, source.reportId, source.findingId)).fixable).toBe(false);
    await expect(fixes.generate(businessId, actor, { evidenceId: record.id })).rejects.toThrow("expired");
    expect(await snapshot()).toBe(before);
  });

  it("keeps an unchanged fresh reviewed target eligible without publishing a revalidation record", async () => {
    const record = await fixes.enroll(businessId, actor, enrollment());
    const before = await snapshot();
    const result = await fixes.revalidate(businessId, actor, record.id);
    expect(result).toMatchObject({ reviewExpired: false, requiresNewOperatorConfirmation: false, eligibleForGeneration: true, confirmationRenewed: false,
      target: { mediaId: 7, pageId: 9, currentAlt: "" } });
    expect(collector).toHaveBeenCalledTimes(1);
    expect((await fixes.capability(businessId, actor, source.reportId, source.findingId)).fixable).toBe(true);
    expect(await snapshot()).toBe(before);
  });

  it("rechecks review expiry after remote precondition reads before starting generation", async () => {
    const record = await fixes.enroll(businessId, actor, enrollment());
    const before = await snapshot(), read = transport.getMockImplementation()!;
    const clock = jest.spyOn(Date, "now");
    transport.mockImplementation(async (...args) => {
      const result = await read(...args);
      clock.mockReturnValue(Date.parse(record.expiresAt) + 1);
      return result;
    });
    const provider = jest.spyOn(app.get(MetaMuseProvider), "generate");
    await expect(fixes.generate(businessId, actor, { evidenceId: record.id })).rejects.toThrow("expired");
    expect(provider).not.toHaveBeenCalled();
    expect(await snapshot()).toBe(before);
  });

  it.each(["changed-alt", "missing-alt", "unrelated-image", "wrong-page", "http-error"])("rejects %s public revalidation without renewing or publishing", async kind => {
    const record = await fixes.enroll(businessId, actor, enrollment());
    const before = await snapshot();
    if (kind === "changed-alt") publicPage.body = Buffer.from(`<img class="wp-image-7" src="${variantUrl}" alt="Changed">`);
    if (kind === "missing-alt") publicPage.body = Buffer.from(`<img class="wp-image-7" src="${variantUrl}">`);
    if (kind === "unrelated-image") publicPage.body = Buffer.from(`<img class="wp-image-99" src="${siteUrl}/unrelated.png" alt="">`);
    if (kind === "wrong-page") publicPage.finalUrl = `${siteUrl}/other-page/`;
    if (kind === "http-error") publicPage.status = 503;
    expect((await post("revalidation", { confirmed: true, evidenceId: record.id })).status).toBe(409);
    expect(await snapshot()).toBe(before);
  });

  it.each(["stored-alt", "media-modified", "page-modified"])("rejects changed authenticated %s preconditions", async kind => {
    const record = await fixes.enroll(businessId, actor, enrollment());
    const before = await snapshot();
    if (kind === "stored-alt") media.alt_text = "Changed remotely";
    if (kind === "media-modified") media.modified_gmt = "2026-11-02T00:01:00";
    if (kind === "page-modified") page.modified_gmt = "2026-11-02T00:01:00";
    expect((await post("revalidation", { confirmed: true, evidenceId: record.id })).status).toBe(409);
    expect(collector).not.toHaveBeenCalled();
    expect(await snapshot()).toBe(before);
  });

  it("rejects a changed saved report rather than accepting current remote identity alone", async () => {
    const record = await fixes.enroll(businessId, actor, enrollment());
    const original = (await reports.read(source.reportId))!;
    const changed = { ...original, generatedAt: new Date(Date.parse(original.generatedAt) + 1000).toISOString() };
    jest.spyOn(reports, "read").mockResolvedValue(changed);
    await expect(fixes.revalidate(businessId, actor, record.id)).rejects.toThrow("Source report changed");
    expect(collector).not.toHaveBeenCalled();
  });

  it.each(["missing-bearer", "wrong-bearer", "foreign-host", "foreign-origin"])("rejects %s on the operator revalidation route before provider reads", async kind => {
    const call = request(app.getHttpServer()).post(prefix + "revalidation").set("Host", kind === "foreign-host" ? "unrelated.example:3001" : "localhost:3001");
    if (kind !== "missing-bearer") call.set("Authorization", `Bearer ${kind === "wrong-bearer" ? "invalid-operator" : operator}`);
    if (kind === "foreign-origin") call.set("Origin", "https://unrelated.example");
    const response = await call.send({ confirmed: true, evidenceId: randomUUID() });
    expect(response.status).toBe(kind === "missing-bearer" || kind === "wrong-bearer" ? 401 : 403);
    expect(transport).not.toHaveBeenCalled(); expect(collector).not.toHaveBeenCalled();
    expect(store.list(businessId, actor)).toEqual([]);
  });

  it.each([{ confirmed: false }, { confirmed: true, renew: true }, { confirmed: true, expiresAt: "2099-01-01T00:00:00.000Z" }])("rejects renewal-shaped or unconfirmed revalidation input %j", async body => {
    const response = await post("revalidation", { evidenceId: randomUUID(), ...body });
    expect(response.status).toBe(400);
    expect(transport).not.toHaveBeenCalled(); expect(collector).not.toHaveBeenCalled();
  });

  it("persists reviewed Spanish context from the saved business and authenticated page and retains output-v1 mock compatibility", async () => {
    const response = await post("evidence", enrollment({ proposalLanguage: "es", requiredTerms: ["ayuda", "cartas", "IRS"], verifiedDescription: spanishDescription }));
    expect(response.status).toBe(201);
    expect(response.body.proposalContext).toMatchObject({ version: "wordpress-alt-context-v2", language: "es", requiredTerms: ["ayuda", "cartas", "IRS"],
      business: { id: businessId, name: "Offline Guzman fixture", website: siteUrl },
      page: { id: 9, resource: "pages", url: pageUrl, title: "Ayuda con cartas del IRS & contabilidad", textExcerpt: "Ayuda con cartas del IRS Atención en español." } });
    expect(response.body.proposalContext.page.textExcerpt).not.toContain("script");
    expect(store.read(businessId, actor, response.body.id)?.proposalContext).toEqual(response.body.proposalContext);
    const generated = await fixes.generate(businessId, actor, { evidenceId: response.body.id });
    expect(generated).toMatchObject({ isMock: true, provider: "mock-fixture", output: { schemaVersion: "wordpress-alt-output-v1", status: "proposed", altText: spanishDescription, reason: "DESCRIPTION_EXCERPT" } });
    expect((await fixes.capability(businessId, actor, source.reportId, source.findingId)).savedGeneration).toMatchObject({ id: generated.id, isMock: true });
  });

  it("preserves inherited English v1 evidence and mock output without adding a Spanish context", async () => {
    const record = await fixes.enroll(businessId, actor, enrollment());
    expect(record).not.toHaveProperty("proposalContext");
    const generated = await fixes.generate(businessId, actor, { evidenceId: record.id });
    expect(generated).toMatchObject({ isMock: true, output: { schemaVersion: "wordpress-alt-output-v1", altText: englishDescription, reason: "DESCRIPTION_EXCERPT" } });
  });

  it.each([
    { proposalLanguage: "es" },
    { requiredTerms: ["ayuda"] },
    { proposalLanguage: "es", requiredTerms: ["ayuda"], business: { name: "Untrusted replacement" } },
  ])("rejects incomplete or caller-injected Spanish context %j", async extra => {
    expect((await post("evidence", enrollment({ ...extra, verifiedDescription: spanishDescription }))).status).toBe(400);
    expect(store.list(businessId, actor)).toEqual([]);
  });

  it.each([
    { requiredTerms: ["ayuda", "cartas", "inventado"] },
    { requiredTerms: ["ayuda"], purpose: "functional" },
  ])("rejects unsupported essential terms or non-informative Spanish purpose %j", async extra => {
    expect((await post("evidence", enrollment({ proposalLanguage: "es", verifiedDescription: spanishDescription, ...extra }))).status).toBe(409);
    expect(store.list(businessId, actor)).toEqual([]);
  });
});
