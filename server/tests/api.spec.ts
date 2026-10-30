import "reflect-metadata";
import { jest } from "@jest/globals";
import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";
import {
  AUDIT_REPOSITORY,
  type AuditRepository,
} from "../src/persistence/repositories.js";
import type {
  Audit,
  Finding,
  Evidence,
  Recommendation,
} from "../src/contracts/domain.js";
import {
  CollectionError,
  WebsiteCollector,
} from "../src/integrations/website/collector.js";
import { buildHomepageReport } from "../src/reporting/homepage-report.js";
import { PageSpeedService } from "../src/integrations/lighthouse/pagespeed.service.js";
import { normalizeLighthouse } from "../src/integrations/lighthouse/normalize.js";
import { PageSpeedError } from "../src/integrations/lighthouse/types.js";
import { pageSpeedFixture } from "./fixtures/pagespeed.js";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { FileReportStore } from "../src/reports/file-report.store.js";
import { ReportStorageError } from "../src/reports/report.types.js";

describe("demo API", () => {
  let app: INestApplication;
  let reportsDir: string;

  async function createApp() {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FileReportStore)
      .useValue(
        new FileReportStore(new ConfigService({ REPORTS_DIR: reportsDir })),
      )
      .compile();
    app = configureApp(module.createNestApplication());
    app.useLogger(false);
    await app.init();
  }

  async function waitForAudit(id: string) {
    for (let attempt = 0; attempt < 250; attempt++) {
      const response = await request(app.getHttpServer())
        .get(`/api/audits/${id}`)
        .expect(200);
      if (["completed", "partial", "failed"].includes(response.body.status))
        return response.body;
      await delay(20);
    }
    throw new Error("Audit did not reach a terminal state");
  }

  beforeEach(async () => {
    reportsDir = await mkdtemp(join(tmpdir(), "seo-spy-api-reports-"));
    await createApp();
  });

  afterEach(async () => {
    await app.close();
    const target = resolve(reportsDir);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("seo-spy-api-reports-")
    )
      throw new Error("Refusing to remove an unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });

  it("serves Swagger UI, assets, and complete OpenAPI contracts for implemented endpoints", async () => {
    const ui = await request(app.getHttpServer()).get("/api/docs/").expect(200);
    expect(ui.text).toContain("swagger-ui");
    expect(ui.headers["content-security-policy"]).not.toContain(
      "upgrade-insecure-requests",
    );
    await request(app.getHttpServer())
      .get("/api/docs/swagger-ui-bundle.js")
      .expect(200);
    const init = await request(app.getHttpServer())
      .get("/api/docs/swagger-ui-init.js")
      .expect(200);
    expect(init.text).toContain("SEO Spy API");
    const spec = await request(app.getHttpServer())
      .get("/api/docs-json")
      .expect(200);
    expect(Object.keys(spec.body.paths).sort()).toEqual(
      [
        "/api/health",
        "/api/businesses/{businessId}/dashboard",
        "/api/businesses/{businessId}/audits",
        "/api/audits/{auditId}",
        "/api/audits/{auditId}/findings",
        "/api/audits/{auditId}/recommendations",
        "/api/audits/{auditId}/lighthouse",
        "/api/businesses/{businessId}/reports",
        "/api/audits/{auditId}/report",
        "/api/facebook",
        "/api/facebook/status",
        "/api/facebook/connect",
        "/api/facebook/test-token",
        "/api/facebook/callback",
        "/api/facebook/connection",
        "/api/facebook/disconnect",
        "/api/facebook/reports",
        "/api/businesses/{businessId}/facebook-report",
      ].sort(),
    );
    const create = spec.body.paths["/api/businesses/{businessId}/audits"].post;
    expect(
      create.responses["202"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/CreatedAuditDto");
    expect(
      create.responses["409"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/ApiErrorDto");
    expect(create.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/CreateAuditDto",
    );
    const schemas = spec.body.components.schemas;
    expect(schemas.CreateAuditDto.properties.scope.enum).toEqual([
      "demo",
      "homepage",
      "lighthouse",
    ]);
    expect(schemas.CreateAuditDto.properties.strategy.enum).toEqual([
      "mobile",
      "desktop",
    ]);
    expect(schemas.LighthouseResponseDto.properties.report.nullable).toBe(true);
    expect(schemas.LighthouseReportDto.properties.provider.enum).toEqual([
      "google-pagespeed-insights",
    ]);
    expect(schemas.AuditReportDto.properties.schemaVersion.enum).toEqual([
      "seo-spy.audit-report.v1",
    ]);
    expect(JSON.stringify(schemas.AuditSummaryDto.properties.report)).toContain(
      "ReportFileReferenceDto",
    );
    expect(schemas.DashboardDto.properties.lighthouse.nullable).toBe(true);
    expect(schemas.CreateAuditDto.required).toContain("scope");
    expect(schemas.DashboardDto.properties.business.$ref).toContain(
      "BusinessDto",
    );
    expect(
      schemas.FindingsResponseDto.properties.evidence.items.$ref,
    ).toContain("EvidenceDto");
    expect(schemas.ScoreDto.properties.value.nullable).toBe(true);
    expect(schemas.AuditSummaryDto.properties.startedAt.nullable).toBe(true);
    expect(schemas.AuditSummaryDto.properties.status.enum).toContain("running");
  });

  it("serves health, headers and an explicitly simulated seeded dashboard", async () => {
    const health = await request(app.getHttpServer())
      .get("/api/health")
      .expect(200);
    expect(health.body).toMatchObject({ status: "ok", mode: "demo" });
    expect(health.headers["x-request-id"]).toEqual(expect.any(String));
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    const dashboard = await request(app.getHttpServer())
      .get("/api/businesses/demo-guzman/dashboard")
      .expect(200);
    expect(dashboard.body).toMatchObject({
      mode: "demo",
      business: { id: "demo-guzman" },
      activeAudit: null,
      priorityOpportunities: 3,
    });
    expect(dashboard.body.notice).toContain("No website scan");
    expect(dashboard.body.latestAudit.status).toBe("completed");
    expect(
      dashboard.body.scores.every(
        (score: { availability: string }) => score.availability === "demo",
      ),
    ).toBe(true);
  });

  it.each([
    {},
    { scope: "website" },
    { scope: "demo", target: "https://example.com" },
    { scope: null },
  ])("rejects invalid audit requests %j", async (body) => {
    const response = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send(body)
      .expect(400);
    expect(response.body.error).toMatchObject({
      code: "INVALID_REQUEST",
      requestId: response.headers["x-request-id"],
    });
  });

  it("returns consistent errors for malformed identifiers, missing resources and routes", async () => {
    await request(app.getHttpServer())
      .get("/api/audits/not-a-uuid")
      .expect(400);
    const missing = await request(app.getHttpServer())
      .get(`/api/audits/${randomUUID()}`)
      .expect(404);
    expect(missing.body.error.code).toBe("AUDIT_NOT_FOUND");
    await request(app.getHttpServer())
      .get("/api/businesses/missing/dashboard")
      .expect(404);
    await request(app.getHttpServer())
      .post("/api/businesses/missing/audits")
      .send({ scope: "demo" })
      .expect(404);
    const route = await request(app.getHttpServer())
      .get("/api/unknown")
      .expect(404);
    expect(route.body.error).toMatchObject({
      code: "NOT_FOUND",
      requestId: expect.any(String),
    });
  });

  it("runs an audit, rejects concurrent duplicates and preserves evidence and history", async () => {
    const previous = await request(app.getHttpServer()).get(
      "/api/businesses/demo-guzman/dashboard",
    );
    const submissions = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post("/api/businesses/demo-guzman/audits")
          .send({ scope: "demo" }),
      ),
    );
    expect(submissions.map((response) => response.status).sort()).toEqual([
      202, 409,
    ]);
    const created = submissions.find((response) => response.status === 202)!;
    const id = created.body.id as string;
    expect(created.body).toMatchObject({
      status: "queued",
      mode: "demo",
      statusUrl: `/api/audits/${id}`,
    });
    const pending = await request(app.getHttpServer())
      .get(`/api/audits/${id}/findings`)
      .expect(200);
    expect(pending.body.findings).toEqual([]);
    const during = await request(app.getHttpServer()).get(
      "/api/businesses/demo-guzman/dashboard",
    );
    expect(during.body.latestAudit.id).toBe(previous.body.latestAudit.id);
    expect(during.body.activeAudit.id).toBe(id);
    const states = new Set<string>();
    let completed = false;
    for (let attempt = 0; attempt < 250; attempt++) {
      const status = await request(app.getHttpServer())
        .get(`/api/audits/${id}`)
        .expect(200);
      states.add(status.body.status);
      if (status.body.status === "completed") {
        completed = true;
        break;
      }
      await delay(20);
    }
    expect(completed).toBe(true);
    expect(states.has("running")).toBe(true);
    const findings = await request(app.getHttpServer())
      .get(`/api/audits/${id}/findings`)
      .expect(200);
    const recommendations = await request(app.getHttpServer())
      .get(`/api/audits/${id}/recommendations`)
      .expect(200);
    const evidenceIds = new Set(
      findings.body.evidence.map((item: Evidence) => item.id),
    );
    const findingIds = new Set(
      findings.body.findings.map((item: Finding) => item.id),
    );
    expect(findings.body.findings).toHaveLength(3);
    findings.body.findings.forEach((finding: Finding) => {
      expect(finding.auditId).toBe(id);
      finding.evidenceIds.forEach((evidenceId) =>
        expect(evidenceIds.has(evidenceId)).toBe(true),
      );
    });
    recommendations.body.recommendations.forEach((item: Recommendation) =>
      expect(findingIds.has(item.findingId)).toBe(true),
    );
    const after = await request(app.getHttpServer()).get(
      "/api/businesses/demo-guzman/dashboard",
    );
    expect(after.body.latestAudit.id).toBe(id);
    expect(after.body.activeAudit).toBeNull();
    await request(app.getHttpServer())
      .get(`/api/audits/${previous.body.latestAudit.id}/findings`)
      .expect(200);
    await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "demo" })
      .expect(202);
  }, 10000);

  it("closes pending jobs without leaving timers or active work", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "demo" })
      .expect(202);
    const repository = app.get<AuditRepository>(AUDIT_REPOSITORY);
    await app.close();
    const audit = await repository.findById(created.body.id as string);
    expect(audit).toMatchObject({
      status: "failed",
      failure: { code: "SERVER_STOPPING" },
    });
  });

  it("does not expose internal exception details", async () => {
    const repository = app.get<AuditRepository>(AUDIT_REPOSITORY);
    jest
      .spyOn(repository, "findById")
      .mockRejectedValueOnce(new Error("private-provider-secret"));
    const response = await request(app.getHttpServer())
      .get(`/api/audits/${randomUUID()}`)
      .expect(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toContain(
      "private-provider-secret",
    );
  });

  it("runs a real homepage audit through HTTP with live evidence and unavailable scores", async () => {
    let finish!: (
      value: Awaited<ReturnType<WebsiteCollector["collect"]>>,
    ) => void;
    const collect = jest
      .spyOn(app.get(WebsiteCollector), "collect")
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const created = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "homepage" })
      .expect(202);
    expect(created.body).toMatchObject({
      mode: "live",
      scope: "homepage",
      scoringVersion: "homepage-v1",
    });
    await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "demo" })
      .expect(409);
    expect(collect.mock.calls[0]?.[0]).toBe("https://guzmantaxaccounting.com");
    const pending = await request(app.getHttpServer())
      .get(created.body.statusUrl as string)
      .expect(200);
    expect(pending.body).toMatchObject({
      status: "running",
      stage: "collecting_evidence",
    });
    const body = Buffer.from(
      '<meta charset="utf-8"><title>Español</title><h1>Taxes</h1><img src="team.jpg" alt="">',
    );
    finish({
      requestedUrl: "https://guzmantaxaccounting.com/",
      finalUrl: "https://www.guzmantaxaccounting.com/",
      status: 200,
      contentType: "text/html; charset=UTF-8",
      collectedAt: new Date().toISOString(),
      bytes: body.length,
      redirects: ["https://www.guzmantaxaccounting.com/"],
      robots: "",
      body,
    });
    await waitForAudit(created.body.id as string);
    const findings = await request(app.getHttpServer())
      .get(`/api/audits/${created.body.id}/findings`)
      .expect(200);
    expect(findings.body).toMatchObject({ mode: "live", status: "completed" });
    expect(
      findings.body.evidence.every(
        (e: Evidence) => e.mode === "live" && e.auditId === created.body.id,
      ),
    ).toBe(true);
    expect(
      findings.body.evidence.find((e: Evidence) => e.checkId === "page-title")
        .observed.values,
    ).toContain("Español");
    const recommendations = await request(app.getHttpServer())
      .get(`/api/audits/${created.body.id}/recommendations`)
      .expect(200);
    expect(recommendations.body.recommendations.length).toBe(
      findings.body.findings.length,
    );
    const dashboard = await request(app.getHttpServer())
      .get("/api/businesses/demo-guzman/dashboard")
      .expect(200);
    expect(dashboard.body.mode).toBe("live");
    expect(dashboard.body.notice).toContain("Homepage HTML");
    expect(
      dashboard.body.scores.every(
        (s: { value: unknown; availability: string }) =>
          s.value === null && s.availability === "unavailable",
      ),
    ).toBe(true);
    expect(dashboard.body.activeAudit).toBeNull();
    const status = await request(app.getHttpServer())
      .get(created.body.statusUrl as string)
      .expect(200);
    const report = buildHomepageReport(
      status.body,
      findings.body,
      recommendations.body,
      dashboard.body,
    );
    expect(report.scores).toHaveLength(4);
    expect(
      report.scores.every(
        (score) => score.value === null && score.availability === "unavailable",
      ),
    ).toBe(true);
  });

  it("exposes safe collection failure codes and preserves the previous completed audit", async () => {
    jest
      .spyOn(app.get(WebsiteCollector), "collect")
      .mockRejectedValue(
        new CollectionError(
          "COLLECTION_TIMEOUT",
          "Homepage collection exceeded 30 seconds.",
        ),
      );
    const previous = await request(app.getHttpServer()).get(
      "/api/businesses/demo-guzman/dashboard",
    );
    const created = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "homepage" })
      .expect(202);
    await waitForAudit(created.body.id as string);
    const status = await request(app.getHttpServer())
      .get(created.body.statusUrl as string)
      .expect(200);
    expect(status.body).toMatchObject({
      status: "failed",
      failure: { code: "COLLECTION_TIMEOUT" },
    });
    const dashboard = await request(app.getHttpServer()).get(
      "/api/businesses/demo-guzman/dashboard",
    );
    expect(dashboard.body.latestAudit.id).toBe(previous.body.latestAudit.id);
    expect(dashboard.body.activeAudit).toBeNull();
    const findings = await request(app.getHttpServer())
      .get(`/api/audits/${created.body.id}/findings`)
      .expect(200);
    const recommendations = await request(app.getHttpServer())
      .get(`/api/audits/${created.body.id}/recommendations`)
      .expect(200);
    expect(
      dashboard.body.scores.some(
        (score: { availability: string }) => score.availability === "demo",
      ),
    ).toBe(true);
    const report = buildHomepageReport(
      status.body,
      findings.body,
      recommendations.body,
      dashboard.body,
    );
    expect(report).toMatchObject({
      mode: "live",
      audit: { status: "failed" },
      scores: [],
    });
    expect(
      buildHomepageReport(status.body, findings.body, recommendations.body, {
        ...dashboard.body,
        latestAudit: null,
      }).scores,
    ).toEqual([]);
  });

  it("interrupts live collection on shutdown and marks the audit failed", async () => {
    jest.spyOn(app.get(WebsiteCollector), "collect").mockImplementation(
      (_url, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener(
            "abort",
            () =>
              reject(
                new CollectionError(
                  "SERVER_STOPPING",
                  "Collection interrupted.",
                ),
              ),
            { once: true },
          );
        }),
    );
    const created = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "homepage" })
      .expect(202);
    const repository = app.get<AuditRepository>(AUDIT_REPOSITORY);
    await app.close();
    expect(await repository.findById(created.body.id as string)).toMatchObject({
      status: "failed",
      failure: { code: "SERVER_STOPPING" },
    });
  });

  function mockHomepage() {
    const body = Buffer.from(
      '<meta charset="utf-8"><title>Taxes</title><h1>Taxes</h1>',
    );
    jest.spyOn(app.get(WebsiteCollector), "collect").mockResolvedValue({
      requestedUrl: "https://guzmantaxaccounting.com/",
      finalUrl: "https://www.guzmantaxaccounting.com/",
      status: 200,
      contentType: "text/html; charset=UTF-8",
      collectedAt: new Date().toISOString(),
      bytes: body.length,
      redirects: ["https://www.guzmantaxaccounting.com/"],
      robots: "",
      body,
    });
  }

  it.each(["mobile", "desktop"] as const)(
    "runs a %s Lighthouse audit with measured results, provenance, and linked evidence",
    async (strategy) => {
      mockHomepage();
      const fixture = pageSpeedFixture();
      fixture.lighthouseResult.configSettings.formFactor = strategy;
      const report = normalizeLighthouse(
        fixture,
        "https://www.guzmantaxaccounting.com/",
        strategy,
      );
      let finish!: (value: typeof report) => void;
      const run = jest
        .spyOn(app.get(PageSpeedService), "run")
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        );
      const created = await request(app.getHttpServer())
        .post("/api/businesses/demo-guzman/audits")
        .send({ scope: "lighthouse", strategy })
        .expect(202);
      expect(created.body).toMatchObject({
        scope: "lighthouse",
        strategy,
        mode: "live",
        scoringVersion: "lighthouse-v1",
      });
      const pending = await request(app.getHttpServer())
        .get(created.body.statusUrl as string)
        .expect(200);
      expect(pending.body).toMatchObject({
        stage: "running_lighthouse",
        status: "running",
      });
      await request(app.getHttpServer())
        .post("/api/businesses/demo-guzman/audits")
        .send({ scope: "homepage" })
        .expect(409);
      expect(run.mock.calls[0]?.slice(0, 2)).toEqual([
        "https://www.guzmantaxaccounting.com/",
        strategy,
      ]);
      const unavailable = await request(app.getHttpServer())
        .get(`/api/audits/${created.body.id}/lighthouse`)
        .expect(200);
      expect(unavailable.body.report).toBeNull();
      finish(report);
      await waitForAudit(created.body.id as string);
      const measured = await request(app.getHttpServer())
        .get(`/api/audits/${created.body.id}/lighthouse`)
        .expect(200);
      expect(measured.body).toMatchObject({
        status: "completed",
        failure: null,
        report: { provider: "google-pagespeed-insights", strategy },
      });
      const findings = await request(app.getHttpServer())
        .get(`/api/audits/${created.body.id}/findings`)
        .expect(200);
      const evidenceIds = new Set(
        findings.body.evidence.map((e: Evidence) => e.id),
      );
      findings.body.findings.forEach((finding: Finding) =>
        finding.evidenceIds.forEach((id) =>
          expect(evidenceIds.has(id)).toBe(true),
        ),
      );
      expect(
        findings.body.findings.some(
          (finding: Finding) => finding.checkId === "lighthouse:image-alt",
        ),
      ).toBe(true);
      const dashboard = await request(app.getHttpServer())
        .get("/api/businesses/demo-guzman/dashboard")
        .expect(200);
      expect(
        dashboard.body.lighthouse.categories.map(
          (category: { score: number }) => category.score,
        ),
      ).toEqual([72, 91, 100, 0]);
      expect(
        dashboard.body.scores.every(
          (score: { value: number | null }) => score.value === null,
        ),
      ).toBe(true);
      expect(dashboard.body.notice).toContain("Lighthouse lab");
      const status = await request(app.getHttpServer())
        .get(created.body.statusUrl as string)
        .expect(200);
      const recommendations = await request(app.getHttpServer())
        .get(`/api/audits/${created.body.id}/recommendations`)
        .expect(200);
      const snapshot = buildHomepageReport(
        status.body,
        findings.body,
        recommendations.body,
        dashboard.body,
        measured.body,
      );
      expect(snapshot.lighthouse).toEqual(measured.body.report);
      expect(
        buildHomepageReport(
          status.body,
          findings.body,
          recommendations.body,
          dashboard.body,
          { ...measured.body, auditId: "different-audit" },
        ),
      ).not.toHaveProperty("lighthouse");
    },
  );

  it("preserves HTML findings as partial results when PageSpeed quota is exhausted", async () => {
    mockHomepage();
    const run = jest
      .spyOn(app.get(PageSpeedService), "run")
      .mockRejectedValue(
        new PageSpeedError(
          "PAGESPEED_QUOTA_EXCEEDED",
          "PageSpeed quota exhausted.",
        ),
      );
    const created = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "lighthouse" })
      .expect(202);
    expect(created.body.strategy).toBe("mobile");
    expect(run.mock.calls[0]?.[1]).toBe("mobile");
    await waitForAudit(created.body.id as string);
    const measured = await request(app.getHttpServer())
      .get(`/api/audits/${created.body.id}/lighthouse`)
      .expect(200);
    expect(measured.body).toMatchObject({
      status: "partial",
      report: null,
      failure: { code: "PAGESPEED_QUOTA_EXCEEDED" },
    });
    const findings = await request(app.getHttpServer())
      .get(`/api/audits/${created.body.id}/findings`)
      .expect(200);
    expect(findings.body.findings.length).toBeGreaterThan(0);
    const dashboard = await request(app.getHttpServer())
      .get("/api/businesses/demo-guzman/dashboard")
      .expect(200);
    expect(dashboard.body.latestAudit.id).toBe(created.body.id);
    expect(dashboard.body.lighthouse).toBeNull();
    expect(
      dashboard.body.scores.every(
        (score: { value: number | null }) => score.value === null,
      ),
    ).toBe(true);
  });

  it("marks missing category scores as partial without discarding measured categories", async () => {
    mockHomepage();
    const fixture = pageSpeedFixture();
    const report = normalizeLighthouse(
      {
        lighthouseResult: {
          ...fixture.lighthouseResult,
          categories: {
            performance: fixture.lighthouseResult.categories.performance,
          },
        },
      },
      "https://www.guzmantaxaccounting.com/",
      "mobile",
    );
    jest.spyOn(app.get(PageSpeedService), "run").mockResolvedValue(report);
    const created = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "lighthouse" })
      .expect(202);
    await waitForAudit(created.body.id as string);
    const measured = await request(app.getHttpServer())
      .get(`/api/audits/${created.body.id}/lighthouse`)
      .expect(200);
    expect(measured.body).toMatchObject({
      status: "partial",
      failure: { code: "LIGHTHOUSE_INCOMPLETE" },
    });
    expect(measured.body.report.categories[0].score).toBe(72);
    expect(measured.body.report.categories[1].score).toBeNull();
  });

  it("stops before PageSpeed when protected HTML collection rejects the target", async () => {
    jest
      .spyOn(app.get(WebsiteCollector), "collect")
      .mockRejectedValue(
        new CollectionError("BLOCKED_DESTINATION", "Blocked destination."),
      );
    const run = jest.spyOn(app.get(PageSpeedService), "run");
    const created = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "lighthouse" })
      .expect(202);
    await waitForAudit(created.body.id as string);
    const measured = await request(app.getHttpServer())
      .get(`/api/audits/${created.body.id}/lighthouse`)
      .expect(200);
    expect(measured.body).toMatchObject({
      status: "failed",
      failure: { code: "BLOCKED_DESTINATION" },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    { scope: "lighthouse", strategy: "tablet" },
    { scope: "lighthouse", strategy: null },
    { scope: "homepage", strategy: "mobile" },
    { scope: "demo", strategy: "desktop" },
  ])("rejects unsupported strategy requests %j", async (body) => {
    await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send(body)
      .expect(400);
  });

  it("aborts Lighthouse during shutdown", async () => {
    mockHomepage();
    jest.spyOn(app.get(PageSpeedService), "run").mockImplementation(
      (_target, _strategy, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener(
            "abort",
            () => reject(new PageSpeedError("SERVER_STOPPING", "Interrupted.")),
            { once: true },
          );
        }),
    );
    const created = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "lighthouse" })
      .expect(202);
    await app.close();
    expect(
      await app
        .get<AuditRepository>(AUDIT_REPOSITORY)
        .findById(created.body.id as string),
    ).toMatchObject({ status: "failed", failure: { code: "SERVER_STOPPING" } });
  });

  it("automatically archives distinct reports and serves date-sorted history and downloads after restart", async () => {
    mockHomepage();
    const first = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "homepage" })
      .expect(202);
    const firstStatus = await waitForAudit(first.body.id as string);
    const second = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "homepage" })
      .expect(202);
    const secondStatus = await waitForAudit(second.body.id as string);
    expect(firstStatus.status).toBe("completed");
    expect(firstStatus.report.reportId).toBe(first.body.id);
    expect(firstStatus.report.fileName).not.toBe(secondStatus.report.fileName);
    const file = JSON.parse(
      await readFile(
        join(reportsDir, firstStatus.report.fileName as string),
        "utf8",
      ),
    ) as {
      schemaVersion: string;
      auditId: string;
      results: { evidence: Evidence[] };
    };
    expect(file).toMatchObject({
      schemaVersion: "seo-spy.audit-report.v1",
      auditId: first.body.id,
    });
    expect(file.results.evidence.length).toBeGreaterThan(0);
    expect(
      (await readdir(reportsDir)).filter((name) => name.endsWith(".json")),
    ).toHaveLength(2);
    await app.close();
    await createApp();
    const history = await request(app.getHttpServer())
      .get("/api/businesses/demo-guzman/reports")
      .expect(200);
    expect(
      new Set(history.body.reports.map((r: { auditId: string }) => r.auditId)),
    ).toEqual(new Set([first.body.id, second.body.id]));
    const dates = history.body.reports.map(
      (r: { generatedAt: string }) => r.generatedAt,
    ) as string[];
    expect(dates).toEqual([...dates].sort().reverse());
    const download = await request(app.getHttpServer())
      .get(firstStatus.report.downloadUrl as string)
      .expect(200);
    expect(download.headers["content-disposition"]).toContain(
      firstStatus.report.fileName,
    );
    expect(download.body).toMatchObject({
      auditId: first.body.id,
      reportId: first.body.id,
      generatedAt: firstStatus.report.generatedAt,
    });
    const oldAudit = await request(app.getHttpServer())
      .get(first.body.statusUrl as string)
      .expect(200);
    expect(oldAudit.body).toMatchObject({
      status: "completed",
      report: firstStatus.report,
    });
    const oldFindings = await request(app.getHttpServer())
      .get(`/api/audits/${first.body.id}/findings`)
      .expect(200);
    expect(oldFindings.body.evidence).toEqual(file.results.evidence);
  });

  it("archives partial reports and failed-run records without fabricating measurements", async () => {
    mockHomepage();
    jest
      .spyOn(app.get(PageSpeedService), "run")
      .mockRejectedValue(
        new PageSpeedError(
          "PAGESPEED_QUOTA_EXCEEDED",
          "PageSpeed quota exhausted.",
        ),
      );
    const partial = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "lighthouse" })
      .expect(202);
    const partialStatus = await waitForAudit(partial.body.id as string);
    const partialReport = await request(app.getHttpServer())
      .get(partialStatus.report.downloadUrl as string)
      .expect(200);
    expect(partialReport.body.audit.status).toBe("partial");
    expect(partialReport.body.results.evidence.length).toBeGreaterThan(0);
    expect(partialReport.body.results.lighthouse).toBeUndefined();
    jest
      .mocked(app.get(WebsiteCollector).collect)
      .mockRejectedValueOnce(
        new CollectionError("BLOCKED_DESTINATION", "Blocked destination."),
      );
    const failed = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "homepage" })
      .expect(202);
    const failedStatus = await waitForAudit(failed.body.id as string);
    const failedReport = await request(app.getHttpServer())
      .get(failedStatus.report.downloadUrl as string)
      .expect(200);
    expect(failedReport.body).toMatchObject({
      audit: { status: "failed", failure: { code: "BLOCKED_DESTINATION" } },
      results: null,
    });
  });

  it("does not report successful completion when the report cannot be written", async () => {
    mockHomepage();
    jest
      .spyOn(app.get(FileReportStore), "write")
      .mockRejectedValueOnce(
        new ReportStorageError(
          "REPORT_STORAGE_ERROR",
          "private-storage-detail",
        ),
      );
    const created = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "homepage" })
      .expect(202);
    const status = await waitForAudit(created.body.id as string);
    expect(status).toMatchObject({
      status: "failed",
      failure: { code: "REPORT_WRITE_FAILED" },
    });
    expect(status.report).toBeUndefined();
    expect(JSON.stringify(status)).not.toContain("private-storage-detail");
    await request(app.getHttpServer())
      .get(`/api/audits/${created.body.id}/report`)
      .expect(404);
  });

  it("validates report routes and returns a clean missing-report response", async () => {
    await request(app.getHttpServer())
      .get("/api/audits/not-a-uuid/report")
      .expect(400);
    const missing = await request(app.getHttpServer())
      .get(`/api/audits/${randomUUID()}/report`)
      .expect(404);
    expect(missing.body.error.code).toBe("REPORT_NOT_FOUND");
    await request(app.getHttpServer())
      .get("/api/businesses/missing/reports")
      .expect(404);
    const list = await request(app.getHttpServer())
      .get("/api/businesses/demo-guzman/reports")
      .expect(200);
    expect(list.body.reports).toEqual([]);
  });

  it("marks runner failures explicitly instead of leaving audits running", async () => {
    const repository = app.get<AuditRepository>(AUDIT_REPOSITORY);
    const save = repository.save.bind(repository);
    jest
      .spyOn(repository, "save")
      .mockImplementationOnce(async (_audit: Audit) => {
        void _audit;
        throw new Error("Simulated storage failure");
      })
      .mockImplementation(save);
    const created = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .send({ scope: "demo" })
      .expect(202);
    await delay(200);
    const response = await request(app.getHttpServer())
      .get(created.body.statusUrl as string)
      .expect(200);
    expect(response.body).toMatchObject({
      status: "failed",
      failure: { code: "AUDIT_FAILED" },
    });
  });

  it("returns a correlated error for malformed JSON", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/businesses/demo-guzman/audits")
      .set("Content-Type", "application/json")
      .send("{invalid")
      .expect(400);
    expect(response.body.error).toMatchObject({
      code: "INVALID_REQUEST",
      requestId: response.headers["x-request-id"],
    });
    expect(response.body.error.requestId).not.toBe("undefined");
  });
});
