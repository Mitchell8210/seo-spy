import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AppDatabase } from "../../persistence/sqlite/app-database.js";

const MAX_BYTES = 1024 * 1024;
const keySchema = z.string().regex(/^[a-f0-9]{64}$/);
const entrySchema = z.object({
  key: keySchema,
  businessId: z.string().min(1).max(128).refine(value => ![...value].some(character => character.charCodeAt(0) < 32)),
  provider: z.enum(["ga4", "search-console"]),
  expiresAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
}).strict();

export interface GoogleCacheEntry {
  key: string;
  businessId: string;
  provider: "ga4" | "search-console";
  expiresAt: string;
  payload: unknown;
}

export class GoogleCacheError extends Error {
  readonly code = "GOOGLE_CACHE_UNAVAILABLE";
  constructor() { super("The Google response cache could not be accessed safely."); this.name = "GoogleCacheError"; }
}
const failure = () => new GoogleCacheError();
const digest = (payload: string) => createHash("sha256").update(payload).digest("hex");

/** Mutable response cache only. No collection, token refresh, timers or Meta access. */
@Injectable()
export class GoogleCacheStore {
  constructor(private readonly database: AppDatabase) {}

  private validate(input: unknown): GoogleCacheEntry {
    const result = entrySchema.safeParse(input);
    if (!result.success) throw failure();
    const value = result.data;
    if (Object.hasOwn(value.payload, "businessId") && value.payload.businessId !== value.businessId || Object.hasOwn(value.payload, "provider") && value.payload.provider !== value.provider) throw failure();
    return value;
  }

  read(key: string): GoogleCacheEntry | null {
    try {
      if (!keySchema.safeParse(key).success) throw failure();
      const row = this.database.connection().prepare("SELECT * FROM google_reporting_cache WHERE key=?").get(key);
      if (!row) return null;
      if (typeof row.data_json !== "string" || Buffer.byteLength(row.data_json) > MAX_BYTES || row.checksum !== digest(row.data_json)) throw failure();
      const value = this.validate({ key: row.key, businessId: row.business_id, provider: row.provider, expiresAt: row.expires_at, payload: JSON.parse(row.data_json) as unknown });
      if (value.key !== key || !z.string().datetime().safeParse(row.updated_at).success) throw failure();
      // Expired entries are returned deliberately; the service decides stale/negative-cache policy.
      return value;
    } catch { throw failure(); }
  }

  write(entry: GoogleCacheEntry): void {
    try {
      const value = this.validate(entry);
      const json = JSON.stringify(value.payload);
      if (Buffer.byteLength(json) > MAX_BYTES) throw failure();
      this.database.withTransaction(database => {
        const existing = database.prepare("SELECT business_id,provider FROM google_reporting_cache WHERE key=?").get(value.key);
        if (existing && (existing.business_id !== value.businessId || existing.provider !== value.provider)) throw failure();
        database.prepare("INSERT INTO google_reporting_cache(key,business_id,provider,expires_at,updated_at,data_json,checksum) VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at,updated_at=excluded.updated_at,data_json=excluded.data_json,checksum=excluded.checksum").run(value.key, value.businessId, value.provider, value.expiresAt, new Date().toISOString(), json, digest(json));
      });
    } catch { throw failure(); }
  }
}
