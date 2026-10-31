import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createDemoBusiness, createDemoConnections, createSeedAudit } from "../../fixtures/demo.js";

export type ArtifactKind = "audit-report" | "wordpress-evidence" | "wordpress-muse" | "wordpress-proposal" | "wordpress-started" | "wordpress-outcome" | "wordpress-verification";
export interface AppArtifact { kind: ArtifactKind; id: string; businessId: string; createdAt: string; payload: unknown }
export type AppArtifactInput = AppArtifact;
const kinds = new Set<string>(["audit-report", "wordpress-evidence", "wordpress-muse", "wordpress-proposal", "wordpress-started", "wordpress-outcome", "wordpress-verification"]);
const MAX_BYTES = 32 * 1024 * 1024;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const dateSchema = z.string().datetime();
const date = (value: unknown): value is string => dateSchema.safeParse(value).success;
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && ![...value].some(character => character.charCodeAt(0) < 32);

export class AppDatabaseError extends Error {
  constructor(public readonly code = "DATABASE_UNAVAILABLE", message = "The application database could not be accessed safely.") { super(message); this.name = "AppDatabaseError"; }
}
const fail = () => new AppDatabaseError();

/** Application data only. The separately protected AI credit ledger is never opened here. */
@Injectable()
export class AppDatabase implements OnApplicationShutdown {
  private readonly path: string;
  private database?: DatabaseSync;
  private inode?: number;
  private device?: number;
  private depth = 0;
  constructor(config: ConfigService) {
    const configured = config.get<string>("DATABASE_PATH") ?? "reports/seo-spy.sqlite";
    if (configured === ":memory:") {
      if (config.get<string>("NODE_ENV") !== "test" && process.env.NODE_ENV !== "test") throw fail();
      this.path = configured;
    } else {
      const root = fileURLToPath(new URL("../../../", import.meta.url));
      this.path = resolve(root, configured);
      const budgetPath = resolve(root, config.get<string>("AI_USAGE_DB") ?? "reports/ai-usage.sqlite");
      const normalized = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
      if (normalized(this.path) === normalized(budgetPath)) throw fail();
      if (existsSync(this.path) && existsSync(budgetPath)) {
        const target = lstatSync(this.path), ledger = lstatSync(budgetPath);
        if (target.ino !== 0 && target.ino === ledger.ino && target.dev === ledger.dev) throw fail();
      }
    }
  }
  close(): void { this.database?.close(); this.database = undefined; }
  onApplicationShutdown(): void { this.close(); }

  private safeFile(path: string): boolean {
    if (!existsSync(path)) return false;
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw fail();
    return true;
  }
  connection(): DatabaseSync {
    try {
      const memory = this.path === ":memory:";
      let existing = false;
      let sentinel = false;
      if (!memory) {
        const directory = dirname(this.path);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const directoryInfo = lstatSync(directory);
        if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw fail();
        existing = this.safeFile(this.path);
        sentinel = this.safeFile(`${this.path}.initialized`);
        if (!existing && (sentinel || this.database)) throw fail();
        for (const suffix of ["-journal", "-wal", "-shm"]) this.safeFile(this.path + suffix);
        if (this.database) {
          const info = lstatSync(this.path);
          if (info.ino !== this.inode || info.dev !== this.device) throw fail();
        }
      }
      if (this.database) return this.database;
      const database = new DatabaseSync(this.path, { enableForeignKeyConstraints: true, allowExtension: false });
      try {
        const version = database.prepare("PRAGMA user_version").get()?.user_version;
        if (existing && version !== 1) throw fail();
        database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
        if (!existing) {
          database.exec(`BEGIN IMMEDIATE;
            CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
            CREATE TABLE businesses (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json)));
            CREATE TABLE connections (business_id TEXT NOT NULL REFERENCES businesses(id), platform TEXT NOT NULL CHECK(platform IN ('website','facebook')), data_json TEXT NOT NULL CHECK(json_valid(data_json)), PRIMARY KEY(business_id,platform));
            CREATE TABLE audits (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), scope TEXT NOT NULL CHECK(scope IN ('demo','homepage','lighthouse','facebook')), status TEXT NOT NULL CHECK(status IN ('queued','running','completed','partial','failed')), stage TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, revision INTEGER NOT NULL DEFAULT 1, data_json TEXT NOT NULL CHECK(json_valid(data_json)));
            CREATE UNIQUE INDEX audits_one_active ON audits(business_id,CASE WHEN scope='facebook' THEN 'facebook' ELSE 'website' END) WHERE status IN ('queued','running');
            CREATE INDEX audits_business_completed ON audits(business_id,status,completed_at DESC);
            CREATE TABLE suggestions (audit_id TEXT NOT NULL REFERENCES audits(id), id TEXT NOT NULL, business_id TEXT NOT NULL REFERENCES businesses(id), status TEXT NOT NULL, created_at TEXT NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json)), PRIMARY KEY(audit_id,id));
            CREATE INDEX suggestions_business_status ON suggestions(business_id,status,created_at DESC);
            CREATE TABLE findings (audit_id TEXT NOT NULL REFERENCES audits(id), id TEXT NOT NULL, business_id TEXT NOT NULL REFERENCES businesses(id), status TEXT NOT NULL, created_at TEXT NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json)), PRIMARY KEY(audit_id,id));
            CREATE TABLE artifacts (kind TEXT NOT NULL CHECK(kind IN ('audit-report','wordpress-evidence','wordpress-muse','wordpress-proposal','wordpress-started','wordpress-outcome','wordpress-verification')), id TEXT NOT NULL, business_id TEXT NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), checksum TEXT NOT NULL, PRIMARY KEY(kind,id));
            CREATE INDEX artifacts_business_date ON artifacts(kind,business_id,created_at DESC,id);
            INSERT INTO schema_migrations(version,applied_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
            PRAGMA user_version=1;
            COMMIT;`);
        }
        if (database.prepare("PRAGMA quick_check").get()?.quick_check !== "ok" || database.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE version=1").get()?.count !== 1) throw fail();
        this.database = database;
        if (!memory) {
          const info = lstatSync(this.path);
          if (!info.isFile() || info.isSymbolicLink()) throw fail();
          this.inode = info.ino; this.device = info.dev;
          chmodSync(this.path, 0o600);
          if (!sentinel) {
            let handle: number | undefined;
            try { handle = openSync(`${this.path}.initialized`, "wx", 0o600); writeFileSync(handle, "seo-spy.application-database.v1\n"); fsyncSync(handle); }
            catch (error) { if (!(object(error) && error.code === "EEXIST")) throw error; }
            finally { if (handle !== undefined) closeSync(handle); }
          }
        }
        return database;
      } catch (error) { database.close(); this.database = undefined; throw error; }
    } catch { throw fail(); }
  }
  withTransaction<T>(operation: (database: DatabaseSync) => T): T {
    const database = this.connection();
    const nested = this.depth > 0;
    const savepoint = `app_transaction_${this.depth}`;
    this.depth++;
    try {
      database.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
      const result = operation(database);
      if (object(result) && typeof result.then === "function") throw fail();
      database.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT");
      return result;
    } catch (error) {
      try { database.exec(nested ? `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}` : "ROLLBACK"); } catch { /* Preserve original failure. */ }
      if (error instanceof AppDatabaseError) throw error;
      throw fail();
    } finally { this.depth--; }
  }
  ensureSeeded(): void {
    this.withTransaction(database => {
      const business = createDemoBusiness();
      business.createdAt = "2026-10-27T00:00:00.000Z";
      if (database.prepare("SELECT id FROM businesses WHERE id=?").get(business.id)) return;
      database.prepare("INSERT INTO businesses(id,created_at,data_json) VALUES(?,?,?)").run(business.id, business.createdAt, JSON.stringify(business));
      for (const connection of createDemoConnections(business)) database.prepare("INSERT INTO connections(business_id,platform,data_json) VALUES(?,?,?)").run(business.id, connection.platform, JSON.stringify(connection));
      const audit = createSeedAudit(business.id);
      audit.createdAt = business.createdAt; audit.startedAt = business.createdAt; audit.completedAt = business.createdAt;
      for (const item of audit.results?.evidence ?? []) item.collectedAt = business.createdAt;
      database.prepare("INSERT INTO audits(id,business_id,scope,status,stage,created_at,started_at,completed_at,data_json) VALUES(?,?,?,?,?,?,?,?,?)").run(audit.id, audit.businessId, audit.scope, audit.status, audit.stage, audit.createdAt, audit.startedAt, audit.completedAt, JSON.stringify(audit));
      for (const item of audit.results?.recommendations ?? []) database.prepare("INSERT INTO suggestions(audit_id,id,business_id,status,created_at,data_json) VALUES(?,?,?,?,?,?)").run(audit.id, item.id, audit.businessId, item.status, audit.completedAt, JSON.stringify(item));
      for (const item of audit.results?.findings ?? []) database.prepare("INSERT INTO findings(audit_id,id,business_id,status,created_at,data_json) VALUES(?,?,?,?,?,?)").run(audit.id, item.id, audit.businessId, item.status, audit.completedAt, JSON.stringify(item));
    });
  }
  private validateArtifact(artifact: AppArtifact): string {
    if (!kinds.has(artifact.kind) || !identifier(artifact.id) || !identifier(artifact.businessId) || !date(artifact.createdAt) || !object(artifact.payload)) throw fail();
    const payload = JSON.stringify(artifact.payload);
    if (Buffer.byteLength(payload) > MAX_BYTES) throw fail();
    const sourceBusiness = artifact.payload.businessId ?? (object(artifact.payload.business) ? artifact.payload.business.id : undefined);
    const sourceId = artifact.kind === "audit-report" ? artifact.payload.reportId : artifact.payload.id;
    if (sourceBusiness !== undefined && sourceBusiness !== artifact.businessId || sourceId !== undefined && sourceId !== artifact.id) throw fail();
    return payload;
  }
  private artifact(row: Record<string, unknown>): AppArtifact {
    if (typeof row.payload_json !== "string" || Buffer.byteLength(row.payload_json) > MAX_BYTES || row.checksum !== digest(row.payload_json)) throw fail();
    const artifact = { kind: row.kind as ArtifactKind, id: row.id as string, businessId: row.business_id as string, createdAt: row.created_at as string, payload: JSON.parse(row.payload_json) as unknown };
    this.validateArtifact(artifact);
    return artifact;
  }
  readArtifact(kind: ArtifactKind, id: string): AppArtifact | null {
    if (!kinds.has(kind) || !identifier(id)) throw fail();
    try { const row = this.connection().prepare("SELECT * FROM artifacts WHERE kind=? AND id=?").get(kind, id); return row ? this.artifact(row) : null; }
    catch { throw fail(); }
  }
  listArtifacts(kind: ArtifactKind, businessId?: string, limit?: number): AppArtifact[] {
    if (!kinds.has(kind) || businessId !== undefined && !identifier(businessId) || limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100000)) throw fail();
    try {
      const database = this.connection();
      const rows = businessId === undefined ? database.prepare("SELECT * FROM artifacts WHERE kind=? ORDER BY julianday(created_at) DESC,id LIMIT ?").all(kind, limit ?? -1) : database.prepare("SELECT * FROM artifacts WHERE kind=? AND business_id=? ORDER BY julianday(created_at) DESC,id LIMIT ?").all(kind, businessId, limit ?? -1);
      return rows.map(row => this.artifact(row));
    } catch { throw fail(); }
  }
  insertArtifact(artifact: AppArtifact): boolean {
    try {
      const payload = this.validateArtifact(artifact);
      return this.withTransaction(database => {
        if (database.prepare("SELECT id FROM artifacts WHERE kind=? AND id=?").get(artifact.kind, artifact.id)) return false;
        database.prepare("INSERT INTO artifacts(kind,id,business_id,created_at,payload_json,checksum) VALUES(?,?,?,?,?,?)").run(artifact.kind, artifact.id, artifact.businessId, artifact.createdAt, payload, digest(payload));
        return true;
      });
    } catch { throw fail(); }
  }
}
