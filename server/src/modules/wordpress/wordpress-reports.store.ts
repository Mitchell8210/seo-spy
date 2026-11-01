import { ConflictException, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { wordpressEvidenceReportSchema, type WordPressEvidenceReport } from "./wordpress-report.types.js";
import { AppDatabase } from "../../persistence/sqlite/app-database.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 8 * 1024 * 1024;
const codeIs = (error: unknown, code: string) => typeof error === "object" && error !== null && "code" in error && error.code === code;
const failure = () => new ServiceUnavailableException({ code: "WORDPRESS_REPORT_STORAGE_ERROR", message: "The WordPress evidence archive could not be accessed safely." });
const duplicate = () => new ConflictException({ code: "WORDPRESS_REPORT_EXISTS", message: "The WordPress evidence report already exists and cannot be overwritten." });

/** Immutable SQLite source evidence, with preserved JSON archives/compatibility exports. */
@Injectable()
export class WordPressReportsStore {
  private readonly directory: string;
  private readonly database: AppDatabase;

  constructor(config: ConfigService, @Optional() database?: AppDatabase) {
    this.directory = resolve(fileURLToPath(new URL("../../../", import.meta.url)), config.get<string>("WORDPRESS_REPORTS_DIR") ?? "reports/wordpress-evidence");
    this.database = database ?? new AppDatabase(config);
  }

  private validateId(id: string): void {
    if (!UUID.test(id)) throw failure();
  }

  private async directoryExists(create = false): Promise<boolean> {
    try {
      if (create) await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure();
      return true;
    } catch (error) {
      if (!create && codeIs(error, "ENOENT")) return false;
      throw failure();
    }
  }

  private async exportJson(report: WordPressEvidenceReport): Promise<void> {
    let temporary: string | undefined;
    try {
      const parsed = wordpressEvidenceReportSchema.safeParse(report);
      if (!parsed.success) throw failure();
      this.validateId(parsed.data.id);
      const json = JSON.stringify(parsed.data, null, 2) + "\n";
      if (Buffer.byteLength(json) > MAX_BYTES) throw failure();
      await this.directoryExists(true);
      temporary = join(this.directory, `.${parsed.data.id}.${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(json, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      // A hard link publishes the complete synced file atomically and refuses overwrite.
      try { await link(temporary, join(this.directory, `${parsed.data.id}.json`)); }
      catch (error) { if (codeIs(error, "EEXIST")) throw duplicate(); throw error; }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw failure();
    } finally {
      if (temporary) await unlink(temporary).catch(() => undefined);
    }
  }

  private async readLegacy(id: string): Promise<WordPressEvidenceReport | null> {
    this.validateId(id);
    if (!await this.directoryExists()) return null;
    const path = join(this.directory, `${id}.json`);
    try {
      let info;
      try { info = await lstat(path); }
      catch (error) { if (codeIs(error, "ENOENT")) return null; throw error; }
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) throw failure();
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_BYTES || stat.ino !== info.ino || stat.dev !== info.dev) throw failure();
        // One extra byte detects a file that grows during the bounded read.
        const buffer = Buffer.alloc(stat.size + 1);
        let used = 0;
        while (used < buffer.length) {
          const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
          if (!bytesRead) break;
          used += bytesRead;
        }
        if (used !== stat.size) throw failure();
        const value: unknown = JSON.parse(buffer.subarray(0, used).toString("utf8"));
        const parsed = wordpressEvidenceReportSchema.safeParse(value);
        if (!parsed.success || parsed.data.id !== id) throw failure();
        return parsed.data;
      } finally {
        await handle.close();
      }
    } catch { throw failure(); }
  }

  private stored(id: string): WordPressEvidenceReport | null {
    const artifact = this.database.readArtifact("wordpress-evidence", id);
    if (!artifact) return null;
    if (Buffer.byteLength(JSON.stringify(artifact.payload)) > MAX_BYTES) throw failure();
    const parsed = wordpressEvidenceReportSchema.safeParse(artifact.payload);
    if (!parsed.success || parsed.data.id !== artifact.id || parsed.data.businessId !== artifact.businessId || parsed.data.generatedAt !== artifact.createdAt) throw failure();
    return parsed.data;
  }
  private insert(report: WordPressEvidenceReport): boolean {
    return this.database.insertArtifact({ kind: "wordpress-evidence", id: report.id, businessId: report.businessId, createdAt: report.generatedAt, payload: report });
  }
  async publish(report: WordPressEvidenceReport): Promise<void> {
    try {
      const parsed = wordpressEvidenceReportSchema.safeParse(report);
      if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data)) > MAX_BYTES) throw failure();
      this.validateId(parsed.data.id);
      if (this.stored(parsed.data.id)) throw duplicate();
      // Keep the prior JSON contract as an export. Neither export nor database
      // failure is reported as a successful database-backed publication.
      await this.exportJson(parsed.data);
      if (!this.insert(parsed.data)) throw duplicate();
    } catch (error) { if (error instanceof ConflictException) throw error; throw failure(); }
  }
  async read(id: string): Promise<WordPressEvidenceReport | null> {
    this.validateId(id);
    try {
      const stored = this.stored(id);
      if (stored) return stored;
      const legacy = await this.readLegacy(id);
      if (!legacy) return null;
      this.insert(legacy);
      return this.stored(id);
    } catch { throw failure(); }
  }
  async importLegacy(): Promise<{ imported: number; existing: number }> {
    try {
      // Storage must be available even when the legacy directory is absent.
      this.database.connection();
      const result = { imported: 0, existing: 0 };
      if (!await this.directoryExists()) return result;
      for (const name of await readdir(this.directory)) {
        if (!name.endsWith(".json") || !UUID.test(name.slice(0, -5))) continue;
        const id = name.slice(0, -5);
        if (this.stored(id)) { result.existing++; continue; }
        const legacy = await this.readLegacy(id);
        if (!legacy) throw failure();
        if (this.insert(legacy)) result.imported++; else result.existing++;
      }
      return result;
    } catch { throw failure(); }
  }
  async list(businessId: string, siteUrl: string, limit: number): Promise<WordPressEvidenceReport[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw failure();
    try {
      await this.importLegacy();
      return this.database.listArtifacts("wordpress-evidence", businessId).map(artifact => {
        const report = this.stored(artifact.id);
        if (!report) throw failure();
        return report;
      }).filter(report => report.siteUrl === siteUrl).slice(0, limit);
    } catch { throw failure(); }
  }
}
