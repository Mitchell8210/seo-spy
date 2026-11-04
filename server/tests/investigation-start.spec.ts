import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { jest } from "@jest/globals";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { InvestigationStartModule } from "../src/modules/investigation-ai/investigation-start.module.js";
import { AuditsService } from "../src/modules/audits/audits.service.js";
import { FacebookReportsService } from "../src/modules/facebook/facebook-reports.service.js";
import { OverallInvestigationService } from "../src/modules/facebook/overall-investigation.service.js";
import { configureApp } from "../src/configure-app.js";
import { MetaMuseTransport } from "../src/integrations/ai/meta-muse.provider.js";
import { FacebookCredentialsStore } from "../src/modules/facebook/facebook-credentials.store.js";

const businessId = "demo-guzman", origin = "http://localhost:5173", operator = "offline-operator-key-for-report-tests-123456";
describe("Authenticated report starts with the existing browser session and CSRF proof", () => {
  let app: INestApplication, directory: string, cookie: string, csrf: string;
  const website = jest.fn<AuditsService["create"]>(), social = jest.fn<FacebookReportsService["create"]>(), overall = jest.fn<OverallInvestigationService["start"]>();
  const model = jest.fn<MetaMuseTransport["post"]>();
  const prefix = `/api/wordpress/businesses/${businessId}/investigations`;
  const start = (kind: string, body: object = { confirmed: true }) => request(app.getHttpServer()).post(`${prefix}/${kind}`).set("Host", "localhost:5173").set("Origin", origin)
    .set("Cookie", cookie).set("x-wordpress-csrf", csrf).send(body);
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-report-start-"));
    website.mockReset(); social.mockReset(); overall.mockReset(); model.mockReset();
    const settings = { NODE_ENV: "test", DATABASE_PATH: ":memory:", AI_USAGE_DB: join(directory, "ai.sqlite"), WORDPRESS_BUSINESS_ID: businessId, WORDPRESS_SITE_URL: "https://guzmantaxaccounting.com/",
      FACEBOOK_REDIRECT_URI: "http://localhost:3001/api/facebook/callback", FACEBOOK_FRONTEND_ORIGIN: origin, FACEBOOK_GRAPH_VERSION: "v26.0",
      WORDPRESS_OPERATOR_KEY: operator, WORDPRESS_FRONTEND_ORIGIN: origin, WORDPRESS_ACTIONS_DIR: join(directory, "actions"), WORDPRESS_REPORTS_DIR: join(directory, "reports"), WORDPRESS_MUSE_DIR: join(directory, "muse"), REPORTS_DIR: join(directory, "audits") };
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), InvestigationStartModule] })
      .overrideProvider(ConfigService).useValue(new ConfigService(settings))
      .overrideProvider(AuditsService).useValue({ create: website })
      .overrideProvider(FacebookReportsService).useValue({ create: social })
      .overrideProvider(OverallInvestigationService).useValue({ start: overall, status: async () => ({ businessId, active: null, latest: null }) })
      .overrideProvider(FacebookCredentialsStore).useValue({ read: async (id: string) => id === "b".repeat(64) ? { token: "offline-facebook-token", createdAt: new Date().toISOString(), expiresAt: Date.now() + 60000 } : null })
      .overrideProvider(MetaMuseTransport).useValue({ post: model }).compile();
    app = configureApp(module.createNestApplication());
    app.getHttpAdapter().get("/api/facebook/fixture-session", (_req, res) => {
      res.setHeader("Set-Cookie", [`${cookie}; Path=/api/wordpress; HttpOnly; SameSite=Lax`, `seo_spy_facebook_test=${"b".repeat(64)}; Path=/api/facebook; HttpOnly; SameSite=Lax`]);
      res.status(204).end();
    });
    await app.init();
    const ticket = await request(app.getHttpServer()).post("/api/wordpress/browser-tickets").set("Host", "localhost:3001").set("Authorization", `Bearer ${operator}`).send({ businessId }).expect(201);
    const code = new URLSearchParams(new URL(ticket.body.url).hash.slice(1)).get("wordpress-session");
    const session = await request(app.getHttpServer()).post("/api/wordpress/browser-session").set("Host", "localhost:5173").set("Origin", origin).send({ code }).expect(201);
    cookie = String(session.headers["set-cookie"][0]).split(";")[0]; csrf = session.body.csrf;
  });
  afterEach(async () => {
    await app.close(); expect(model).not.toHaveBeenCalled();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-report-start-")) throw new Error("Unexpected fixture cleanup path");
    await rm(target, { recursive: true, force: true });
  });
  it("passes a server-derived business/actor context to all three workflows", async () => {
    await start("website").expect(202);
    await start("social", { confirmed: true, pageId: "123" }).set("Cookie", `${cookie}; seo_spy_facebook_test=${"b".repeat(64)}`).expect(202);
    await start("overall").expect(202);
    const scope = expect.objectContaining({ businessId, siteUrl: "https://guzmantaxaccounting.com/", actor: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(website).toHaveBeenCalledWith(businessId, "lighthouse", "mobile", scope);
    expect(social).toHaveBeenCalledWith("b".repeat(64), businessId, "123", scope);
    expect(overall).toHaveBeenCalledWith(undefined, businessId, scope);
  });
  it("hands an existing path-scoped Facebook login to AI report starts without reauthentication", async () => {
    // Use an actual cookie jar: manually attaching a Cookie header hides path bugs.
    const browser = request.agent(app.getHttpServer());
    await browser.get("/api/facebook/fixture-session").expect(204);
    const status = await browser.get(`/api/facebook/investigations/status?businessId=${businessId}`).set("Host", "localhost:5173").expect(200);
    expect(status.headers["set-cookie"]).toEqual(expect.arrayContaining([expect.stringMatching(/seo_spy_facebook_test=b+;.*Path=\/api\/wordpress;.*HttpOnly;.*SameSite=Lax/)]));
    expect(status.text).not.toContain("offline-facebook-token");
    await browser.post(`${prefix}/overall`).set("Host", "localhost:5173").set("Origin", origin).set("x-wordpress-csrf", csrf).send({ confirmed: true }).expect(202);
    expect(overall).toHaveBeenCalledWith("b".repeat(64), businessId, expect.objectContaining({ businessId }));
  });
  it.each(["cookie", "csrf", "origin", "host", "business", "unconfirmed", "target"])("rejects an invalid %s before report or model work", async fault => {
    let call = start(fault === "target" ? "unknown" : "website", { confirmed: fault !== "unconfirmed" });
    if (fault === "cookie") call = call.set("Cookie", "");
    if (fault === "csrf") call = call.set("x-wordpress-csrf", "invalid");
    if (fault === "origin") call = call.set("Origin", "https://external.example");
    if (fault === "host") call = call.set("Host", "external.example");
    if (fault === "business") call = request(app.getHttpServer()).post("/api/wordpress/businesses/foreign/investigations/website").set("Host", "localhost:5173").set("Origin", origin).set("Cookie", cookie).set("x-wordpress-csrf", csrf).send({ confirmed: true });
    const response = await call; expect([400, 401, 403]).toContain(response.status);
    expect(website).not.toHaveBeenCalled(); expect(social).not.toHaveBeenCalled(); expect(overall).not.toHaveBeenCalled();
  });
  it("saved reads never start collection or interpretation", async () => {
    await request(app.getHttpServer()).get(`/api/wordpress/local/businesses/${businessId}/investigation-interpretation?reportIds=${randomUUID()}`).set("Host", "localhost:5173").expect(200, { businessId, interpretation: null });
    expect(website).not.toHaveBeenCalled(); expect(social).not.toHaveBeenCalled(); expect(overall).not.toHaveBeenCalled();
  });
});
