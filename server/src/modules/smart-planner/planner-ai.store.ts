import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AppDatabase, AppDatabaseError } from "../../persistence/sqlite/app-database.js";
import { z } from "zod";
import { canonical, checksum } from "./planner.types.js";
import { aiOutputSchema, aiSettingsSchema, aiSnapshotSchema, defaultAiSettings, snapshotHash, PLANNER_AI_PROMPT_VERSION, PLANNER_AI_SCHEMA_VERSION, type AiDiagnostic, type AiPlanOutput, type AiPlannerSettings, type AiSnapshot } from "./planner-ai.domain.js";

export interface AiProposalRecord {
  id: string; businessId: string; mutationId: string; requestHash: string; createdAt: string; expiresAt: string;
  promptVersion: string; schemaVersion: string; mode: "mock" | "live"; model: string | null;
  status: "generating" | "ready" | "invalid" | "failed" | "approval_required" | "applied";
  snapshot: AiSnapshot; snapshotHash: string; output: AiPlanOutput | null; diagnostics: AiDiagnostic[];
  appliedAt: string | null; applicationMutationId: string | null; applicationRequestHash: string | null;
  requestIdentity: string | null; accountingAttemptId: string | null;
}
const invalid = () => new AppDatabaseError("DATABASE_RECORD_INVALID", "The saved AI planning record could not be accessed safely.");
const recordSchema = z.object({
  id: z.string().uuid(), businessId: z.string().min(1).max(160), mutationId: z.string().uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
  promptVersion: z.literal(PLANNER_AI_PROMPT_VERSION), schemaVersion: z.literal(PLANNER_AI_SCHEMA_VERSION), mode: z.enum(["mock", "live"]), model: z.string().max(100).nullable(),
  status: z.enum(["generating", "ready", "invalid", "failed", "approval_required", "applied"]), snapshot: aiSnapshotSchema, snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), output: aiOutputSchema.nullable(),
  diagnostics: z.array(z.object({ code: z.string().max(100), detail: z.string().max(2000), taskId: z.string().uuid().optional() }).strict()).max(50),
  appliedAt: z.string().datetime().nullable(), applicationMutationId: z.string().uuid().nullable(), applicationRequestHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  requestIdentity: z.string().regex(/^[a-f0-9]{64}$/).nullable(), accountingAttemptId: z.string().max(128).nullable(),
}).strict().superRefine((record, context) => {
  if (snapshotHash(record.snapshot) !== record.snapshotHash || record.snapshot.businessId !== record.businessId || record.expiresAt <= record.createdAt
    || ["ready", "applied"].includes(record.status) !== (record.output !== null)
    || (record.status === "applied") !== (record.appliedAt !== null && record.applicationMutationId !== null && record.applicationRequestHash !== null)
    || record.mode === "mock" && (record.requestIdentity !== null || record.accountingAttemptId !== null)
    || record.output && (record.output.snapshotHash !== record.snapshotHash || record.output.businessId !== record.businessId || record.output.plannerRevision !== record.snapshot.plannerRevision)) context.addIssue({ code: "custom", message: "Proposal metadata mismatch" });
});
@Injectable()
export class PlannerAiStore {
  constructor(private readonly database: AppDatabase) {}
  settings(businessId: string): AiPlannerSettings {
    const row = this.database.connection().prepare("SELECT data_json,checksum FROM smart_planner_ai_preferences WHERE business_id=?").get(businessId);
    if (!row) return structuredClone(defaultAiSettings);
    const value = this.decode(row, 8192), parsed = aiSettingsSchema.safeParse(value);
    if (!parsed.success) throw invalid(); return parsed.data;
  }
  saveSettings(businessId: string, settings: AiPlannerSettings) {
    const data = canonical(aiSettingsSchema.parse(settings));
    this.database.connection().prepare("INSERT INTO smart_planner_ai_preferences(business_id,data_json,checksum) VALUES(?,?,?) ON CONFLICT(business_id) DO UPDATE SET data_json=excluded.data_json,checksum=excluded.checksum").run(businessId, data, checksum(data));
  }
  private decode(row: Record<string, unknown>, maximum: number): unknown {
    if (typeof row.data_json !== "string" || Buffer.byteLength(row.data_json) > maximum || checksum(row.data_json) !== row.checksum) throw invalid();
    try { return JSON.parse(row.data_json) as unknown; } catch { throw invalid(); }
  }
  private record(row: Record<string, unknown>): AiProposalRecord {
    const parsed = recordSchema.safeParse(this.decode(row, 512 * 1024));
    if (!parsed.success) throw invalid();
    const value = parsed.data;
    if (value.id !== row.id || value.businessId !== row.business_id || value.mutationId !== row.mutation_id || value.requestHash !== row.request_hash || value.createdAt !== row.created_at) throw invalid();
    return value;
  }
  findMutation(businessId: string, mutationId: string) {
    const row = this.database.connection().prepare("SELECT * FROM smart_planner_ai_proposals WHERE business_id=? AND mutation_id=?").get(businessId, mutationId);
    return row ? this.record(row) : null;
  }
  get(businessId: string, id: string) {
    const row = this.database.connection().prepare("SELECT * FROM smart_planner_ai_proposals WHERE business_id=? AND id=?").get(businessId, id);
    if (!row) throw new NotFoundException({ code: "AI_PROPOSAL_NOT_FOUND", message: "The proposal was not found for this business." });
    return this.record(row);
  }
  latest(businessId: string) {
    const row = this.database.connection().prepare("SELECT * FROM smart_planner_ai_proposals WHERE business_id=? ORDER BY rowid DESC LIMIT 1").get(businessId);
    return row ? this.record(row) : null;
  }
  reserve(record: AiProposalRecord): { record: AiProposalRecord; created: boolean } {
    // Typed application errors are checked outside AppDatabase's SQL-error envelope.
    const result = this.database.withTransaction(db => {
      const prior = this.findMutation(record.businessId, record.mutationId);
      if (prior) return { record: prior, created: false, conflict: false };
      const revision = db.prepare("SELECT revision FROM smart_planners WHERE business_id=?").get(record.businessId)?.revision ?? 0;
      if (revision !== record.snapshot.plannerRevision || canonical(this.settings(record.businessId)) !== canonical(record.snapshot.settings)) return { record, created: false, conflict: true };
      const data = canonical(record);
      db.prepare("INSERT INTO smart_planner_ai_proposals(id,business_id,mutation_id,request_hash,created_at,data_json,checksum) VALUES(?,?,?,?,?,?,?)").run(record.id, record.businessId, record.mutationId, record.requestHash, record.createdAt, data, checksum(data));
      return { record, created: true, conflict: false };
    });
    if (result.conflict || result.record.requestHash !== record.requestHash) throw new ConflictException({ code: "AI_PROPOSAL_CONFLICT", message: "The planner or request changed. Review current settings and generate a new proposal." });
    return result;
  }
  update(record: AiProposalRecord) {
    const data = canonical(record);
    if (Buffer.byteLength(data) > 512 * 1024) throw invalid();
    const result = this.database.connection().prepare("UPDATE smart_planner_ai_proposals SET data_json=?,checksum=? WHERE id=? AND business_id=?").run(data, checksum(data), record.id, record.businessId);
    if (result.changes !== 1) throw invalid();
  }
}
