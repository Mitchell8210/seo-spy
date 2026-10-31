import { ConflictException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { wordpressMuseAnalysisSchema, type WordPressMuseAnalysis } from "./wordpress-muse.types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 512 * 1024;
const codeIs = (error: unknown, code: string) => typeof error === "object" && error !== null && "code" in error && error.code === code;
const failure = () => new ServiceUnavailableException({ code: "WORDPRESS_MUSE_STORAGE_ERROR", message: "The WordPress Muse analysis archive could not be accessed safely." });

/** Separate immutable interpretation records; source evidence and action state are never rewritten. */
@Injectable()
export class WordPressMuseStore {
  private readonly directory: string;
  constructor(config: ConfigService) {
    this.directory = resolve(fileURLToPath(new URL("../../../", import.meta.url)), config.get<string>("WORDPRESS_MUSE_DIR") ?? "reports/wordpress-muse");
  }
  private async ready(create = false): Promise<boolean> {
    try {
      if (create) await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure();
      return true;
    } catch (error) { if (!create && codeIs(error, "ENOENT")) return false; throw failure(); }
  }
  async publish(record: WordPressMuseAnalysis): Promise<void> {
    let temporary: string | undefined;
    try {
      const parsed = wordpressMuseAnalysisSchema.safeParse(record);
      if (!parsed.success || !UUID.test(parsed.data.id)) throw failure();
      const json = JSON.stringify(parsed.data, null, 2) + "\n";
      if (Buffer.byteLength(json) > MAX_BYTES) throw failure();
      await this.ready(true);
      temporary = join(this.directory, `.${parsed.data.id}.${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(json, "utf8"); await handle.sync(); } finally { await handle.close(); }
      try { await link(temporary, join(this.directory, `${parsed.data.id}.json`)); }
      catch (error) {
        if (codeIs(error, "EEXIST")) throw new ConflictException({ code: "WORDPRESS_MUSE_ANALYSIS_EXISTS", message: "The saved Muse analysis cannot be overwritten." });
        throw error;
      }
    } catch (error) { if (error instanceof ConflictException) throw error; throw failure(); }
    finally { if (temporary) await unlink(temporary).catch(() => undefined); }
  }
  async read(id: string): Promise<WordPressMuseAnalysis | null> {
    if (!UUID.test(id)) throw failure();
    if (!await this.ready()) return null;
    try {
      const path = join(this.directory, `${id}.json`);
      let info;
      try { info = await lstat(path); } catch (error) { if (codeIs(error, "ENOENT")) return null; throw error; }
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) throw failure();
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_BYTES || stat.ino !== info.ino || stat.dev !== info.dev) throw failure();
        const buffer = Buffer.alloc(stat.size + 1);
        let used = 0;
        while (used < buffer.length) {
          const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
          if (!bytesRead) break;
          used += bytesRead;
        }
        if (used !== stat.size) throw failure();
        const parsed = wordpressMuseAnalysisSchema.safeParse(JSON.parse(buffer.subarray(0, used).toString("utf8")));
        if (!parsed.success || parsed.data.id !== id) throw failure();
        return parsed.data;
      } finally { await handle.close(); }
    } catch { throw failure(); }
  }
  async findByCacheKey(businessId: string, siteUrl: string, reportId: string, cacheKey: string): Promise<WordPressMuseAnalysis | null> {
    if (!UUID.test(reportId) || !/^[a-f0-9]{64}$/.test(cacheKey)) throw failure();
    if (!await this.ready()) return null;
    try {
      // Validate each candidate sequentially; corrupt cache storage must not cause a paid fallback.
      for (const name of await readdir(this.directory)) {
        if (!name.endsWith(".json") || !UUID.test(name.slice(0, -5))) continue;
        const record = await this.read(name.slice(0, -5));
        if (!record) throw failure();
        if (record.businessId === businessId && record.siteUrl === siteUrl && record.reportId === reportId && record.cacheKey === cacheKey && record.generationMode !== undefined) return record;
      }
      return null;
    } catch { throw failure(); }
  }
}
