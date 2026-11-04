import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { AiUsageStore } from "./ai-usage.store.js";
import { AiUsageError } from "./ai-usage.types.js";

/** Inspect a stable copy; opening the source read-only can create WAL/SHM files. */
export async function readAiUsageSnapshot(config: ConfigService) {
  const source = resolve(fileURLToPath(new URL("../../../", import.meta.url)), config.get<string>("AI_USAGE_DB") ?? "reports/ai-usage.sqlite");
  const paths = [source, source + ".initialized", source + "-wal", source + "-shm", source + "-journal"];
  const fingerprints = async () => Promise.all(paths.map(async (path, index) => {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) throw new Error();
      return createHash("sha256").update(await readFile(path)).digest("hex");
    } catch (error) {
      if (index > 1 && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new AiUsageError("AI_USAGE_UNAVAILABLE", "An existing initialized spending ledger is required; preview never creates or repairs one.");
    }
  }));
  const before = await fingerprints();
  const directory = await mkdtemp(join(tmpdir(), "seo-spy-ledger-preview-"));
  const cleanupAllowed = resolve(directory).startsWith(resolve(tmpdir()) + sep);
  const copiedPath = join(directory, "usage.sqlite");
  const copied = new AiUsageStore(new ConfigService({ AI_USAGE_DB: copiedPath }));
  try {
    for (let index = 0; index < paths.length; index++) if (before[index] !== null && index !== 3) await copyFile(paths[index], copiedPath + paths[index].slice(source.length));
    const summary = await copied.status();
    if (JSON.stringify(await fingerprints()) !== JSON.stringify(before)) throw new AiUsageError("AI_USAGE_UNAVAILABLE", "The source ledger changed during preview; no authorization was created.");
    return summary;
  } finally {
    copied.onModuleDestroy();
    if (cleanupAllowed) await rm(directory, { recursive: true });
  }
}
