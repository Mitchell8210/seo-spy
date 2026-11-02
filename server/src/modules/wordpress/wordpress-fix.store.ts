import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AppDatabase } from "../../persistence/sqlite/app-database.js";
export const fixDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Immutable adjunct records in application SQLite. Never opens the spending ledger. */
@Injectable()
export class WordPressFixStore {
  constructor(private readonly database: AppDatabase) {}
  private exists() { return !!this.database.connection().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wordpress_fix_records'").get(); }
  publish<T extends { id: string; businessId: string; actor: string; kind: string; createdAt: string }>(record: T): T {
    const db = this.database.connection();
    db.exec("CREATE TABLE IF NOT EXISTS wordpress_fix_records(id TEXT PRIMARY KEY, business_id TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL, checksum TEXT NOT NULL)");
    db.prepare("INSERT INTO wordpress_fix_records VALUES(?,?,?,?,?,?,?)").run(record.id, record.businessId, record.actor, record.kind, record.createdAt, JSON.stringify(record), fixDigest(record));
    return record;
  }
  list(businessId: string, actor: string): Record<string, unknown>[] {
    if (!this.exists()) return [];
    return this.database.connection().prepare("SELECT payload,checksum FROM wordpress_fix_records WHERE business_id=? AND actor=? ORDER BY created_at DESC,rowid DESC").all(businessId, actor).map(row => {
      const value = JSON.parse(String(row.payload)) as Record<string, unknown>;
      if (fixDigest(value) !== row.checksum || value.businessId !== businessId || value.actor !== actor) throw new ServiceUnavailableException("Fix record integrity failed.");
      return value;
    });
  }
  read(businessId: string, actor: string, id: string) { return this.list(businessId, actor).find(row => row.id === id) ?? null; }
}
