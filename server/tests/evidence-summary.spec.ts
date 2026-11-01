import "reflect-metadata";
import { jest } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { configureApp } from "../src/configure-app.js";
import { createDemoBusiness, createSeedAudit } from "../src/fixtures/demo.js";
import { analyzeHomepage } from "../src/integrations/website/analyze.js";
import { attachLighthouse } from "../src/integrations/lighthouse/evidence.js";
import { normalizeLighthouse } from "../src/integrations/lighthouse/normalize.js";
import { summarizeEvidence } from "../src/reporting/evidence-summary.js";
import { analyzeWebsite } from "../src/integrations/lighthouse/prioritize.js";
import { FileReportStore } from "../src/reports/file-report.store.js";
import { ReportsModule } from "../src/reports/reports.module.js";
import { pageSpeedFixture } from "./fixtures/pagespeed.js";

const business = createDemoBusiness();
function fixture() {
  const audit = createSeedAudit(business.id);
  audit.scope = "lighthouse";
  audit.mode = "live";
  audit.scoringVersion = "lighthouse-v1";
  audit.results = analyzeHomepage({
    requestedUrl: business.website, finalUrl: business.website, status: 200,
    contentType: "text/html; charset=UTF-8", collectedAt: audit.completedAt!,
    bytes: 100, redirects: [], robots: "", body: Buffer.from('<title>Example</title><h1>Example</h1><img src="data:image/png;base64,LONGPAYLOAD" alt="">'),
  }, audit.id);
  attachLighthouse(audit.results, normalizeLighthouse(pageSpeedFixture(), "https://www.guzmantaxaccounting.com/", "mobile"), audit.id);
  return audit;
}

describe("programmatic evidence summaries", () => {
  it("summarizes actual HTML counts without dumping image data or changing evidence/scores", () => {
    const audit = fixture();
    const before = structuredClone(audit.results);
    const summaries = summarizeEvidence(audit.id, audit.results);
    const image = audit.results!.findings.find((item) => item.checkId === "image-alt")!;
    const summary = summaries.findings.find((item) => item.id === image.id)!;
    expect(summary.text).toContain("1 have empty alt text");
    expect(summary.text).toContain("decorative images");
    expect(summary.text).not.toContain("LONGPAYLOAD");
    expect(summary.sourceLabel).toMatch(/^Homepage HTML/);
    expect(summary.evidenceIds).toEqual(image.evidenceIds);
    expect(audit.results).toEqual(before);
  });

  it("uses only the finding's measured result, preserves units/zero and excludes shared payloads", () => {
    const audit = fixture();
    const finding = audit.results!.findings.find((item) => item.checkId.startsWith("lighthouse:"))!;
    const evidence = audit.results!.evidence.find((item) => item.checkId === finding.checkId)!;
    evidence.observed.title = "Measured fixture check";
    evidence.observed.displayValue = "0 ms";
    evidence.observed.explanation = "";
    const summary = summarizeEvidence(audit.id, audit.results).findings.find((item) => item.id === finding.id)!;
    expect(summary.text).toBe("Measured fixture check: 0 ms.");
    expect(summary.text).not.toMatch(/auditIds|categories|provider|scoreDisplayMode/);
    expect(summary.sourceLabel).toMatch(/^Lighthouse · mobile/);
    evidence.observed.displayValue = "9.7 s";
    expect(summarizeEvidence(audit.id, audit.results).findings.find((item) => item.id === finding.id)!.text).toBe("Measured fixture check: 9.7 s.");
  });

  it("bounds all summaries, strips documentation markup, and never infers missing evidence", () => {
    const audit = fixture();
    for (const finding of audit.results!.findings) finding.explanation = "A measured observation. " + "long ".repeat(1000);
    for (const evidence of audit.results!.evidence) if (evidence.checkId.startsWith("lighthouse:")) {
      evidence.observed.title = "A [check](https://example.com/docs)";
      evidence.observed.explanation = "A measured observation. " + "long ".repeat(1000);
    }
    const summaries = summarizeEvidence(audit.id, audit.results);
    for (const summary of [...summaries.findings, ...summaries.checks]) {
      expect(summary.text.length).toBeLessThanOrEqual(280);
      expect(summary.text).not.toMatch(/https:\/\/|\]\(/);
    }
    const finding = audit.results!.findings[0];
    finding.evidenceIds = [];
    expect(summarizeEvidence(audit.id, audit.results).findings[0].text).toBe("Supporting evidence is unavailable for this finding.");
    expect(summarizeEvidence(audit.id, null).findings).toEqual([]);
  });
});

describe("saved Website summary HTTP contract", () => {
  let directory: string;
  let store: FileReportStore;
  let app: INestApplication;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-evidence-summary-"));
    store = new FileReportStore(new ConfigService({ REPORTS_DIR: directory }));
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ReportsModule] })
      .overrideProvider(FileReportStore).useValue(store).compile();
    app = configureApp(module.createNestApplication()); app.useLogger(false); await app.init();
  });
  afterEach(async () => {
    jest.restoreAllMocks(); await app.close();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-evidence-summary-")) throw new Error("Unexpected test path");
    await rm(target, { recursive: true, force: true });
  });
  it("persists summaries during report generation and serves them through the documented API", async () => {
    const audit = fixture();
    const ref = await store.write(audit, business);
    const persisted = await store.read(audit.id);
    const expected = summarizeEvidence(audit.id, audit.results);
    expect(persisted!.results!.evidenceSummaries).toEqual(expected);
    const response = await request(app.getHttpServer()).get(`/api/audits/${audit.id}/evidence-summary`).expect(200);
    expect(response.body).toEqual(expected);
    expect((await readFile(join(directory, ref.fileName), "utf8"))).toContain("programmatic-evidence-v1");
  });
  it("derives summaries for legacy archives without modifying files or making network/provider calls", async () => {
    const audit = fixture();
    const ref = await store.write(audit, business);
    const path = join(directory, ref.fileName);
    const legacy = JSON.parse(await readFile(path, "utf8"));
    delete legacy.results.evidenceSummaries;
    await writeFile(path, JSON.stringify(legacy), "utf8");
    const before = await readFile(path, "utf8");
    const network = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network"));
    const response = await request(app.getHttpServer()).get(`/api/audits/${audit.id}/evidence-summary`).expect(200);
    expect(response.body).toEqual(summarizeEvidence(audit.id, audit.results));
    expect(await readFile(path, "utf8")).toBe(before);
    expect(network).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get(`/api/audits/${business.id}/evidence-summary`).expect(400);
    await request(app.getHttpServer()).get("/api/audits/00000000-0000-4000-8000-000000000001/evidence-summary").expect(404);
  });
  it("serves current priorities for legacy all-low reports while preserving the original archive", async () => {
    const audit = fixture();
    audit.results!.lighthouse!.metrics.find(item => item.id === "first-contentful-paint")!.value = 5000;
    const reference = await store.write(audit, business);
    const path = join(directory, reference.fileName);
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.results.websiteAnalysis.version).toBe("website-priority-v1");
    expect(saved.results.findings.find((item: { checkId: string }) => item.checkId === "lighthouse:first-contentful-paint").severity).toBe("medium");
    delete saved.results.websiteAnalysis;
    for (const finding of saved.results.findings) finding.severity = "low";
    await writeFile(path, JSON.stringify(saved), "utf8");
    const before = await readFile(path, "utf8");
    const network = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network"));
    const response = await request(app.getHttpServer()).get(`/api/audits/${audit.id}/website-analysis`).expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual(analyzeWebsite(audit.id, saved.results));
    expect(response.body.findings.find((item: { checkId: string }) => item.checkId === "lighthouse:first-contentful-paint").severity).toBe("medium");
    expect(await readFile(path, "utf8")).toBe(before);
    expect(network).not.toHaveBeenCalled();
  });
});
