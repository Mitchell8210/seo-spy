import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AppDatabase } from "../../persistence/sqlite/app-database.js";

export const assessmentHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Kind = "assessment" | "analysis" | "confirmed-facts" | "edit-origin";
const identity = z.string().uuid();
const fail = () => new ServiceUnavailableException({ code: "ASSESSMENT_STORAGE_ERROR", message: "Saved assessments could not be accessed safely. No provider call or edit was started." });
const MAX_BYTES = 2 * 1024 * 1024;

/** Immutable records with checksums, cache uniqueness and business-scoped reads. Never opens the AI ledger. */
@Injectable()
export class AssessmentStore {
  constructor(private readonly database: AppDatabase) {}
  private decode(row: Record<string, unknown>, businessId: string): unknown {
    if (row.business_id !== businessId || typeof row.data_json !== "string" || Buffer.byteLength(row.data_json) > MAX_BYTES) throw fail();
    const payload: unknown = JSON.parse(row.data_json);
    if (row.checksum !== assessmentHash(payload)) throw fail();
    if (typeof payload !== "object" || payload === null || !("businessId" in payload) || payload.businessId !== businessId || !("id" in payload) || payload.id !== row.id
      || !("createdAt" in payload) || payload.createdAt !== row.created_at || !z.string().datetime().safeParse(row.created_at).success
      || !identity.safeParse(row.id).success || !z.string().regex(/^[a-f0-9]{64}$/).safeParse(row.cache_key).success
      || !["assessment", "analysis", "confirmed-facts", "edit-origin"].includes(String(row.kind))) throw fail();
    return payload;
  }
  read(kind: Kind, businessId: string, id: string): unknown | null {
    try {
      identity.parse(id);
      const row = this.database.connection().prepare("SELECT * FROM assessment_records WHERE kind=? AND business_id=? AND id=?").get(kind, businessId, id);
      return row ? this.decode(row, businessId) : null;
    } catch { throw fail(); }
  }
  list(kind: Kind, businessId: string, limit = 50): unknown[] {
    try {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fail();
      return this.database.connection().prepare("SELECT * FROM assessment_records WHERE kind=? AND business_id=? ORDER BY created_at DESC,id LIMIT ?").all(kind, businessId, limit).map(row => this.decode(row, businessId));
    } catch { throw fail(); }
  }
  byCacheKey(kind: Kind, businessId: string, key: string): unknown | null {
    try { const row = this.database.connection().prepare("SELECT * FROM assessment_records WHERE kind=? AND business_id=? AND cache_key=?").get(kind, businessId, key); return row ? this.decode(row, businessId) : null; }
    catch { throw fail(); }
  }
  write<T extends { id: string; businessId: string; createdAt: string }>(kind: Kind, record: T, cacheKey: string): unknown {
    try {
      identity.parse(record.id); z.string().datetime().parse(record.createdAt); z.string().regex(/^[a-f0-9]{64}$/).parse(cacheKey);
      const payload = JSON.stringify(record);
      if (Buffer.byteLength(payload) > MAX_BYTES) throw fail();
      return this.database.withTransaction(database => {
        const existing = database.prepare("SELECT * FROM assessment_records WHERE kind=? AND business_id=? AND cache_key=?").get(kind, record.businessId, cacheKey);
        if (existing) return this.decode(existing, record.businessId);
        const collision = database.prepare("SELECT * FROM assessment_records WHERE kind=? AND id=?").get(kind, record.id);
        if (collision) { if (collision.checksum !== assessmentHash(record)) throw fail(); return this.decode(collision, record.businessId); }
        database.prepare("INSERT INTO assessment_records(kind,id,business_id,created_at,cache_key,data_json,checksum) VALUES(?,?,?,?,?,?,?)").run(kind, record.id, record.businessId, record.createdAt, cacheKey, payload, assessmentHash(record));
        return record;
      });
    } catch { throw fail(); }
  }
}
