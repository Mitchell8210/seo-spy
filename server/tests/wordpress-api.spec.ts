import "reflect-metadata";
import { jest } from "@jest/globals";
import { ServiceUnavailableException, type INestApplication } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { configureApp } from "../src/configure-app.js";
import { WordPressModule } from "../src/modules/wordpress/wordpress.module.js";
import { WordPressActionsStore } from "../src/modules/wordpress/wordpress-actions.store.js";
import { WordPressClient, WordPressRequestError } from "../src/integrations/wordpress/wordpress.client.js";
import { operatorIdentity } from "../src/modules/wordpress/wordpress.guard.js";
import { BUSINESS_REPOSITORY } from "../src/persistence/repositories.js";
import { MetaMuseProvider } from "../src/integrations/ai/meta-muse.provider.js";
import { WebsiteCollector } from "../src/integrations/website/collector.js";

const businessId = "demo-guzman";
const operator = "test-wordpress-operator-key-at-least-32-characters";
const prefix = `/api/wordpress/businesses/${businessId}`;

describe("WordPress operator API with controlled remote fixtures", () => {
  let app: INestApplication;
  let directory: string;
  let settings: Record<string, unknown>;
  let remote: Record<string, unknown>;
  let transport: ReturnType<typeof jest.fn<WordPressClient["request"]>>;

  const posts = () => transport.mock.calls.filter(call => call[1] === "POST");
  const get = (path: string, token = operator) => request(app.getHttpServer()).get(path)
    .set("Host", "localhost:3001").set("Authorization", `Bearer ${token}`);
  const post = (path: string, body: object, token = operator) => request(app.getHttpServer()).post(path)
    .set("Host", "localhost:3001").set("Authorization", `Bearer ${token}`).send(body);

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-wordpress-api-"));
    settings = {
      WORDPRESS_BUSINESS_ID: businessId,
      WORDPRESS_SITE_URL: "https://example.com",
      WORDPRESS_USERNAME: "private-wordpress-username",
      WORDPRESS_APPLICATION_PASSWORD: "private-wordpress-application-password",
      WORDPRESS_OPERATOR_KEY: operator,
      WORDPRESS_WRITES_ENABLED: false,
      WORDPRESS_FRONTEND_ORIGIN: "http://localhost:5173",
      WORDPRESS_ACTIONS_DIR: directory,
      WORDPRESS_REPORTS_DIR: join(directory, "evidence"),
      WORDPRESS_MUSE_DIR: join(directory, "muse"),
      AI_ENABLED: false,
      PORT: 3001,
    };
    remote = {
      id: 7, type: "page", status: "publish", slug: "example", link: "https://example.com/example/",
      modified_gmt: "2026-10-30T20:00:00", title: { raw: "Original title", rendered: "Original title" },
      content: { raw: "Original content", rendered: "<p>Original content</p>", protected: false },
      excerpt: { raw: "Original excerpt", rendered: "Original excerpt" },
      alt_text: "Original image description", caption: { raw: "Original caption" }, description: { raw: "Original description" },
      meta: {},
      source_url: "https://example.com/image.jpg",
    };
    transport = jest.fn<WordPressClient["request"]>().mockImplementation(async (_connection, method, path, body) => {
      if (path.startsWith("/wp-json/wp/v2/users/me")) return { id: 12, roles: ["administrator"], capabilities: {
        read: true, edit_pages: true, edit_others_pages: true, edit_published_pages: true,
        edit_posts: true, edit_others_posts: true, edit_published_posts: true, upload_files: true,
      } };
      if (/\/wp\/v2\/(pages|posts|media)\/\d+/.test(path)) {
        if (method === "POST") {
          for (const [key, value] of Object.entries(body ?? {})) {
            remote[key] = ["title", "content", "excerpt", "caption", "description"].includes(key)
              ? { raw: value, rendered: value } : value;
          }
          remote.modified_gmt = "2026-10-30T20:01:00";
        }
        return structuredClone(remote);
      }
      if (/\/wp\/v2\/(pages|posts|media)(?:\?|$)/.test(path)) return [structuredClone(remote)];
      if (path === "/wp-json/" || path.startsWith("/wp-json/wp-abilities/v1")) return { namespaces: ["wp/v2"], routes: {} };
      if (path.startsWith("/wp-json/wp/v2/plugins")) return [];
      throw new Error("Unexpected fixture request path");
    });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), WordPressModule,
    ] }).overrideProvider(ConfigService).useValue(new ConfigService(settings))
      .overrideProvider(WordPressClient).useValue({ request: transport })
      .overrideProvider(WebsiteCollector).useValue({ collect: jest.fn<WebsiteCollector["collect"]>().mockResolvedValue({ requestedUrl: "https://example.com/example/", finalUrl: "https://example.com/example/", status: 200, contentType: "text/html; charset=utf-8", robots: "", collectedAt: new Date().toISOString(), bytes: 65, redirects: [], body: Buffer.from('<img class="wp-image-7" src="/image.jpg" alt="Approved alternative">') }) })
      .overrideProvider(BUSINESS_REPOSITORY).useValue({
        findById: async (id: string) => id === businessId ? { id, name: "Example", website: "https://example.com", createdAt: "2026-10-30T00:00:00Z" } : null,
        connections: async () => [],
      }).compile();
    app = configureApp(module.createNestApplication());
    app.useLogger(false);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-wordpress-api-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });

  async function preview(changes: object = { title: "Approved title" }) {
    const response = await post(`${prefix}/proposals`, { resource: "pages", resourceId: 7, changes });
    expect(response.status).toBe(201);
    expect(response.body.id).toEqual(expect.any(String));
    expect(response.body.hash).toEqual(expect.any(String));
    return response.body as { id: string; hash: string };
  }

  function rankMathFixture() {
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (...args) => {
      const path = args[2];
      if (path.startsWith("/wp-json/wp/v2/plugins")) return [{ plugin: "seo-by-rank-math/rank-math", version: "1.0.277.2", status: "active" }];
      const ability = /\/wp-abilities\/v1\/abilities\/rank-math\/([^/?]+)/.exec(path)?.[1];
      if (ability && !path.includes("/run")) return { name: `rank-math/${ability}`, meta: { annotations: { readonly: true } } };
      if (ability === "get-post-seo-meta") return { post_id: 7, title: "SEO title", description: "SEO description", seo_score: 0 };
      if (ability === "get-seo-scores") return [{ post_id: 7, title: "Fixture page", score: 0, last_updated: 1793390400 }];
      if (ability === "audit-site-seo") return { score: 68, remote_api_status: "ok", last_run_at: 1793390400, findings: [{ test_id: "title", status: "fail", title: "Check the title", description: "The title needs review." }] };
      return original(...args);
    });
  }

  it("archives bounded published evidence with null scoring, excludes bodies, and reads history without remote calls", async () => {
    rankMathFixture();
    const created = await post(`${prefix}/reports`, { sampleSize: 2 }).expect(201);
    expect(created.body).toMatchObject({ schemaVersion: "seo-spy.wordpress-evidence.v1", businessId, availability: "partial", sampleSize: 2, scoring: { seoSpyScore: null, policyVersion: null, storedScoreFreshness: "unknown" } });
    expect(created.body.content[0].items[0]).toMatchObject({ id: 7, title: "Original title" });
    expect(created.body.rankMath[0].evidence.content.storedSeoScore).toBe(0);
    expect(created.text).not.toContain("Original content");
    expect(created.text).not.toContain("private-wordpress");
    expect(created.text).not.toContain(operator);
    expect(posts()).toHaveLength(0);
    expect(transport.mock.calls.some(call => call[2].includes("audit-site-seo/run"))).toBe(false);
    const count = transport.mock.calls.length;
    settings.WORDPRESS_APPLICATION_PASSWORD = "";
    await get(`${prefix}/reports/${created.body.id}`).expect(200, created.body);
    const list = await get(`${prefix}/reports?limit=1`).expect(200);
    expect(list.body.reports).toHaveLength(1);
    expect(list.body.reports[0].id).toBe(created.body.id);
    expect(transport.mock.calls).toHaveLength(count);
    settings.WORDPRESS_SITE_URL = "https://www.example.com";
    await get(`${prefix}/reports/${created.body.id}`).expect(404);
    const other = await get("/api/wordpress/businesses/another-business/reports");
    expect([403, 404]).toContain(other.status);
  });

  it("validates report requests and authorization before collection", async () => {
    await post(`${prefix}/reports`, {}, "incorrect").expect(401);
    await post(`${prefix}/reports`, { sampleSize: 21 }).expect(400);
    await post(`${prefix}/reports`, { sampleSize: 0 }).expect(400);
    await post(`${prefix}/reports`, { sampleSize: "2" }).expect(400);
    await post(`${prefix}/reports`, { confirmed: true }).expect(400);
    await get(`${prefix}/reports?limit=51`).expect(400);
    await get(`${prefix}/reports/not-a-uuid`).expect(400);
    expect(transport).not.toHaveBeenCalled();
  });

  it("preserves source failures and prior evidence without inventing a clean site", async () => {
    const first = await post(`${prefix}/reports`, {}).expect(201);
    transport.mockRejectedValue(new Error("secret-provider-failure"));
    const failed = await post(`${prefix}/reports`, {}).expect(201);
    expect(failed.body.availability).toBe("unavailable");
    expect(failed.body.content.every((entry: { availability: string }) => entry.availability === "unavailable")).toBe(true);
    expect(failed.text).not.toContain("secret-provider-failure");
    const prior = await get(`${prefix}/reports/${first.body.id}`).expect(200);
    expect(prior.body).toEqual(first.body);
    expect((await get(`${prefix}/reports`).expect(200)).body.reports).toHaveLength(2);
  });

  it("excludes private content and out-of-sample Rank Math scores", async () => {
    rankMathFixture();
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (...args) => {
      if (args[2].includes("get-seo-scores/run")) return [{ post_id: 999, title: "Private draft title", keyword: "private", score: 99 }];
      return original(...args);
    });
    const report = await post(`${prefix}/reports`, {}).expect(201);
    expect(report.text).not.toContain("Private draft title");
    expect(report.body.rankMath[0].evidence.scores.items).toEqual([]);
    remote.status = "draft";
    const privateReport = await post(`${prefix}/reports`, {}).expect(201);
    expect(privateReport.body.content[0].availability).toBe("unavailable");
    expect(privateReport.body.content[0].items).toEqual([]);
    expect(privateReport.body.rankMath[0].evidence).toBeNull();
    remote.status = "publish";
    remote.content = { protected: true, rendered: "Private password-protected body" };
    const protectedReport = await post(`${prefix}/reports`, {}).expect(201);
    expect(protectedReport.body.content[0].items).toEqual([]);
    expect(protectedReport.body.rankMath[0].evidence).toBeNull();
    expect(protectedReport.text).not.toContain("Original title");
    expect(protectedReport.text).not.toContain("Private password-protected body");
  });

  it("rejects a concurrent report collection and releases its guard after completion", async () => {
    const original = transport.getMockImplementation()!;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    transport.mockImplementationOnce(async (...args) => { entered(); await blocked; return original(...args); });
    const collecting = post(`${prefix}/reports`, {}).then(response => response);
    await started;
    try { await post(`${prefix}/reports`, {}).expect(409); }
    finally { release(); }
    expect((await collecting).status).toBe(201);
    await post(`${prefix}/reports`, {}).expect(201);
  });

  it("returns an error instead of claiming saved evidence when publication fails and clears the active collection", async () => {
    const { WordPressReportsStore } = await import("../src/modules/wordpress/wordpress-reports.store.js");
    const store = app.get(WordPressReportsStore);
    const fail = jest.spyOn(store, "publish").mockRejectedValueOnce(new ServiceUnavailableException("Fixture publication failure"));
    await post(`${prefix}/reports`, {}).expect(503);
    await post(`${prefix}/reports`, {}).expect(201);
    expect(fail).toHaveBeenCalledTimes(2);
  });

  it("prepares cited Muse input cost-free, requires confirmation and defaults paid generation off", async () => {
    const report = await post(`${prefix}/reports`, {}).expect(201);
    const count = transport.mock.calls.length;
    const prepared = await get(`${prefix}/reports/${report.body.id}/muse-evidence`).expect(200);
    expect(prepared.body.schemaVersion).toBe("seo-spy.wordpress-muse-evidence.v1");
    expect(prepared.body.business.id).toBe(businessId);
    expect(prepared.body.observations.length).toBeGreaterThan(0);
    expect(prepared.text).not.toContain("Original content");
    await post(`${prefix}/reports/${report.body.id}/muse-analyses`, {}).expect(400);
    await post(`${prefix}/reports/${report.body.id}/muse-analyses`, { confirmed: false }).expect(400);
    await post(`${prefix}/reports/${report.body.id}/muse-analyses`, { confirmed: true }).set("Origin", "https://attacker.example").expect(403);
    const disabled = await post(`${prefix}/reports/${report.body.id}/muse-analyses`, { confirmed: true }).expect(503);
    expect(disabled.body.error.code).toBe("AI_DISABLED");
    expect(transport.mock.calls).toHaveLength(count);
  });

  it("publishes validated informational Muse output and reads it without another call", async () => {
    const report = await post(`${prefix}/reports`, {}).expect(201);
    const prepared = await get(`${prefix}/reports/${report.body.id}/muse-evidence`).expect(200);
    const ref = prepared.body.observations[0].evidenceId;
    const generate = jest.spyOn(app.get(MetaMuseProvider), "generate").mockResolvedValue({ model: "muse-spark-1.3", usage: { inputTokens: 100, outputTokens: 80 }, requestId: "fixture", output: { schemaVersion: "wordpress-muse-output-v1", summary: "A bounded content sample was collected.", summaryEvidenceIds: [ref], observations: [{ id: "sample", kind: "fact", text: "The sampled title is available.", evidenceIds: [ref] }], recommendations: [], limitations: ["The sample is limited."], seoSpyScore: null } });
    const created = await post(`${prefix}/reports/${report.body.id}/muse-analyses`, { confirmed: true }).expect(201);
    expect(created.body.schemaVersion).toBe("seo-spy.wordpress-muse-analysis.v1");
    expect(created.body.sourceHash).toBe(prepared.body.source.contentHash);
    settings.MODEL_API_KEY = "";
    const count = transport.mock.calls.length;
    await get(`${prefix}/reports/${report.body.id}/muse-analyses/${created.body.id}`).expect(200, created.body);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls).toHaveLength(count);
    const different = await post(`${prefix}/reports`, {}).expect(201);
    await get(`${prefix}/reports/${different.body.id}/muse-analyses/${created.body.id}`).expect(404);
  });

  it("verifies only applied media-alt proposals, saves public receipts, and reads them without collection", async () => {
    const proposal = await post(`${prefix}/proposals`, { resource: "media", resourceId: 7, changes: { altText: "Approved alternative" } }).expect(201);
    const path = `${prefix}/proposals/${proposal.body.id}/verifications`;
    await post(path, { pageResource: "pages", pageId: 7 }).expect(409);
    await post(path, { pageResource: "pages", pageId: 7, url: "https://attacker.example" }).expect(400);
    settings.WORDPRESS_WRITES_ENABLED = true;
    await post(`${prefix}/proposals/${proposal.body.id}/apply`, { proposalHash: proposal.body.hash, confirmed: true }).expect(201);
    settings.WORDPRESS_WRITES_ENABLED = false;
    const receipt = await post(path, { pageResource: "pages", pageId: 7 }).expect(201);
    expect(receipt.body).toMatchObject({ status: "verified", storedFieldMatches: true, matchedImages: 1 });
    expect(receipt.body.actor).toBeUndefined();
    const collector = app.get(WebsiteCollector);
    expect(collector.collect).toHaveBeenCalledWith("https://example.com/example/", undefined, "https://example.com");
    const count = transport.mock.calls.length;
    await get(`${path}/${receipt.body.id}`).expect(200, receipt.body);
    expect(transport.mock.calls).toHaveLength(count);
    expect(collector.collect).toHaveBeenCalledTimes(1);
    await get(`${prefix}/proposals/${randomUUID()}/verifications/${receipt.body.id}`).expect(404);
  });

  it("requires the local operator credential and rejects an unrelated browser Origin before any remote call", async () => {
    await request(app.getHttpServer()).get(`${prefix}/connection`).set("Host", "localhost:3001").expect(401);
    await get(`${prefix}/connection`, "incorrect-token").expect(401);
    await get(`${prefix}/connection`).set("Origin", "https://attacker.example").expect(403);
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not use bound credentials for another business or return the credentials to a caller", async () => {
    const denied = await get("/api/wordpress/businesses/another-business/connection");
    expect([403, 404]).toContain(denied.status);
    expect(transport).not.toHaveBeenCalled();
    const response = await get(`${prefix}/connection`).expect(200);
    expect(response.text).not.toContain("private-wordpress");
    expect(response.text).not.toContain(operator);
    expect(posts()).toHaveLength(0);
  });

  it("fails closed on missing local operator or credential configuration and a mismatched installation", async () => {
    settings.WORDPRESS_OPERATOR_KEY = "";
    await get(`${prefix}/connection`).expect(503);
    settings.WORDPRESS_OPERATOR_KEY = operator;
    settings.WORDPRESS_APPLICATION_PASSWORD = "";
    await get(`${prefix}/connection`).expect(503);
    settings.WORDPRESS_APPLICATION_PASSWORD = "private-wordpress-application-password";
    settings.WORDPRESS_SITE_URL = "https://other-business.example";
    await get(`${prefix}/connection`).expect(403);
    expect(transport).not.toHaveBeenCalled();
  });

  it("retrieves existing content through fixed core resources without exposing connection credentials", async () => {
    const list = await get(`${prefix}/content/pages?page=1&perPage=2`).expect(200);
    expect(list.text).toContain("Original title");
    const item = await get(`${prefix}/content/pages/7`).expect(200);
    expect(item.text).toContain("Original content");
    expect(item.text).not.toContain("private-wordpress");
    expect(item.text).not.toContain(operator);
    await get(`${prefix}/content/plugins`).expect(400);
    expect(posts()).toHaveLength(0);
  });

  it("validates resources, identifiers, pagination and proposal fields without making remote writes", async () => {
    for (const body of [
      { resource: "plugins", resourceId: 7, changes: { title: "Bad" } },
      { resource: "pages", resourceId: -1, changes: { title: "Bad" } },
      { resource: "pages", resourceId: 7, changes: { script: "arbitrary code" } },
      { resource: "pages", resourceId: 7, changes: { title: "New" }, actor: "administrator" },
      { resource: "pages", resourceId: 7, changes: {} },
    ]) await post(`${prefix}/proposals`, body).expect(400);
    await get(`${prefix}/content/pages?page=-1`).expect(400);
    expect(posts()).toHaveLength(0);
  });

  it("produces a concrete preview without writing and keeps application disabled by default", async () => {
    const proposal = await preview();
    expect(posts()).toHaveLength(0);
    const result = await post(`${prefix}/proposals/${proposal.id}/apply`, { proposalHash: proposal.hash, confirmed: true });
    expect([403, 503]).toContain(result.status);
    expect(posts()).toHaveLength(0);
  });

  it("rejects a no-op proposal rather than presenting unchanged content as a fix", async () => {
    await post(`${prefix}/proposals`, { resource: "pages", resourceId: 7, changes: { title: "Original title" } }).expect(400);
    expect(posts()).toHaveLength(0);
  });

  it("binds Apply to the exact proposal hash and explicit confirmation", async () => {
    settings.WORDPRESS_WRITES_ENABLED = true;
    const proposal = await preview();
    const denied = await post(`${prefix}/proposals/${proposal.id}/apply`, { proposalHash: "0".repeat(64), confirmed: true });
    expect([400, 409]).toContain(denied.status);
    await post(`${prefix}/proposals/${proposal.id}/apply`, { proposalHash: proposal.hash, confirmed: false }).expect(400);
    expect(posts()).toHaveLength(0);
  });

  it("rejects a stale remote baseline without overwriting another actor's change", async () => {
    settings.WORDPRESS_WRITES_ENABLED = true;
    const proposal = await preview();
    remote.modified_gmt = "2026-10-30T20:00:30";
    remote.title = { raw: "Someone else's title", rendered: "Someone else's title" };
    const response = await post(`${prefix}/proposals/${proposal.id}/apply`, { proposalHash: proposal.hash, confirmed: true });
    expect([200, 201, 409]).toContain(response.status);
    expect(posts()).toHaveLength(0);
    expect(JSON.stringify(response.body)).toMatch(/conflict|stale|changed|failed/i);
  });

  it("applies only approved fields, verifies the result and never resends a completed proposal", async () => {
    settings.WORDPRESS_WRITES_ENABLED = true;
    const proposal = await preview();
    const first = await post(`${prefix}/proposals/${proposal.id}/apply`, { proposalHash: proposal.hash, confirmed: true });
    expect([200, 201]).toContain(first.status);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.[3]).toEqual({ title: "Approved title" });
    expect(JSON.stringify(first.body)).toMatch(/applied|verified/i);
    expect(first.text).not.toContain("private-wordpress");
    const repeated = await post(`${prefix}/proposals/${proposal.id}/apply`, { proposalHash: proposal.hash, confirmed: true });
    expect([200, 201, 409]).toContain(repeated.status);
    expect(posts()).toHaveLength(1);
  });

  it("does not let a rotated operator identity apply an earlier operator's proposal", async () => {
    settings.WORDPRESS_WRITES_ENABLED = true;
    const proposal = await preview();
    const newOperator = `${operator}-rotated`;
    settings.WORDPRESS_OPERATOR_KEY = newOperator;
    const denied = await post(`${prefix}/proposals/${proposal.id}/apply`, { proposalHash: proposal.hash, confirmed: true }, newOperator);
    expect([403, 404]).toContain(denied.status);
    expect(posts()).toHaveLength(0);
  });

  it("serializes distinct proposals targeting the same content while a write is in flight", async () => {
    settings.WORDPRESS_WRITES_ENABLED = true;
    const firstProposal = await preview({ title: "First reviewed change" });
    const secondProposal = await preview({ title: "Second reviewed change" });
    const original = transport.getMockImplementation()!;
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    transport.mockImplementation(async (...args) => {
      if (args[1] === "POST") { entered(); await blocked; }
      return original(...args);
    });
    const first = post(`${prefix}/proposals/${firstProposal.id}/apply`, { proposalHash: firstProposal.hash, confirmed: true }).then(response => response);
    await started;
    try {
      const second = await post(`${prefix}/proposals/${secondProposal.id}/apply`, { proposalHash: secondProposal.hash, confirmed: true }).expect(409);
      expect(second.body.error.code).toBe("WORDPRESS_TARGET_RESERVED");
      expect(posts()).toHaveLength(1);
    } finally { release(); }
    const result = await first;
    expect(result.status).toBe(201);
    expect(result.body.status).toBe("applied");
    expect(posts()).toHaveLength(1);
  });

  it("does not resend a write whose response was lost", async () => {
    settings.WORDPRESS_WRITES_ENABLED = true;
    const proposal = await preview();
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (...args) => {
      if (args[1] === "POST") throw new WordPressRequestError("WORDPRESS_TIMEOUT", "The WordPress request timed out.");
      return original(...args);
    });
    const first = await post(`${prefix}/proposals/${proposal.id}/apply`, { proposalHash: proposal.hash, confirmed: true });
    expect([200, 201, 409, 503]).toContain(first.status);
    expect(posts()).toHaveLength(1);
    const second = await post(`${prefix}/proposals/${proposal.id}/apply`, { proposalHash: proposal.hash, confirmed: true });
    expect([200, 201, 409, 503]).toContain(second.status);
    expect(posts()).toHaveLength(1);
    expect(JSON.stringify(second.body)).toMatch(/unknown|reconcil|unresolved/i);
    const newProposal = await preview({ title: "Another reviewed change" });
    const blocked = await post(`${prefix}/proposals/${newProposal.id}/apply`, { proposalHash: newProposal.hash, confirmed: true }).expect(409);
    expect(blocked.body.error.code).toBe("WORDPRESS_TARGET_RESERVED");
    expect(posts()).toHaveLength(1);
  });

  it("keeps the target reserved when a completed remote write cannot publish its durable outcome", async () => {
    settings.WORDPRESS_WRITES_ENABLED = true;
    const proposal = await preview();
    const store = app.get(WordPressActionsStore);
    const original = store.create.bind(store);
    const publication = jest.spyOn(store, "create").mockImplementation(async (id, kind, value) => {
      if (id === proposal.id && kind === "outcome") throw new ServiceUnavailableException("Fixture outcome publication failed.");
      return original(id, kind, value);
    });
    try {
      await post(`${prefix}/proposals/${proposal.id}/apply`, { proposalHash: proposal.hash, confirmed: true }).expect(503);
      expect(posts()).toHaveLength(1);
      const receipt = await get(`${prefix}/proposals/${proposal.id}`).expect(200);
      expect(receipt.body.executionStarted).toBe(true);
      expect(receipt.body.outcome).toBeNull();
      await post(`${prefix}/proposals/${proposal.id}/apply`, { proposalHash: proposal.hash, confirmed: true }).expect(409);
      const later = await preview({ title: "A later reviewed proposal" });
      const blocked = await post(`${prefix}/proposals/${later.id}/apply`, { proposalHash: later.hash, confirmed: true }).expect(409);
      expect(blocked.body.error.code).toBe("WORDPRESS_TARGET_RESERVED");
      expect(posts()).toHaveLength(1);
    } finally { publication.mockRestore(); }
  });

  it.each(["wrong-response-id", "remote-400"] as const)("treats a dispatched %s as uncertain and never repeats the write", async kind => {
    settings.WORDPRESS_WRITES_ENABLED = true;
    const proposal = await preview();
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (...args) => {
      if (args[1] === "POST") {
        if (kind === "wrong-response-id") return { id: 999 };
        throw new WordPressRequestError("WORDPRESS_HTTP_ERROR", "The remote request was rejected after dispatch.", 400);
      }
      return original(...args);
    });
    const first = await post(`${prefix}/proposals/${proposal.id}/apply`, { proposalHash: proposal.hash, confirmed: true }).expect(201);
    expect(first.body.status).toBe("outcome_unknown");
    expect(posts()).toHaveLength(1);
    const repeated = await post(`${prefix}/proposals/${proposal.id}/apply`, { proposalHash: proposal.hash, confirmed: true }).expect(201);
    expect(repeated.body).toEqual(first.body);
    expect(posts()).toHaveLength(1);
    const later = await preview({ title: "Later approved update" });
    await post(`${prefix}/proposals/${later.id}/apply`, { proposalHash: later.hash, confirmed: true }).expect(409);
    expect(posts()).toHaveLength(1);
  });

  it("does not replace Elementor-built content using a generic core content patch", async () => {
    remote.meta = { _elementor_edit_mode: "builder", _elementor_data: "[{\"id\":\"builder-layout\"}]" };
    const response = await post(`${prefix}/proposals`, { resource: "pages", resourceId: 7, changes: { content: "Generic replacement" } });
    expect([400, 409]).toContain(response.status);
    expect(posts()).toHaveLength(0);
  });

  it("reads real Rank Math metadata/stored scores without triggering the site's audit ability", async () => {
    rankMathFixture();
    const response = await get(`${prefix}/rank-math/evidence?resource=pages&id=7`).expect(200);
    expect(response.body.evidence.provider).toBe("rank-math");
    expect(response.body.evidence.plugin.edition).toBe("free");
    expect(response.body.evidence.content.storedSeoScore).toBe(0);
    expect(response.body.evidence.content.metadata.description).toBe("SEO description");
    expect(transport.mock.calls.some(call => call[2].includes("audit-site-seo/run"))).toBe(false);
    expect(posts()).toHaveLength(0);
    expect(response.text).not.toContain("private-wordpress");
  });

  it("gates audit triggers separately from evidence reads and never repeats a request ID", async () => {
    rankMathFixture();
    const requestId = randomUUID();
    await post(`${prefix}/rank-math/audits`, { requestId, confirmed: false }).expect(400);
    await post(`${prefix}/rank-math/audits`, { requestId, confirmed: true }).expect(403);
    expect(transport.mock.calls.some(call => call[2].includes("audit-site-seo/run"))).toBe(false);
    settings.WORDPRESS_WRITES_ENABLED = true;
    const response = await post(`${prefix}/rank-math/audits`, { requestId, confirmed: true }).expect(201);
    expect(response.body.result.provider).toBe("rank-math");
    expect(response.body.result.score).toBe(68);
    expect(response.body.status).toBe("success");
    expect(response.body.result.status).toBe("success");
    const calls = transport.mock.calls.length;
    const repeated = await post(`${prefix}/rank-math/audits`, { requestId, confirmed: true }).expect(201);
    expect(repeated.body).toEqual(response.body);
    expect(transport.mock.calls).toHaveLength(calls);
    expect(transport.mock.calls.filter(call => call[2].includes("audit-site-seo/run"))).toHaveLength(1);
    settings.WORDPRESS_WRITES_ENABLED = false;
    const saved = await get(`${prefix}/rank-math/audits/${requestId}`).expect(200);
    expect(saved.body.outcome).toEqual(response.body);
    expect(saved.body.status).toBe("success");
    expect(transport.mock.calls).toHaveLength(calls);
    const newOperator = `${operator}-rotated`;
    settings.WORDPRESS_OPERATOR_KEY = newOperator;
    await get(`${prefix}/rank-math/audits/${requestId}`, newOperator).expect(403);
    expect(transport.mock.calls).toHaveLength(calls);
  });

  it.each([
    ["WORDPRESS_TIMEOUT", undefined, "timeout"],
    ["WORDPRESS_HTTP_ERROR", 403, "failed"],
    ["WORDPRESS_HTTP_ERROR", 404, "unsupported"],
    ["WORDPRESS_REQUEST_FAILED", undefined, "unknown"],
  ] as const)("persists %s as %s / %s and does not repeat a failed execution", async (code, http, status) => {
    rankMathFixture();
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (...args) => {
      if (args[2].includes("audit-site-seo/run")) throw new WordPressRequestError(code, "private provider detail", http);
      return original(...args);
    });
    settings.WORDPRESS_WRITES_ENABLED = true;
    const requestId = randomUUID();
    const response = await post(`${prefix}/rank-math/audits`, { requestId, confirmed: true }).expect(201);
    expect(response.body.status).toBe(status);
    expect(response.body.result.status).toBe(status);
    const calls = transport.mock.calls.length;
    const replay = await post(`${prefix}/rank-math/audits`, { requestId, confirmed: true }).expect(201);
    expect(replay.body).toEqual(response.body);
    settings.WORDPRESS_WRITES_ENABLED = false;
    const receipt = await get(`${prefix}/rank-math/audits/${requestId}`).expect(200);
    expect(receipt.body.status).toBe(status);
    expect(transport.mock.calls).toHaveLength(calls);
    expect(receipt.text).not.toContain("private provider detail");
  });

  it("reads a legacy unavailable receipt as unknown without changing its archive or making remote calls", async () => {
    const store = app.get(WordPressActionsStore);
    const id = randomUUID();
    const original = { id, businessId, result: { version: "rank-math-audit-v1", availability: "unavailable", score: null, findings: [] } };
    await store.create(id, "started", { kind: "rankmath_audit", businessId, actor: operatorIdentity(operator) });
    await store.create(id, "outcome", original);
    const response = await get(`${prefix}/rank-math/audits/${id}`).expect(200);
    expect(response.body.status).toBe("unknown");
    expect(response.body.outcome.result.status).toBe("unknown");
    expect(await store.read(id, "outcome")).toEqual(original);
    expect(transport).not.toHaveBeenCalled();
  });
});
