import { ConflictException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { wordpressEvidenceReportSchema, type WordPressEvidenceReport } from "./wordpress-report.types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 8 * 1024 * 1024;
const codeIs = (error: unknown, code: string) => typeof error === "object" && error !== null && "code" in error && error.code === code;
const failure = () => new ServiceUnavailableException({ code: "WORDPRESS_REPORT_STORAGE_ERROR", message: "The WordPress evidence archive could not be accessed safely." });
const duplicate = () => new ConflictException({ code: "WORDPRESS_REPORT_EXISTS", message: "The WordPress evidence report already exists and cannot be overwritten." });

/** Immutable source evidence. Analysis must create new records instead of replacing these files. */
@Injectable()
export class WordPressReportsStore {
  private readonly directory: string;

  constructor(config: ConfigService) {
    this.directory = resolve(fileURLToPath(new URL("../../../", import.meta.url)), config.get<string>("WORDPRESS_REPORTS_DIR") ?? "reports/wordpress-evidence");
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

  async publish(report: WordPressEvidenceReport): Promise<void> {
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

  async read(id: string): Promise<WordPressEvidenceReport | null> {
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

  async list(businessId: string, siteUrl: string, limit: number): Promise<WordPressEvidenceReport[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw failure();
    if (!await this.directoryExists()) return [];
    try {
      const reports: WordPressEvidenceReport[] = [];
      // Sequential bounded file reads avoid loading the archive into memory at once.
      for (const name of await readdir(this.directory)) {
        if (!name.endsWith(".json") || !UUID.test(name.slice(0, -5))) continue;
        const report = await this.read(name.slice(0, -5));
        if (!report) throw failure();
        if (report.businessId !== businessId || report.siteUrl !== siteUrl) continue;
        reports.push(report);
        reports.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || a.id.localeCompare(b.id));
        if (reports.length > limit) reports.pop();
      }
      return reports;
    } catch { throw failure(); }
  }
}
