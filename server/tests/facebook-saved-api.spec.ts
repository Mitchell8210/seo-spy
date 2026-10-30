import "reflect-metadata";
import { jest } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { configureApp } from "../src/configure-app.js";
import { ReportsModule } from "../src/reports/reports.module.js";
import { FileReportStore } from "../src/reports/file-report.store.js";
import { createDemoBusiness, createSeedAudit } from "../src/fixtures/demo.js";
import type { FacebookReport } from "../src/integrations/facebook/types.js";

describe("saved Facebook report presentation API", () => {
  let app: INestApplication;
  let directory: string;
  let store: FileReportStore;
  const business = createDemoBusiness();
  function audit() {
    const value = createSeedAudit(business.id);
    value.id = randomUUID();
    value.scope = "facebook";
    value.mode = "live";
    value.scoringVersion = "facebook-v1";
    value.status = "partial";
    const at = "2026-10-29T16:49:15.000Z";
    const facebook: FacebookReport = {
      provider: "facebook-graph",
      version: "facebook-v1",
      graphVersion: "v26.0",
      pageId: "123",
      pageName: "Example Page",
      collectedAt: at,
      window: {
        since: "2026-09-29T16:49:15.000Z",
        until: at,
        requestedDays: 30,
      },
      profile: {
        phone: {
          status: "available",
          value: "(702) 340-6758",
          collectedAt: at,
        },
      },
      posts: {
        status: "available",
        items: [
          {
            id: "123_456",
            message: "Call (725) 340-6758",
            createdTime: "2026-08-19T20:23:18.000Z",
            url: "https://www.facebook.com/123_456",
          },
        ],
        truncated: true,
        collectedAt: at,
      },
      metrics: [
        {
          name: "page_post_engagements",
          status: "available",
          period: "day",
          points: [{ endTime: at, value: 0 }],
          aggregation: "sum",
          total: 0,
          collectedAt: at,
        },
      ],
      summary: {
        followersStart: null,
        followersEnd: null,
        followersChange: null,
        latestPostAt: "2026-08-19T20:23:18.000Z",
        postsInWindow: 0,
        postsInWindowComplete: false,
      },
      coverage: {
        profileFieldsAvailable: 1,
        profileFieldsMissing: 0,
        profileFieldsUnavailable: 0,
        metricsAvailable: 1,
        metricsRequested: 7,
        postsLimit: 50,
      },
      limitations: ["Bounded posts"],
    };
    value.results = {
      evidence: [
        "facebook:posts",
        "facebook:profile:phone",
        "facebook:insight:page_post_engagements",
      ].map((checkId) => ({
        id: randomUUID(),
        auditId: value.id,
        checkId,
        sourceUrl: "https://www.facebook.com/123",
        collectedAt: at,
        observed: { status: "available" },
        mode: "live",
      })),
      findings: [],
      recommendations: [],
      scores: [],
      facebook,
    };
    return value;
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-facebook-saved-"));
    store = new FileReportStore(new ConfigService({ REPORTS_DIR: directory }));
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ReportsModule,
      ],
    })
      .overrideProvider(FileReportStore)
      .useValue(store)
      .compile();
    app = configureApp(module.createNestApplication());
    app.useLogger(false);
    await app.init();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
    const target = resolve(directory);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("seo-spy-facebook-saved-")
    )
      throw new Error("Unexpected test path");
    await rm(target, { recursive: true, force: true });
  });

  it("returns an explicit empty state and rejects an unknown business", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/businesses/demo-guzman/facebook-report")
      .expect(200);
    expect(response.body).toEqual({
      businessId: business.id,
      report: null,
      analysis: null,
      latestAttempt: null,
    });
    await request(app.getHttpServer())
      .get("/api/businesses/unknown/facebook-report")
      .expect(404);
  });
  it("derives stable evidence-linked analysis without changing immutable reports or calling providers", async () => {
    const saved = audit();
    const reference = await store.write(saved, business);
    const before = await readFile(join(directory, reference.fileName), "utf8");
    const network = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network must not be used"));
    const response = await request(app.getHttpServer())
      .get("/api/businesses/demo-guzman/facebook-report")
      .expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.report.auditId).toBe(saved.id);
    expect(response.body.analysis).toMatchObject({
      version: "facebook-analysis-v1",
      auditId: saved.id,
    });
    expect(response.body.analysis.findings.length).toBeGreaterThan(0);
    for (const finding of response.body.analysis.findings) {
      expect(finding.evidenceIds.length).toBeGreaterThan(0);
      expect(
        finding.evidenceIds.every((id: string) =>
          saved.results!.evidence.some((e) => e.id === id),
        ),
      ).toBe(true);
    }
    const repeat = await request(app.getHttpServer())
      .get("/api/businesses/demo-guzman/facebook-report")
      .expect(200);
    expect(repeat.body.analysis).toEqual(response.body.analysis);
    expect(await readFile(join(directory, reference.fileName), "utf8")).toBe(
      before,
    );
    expect(network).not.toHaveBeenCalled();
  });
  it("retains the latest usable report when a newer attempt failed, excluding other businesses and website reports", async () => {
    const usable = audit();
    await store.write(usable, business);
    await delay(5);
    const failed = audit();
    failed.results = null;
    failed.status = "failed";
    failed.stage = "failed";
    failed.failure = {
      code: "FACEBOOK_COLLECTION_FAILED",
      message: "Unavailable",
    };
    await store.write(failed, business);
    const other = audit();
    other.businessId = "other";
    await store.write(other, { ...business, id: "other" });
    await store.write(createSeedAudit(business.id), business);
    const response = await request(app.getHttpServer())
      .get("/api/businesses/demo-guzman/facebook-report")
      .expect(200);
    expect(response.body.report.auditId).toBe(usable.id);
    expect(response.body.latestAttempt.auditId).toBe(failed.id);
    expect(response.body.latestAttempt.status).toBe("failed");
  });
  it("returns a failed-attempt empty state and safe storage errors", async () => {
    const failed = audit();
    failed.results = null;
    failed.status = "failed";
    failed.stage = "failed";
    await store.write(failed, business);
    const response = await request(app.getHttpServer())
      .get("/api/businesses/demo-guzman/facebook-report")
      .expect(200);
    expect(response.body.report).toBeNull();
    expect(response.body.latestAttempt.status).toBe("failed");
    const ref = (await store.list(business.id))[0]!;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(directory, ref.fileName),
      "broken private provider data",
    );
    const invalid = await request(app.getHttpServer())
      .get("/api/businesses/demo-guzman/facebook-report")
      .expect(503);
    expect(invalid.text).not.toContain("private provider");
  });
});
