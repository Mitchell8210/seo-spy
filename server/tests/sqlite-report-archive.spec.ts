import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createDemoBusiness, createSeedAudit } from "../src/fixtures/demo.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { FileReportStore } from "../src/reports/file-report.store.js";
import type { AuditReportRecord } from "../src/reports/report.types.js";

describe("SQLite-backed report archive and immutable legacy JSON adoption", () => {
  let directory: string;
  let exportsPath: string;
  let databasePath: string;
  let stores: AppDatabase[];
  const business = createDemoBusiness();
  const open = () => {
    const config = new ConfigService({ DATABASE_PATH: databasePath, REPORTS_DIR: exportsPath, NODE_ENV: "test" });
    const database = new AppDatabase(config);
    stores.push(database);
    return { database, reports: new FileReportStore(config, database) };
  };
  const legacy = (at = "2026-10-30T12:00:00.000Z"): AuditReportRecord => {
    const { results, report: _report, ...audit } = createSeedAudit(business.id);
    void _report;
    return { schemaVersion: "seo-spy.audit-report.v1", reportId: audit.id, auditId: audit.id, generatedAt: at, business, audit, results };
  };
  const filename = (record: AuditReportRecord) => `${record.generatedAt.replace(/[:.]/g, "-")}_${record.auditId}.json`;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "seo-spy-sqlite-reports-"));
    exportsPath = join(directory, "exports");
    databasePath = join(directory, "app.sqlite");
    stores = [];
  });
  afterEach(async () => {
    for (const database of stores) database.close();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("seo-spy-sqlite-reports-")) throw new Error("Unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });

  it("saves reports, statuses, timestamps and suggestions in SQLite and reads them after restart without JSON exports", async () => {
    const { database, reports } = open();
    const audit = createSeedAudit(business.id);
    const reference = await reports.write(audit, business);
    const saved = await reports.read(audit.id);
    expect(database.readArtifact("audit-report", audit.id)?.payload).toEqual(saved);
    expect(saved).toMatchObject({ audit: { status: audit.status, createdAt: audit.createdAt, completedAt: audit.completedAt }, results: { recommendations: audit.results!.recommendations } });
    await unlink(join(exportsPath, reference.fileName));
    const restarted = open().reports;
    expect(await restarted.read(audit.id)).toEqual(saved);
    expect(await restarted.list(business.id)).toEqual([expect.objectContaining(reference)]);
    expect(await restarted.write(audit, business)).toEqual(reference);
    expect(await readdir(exportsPath)).toEqual([]);
  });

  it("adopts legacy JSON without modifying it and makes migration idempotent", async () => {
    const record = legacy();
    await mkdir(exportsPath);
    const text = JSON.stringify(record, null, 2) + "\n";
    await writeFile(join(exportsPath, filename(record)), text);
    const { reports, database } = open();
    expect(await reports.importLegacy()).toEqual({ imported: 1, existing: 0 });
    expect(database.readArtifact("audit-report", record.auditId)?.payload).toEqual(record);
    expect(await reports.importLegacy()).toEqual({ imported: 0, existing: 1 });
    expect(await readFile(join(exportsPath, filename(record)), "utf8")).toBe(text);
    await unlink(join(exportsPath, filename(record)));
    expect(await open().reports.read(record.auditId)).toEqual(record);
  });

  it("uses committed SQLite history rather than tampered export copies", async () => {
    const { reports } = open();
    const audit = createSeedAudit(business.id);
    const reference = await reports.write(audit, business);
    const original = await reports.read(audit.id);
    await writeFile(join(exportsPath, reference.fileName), "broken export copy");
    expect(await open().reports.read(audit.id)).toEqual(original);
    expect(await open().reports.list(business.id)).toHaveLength(1);
  });

  it("keeps imported history business-scoped and newest-first", async () => {
    const older = legacy("2026-10-29T10:00:00.000Z");
    const newer = legacy("2026-10-30T10:00:00.000Z");
    await mkdir(exportsPath);
    for (const record of [newer, older]) await writeFile(join(exportsPath, filename(record)), JSON.stringify(record));
    const reports = open().reports;
    expect((await reports.list(business.id)).map(item => item.auditId)).toEqual([newer.auditId, older.auditId]);
    expect(await reports.list("another-business")).toEqual([]);
  });

  it("refuses malformed unmigrated history and does not silently claim import completion", async () => {
    const record = legacy();
    await mkdir(exportsPath);
    await writeFile(join(exportsPath, filename(record)), "{bad-json");
    const { reports, database } = open();
    await expect(reports.importLegacy()).rejects.toMatchObject({ code: "INVALID_REPORT" });
    expect(database.listArtifacts("audit-report")).toEqual([]);
  });

  it("rejects reuse of a persisted audit ID for another business and preserves the original snapshot", async () => {
    const { reports } = open();
    const audit = createSeedAudit(business.id);
    await reports.write(audit, business);
    const original = await reports.read(audit.id);
    const another = { ...business, id: "another-business" };
    await expect(reports.write({ ...audit, businessId: another.id }, another)).rejects.toMatchObject({ code: "INVALID_REPORT" });
    expect(await reports.read(audit.id)).toEqual(original);
  });

  it("does not report successful publication when the SQLite commit fails after JSON export", async () => {
    const { reports, database } = open();
    const audit = createSeedAudit(business.id);
    const insert = jest.spyOn(database, "insertArtifact").mockImplementationOnce(() => { throw new Error("private database location"); });
    await expect(reports.write(audit, business)).rejects.toMatchObject({ code: "REPORT_STORAGE_ERROR" });
    expect((await readdir(exportsPath)).filter(name => name.endsWith(".json"))).toHaveLength(1);
    insert.mockRestore();
    const recovered = await reports.read(audit.id);
    expect(recovered?.auditId).toBe(audit.id);
    expect(database.readArtifact("audit-report", audit.id)?.payload).toEqual(recovered);
  });
});
