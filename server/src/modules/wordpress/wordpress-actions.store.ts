import { Injectable, Optional, ServiceUnavailableException, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { open, lstat, mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppDatabase, type ArtifactKind } from "../../persistence/sqlite/app-database.js";

@Injectable()
export class WordPressActionsStore implements OnApplicationShutdown {
  private readonly directory: string;
  private readonly database: AppDatabase;
  private readonly ownsDatabase: boolean;
  constructor(config: ConfigService, @Optional() database?: AppDatabase) {
    this.directory = resolve(fileURLToPath(new URL("../../../", import.meta.url)), config.get<string>("WORDPRESS_ACTIONS_DIR") ?? "reports/wordpress-actions");
    this.database = database ?? new AppDatabase(config);
    this.ownsDatabase = !database;
  }
  onApplicationShutdown() { if (this.ownsDatabase) this.database.close(); }
  private artifactKind(kind: string): ArtifactKind {
    this.path("00000000-0000-4000-8000-000000000000", kind);
    return `wordpress-${kind}` as ArtifactKind;
  }
  private persist(id: string, kind: string, data: unknown, observedAt: string) {
    if (!data || typeof data !== "object" || Array.isArray(data) || !("businessId" in data) || typeof data.businessId !== "string" || !data.businessId) throw new Error("Invalid operation scope");
    const value = data as Record<string, unknown>;
    const timestamp = [value.createdAt, value.startedAt, value.completedAt].find(item => typeof item === "string" && Number.isFinite(Date.parse(item)));
    return this.database.insertArtifact({ kind: this.artifactKind(kind), id, businessId: data.businessId, createdAt: typeof timestamp === "string" ? timestamp : observedAt, payload: data });
  }
  private path(id: string, kind: string) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !["proposal", "started", "outcome", "verification"].includes(kind)) throw new ServiceUnavailableException("Invalid WordPress operation record.");
    return join(this.directory, `${id}.${kind}.json`);
  }
  async reserveTarget(key: string): Promise<(() => Promise<void>) | null> {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new ServiceUnavailableException("Invalid target reservation.");
    const path = join(this.directory, `${key}.target.lock`);
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const info = await lstat(this.directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
      const handle = await open(path, "wx", 0o600);
      await handle.close();
      return async () => { await unlink(path); };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") return null;
      throw new ServiceUnavailableException("The target could not be reserved safely.");
    }
  }
  async read(id: string, kind: string): Promise<unknown | null> {
    try {
      const path = this.path(id, kind);
      const saved = this.database.readArtifact(this.artifactKind(kind), id);
      if (saved) return saved.payload;
      const directory = await lstat(this.directory);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error();
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) throw new Error();
      const data: unknown = JSON.parse(await readFile(path, "utf8"));
      this.persist(id, kind, data, info.mtime.toISOString());
      return this.database.readArtifact(this.artifactKind(kind), id)?.payload ?? null;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      throw new ServiceUnavailableException("The WordPress operation record could not be read safely.");
    }
  }
  async create(id: string, kind: string, data: object): Promise<boolean> {
    try {
      this.path(id, kind);
      if (this.database.readArtifact(this.artifactKind(kind), id)) return false;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const info = await lstat(this.directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
      const json = JSON.stringify(data, null, 2);
      if (Buffer.byteLength(json) > 4 * 1024 * 1024) throw new Error();
      const handle = await open(this.path(id, kind), "wx", 0o600);
      try { await handle.writeFile(json); await handle.sync(); } finally { await handle.close(); }
      if (!this.persist(id, kind, data, new Date().toISOString())) throw new Error("Operation record publication conflict");
      return true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") return false;
      throw new ServiceUnavailableException("The WordPress operation record could not be saved safely.");
    }
  }
  async importLegacy(): Promise<{ imported: number; existing: number }> {
    let names: string[];
    try {
      const info = await lstat(this.directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
      names = await readdir(this.directory);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { imported: 0, existing: 0 };
      throw new ServiceUnavailableException("The operation history could not be imported safely.");
    }
    let imported = 0, existing = 0;
    for (const name of names) {
      const match = /^([a-f0-9-]{36})\.(proposal|started|outcome|verification)\.json$/.exec(name);
      if (!match) continue;
      if (this.database.readArtifact(this.artifactKind(match[2]), match[1])) { existing++; continue; }
      if (await this.read(match[1], match[2])) imported++;
    }
    return { imported, existing };
  }
}
