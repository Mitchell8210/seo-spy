import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { open, lstat, mkdir, readFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

@Injectable()
export class WordPressActionsStore {
  private readonly directory: string;
  constructor(config: ConfigService) { this.directory = resolve(fileURLToPath(new URL("../../../", import.meta.url)), config.get<string>("WORDPRESS_ACTIONS_DIR") ?? "reports/wordpress-actions"); }
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
      const path = this.path(id, kind); const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) throw new Error();
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      throw new ServiceUnavailableException("The WordPress operation record could not be read safely.");
    }
  }
  async create(id: string, kind: string, data: object): Promise<boolean> {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const info = await lstat(this.directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
      const json = JSON.stringify(data, null, 2);
      if (Buffer.byteLength(json) > 4 * 1024 * 1024) throw new Error();
      const handle = await open(this.path(id, kind), "wx", 0o600);
      try { await handle.writeFile(json); await handle.sync(); } finally { await handle.close(); }
      return true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") return false;
      throw new ServiceUnavailableException("The WordPress operation record could not be saved safely.");
    }
  }
}
