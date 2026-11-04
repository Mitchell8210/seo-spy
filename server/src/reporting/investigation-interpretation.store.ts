import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { AppDatabase } from "../persistence/sqlite/app-database.js";
import { interpretationHash, interpretationSchema, type InvestigationInterpretation } from "./investigation-interpretation.js";

/** Independent immutable report references. Reads never create tables or dispatch work. */
@Injectable()
export class InvestigationInterpretationStore {
  constructor(private readonly database: AppDatabase) {}
  private exists() { return !!this.database.connection().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='investigation_interpretations'").get(); }
  private decode(row: Record<string, unknown>): InvestigationInterpretation {
    if (typeof row.payload !== "string" || row.payload.length > 100000 || interpretationHash(JSON.parse(row.payload)) !== row.checksum) throw new Error();
    const value = interpretationSchema.parse(JSON.parse(row.payload));
    if (value.id !== row.id || value.businessId !== row.business_id) throw new Error();
    return value;
  }
  private failed(): never { throw new ServiceUnavailableException({ code: "AI_INTERPRETATION_STORAGE", message: "Saved AI interpretation storage is unavailable. No automatic model retry was started." }); }
  reserve(key: string, value: InvestigationInterpretation) {
    try {
      return this.database.withTransaction(db => {
        db.exec("CREATE TABLE IF NOT EXISTS investigation_interpretations(id TEXT PRIMARY KEY,business_id TEXT NOT NULL,cache_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,payload TEXT NOT NULL,checksum TEXT NOT NULL)");
        const old = db.prepare("SELECT * FROM investigation_interpretations WHERE cache_key=?").get(key);
        if (old) { const saved = this.decode(old); if (saved.businessId !== value.businessId) throw new Error(); return { fresh: false, value: saved }; }
        const parsed = interpretationSchema.parse(value), payload = JSON.stringify(parsed);
        db.prepare("INSERT INTO investigation_interpretations VALUES(?,?,?,?,?,?)").run(parsed.id, parsed.businessId, key, parsed.createdAt, payload, interpretationHash(parsed));
        return { fresh: true, value: parsed };
      });
    } catch { this.failed(); }
  }
  finish(value: InvestigationInterpretation) {
    try {
      const parsed = interpretationSchema.parse(value);
      return this.database.withTransaction(db => {
        const row = db.prepare("SELECT * FROM investigation_interpretations WHERE id=? AND business_id=?").get(parsed.id, parsed.businessId);
        if (!row || this.decode(row).status !== "pending" || parsed.status === "pending") throw new Error();
        db.prepare("UPDATE investigation_interpretations SET payload=?,checksum=? WHERE id=?").run(JSON.stringify(parsed), interpretationHash(parsed), parsed.id);
        return parsed;
      });
    } catch { this.failed(); }
  }
  saved(businessId: string, reportIds: string[], exact = true): InvestigationInterpretation | null {
    try {
      if (!this.exists() || !reportIds.length) return null;
      for (const row of this.database.connection().prepare("SELECT * FROM investigation_interpretations WHERE business_id=? ORDER BY created_at DESC,id DESC LIMIT 100").all(businessId)) {
        const value = this.decode(row);
        if (value.businessId !== businessId) throw new Error();
        if ((!exact || value.sources.length === reportIds.length) && reportIds.every(id => value.sources.some(source => source.reportId === id))) return value;
      }
      return null;
    } catch { this.failed(); }
  }
}
