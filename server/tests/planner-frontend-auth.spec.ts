import "reflect-metadata";
import { jest } from "@jest/globals";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { configureApp } from "../src/configure-app.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { WordPressService } from "../src/modules/wordpress/wordpress.service.js";
import { WordPressFixSessionController, WordPressFixSessions, WordPressFixSessionGuard } from "../src/modules/wordpress/wordpress-fix-session.js";
import { WordPressOperatorGuard, operatorIdentity } from "../src/modules/wordpress/wordpress.guard.js";
import { PlannerAiFrontendController } from "../src/modules/smart-planner/planner-ai.controller.js";
import { PlannerAiService } from "../src/modules/smart-planner/planner-ai.service.js";

test("frontend planning reuses the persistent cookie, exact business binding, CSRF and revocation", async () => {
  const operator = "offline-planner-operator-at-least-thirty-two-characters", businessId = "demo-guzman", siteUrl = "https://example.com/";
  const config = new ConfigService({ NODE_ENV: "test", DATABASE_PATH: ":memory:", WORDPRESS_OPERATOR_KEY: operator, WORDPRESS_FRONTEND_ORIGIN: "http://localhost:5173" });
  const generate = jest.fn(async () => ({ id: "saved-proposal" }));
  const module = await Test.createTestingModule({ controllers: [WordPressFixSessionController, PlannerAiFrontendController], providers: [WordPressFixSessions, WordPressFixSessionGuard, WordPressOperatorGuard,
    { provide: ConfigService, useValue: config }, { provide: AppDatabase, useValue: new AppDatabase(config) },
    { provide: WordPressService, useValue: { reportSite: async () => siteUrl } }, { provide: PlannerAiService, useValue: { generate } }] }).compile();
  const app = configureApp(module.createNestApplication()); app.useLogger(false); await app.init();
  const url = `/api/wordpress/businesses/${businessId}/smart-planner/ai-proposals`;
  const body = { expectedRevision: 0, mutationId: randomUUID(), mode: "live", weekStart: "2026-11-02" };
  const post = (path: string) => request(app.getHttpServer()).post(path).set("Host", "localhost:5173").set("Origin", "http://localhost:5173");
  try {
    await post(url).send(body).expect(401); expect(generate).not.toHaveBeenCalled();
    const ticket = await post("/api/wordpress/browser-tickets").set("Authorization", `Bearer ${operator}`).send({ businessId }).expect(201);
    const code = new URLSearchParams(new URL(ticket.body.url).hash.slice(1)).get("wordpress-session");
    const session = await post("/api/wordpress/browser-session").send({ code }).expect(201);
    const cookie = String(session.headers["set-cookie"][0]).split(";")[0], csrf = session.body.csrf as string;
    expect(String(session.headers["set-cookie"][0])).toContain("Path=/api/wordpress");
    await post(url).set("Cookie", cookie).send(body).expect(403);
    await post(url.replace(businessId, "other-business")).set("Cookie", cookie).set("x-wordpress-csrf", csrf).send(body).expect(401);
    await post(url).set("Cookie", cookie).set("x-wordpress-csrf", csrf).send(body).expect(201);
    expect(generate).toHaveBeenCalledWith(businessId, body, { actor: operatorIdentity(operator), businessId, siteUrl });
    expect(generate).toHaveBeenCalledTimes(1);
    await post("/api/wordpress/browser-session/revoke").set("Cookie", cookie).set("x-wordpress-csrf", csrf).send({}).expect(201);
    await post(url).set("Cookie", cookie).set("x-wordpress-csrf", csrf).send(body).expect(401);
    expect(generate).toHaveBeenCalledTimes(1);
  } finally { await app.close(); }
});
