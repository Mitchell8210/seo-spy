import { jest } from "@jest/globals";
import { Test } from "@nestjs/testing";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { configureApp } from "../src/configure-app.js";
import type { Business } from "../src/contracts/domain.js";
import { BUSINESS_REPOSITORY } from "../src/persistence/repositories.js";
import { MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import { AiUsageStore } from "../src/integrations/ai/ai-usage.store.js";
import { WordPressClient } from "../src/integrations/wordpress/wordpress.client.js";
import { WordPressImageContent } from "../src/integrations/wordpress/image-content.js";
import { WebsiteCollector } from "../src/integrations/website/collector.js";
import { WordPressModule } from "../src/modules/wordpress/wordpress.module.js";
import { WordPressPageEvidenceService } from "../src/modules/wordpress/wordpress-page-evidence.service.js";
import { WordPressPurposeService } from "../src/modules/wordpress/wordpress-purpose.service.js";
import { WordPressFixService } from "../src/modules/wordpress/wordpress-fix.service.js";
import { WordPressFixStore, fixDigest } from "../src/modules/wordpress/wordpress-fix.store.js";
import { operatorIdentity } from "../src/modules/wordpress/wordpress.guard.js";
import { altEvidenceSchema, type AltEvidence } from "../src/modules/wordpress/wordpress-fix.types.js";
import { deterministicPurposeBindingId } from "../src/modules/wordpress/wordpress-purpose.types.js";

const businessId = "demo-guzman", siteUrl = "https://example.com", pageUrl = `${siteUrl}/bookkeeping/`;
const sourceUrl = `${siteUrl}/original.png`, variant = `${siteUrl}/registered-crop.webp`, originalHash = "c".repeat(64);
const operator = "offline-durable-purpose-operator-fixture", actor = operatorIdentity(operator);
const description = "Guzman ofrece ayuda en español para comprender cartas del IRS y conocer las opciones de respuesta.";
const prefix = `/api/wordpress/businesses/${businessId}/fix-operator/`;

describe("durable owner purpose and separate execution state in disposable WordPress workflows", () => {
  let app: INestApplication, directory: string, fixes: WordPressFixService, purposes: WordPressPurposeService, store: WordPressFixStore, pageEvidence: WordPressPageEvidenceService;
  let owner: AltEvidence, source: Awaited<ReturnType<WordPressPageEvidenceService["collect"]>>, business: Business;
  let media: Record<string, unknown>, page: Record<string, unknown>, imageHash: string, variantHash: string, writable: boolean, publicAlt: string, publicMarkup: string | null;
  let transport: ReturnType<typeof jest.fn<WordPressClient["request"]>>, model: ReturnType<typeof jest.fn<MetaMuseTransport["post"]>>;
  let imageRead: ReturnType<typeof jest.fn<WordPressImageContent["fingerprint"]>>, collector: ReturnType<typeof jest.fn<WebsiteCollector["collect"]>>;
  let ledgerSpies: ReturnType<typeof jest.spyOn>[];
  const post = (path: string, body: unknown) => request(app.getHttpServer()).post(prefix + path).set("Host", "localhost:3001").set("Authorization", `Bearer ${operator}`).send(body as object);
  const advance = (millis: number) => jest.setSystemTime(Date.now() + millis);
  const adoption = () => ({ evidenceId: owner.id, originalReviewHash: fixDigest(owner), originalImageHash: originalHash,
    hashProvenance: "Original raster fingerprint explicitly attested by the fixture operator.", dependenciesUnchanged: true });
  const enrollment = (verifiedDescription = description) => ({ confirmed: true, reportId: source.reportId, findingId: source.findingId, evidenceId: source.evidenceId,
    mediaId: 7, pageResource: "pages", pageId: 9, purpose: "informative", verifiedDescription, proposalLanguage: "es", requiredTerms: ["ayuda", "cartas", "IRS"] });

  beforeEach(async () => {
    jest.useFakeTimers({ now: Date.parse("2026-11-02T10:00:00.000Z"), doNotFake: ["nextTick", "setImmediate", "clearImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    directory = await mkdtemp(join(tmpdir(), "seo-spy-purpose-workflow-"));
    const config = new ConfigService({ NODE_ENV: "test", DATABASE_PATH: join(directory, "application.sqlite"), REPORTS_DIR: join(directory, "reports"),
      WORDPRESS_BUSINESS_ID: businessId, WORDPRESS_SITE_URL: siteUrl, WORDPRESS_USERNAME: "offline-user", WORDPRESS_APPLICATION_PASSWORD: "offline-password",
      WORDPRESS_OPERATOR_KEY: operator, WORDPRESS_ACTIONS_DIR: join(directory, "actions"), WORDPRESS_REPORTS_DIR: join(directory, "wordpress"),
      WORDPRESS_MUSE_DIR: join(directory, "muse"), WORDPRESS_WRITES_ENABLED: false, AI_USAGE_DB: join(directory, "usage.sqlite"),
      MOCK_AI: true, AI_MODE: "mock", AI_ENABLED: false, AI_DEV_BUDGET_MICROS: 0 });
    business = { id: businessId, name: "Offline Guzman fixture", website: siteUrl, createdAt: new Date().toISOString() };
    imageHash = originalHash; variantHash = originalHash; writable = true; publicAlt = ""; publicMarkup = null;
    media = { id: 7, type: "attachment", status: "inherit", media_type: "image", post: 9, source_url: sourceUrl, alt_text: "", modified_gmt: "2026-11-02T00:00:00",
      media_details: { sizes: { large: { source_url: variant, width: 1024, height: 1024 } } } };
    page = { id: 9, type: "page", status: "publish", link: pageUrl, modified_gmt: "2026-11-02T00:00:00", title: { rendered: "Ayuda con cartas del IRS" },
      content: { protected: false, rendered: `<h1>Ayuda con cartas del IRS</h1><p>Atención en español.</p><figure id="promotion"><img class="wp-image-7" src="${variant}" alt=""></figure>` } };
    transport = jest.fn<WordPressClient["request"]>().mockImplementation(async (_connection, method, path) => {
      if (!["GET", "OPTIONS"].includes(method)) throw new Error("All WordPress writes are forbidden in purpose tests");
      if (path.startsWith("/wp-json/wp/v2/media/7")) return method === "OPTIONS" ? { endpoints: writable ? [{ methods: ["POST"], args: { alt_text: { type: "string" } } }] : [] } : structuredClone(media);
      if (path.startsWith("/wp-json/wp/v2/pages/9")) return structuredClone(page);
      if (path.startsWith("/wp-json/wp/v2/users/me")) return { id: 1, capabilities: { upload_files: writable, edit_posts: writable } };
      throw new Error("Unexpected offline target");
    });
    collector = jest.fn<WebsiteCollector["collect"]>().mockImplementation(async () => {
      const html = publicMarkup ?? `<h1>Ayuda con cartas del IRS</h1><img class="wp-image-7" src="data:image/png;base64,AAAA" data-src="${variant}" alt="${publicAlt}">`;
      return { requestedUrl: String(page.link), finalUrl: String(page.link), status: 200, contentType: "text/html; charset=utf-8", body: Buffer.from(html),
        collectedAt: new Date().toISOString(), bytes: Buffer.byteLength(html), redirects: [], robots: "" };
    });
    imageRead = jest.fn<WordPressImageContent["fingerprint"]>().mockImplementation(async input => ({ sourceUrl: input, sha256: input === variant ? variantHash : imageHash, bytes: 1000, collectedAt: new Date().toISOString() }));
    model = jest.fn<MetaMuseTransport["post"]>().mockRejectedValue(new Error("Paid generation forbidden"));
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), WordPressModule] })
      .overrideProvider(ConfigService).useValue(config).overrideProvider(WordPressClient).useValue({ request: transport })
      .overrideProvider(WebsiteCollector).useValue({ collect: collector }).overrideProvider(WordPressImageContent).useValue({ fingerprint: imageRead })
      .overrideProvider(MetaMuseTransport).useValue({ post: model })
      .overrideProvider(BUSINESS_REPOSITORY).useValue({ findById: async (id: string) => id === businessId ? structuredClone(business) : null, connections: async () => [] }).compile();
    app = configureApp(module.createNestApplication()); app.useLogger(false); await app.init();
    fixes = app.get(WordPressFixService); purposes = app.get(WordPressPurposeService); store = app.get(WordPressFixStore); pageEvidence = app.get(WordPressPageEvidenceService);
    const ledger = app.get(AiUsageStore);
    ledgerSpies = [jest.spyOn(ledger, "estimate"), jest.spyOn(ledger, "estimateWordPressAlt"), jest.spyOn(ledger, "approve"), jest.spyOn(ledger, "reserve"), jest.spyOn(ledger, "settle"), jest.spyOn(ledger, "activateWordPressAltFunding")];
    for (const spy of ledgerSpies) spy.mockImplementation(() => { throw new Error("Ledger operations forbidden"); });
    source = await pageEvidence.collect(businessId, { confirmed: true, mediaId: 7, pageResource: "pages", pageId: 9 });
    const reviewed = await fixes.enroll(businessId, actor, enrollment());
    owner = altEvidenceSchema.parse(store.read(businessId, actor, reviewed.id));
  });
  afterEach(async () => {
    expect(model).not.toHaveBeenCalled(); expect(transport.mock.calls.every(call => ["GET", "OPTIONS"].includes(call[1]))).toBe(true);
    for (const spy of ledgerSpies) expect(spy).not.toHaveBeenCalled();
    jest.restoreAllMocks(); await app.close(); jest.useRealTimers();
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true); await rm(directory, { recursive: true });
  });

  it("adopts an expired confirmed purpose explicitly while preserving owner actor/date and creating only machine state", async () => {
    const original = fixDigest(owner); advance(16 * 60000);
    await expect(fixes.preview(businessId, actor, { evidenceId: owner.id })).rejects.toThrow();
    const response = await post("purpose-adoption", adoption()); expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ ownerConfirmationCreated: false, originalConfirmedAt: owner.createdAt,
      binding: { id: deterministicPurposeBindingId(owner.id), evidenceId: owner.id, originalReviewHash: original, originalConfirmedAt: owner.createdAt, originalConfirmedBy: actor } });
    const states = store.list(businessId, actor).filter(row => row.kind === "execution-state"); expect(states).toHaveLength(1);
    expect(Date.parse(String(states[0].expiresAt)) - Date.parse(String(states[0].createdAt))).toBe(15 * 60000);
    expect(fixDigest(store.read(businessId, actor, owner.id))).toBe(original);
  });

  it.each(["missing-hash", "wrong-hash", "missing-attestation", "false-attestation", "wrong-review-hash"])("rejects %s adoption without creating a binding", async kind => {
    const body: Record<string, unknown> = adoption();
    if (kind === "missing-hash") delete body.originalImageHash;
    if (kind === "wrong-hash") body.originalImageHash = "d".repeat(64);
    if (kind === "missing-attestation") delete body.dependenciesUnchanged;
    if (kind === "false-attestation") body.dependenciesUnchanged = false;
    if (kind === "wrong-review-hash") body.originalReviewHash = "d".repeat(64);
    expect((await post("purpose-adoption", body)).status).toBeGreaterThanOrEqual(400);
    expect(purposes.hasBinding(owner)).toBe(false);
  });

  it("refreshes only execution clocks after fifteen minutes with the same v3 request and original consent", async () => {
    await purposes.adopt(businessId, actor, adoption());
    const preview = await fixes.preview(businessId, actor, { evidenceId: owner.id, instructions: "Español conciso." });
    const initialState = store.list(businessId, actor).find(row => row.kind === "execution-state")!;
    const bindingBefore = fixDigest(purposes.binding(owner)); advance(16 * 60000);
    const calls = transport.mock.calls.length, pixels = imageRead.mock.calls.length;
    const capability = await fixes.capability(businessId, actor, source.reportId, source.findingId);
    expect(capability).toMatchObject({ purposeReusable: true, executionRefreshRequired: true });
    expect(transport).toHaveBeenCalledTimes(calls); expect(imageRead).toHaveBeenCalledTimes(pixels);
    const refreshed = await post("execution-state", { confirmed: true, evidenceId: owner.id }); expect(refreshed.status).toBe(201);
    expect(refreshed.body).toMatchObject({ ownerConfirmationRenewed: false });
    expect(refreshed.body.state.id).not.toBe(initialState.id);
    expect(refreshed.body.state.createdAt).not.toBe(initialState.createdAt);
    const next = await fixes.preview(businessId, actor, { evidenceId: owner.id, instructions: "Español conciso." });
    expect(next.requestHash).toBe(preview.requestHash); expect(fixDigest(purposes.binding(owner))).toBe(bindingBefore);
    expect(altEvidenceSchema.parse(store.read(businessId, actor, owner.id)).createdAt).toBe(owner.createdAt);
  });

  it("lets explicit mock generation refresh expired execution state without creating human or paid approval", async () => {
    await purposes.adopt(businessId, actor, adoption()); advance(16 * 60000);
    const generation = await fixes.generate(businessId, actor, { evidenceId: owner.id, instructions: "Español conciso." });
    expect(generation).toMatchObject({ isMock: true, provider: "mock-fixture", evidenceId: owner.id, output: { status: "proposed" } });
    expect(store.list(businessId, actor).filter(row => row.kind === "evidence")).toHaveLength(1);
    expect(purposes.binding(owner).originalConfirmedAt).toBe(owner.createdAt);
  });

  it("prepares a grounded human edit with a distinct hash and keeps its generation immutable, without writes or inference", async () => {
    const enrolled = await post("evidence", enrollment("Gráfico promocional sobre ayuda para entender y responder cartas del IRS."));
    expect(enrolled.status).toBe(201); owner = altEvidenceSchema.parse(store.read(businessId, actor, enrolled.body.id));
    await purposes.adopt(businessId, actor, adoption());
    const generation = await fixes.generate(businessId, actor, { evidenceId: owner.id });
    const original = fixDigest(store.read(businessId, actor, generation.id));
    const edited = `${business.name} ofrece ayuda para entender y responder cartas del IRS.`;
    const proposal = await fixes.propose(businessId, actor, generation.id, edited);
    expect(proposal).toMatchObject({ textOrigin: "human-edited", before: { altText: "" }, changes: { altText: edited } });
    const another = await fixes.propose(businessId, actor, generation.id, edited);
    expect(another.hash).not.toBe(proposal.hash);
    expect(await fixes.read(businessId, actor, proposal.id)).toMatchObject({ hash: proposal.hash, textOrigin: "human-edited", executionStarted: false });
    expect(fixDigest(store.read(businessId, actor, generation.id))).toBe(original); expect(model).not.toHaveBeenCalled();
    expect(transport.mock.calls.every(call => ["GET", "OPTIONS"].includes(call[1]))).toBe(true);
  });

  it("invalidates purpose after image bytes change and does not revive it when the original bytes return", async () => {
    await purposes.adopt(businessId, actor, adoption()); imageHash = "d".repeat(64);
    await expect(purposes.refresh(businessId, actor, owner.id)).rejects.toThrow();
    expect(store.list(businessId, actor).filter(row => row.kind === "purpose-invalidation")).toHaveLength(1);
    imageHash = originalHash; const calls = imageRead.mock.calls.length;
    await expect(purposes.refresh(businessId, actor, owner.id)).rejects.toThrow();
    expect(imageRead).toHaveBeenCalledTimes(calls);
  });

  it.each(["public-link", "public-text", "variant-pixels"])("invalidates %s changes despite an unchanged authenticated page and original image", async kind => {
    await purposes.adopt(businessId, actor, adoption());
    if (kind === "public-link") publicMarkup = `<h1>Ayuda con cartas del IRS</h1><a href="/different-destination/"><img class="wp-image-7" src="${variant}" alt=""></a>`;
    if (kind === "public-text") publicMarkup = `<h1>A different public audience</h1><img class="wp-image-7" src="${variant}" alt="">`;
    if (kind === "variant-pixels") variantHash = "d".repeat(64);
    await expect(purposes.refresh(businessId, actor, owner.id)).rejects.toThrow();
    expect(store.list(businessId, actor).filter(row => row.kind === "purpose-invalidation")).toHaveLength(1);
    publicMarkup = null; variantHash = originalHash;
    await expect(purposes.refresh(businessId, actor, owner.id)).rejects.toThrow();
  });

  it.each(["alt", "media-modified", "page-modified", "permission"])("blocks stale %s execution while retaining durable purpose", async kind => {
    await purposes.adopt(businessId, actor, adoption()); const before = fixDigest(purposes.binding(owner));
    if (kind === "alt") { media.alt_text = "Changed externally"; publicAlt = "Changed externally"; page.content = { protected: false, rendered: String((page.content as { rendered: string }).rendered).replace('alt=""', 'alt="Changed externally"') }; }
    if (kind === "media-modified") media.modified_gmt = "2026-11-02T01:00:00";
    if (kind === "page-modified") page.modified_gmt = "2026-11-02T01:00:00";
    if (kind === "permission") writable = false;
    await expect(purposes.refresh(businessId, actor, owner.id)).rejects.toThrow();
    expect(fixDigest(purposes.binding(owner))).toBe(before);
    expect(store.list(businessId, actor).filter(row => row.kind === "purpose-invalidation")).toHaveLength(0);
    expect(store.list(businessId, actor).filter(row => row.kind === "execution-invalidation")).toHaveLength(1);
    expect(await fixes.capability(businessId, actor, source.reportId, source.findingId)).toMatchObject({ fixable: false, purposeReusable: true, executionRefreshRequired: true });
    await expect(fixes.preview(businessId, actor, { evidenceId: owner.id })).rejects.toThrow();
  });

  it("recovers from a failed permission check by refreshing machine state without new owner consent", async () => {
    await purposes.adopt(businessId, actor, adoption()); const before = fixDigest(purposes.binding(owner));
    writable = false; await expect(purposes.refresh(businessId, actor, owner.id)).rejects.toThrow();
    expect(await fixes.capability(businessId, actor, source.reportId, source.findingId)).toMatchObject({ fixable: false, executionRefreshRequired: true });
    writable = true; advance(1000);
    const refreshed = await purposes.refresh(businessId, actor, owner.id);
    expect(refreshed.ownerConfirmationRenewed).toBe(false);
    expect(await fixes.capability(businessId, actor, source.reportId, source.findingId)).toMatchObject({ fixable: true, purposeReusable: true, executionRefreshRequired: false });
    expect(fixDigest(purposes.binding(owner))).toBe(before);
    expect(altEvidenceSchema.parse(store.read(businessId, actor, owner.id)).createdAt).toBe(owner.createdAt);
    expect(store.list(businessId, actor).filter(row => row.kind === "evidence")).toHaveLength(1);
  });

  it("recovers changed alt/modification preconditions only through a fresh exact report and a new request hash", async () => {
    await purposes.adopt(businessId, actor, adoption()); const before = fixDigest(purposes.binding(owner));
    const oldPreview = await fixes.preview(businessId, actor, { evidenceId: owner.id, instructions: "Español conciso." });
    media.alt_text = "Previously approved external alternative"; media.modified_gmt = "2026-11-02T01:00:00"; publicAlt = String(media.alt_text);
    page.content = { protected: false, rendered: String((page.content as { rendered: string }).rendered).replace('alt=""', `alt="${publicAlt}"`) };
    await expect(purposes.refresh(businessId, actor, owner.id)).rejects.toThrow();
    expect(await fixes.capability(businessId, actor, source.reportId, source.findingId)).toMatchObject({ fixable: false, executionRefreshRequired: true });
    advance(1000);
    const freshSource = await pageEvidence.collect(businessId, { confirmed: true, mediaId: 7, pageResource: "pages", pageId: 9 });
    const refreshed = await purposes.refresh(businessId, actor, owner.id, { reportId: freshSource.reportId, findingId: freshSource.findingId, evidenceId: freshSource.evidenceId });
    expect(refreshed.ownerConfirmationRenewed).toBe(false);
    expect(refreshed.evidence.target).toMatchObject({ currentAlt: publicAlt, modified: media.modified_gmt });
    const newPreview = await fixes.preview(businessId, actor, { evidenceId: owner.id, instructions: "Español conciso." });
    expect(newPreview.requestHash).not.toBe(oldPreview.requestHash);
    expect(fixDigest(purposes.binding(owner))).toBe(before);
    expect(await fixes.capability(businessId, actor, freshSource.reportId, freshSource.findingId)).toMatchObject({ fixable: true, purposeReusable: true, executionRefreshRequired: false });
    expect((await fixes.capability(businessId, actor, source.reportId, source.findingId)).fixable).toBe(false);
    expect(store.list(businessId, actor).filter(row => row.kind === "evidence")).toHaveLength(1);
  });

  it("does not reset the seven-day source deadline when refreshing execution state", async () => {
    await purposes.adopt(businessId, actor, adoption()); const before = fixDigest(purposes.binding(owner)); advance(8 * 86400000);
    await expect(purposes.refresh(businessId, actor, owner.id)).rejects.toThrow();
    expect(fixDigest(purposes.binding(owner))).toBe(before);
    expect(altEvidenceSchema.parse(store.read(businessId, actor, owner.id)).source).toEqual(owner.source);
  });

  it("rejects old purpose after a fresh owner decision supersedes it", async () => {
    await purposes.adopt(businessId, actor, adoption()); advance(1000);
    const newer = await fixes.enroll(businessId, actor, enrollment(description + " Atención personalizada."));
    expect(newer.id).not.toBe(owner.id); await expect(purposes.refresh(businessId, actor, owner.id)).rejects.toThrow();
    expect(store.read(businessId, actor, owner.id)).not.toBeNull();
  });

  it.each(["foreign-owner", "cross-page", "placement", "business-name"])("rejects %s context reuse", async kind => {
    await purposes.adopt(businessId, actor, adoption());
    if (kind === "foreign-owner") { await expect(purposes.refresh(businessId, "d".repeat(64), owner.id)).rejects.toThrow(); return; }
    if (kind === "cross-page") page.link = `${siteUrl}/another-page/`;
    if (kind === "placement") page.content = { protected: false, rendered: String((page.content as { rendered: string }).rendered).replace('id="promotion"', 'id="different-purpose-section"') };
    if (kind === "business-name") business.name = "Different business";
    await expect(purposes.refresh(businessId, actor, owner.id)).rejects.toThrow();
  });

  it("rejects an unrelated execution source without changing the original purpose or evidence", async () => {
    await purposes.adopt(businessId, actor, adoption()); const before = fixDigest(purposes.binding(owner));
    await expect(purposes.refresh(businessId, actor, owner.id, { reportId: randomUUID(), findingId: source.findingId, evidenceId: source.evidenceId })).rejects.toThrow();
    expect(fixDigest(purposes.binding(owner))).toBe(before);
  });

  it("allows at most one deterministic binding during concurrent explicit adoption", async () => {
    const results = await Promise.allSettled([purposes.adopt(businessId, actor, adoption()), purposes.adopt(businessId, actor, adoption())]);
    expect(results.some(result => result.status === "fulfilled")).toBe(true);
    const bindings = store.list(businessId, actor).filter(row => row.kind === "purpose-binding");
    expect(bindings).toHaveLength(1); expect(bindings[0].id).toBe(deterministicPurposeBindingId(owner.id));
    expect(store.list(businessId, actor).filter(row => row.kind === "evidence")).toHaveLength(1);
  });
});
