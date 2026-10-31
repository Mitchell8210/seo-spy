import { Injectable } from "@nestjs/common";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Audit, Business, Connection } from "../../contracts/domain.js";
import { facebookReportSchema } from "../../integrations/facebook/types.js";
import type { AuditRepository, BusinessRepository } from "../repositories.js";
import { AppDatabase, AppDatabaseError } from "./app-database.js";

const id = z.string().min(1).max(256);
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const businessSchema = z.object({ id, name: z.string(), website: z.string().url(), createdAt: timestamp });
const connectionSchema = z.object({ id, businessId: id, platform: z.enum(["website", "facebook"]), identity: z.string(), status: z.enum(["connected", "disconnected", "authorization_required", "checking", "error"]), mode: z.enum(["demo", "live"]) });
const evidenceSchema = z.object({ id, auditId: id, checkId: id, sourceUrl: z.string(), collectedAt: timestamp, observed: z.record(z.string(), z.string()), mode: z.enum(["demo", "live"]) });
const findingSchema = z.object({ id, auditId: id, checkId: id, evidenceIds: z.array(id), severity: z.enum(["critical", "medium", "low"]), source: z.enum(["website", "website_and_facebook", "facebook"]), title: z.string(), explanation: z.string(), status: z.literal("needs_review") });
const suggestionSchema = z.object({ id, auditId: id, findingId: id, title: z.string(), explanation: z.string(), recommendedChange: z.string(), purpose: z.string(), status: z.literal("needs_review") });
const auditSchema = z.object({
  id, businessId: id, scope: z.enum(["demo", "homepage", "lighthouse", "facebook"]), mode: z.enum(["demo", "live"]),
  status: z.enum(["queued", "running", "completed", "partial", "failed"]), stage: z.enum(["queued", "collecting_evidence", "evaluating_checks", "running_lighthouse", "preparing_recommendations", "complete", "failed"]),
  createdAt: timestamp, startedAt: timestamp.nullable(), completedAt: timestamp.nullable(), warnings: z.array(z.string()), failure: z.object({ code: z.string(), message: z.string() }).nullable(),
  scoringVersion: z.enum(["demo-v1", "homepage-v1", "lighthouse-v1", "facebook-v1"]),
  results: z.object({ evidence: z.array(evidenceSchema), findings: z.array(findingSchema), recommendations: z.array(suggestionSchema), scores: z.array(z.object({ category: z.enum(["website", "social", "consistency", "overall"]), value: z.number().nullable(), maximum: z.number(), availability: z.enum(["demo", "unavailable"]), scoringVersion: z.enum(["demo-v1", "homepage-v1", "facebook-v1"]) })) }).passthrough().nullable(),
}).passthrough();
const failure = () => new AppDatabaseError("DATABASE_RECORD_INVALID", "An application database record is invalid or belongs to a different target.");
const active = (audit: Audit) => audit.status === "queued" || audit.status === "running";
const bytes = (value: unknown): string => {
  const json = JSON.stringify(value);
  if (typeof json !== "string" || Buffer.byteLength(json) > 32 * 1024 * 1024) throw failure();
  return json;
};
const readJson = (value: unknown): unknown => {
  if (typeof value !== "string" || Buffer.byteLength(value) > 32 * 1024 * 1024) throw failure();
  try { return JSON.parse(value) as unknown; } catch { throw failure(); }
};

export function validateStoredAudit(input: unknown): Audit {
  if (!auditSchema.safeParse(input).success) throw failure();
  const audit = input as Audit;
  if (active(audit) && audit.completedAt !== null || !active(audit) && audit.completedAt === null) throw failure();
  if (audit.status === "failed" && audit.stage !== "failed" || ["completed", "partial"].includes(audit.status) && audit.stage !== "complete" || active(audit) && ["complete", "failed"].includes(audit.stage)) throw failure();
  if (audit.results) {
    if (audit.results.evidence.some(item => item.auditId !== audit.id) || audit.results.findings.some(item => item.auditId !== audit.id) || audit.results.recommendations.some(item => item.auditId !== audit.id)) throw failure();
    if (new Set(audit.results.evidence.map(item => item.id)).size !== audit.results.evidence.length || new Set(audit.results.findings.map(item => item.id)).size !== audit.results.findings.length || new Set(audit.results.recommendations.map(item => item.id)).size !== audit.results.recommendations.length) throw failure();
    const evidence = new Set(audit.results.evidence.map(item => item.id));
    const findings = new Set(audit.results.findings.map(item => item.id));
    if (audit.results.findings.some(item => item.evidenceIds.some(reference => !evidence.has(reference))) || audit.results.recommendations.some(item => !findings.has(item.findingId))) throw failure();
    if (audit.results.facebook !== undefined && !facebookReportSchema.safeParse(audit.results.facebook).success) throw failure();
  }
  return audit;
}

@Injectable()
export class SQLiteBusinessRepository implements BusinessRepository {
  constructor(private readonly database: AppDatabase) { database.ensureSeeded(); }
  async findById(id: string): Promise<Business | null> {
    const row = this.database.connection().prepare("SELECT * FROM businesses WHERE id=?").get(id);
    if (!row) return null;
    const parsed = businessSchema.safeParse(readJson(row.data_json));
    if (!parsed.success || parsed.data.id !== id || parsed.data.createdAt !== row.created_at) throw failure();
    return parsed.data;
  }
  async connections(businessId: string): Promise<Connection[]> {
    return this.database.connection().prepare("SELECT * FROM connections WHERE business_id=? ORDER BY CASE platform WHEN 'website' THEN 0 ELSE 1 END").all(businessId).map(row => {
      const parsed = connectionSchema.safeParse(readJson(row.data_json));
      if (!parsed.success || parsed.data.businessId !== businessId || parsed.data.platform !== row.platform) throw failure();
      return parsed.data;
    });
  }
  async upsertBusiness(input: Business): Promise<void> {
    const parsed = businessSchema.safeParse(input);
    if (!parsed.success) throw failure();
    this.database.withTransaction(database => {
      const old = database.prepare("SELECT created_at FROM businesses WHERE id=?").get(input.id);
      const business = { ...parsed.data, createdAt: old ? String(old.created_at) : input.createdAt };
      database.prepare("INSERT INTO businesses(id,created_at,data_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json").run(input.id, business.createdAt, bytes(business));
    });
  }
  async importBusiness(input: Business): Promise<boolean> {
    const parsed = businessSchema.safeParse(input);
    if (!parsed.success) throw failure();
    return this.database.withTransaction(database => {
      if (database.prepare("SELECT id FROM businesses WHERE id=?").get(input.id)) return false;
      database.prepare("INSERT INTO businesses(id,created_at,data_json) VALUES(?,?,?)").run(input.id, input.createdAt, bytes(parsed.data));
      return true;
    });
  }
  async saveConnections(businessId: string, input: Connection[]): Promise<void> {
    const parsed = z.array(connectionSchema).safeParse(input);
    if (!parsed.success || parsed.data.some(item => item.businessId !== businessId) || new Set(parsed.data.map(item => item.platform)).size !== parsed.data.length) throw failure();
    this.database.withTransaction(database => {
      if (!database.prepare("SELECT id FROM businesses WHERE id=?").get(businessId)) throw failure();
      database.prepare("DELETE FROM connections WHERE business_id=?").run(businessId);
      for (const item of parsed.data) database.prepare("INSERT INTO connections(business_id,platform,data_json) VALUES(?,?,?)").run(businessId, item.platform, bytes(item));
    });
  }
}

@Injectable()
export class SQLiteAuditRepository implements AuditRepository {
  constructor(private readonly database: AppDatabase) { database.ensureSeeded(); }
  private audit(row: Record<string, unknown>): Audit {
    const audit = validateStoredAudit(readJson(row.data_json));
    if (audit.id !== row.id || audit.businessId !== row.business_id || audit.status !== row.status || audit.stage !== row.stage || audit.scope !== row.scope || audit.createdAt !== row.created_at || audit.startedAt !== row.started_at || audit.completedAt !== row.completed_at) throw failure();
    return audit;
  }
  async findById(id: string): Promise<Audit | null> { const row = this.database.connection().prepare("SELECT * FROM audits WHERE id=?").get(id); return row ? this.audit(row) : null; }
  async latestCompleted(businessId: string): Promise<Audit | null> { const row = this.database.connection().prepare("SELECT * FROM audits WHERE business_id=? AND scope<>'facebook' AND status IN ('completed','partial') ORDER BY julianday(completed_at) DESC,id LIMIT 1").get(businessId); return row ? this.audit(row) : null; }
  async active(businessId: string): Promise<Audit | null> { const row = this.database.connection().prepare("SELECT * FROM audits WHERE business_id=? AND scope<>'facebook' AND status IN ('queued','running') ORDER BY created_at,id LIMIT 1").get(businessId); return row ? this.audit(row) : null; }
  async listInterruptedAudits(): Promise<Audit[]> { return this.database.connection().prepare("SELECT * FROM audits WHERE status IN ('queued','running') ORDER BY created_at,id").all().map(row => this.audit(row)); }
  private write(database: DatabaseSync, audit: Audit): void {
    database.prepare("INSERT INTO audits(id,business_id,scope,status,stage,created_at,started_at,completed_at,data_json) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,stage=excluded.stage,started_at=excluded.started_at,completed_at=excluded.completed_at,data_json=excluded.data_json,revision=audits.revision+1").run(audit.id, audit.businessId, audit.scope, audit.status, audit.stage, audit.createdAt, audit.startedAt, audit.completedAt, bytes(audit));
    database.prepare("DELETE FROM suggestions WHERE audit_id=?").run(audit.id);
    database.prepare("DELETE FROM findings WHERE audit_id=?").run(audit.id);
    const createdAt = audit.completedAt ?? audit.createdAt;
    for (const item of audit.results?.recommendations ?? []) database.prepare("INSERT INTO suggestions(audit_id,id,business_id,status,created_at,data_json) VALUES(?,?,?,?,?,?)").run(audit.id, item.id, audit.businessId, item.status, createdAt, bytes(item));
    for (const item of audit.results?.findings ?? []) database.prepare("INSERT INTO findings(audit_id,id,business_id,status,created_at,data_json) VALUES(?,?,?,?,?,?)").run(audit.id, item.id, audit.businessId, item.status, createdAt, bytes(item));
  }
  async createIfIdle(input: Audit): Promise<boolean> {
    const audit = validateStoredAudit(input);
    return this.database.withTransaction(database => {
      if (database.prepare("SELECT id FROM audits WHERE id=? OR (business_id=? AND (scope='facebook')=(?='facebook') AND status IN ('queued','running')) LIMIT 1").get(audit.id, audit.businessId, audit.scope)) return false;
      this.write(database, audit);
      return true;
    });
  }
  async save(input: Audit): Promise<void> {
    const audit = validateStoredAudit(input);
    this.database.withTransaction(database => {
      const prior = database.prepare("SELECT * FROM audits WHERE id=?").get(audit.id);
      if (prior) {
        const old = this.audit(prior);
        if (old.businessId !== audit.businessId || old.createdAt !== audit.createdAt || old.scope !== audit.scope || old.mode !== audit.mode) throw failure();
        if (!active(old) && active(audit)) throw failure();
      }
      this.write(database, audit);
    });
  }
  async importAudit(input: Audit): Promise<boolean> {
    const audit = validateStoredAudit(input);
    if (active(audit)) throw failure();
    return this.database.withTransaction(database => {
      const prior = database.prepare("SELECT * FROM audits WHERE id=?").get(audit.id);
      if (prior) {
        if (bytes(this.audit(prior)) !== bytes(audit)) throw new AppDatabaseError("DATABASE_IMPORT_CONFLICT", "An imported audit conflicts with an existing persisted audit.");
        return false;
      }
      this.write(database, audit);
      return true;
    });
  }
}
