import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { WordPressReportsStore } from "../src/modules/wordpress/wordpress-reports.store.js";
import { WordPressMuseStore } from "../src/modules/wordpress/wordpress-muse.store.js";
import type { WordPressEvidenceReport } from "../src/modules/wordpress/wordpress-report.types.js";
import type { WordPressMuseAnalysis } from "../src/modules/wordpress/wordpress-muse.types.js";

const generatedAt = "2026-10-31T12:00:00.000Z";
function evidence(patch: Partial<WordPressEvidenceReport> = {}): WordPressEvidenceReport {
  return {
    schemaVersion: "seo-spy.wordpress-evidence.v1", collectionPolicyVersion: "published-unprotected-v1", id: randomUUID(), businessId: "example", siteUrl: "https://example.com",
    startedAt: generatedAt, generatedAt, availability: "unavailable", sampleSize: 20,
    content: (["pages", "posts", "media"] as const).map(resource => ({ resource, collectedAt: generatedAt, availability: "unavailable", items: [], limitations: [] })),
    rankMath: (["pages", "posts"] as const).map(resource => ({ resource, evidence: null, limitations: [] })),
    scoring: { seoSpyScore: null, policyVersion: null, storedScoreFreshness: "unknown" }, limitations: ["Stored sample only."], ...patch,
  };
}
function analysis(reportId: string, patch: Partial<WordPressMuseAnalysis> = {}): WordPressMuseAnalysis {
  return {
    schemaVersion: "seo-spy.wordpress-muse-analysis.v1", id: randomUUID(), businessId: "example", siteUrl: "https://example.com", reportId,
    sourceHash: "a".repeat(64), model: "muse-spark-1.3", promptVersion: "wordpress-muse-prompt-v1", outputSchemaVersion: "wordpress-muse-output-v1",
    startedAt: generatedAt, generatedAt, usage: { inputTokens: 0, outputTokens: 0 }, requestId: null,
    output: { schemaVersion: "wordpress-muse-output-v1", summary: "Mock fixture for a bounded saved sample.", summaryEvidenceIds: ["source-reference"], observations: [], recommendations: [], limitations: ["MOCK DATA; no paid model request."], seoSpyScore: null },
    limitations: ["MOCK DATA; source dates preserved."], generationMode: "mock", provider: "mock-fixture", isMock: true, cacheKey: "b".repeat(64), fixtureVersion: "muse-development-fixtures-v1", ...patch,
  };
}

describe("SQLite WordPress evidence and Muse archive adoption", () => {
  let directory: string;
  let reportDirectory: string;
  let museDirectory: string;
  let budgetPath: string;
  let config: ConfigService;
  let database: AppDatabase;
  let evidenceStore: WordPressReportsStore;
  let museStore: WordPressMuseStore;
  const createStores = () => {
    database = new AppDatabase(config);
    evidenceStore = new WordPressReportsStore(config, database);
    museStore = new WordPressMuseStore(config, database);
  };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-sqlite-wordpress-"));
    reportDirectory = join(directory, "evidence");
    museDirectory = join(directory, "muse");
    budgetPath = join(directory, "ai-usage.sqlite");
    config = new ConfigService({ DATABASE_PATH: join(directory, "application.sqlite"), WORDPRESS_REPORTS_DIR: reportDirectory, WORDPRESS_MUSE_DIR: museDirectory, AI_USAGE_DB: budgetPath });
    await writeFile(budgetPath, "separate-credit-ledger-must-not-be-opened-or-reset");
    createStores();
  });
  afterEach(async () => {
    database.close();
    expect(await readFile(budgetPath, "utf8")).toBe("separate-credit-ledger-must-not-be-opened-or-reset");
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-sqlite-wordpress-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });

  it("imports legacy evidence idempotently, preserving original bytes, timestamps and unknown policy", async () => {
    const report = evidence();
    delete report.collectionPolicyVersion;
    await mkdir(reportDirectory);
    const path = join(reportDirectory, `${report.id}.json`);
    const original = JSON.stringify(report, null, 1) + "\n";
    await writeFile(path, original);
    expect(await evidenceStore.importLegacy()).toEqual({ imported: 1, existing: 0 });
    expect(await evidenceStore.importLegacy()).toEqual({ imported: 0, existing: 1 });
    expect(await readFile(path, "utf8")).toBe(original);
    expect(database.readArtifact("wordpress-evidence", report.id)?.payload).toEqual(report);
    expect(await evidenceStore.read(report.id)).toEqual(report);
    database.close();
    await unlink(path);
    createStores();
    expect(await evidenceStore.read(report.id)).toEqual(report);
    expect(await evidenceStore.list(report.businessId, report.siteUrl, 10)).toEqual([report]);
    expect((await evidenceStore.read(report.id))?.collectionPolicyVersion).toBeUndefined();
  });

  it("publishes into SQLite while retaining immutable compatibility exports", async () => {
    const report = evidence();
    await evidenceStore.publish(report);
    expect(database.readArtifact("wordpress-evidence", report.id)?.payload).toEqual(report);
    expect(JSON.parse(await readFile(join(reportDirectory, `${report.id}.json`), "utf8"))).toEqual(report);
    await expect(evidenceStore.publish(evidence({ id: report.id }))).rejects.toMatchObject({ status: 409 });
    await writeFile(join(reportDirectory, `${report.id}.json`), "modified export is not the primary database");
    expect(await evidenceStore.read(report.id)).toEqual(report);
    expect(await evidenceStore.list(report.businessId, report.siteUrl, 10)).toEqual([report]);
  });

  it("filters SQLite history by business and installation before applying its limit", async () => {
    const older = evidence({ generatedAt: "2026-10-31T12:01:00.000Z" });
    const newest = evidence({ generatedAt: "2026-10-31T12:03:00.000Z" });
    const otherSite = evidence({ generatedAt: "2026-10-31T12:04:00.000Z", siteUrl: "https://other.example" });
    for (const report of [older, newest, otherSite, evidence({ businessId: "unrelated" })]) await evidenceStore.publish(report);
    expect((await evidenceStore.list("example", "https://example.com", 1)).map(report => report.id)).toEqual([newest.id]);
    expect(await evidenceStore.list("missing", "https://example.com", 10)).toEqual([]);
  });

  it("imports and serves a persistent mock cache after restart without JSON files or paid work", async () => {
    const record = analysis(randomUUID());
    await mkdir(museDirectory);
    const path = join(museDirectory, `${record.id}.json`);
    const original = JSON.stringify(record);
    await writeFile(path, original);
    expect(await museStore.importLegacy()).toEqual({ imported: 1, existing: 0 });
    expect(await museStore.importLegacy()).toEqual({ imported: 0, existing: 1 });
    expect(await readFile(path, "utf8")).toBe(original);
    database.close();
    await unlink(path);
    createStores();
    expect(await museStore.read(record.id)).toEqual(record);
    expect(await museStore.findByCacheKey(record.businessId, record.siteUrl, record.reportId, record.cacheKey!)).toEqual(record);
    expect(await museStore.findByCacheKey("unrelated", record.siteUrl, record.reportId, record.cacheKey!)).toBeNull();
    expect(await museStore.findByCacheKey(record.businessId, "https://other.example", record.reportId, record.cacheKey!)).toBeNull();
    expect(await museStore.findByCacheKey(record.businessId, record.siteUrl, randomUUID(), record.cacheKey!)).toBeNull();
  });

  it("does not claim publication on database failure and can adopt the completed export afterwards", async () => {
    const report = evidence();
    const fail = jest.spyOn(database, "insertArtifact").mockImplementationOnce(() => { throw new Error("private-database-location"); });
    await expect(evidenceStore.publish(report)).rejects.toMatchObject({ status: 503 });
    expect(database.readArtifact("wordpress-evidence", report.id)).toBeNull();
    expect(await evidenceStore.read(report.id)).toEqual(report);
    expect(fail).toHaveBeenCalledTimes(2);
    const record = analysis(report.id);
    fail.mockImplementationOnce(() => { throw new Error("private-database-location"); });
    await expect(museStore.publish(record)).rejects.toMatchObject({ status: 503 });
    expect(database.readArtifact("wordpress-muse", record.id)).toBeNull();
    expect(await museStore.read(record.id)).toEqual(record);
  });

  it("fails closed on unavailable primary storage rather than silently using file-only cache or history", async () => {
    const report = evidence();
    await evidenceStore.publish(report);
    const record = analysis(report.id);
    await museStore.publish(record);
    jest.spyOn(database, "readArtifact").mockImplementation(() => { throw new Error("private-database-path"); });
    await expect(evidenceStore.read(report.id)).rejects.toMatchObject({ status: 503 });
    await expect(museStore.read(record.id)).rejects.toMatchObject({ status: 503 });
    await expect(museStore.findByCacheKey(record.businessId, record.siteUrl, record.reportId, record.cacheKey!)).rejects.toMatchObject({ status: 503 });
  });

  it("rejects malformed legacy JSON and filename mismatches before database adoption", async () => {
    await mkdir(reportDirectory);
    const id = randomUUID();
    const path = join(reportDirectory, `${id}.json`);
    for (const contents of ["{invalid", JSON.stringify(evidence())]) {
      await writeFile(path, contents);
      await expect(evidenceStore.importLegacy()).rejects.toMatchObject({ status: 503 });
      expect(database.readArtifact("wordpress-evidence", id)).toBeNull();
    }
    await mkdir(museDirectory);
    const analysisId = randomUUID();
    await writeFile(join(museDirectory, `${analysisId}.json`), JSON.stringify({ id: analysisId, schemaVersion: "unsupported" }));
    await expect(museStore.importLegacy()).rejects.toMatchObject({ status: 503 });
    expect(database.readArtifact("wordpress-muse", analysisId)).toBeNull();
  });

  it("rejects checksum-corrupt SQLite records without falling back to otherwise valid exports", async () => {
    const report = evidence();
    const record = analysis(report.id);
    await evidenceStore.publish(report);
    await museStore.publish(record);
    database.connection().prepare("UPDATE artifacts SET checksum=? WHERE kind IN ('wordpress-evidence','wordpress-muse')").run("0".repeat(64));
    await expect(evidenceStore.read(report.id)).rejects.toMatchObject({ status: 503 });
    await expect(evidenceStore.list(report.businessId, report.siteUrl, 10)).rejects.toMatchObject({ status: 503 });
    await expect(museStore.read(record.id)).rejects.toMatchObject({ status: 503 });
    await expect(museStore.findByCacheKey(record.businessId, record.siteUrl, record.reportId, record.cacheKey!)).rejects.toMatchObject({ status: 503 });
    expect(JSON.parse(await readFile(join(reportDirectory, `${report.id}.json`), "utf8"))).toEqual(report);
    expect(JSON.parse(await readFile(join(museDirectory, `${record.id}.json`), "utf8"))).toEqual(record);
  });
});
