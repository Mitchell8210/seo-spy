import { Injectable, Optional, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import type { Audit, AuditResults, Business } from "../contracts/domain.js";
import { facebookReportSchema } from "../integrations/facebook/types.js";
import { summarizeEvidence } from "../reporting/evidence-summary.js";
import { analyzeWebsite } from "../integrations/lighthouse/prioritize.js";
import { AppDatabase } from "../persistence/sqlite/app-database.js";
import {
  ReportStorageError,
  type AuditReportRecord,
  type ReportFileReference,
  type StoredReportSummary,
} from "./report.types.js";
export { ReportStorageError } from "./report.types.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_([0-9a-f-]+)\.json$/;
const MAX_BYTES = 32 * 1024 * 1024;
const terminal = (value: unknown) =>
  ["completed", "partial", "failed"].includes(String(value));
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item: unknown) => typeof item === "string");
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));
const failure = () =>
  new ReportStorageError(
    "REPORT_STORAGE_ERROR",
    "The audit report archive could not be accessed safely.",
  );
const corrupt = () =>
  new ReportStorageError(
    "INVALID_REPORT",
    "The audit report archive contains an invalid report.",
  );

function filename(record: AuditReportRecord): string {
  return `${record.generatedAt.replace(/[:.]/g, "-")}_${record.auditId}.json`;
}

export function reportReference(
  record: AuditReportRecord,
): ReportFileReference {
  return {
    reportId: record.reportId,
    auditId: record.auditId,
    generatedAt: record.generatedAt,
    fileName: filename(record),
    downloadUrl: `/api/audits/${record.auditId}/report`,
  };
}

function normalizeResults(results: AuditResults | null): AuditResults | null {
  if (results === null) return null;
  const normalized: AuditResults = {
    evidence: results.evidence.map((e) => ({
      id: e.id,
      auditId: e.auditId,
      checkId: e.checkId,
      sourceUrl: e.sourceUrl,
      collectedAt: e.collectedAt,
      observed: Object.fromEntries(
        Object.entries(e.observed).filter(
          ([, value]) => typeof value === "string",
        ),
      ),
      mode: e.mode,
    })),
    findings: results.findings.map((f) => ({
      id: f.id,
      auditId: f.auditId,
      checkId: f.checkId,
      evidenceIds: [...f.evidenceIds],
      severity: f.severity,
      source: f.source,
      title: f.title,
      explanation: f.explanation,
      status: f.status,
    })),
    recommendations: results.recommendations.map((r) => ({
      id: r.id,
      auditId: r.auditId,
      findingId: r.findingId,
      title: r.title,
      explanation: r.explanation,
      recommendedChange: r.recommendedChange,
      purpose: r.purpose,
      status: r.status,
    })),
    scores: results.scores.map((s) => ({
      category: s.category,
      value: s.value,
      maximum: s.maximum,
      availability: s.availability,
      scoringVersion: s.scoringVersion,
    })),
  };
  const l = results.lighthouse;
  if (results.facebook !== undefined) {
    const parsed = facebookReportSchema.safeParse(results.facebook);
    if (!parsed.success) throw corrupt();
    normalized.facebook = parsed.data;
  }
  if (l)
    normalized.lighthouse = {
      provider: l.provider,
      strategy: l.strategy,
      requestedUrl: l.requestedUrl,
      finalUrl: l.finalUrl,
      fetchedAt: l.fetchedAt,
      lighthouseVersion: l.lighthouseVersion,
      warnings: [...l.warnings],
      categories: l.categories.map((c) => ({
        id: c.id,
        title: c.title,
        score: c.score,
        availability: c.availability,
        auditIds: [...c.auditIds],
      })),
      metrics: l.metrics.map((m) => ({
        id: m.id,
        title: m.title,
        value: m.value,
        unit: m.unit,
        displayValue: m.displayValue,
      })),
      checks: l.checks.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        score: c.score,
        scoreDisplayMode: c.scoreDisplayMode,
        displayValue: c.displayValue,
        explanation: c.explanation,
      })),
    };
  if (results.websiteAnalysis) {
    normalized.websiteAnalysis = analyzeWebsite(results.websiteAnalysis.auditId, normalized);
  }
  return normalized;
}

function validRecord(value: unknown): value is AuditReportRecord {
  if (
    !object(value) ||
    value.schemaVersion !== "seo-spy.audit-report.v1" ||
    typeof value.auditId !== "string" ||
    !UUID.test(value.auditId) ||
    value.reportId !== value.auditId ||
    !timestamp(value.generatedAt) ||
    new Date(value.generatedAt).toISOString() !== value.generatedAt ||
    !object(value.business) ||
    !object(value.audit)
  )
    return false;
  const a = value.audit,
    b = value.business;
  if (
    a.id !== value.auditId ||
    a.businessId !== b.id ||
    typeof b.id !== "string" ||
    !["name", "website", "createdAt"].every(
      (key) => typeof b[key] === "string",
    ) ||
    !terminal(a.status) ||
    !["demo", "homepage", "lighthouse", "facebook"].includes(String(a.scope)) ||
    !["demo", "live"].includes(String(a.mode)) ||
    !["complete", "failed"].includes(String(a.stage)) ||
    !timestamp(a.createdAt) ||
    !timestamp(a.completedAt) ||
    !(a.startedAt === null || timestamp(a.startedAt)) ||
    !strings(a.warnings) ||
    !["demo-v1", "homepage-v1", "lighthouse-v1", "facebook-v1"].includes(
      String(a.scoringVersion),
    ) ||
    !(
      a.failure === null ||
      (object(a.failure) &&
        typeof a.failure.code === "string" &&
        typeof a.failure.message === "string")
    )
  )
    return false;
  const r = value.results;
  if (r === null) return true;
  if (!object(r)) return false;
  if (
    a.scope === "facebook" &&
    (r.facebook === undefined ||
      a.scoringVersion !== "facebook-v1" ||
      a.mode !== "live")
  )
    return false;
  for (const key of ["evidence", "findings", "recommendations", "scores"]) {
    if (
      !Array.isArray(r[key]) ||
      !r[key].every((entry: unknown) => object(entry))
    )
      return false;
  }
  for (const key of ["evidence", "findings", "recommendations"]) {
    const entries = r[key] as Record<string, unknown>[];
    if (
      !entries.every(
        (e) => typeof e.id === "string" && e.auditId === value.auditId,
      )
    )
      return false;
  }
  if (
    !(r.evidence as Record<string, unknown>[]).every(
      (e) =>
        object(e.observed) &&
        Object.values(e.observed).every((v) => typeof v === "string"),
    )
  )
    return false;
  if (
    r.lighthouse !== undefined &&
    (!object(r.lighthouse) ||
      !["categories", "metrics", "checks", "warnings"].every((k) =>
        Array.isArray((r.lighthouse as Record<string, unknown>)[k]),
      ))
  )
    return false;
  if (r.facebook !== undefined) {
    const facebook = facebookReportSchema.safeParse(r.facebook);
    if (!facebook.success) return false;
    // Use the allowlisted shape on reads too; archives are untrusted input.
    r.facebook = facebook.data;
  }
  return true;
}

@Injectable()
export class FileReportStore implements OnApplicationShutdown {
  private readonly directory: string;
  private readonly database: AppDatabase;
  private readonly ownsDatabase: boolean;

  constructor(config: ConfigService, @Optional() database?: AppDatabase) {
    this.directory = resolve(
      fileURLToPath(new URL("../../", import.meta.url)),
      config.get<string>("REPORTS_DIR") ?? "reports/audits",
    );
    this.database = database ?? new AppDatabase(config);
    this.ownsDatabase = database === undefined;
  }

  onApplicationShutdown(): void {
    if (this.ownsDatabase) this.database.close();
  }

  private stored(auditId: string): AuditReportRecord | null {
    try {
      const artifact = this.database.readArtifact("audit-report", auditId);
      if (!artifact) return null;
      if (!validRecord(artifact.payload) || artifact.payload.auditId !== auditId || artifact.businessId !== artifact.payload.business.id || artifact.createdAt !== artifact.payload.generatedAt) throw corrupt();
      return artifact.payload;
    } catch (error) {
      if (error instanceof ReportStorageError) throw error;
      throw failure();
    }
  }

  private remember(record: AuditReportRecord): boolean {
    try {
      const inserted = this.database.insertArtifact({ kind: "audit-report", id: record.auditId, businessId: record.business.id, createdAt: record.generatedAt, payload: record });
      if (!inserted) {
        const existing = this.stored(record.auditId);
        if (!existing || existing.business.id !== record.business.id || existing.audit.scope !== record.audit.scope || existing.audit.mode !== record.audit.mode) throw corrupt();
      }
      return inserted;
    } catch (error) {
      if (error instanceof ReportStorageError) throw error;
      throw failure();
    }
  }

  private validateId(id: string): void {
    if (!UUID.test(id))
      throw new ReportStorageError(
        "INVALID_AUDIT_ID",
        "A valid audit identifier is required.",
      );
  }

  private async names(): Promise<string[]> {
    try {
      return (await readdir(this.directory))
        .filter((name) => FILE.test(name))
        .sort();
    } catch (error) {
      if (object(error) && error.code === "ENOENT") return [];
      throw failure();
    }
  }

  private async load(name: string): Promise<AuditReportRecord> {
    try {
      const path = join(this.directory, name);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES)
        throw corrupt();
      const handle = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const stat = await handle.stat();
        if (
          !stat.isFile() ||
          stat.size > MAX_BYTES ||
          stat.ino !== info.ino ||
          stat.dev !== info.dev
        )
          throw corrupt();
        const buffer = Buffer.alloc(stat.size + 1);
        let used = 0;
        while (used < buffer.length) {
          const { bytesRead } = await handle.read(
            buffer,
            used,
            buffer.length - used,
            null,
          );
          if (!bytesRead) break;
          used += bytesRead;
        }
        if (used > stat.size) throw corrupt();
        const parsed: unknown = JSON.parse(
          buffer.subarray(0, used).toString("utf8"),
        );
        if (!validRecord(parsed) || filename(parsed) !== name) throw corrupt();
        return parsed;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof ReportStorageError) throw error;
      throw corrupt();
    }
  }

  async read(auditId: string): Promise<AuditReportRecord | null> {
    this.validateId(auditId);
    const stored = this.stored(auditId);
    if (stored) return stored;
    const names = (await this.names()).filter((name) =>
      name.endsWith(`_${auditId}.json`),
    );
    if (names.length > 1) throw corrupt();
    if (!names[0]) return null;
    const record = await this.load(names[0]);
    this.remember(record);
    return this.stored(auditId);
  }

  /** Idempotent adoption of validated historical JSON; originals are never changed. */
  async importLegacy(): Promise<{ imported: number; existing: number }> {
    const seen = new Set<string>();
    let imported = 0;
    let existing = 0;
    for (const name of await this.names()) {
      const id = FILE.exec(name)?.[2];
      if (!id || !UUID.test(id) || seen.has(id)) throw corrupt();
      seen.add(id);
      if (this.stored(id)) { existing++; continue; }
      const record = await this.load(name);
      if (this.remember(record)) imported++; else existing++;
    }
    return { imported, existing };
  }

  async list(businessId: string): Promise<StoredReportSummary[]> {
    await this.importLegacy();
    const records: AuditReportRecord[] = [];
    try {
      for (const artifact of this.database.listArtifacts("audit-report", businessId)) {
        const record = this.stored(artifact.id);
        if (!record || record.business.id !== businessId) throw corrupt();
        records.push(record);
      }
    } catch (error) {
      if (error instanceof ReportStorageError) throw error;
      throw failure();
    }
    return records
      .sort(
        (a, b) =>
          b.generatedAt.localeCompare(a.generatedAt) ||
          a.auditId.localeCompare(b.auditId),
      )
      .map((record) => ({
        ...reportReference(record),
        businessId: record.business.id,
        scope: record.audit.scope,
        mode: record.audit.mode,
        status: record.audit.status,
        counts: {
          findings: record.results?.findings.length ?? 0,
          recommendations: record.results?.recommendations.length ?? 0,
        },
      }));
  }

  async write(audit: Audit, business: Business): Promise<ReportFileReference> {
    this.validateId(audit.id);
    if (!terminal(audit.status) || business.id !== audit.businessId)
      throw new ReportStorageError(
        "INVALID_REPORT",
        "Only terminal audits with a matching business can be archived.",
      );
    const assertExisting = (existing: AuditReportRecord) => {
      if (existing.business.id !== business.id || existing.audit.scope !== audit.scope || existing.audit.mode !== audit.mode) throw corrupt();
      return reportReference(existing);
    };
    const saved = this.stored(audit.id);
    if (saved) return assertExisting(saved);
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    const lockPath = join(this.directory, `.${audit.id}.lock`);
    let temp: string | undefined;
    try {
      await mkdir(this.directory, { recursive: true });
      for (let attempt = 0; attempt < 200; attempt++) {
        try {
          lock = await open(lockPath, "wx", 0o600);
          break;
        } catch (error) {
          if (!object(error) || error.code !== "EEXIST") throw error;
          await delay(25);
        }
      }
      if (!lock) throw failure();
      const existing = await this.read(audit.id);
      if (existing) return assertExisting(existing);
      const record: AuditReportRecord = {
        schemaVersion: "seo-spy.audit-report.v1",
        reportId: audit.id,
        auditId: audit.id,
        generatedAt: new Date().toISOString(),
        business: {
          id: business.id,
          name: business.name,
          website: business.website,
          createdAt: business.createdAt,
        },
        audit: {
          id: audit.id,
          businessId: audit.businessId,
          scope: audit.scope,
          ...(audit.strategy ? { strategy: audit.strategy } : {}),
          mode: audit.mode,
          status: audit.status,
          stage: audit.stage,
          createdAt: audit.createdAt,
          startedAt: audit.startedAt,
          completedAt: audit.completedAt,
          warnings: [...audit.warnings],
          failure: audit.failure
            ? { code: audit.failure.code, message: audit.failure.message }
            : null,
          scoringVersion: audit.scoringVersion,
        },
        results: normalizeResults(audit.results),
      };
      if (record.results && (audit.scope === "homepage" || audit.scope === "lighthouse")) {
        const analysis = analyzeWebsite(audit.id, record.results);
        record.results.findings = analysis.findings;
        record.results.recommendations = analysis.recommendations;
        record.results.websiteAnalysis = analysis;
        record.results.evidenceSummaries = summarizeEvidence(audit.id, record.results);
      }
      if (!validRecord(record)) throw corrupt();
      const json = JSON.stringify(record, null, 2) + "\n";
      if (Buffer.byteLength(json) > MAX_BYTES)
        throw new ReportStorageError(
          "REPORT_TOO_LARGE",
          "The audit report exceeds the archive size limit.",
        );
      temp = join(this.directory, `.${audit.id}.${randomUUID()}.tmp`);
      const handle = await open(temp, "wx", 0o600);
      try {
        await handle.writeFile(json, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await link(temp, join(this.directory, filename(record)));
      this.remember(record);
      const committed = this.stored(record.auditId);
      if (!committed) throw failure();
      return reportReference(committed);
    } catch (error) {
      if (error instanceof ReportStorageError) throw error;
      throw failure();
    } finally {
      if (temp) await unlink(temp).catch(() => undefined);
      if (lock) {
        await lock.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
      }
    }
  }
}
