import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AiUsageError } from "./ai-usage.types.js";
import { transparencySelectionSchema } from "../assessment-ai/assessment-muse.types.js";
import { wordPressAltStatus } from "./muse-wordpress-alt-ledger.js";
import { wordPressAllowanceAccounting } from "./muse-wordpress-allowance.js";

export const MUSE_TESTING_POLICY = { version: "muse-controlled-testing-v1", budgetMicros: 5_000_000, dailyReservationMicros: 2_000_000, maxCalls: 10, perRequestMicros: 500_000, concurrency: 1, retries: 0,
  protectedDemoMicros: 148_000_000, promotionalPoolMicros: 150_000_000 } as const;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const MUSE_TESTING_POLICY_HASH = digest(MUSE_TESTING_POLICY);
const hash = z.string().regex(/^[a-f0-9]{64}$/), micros = z.number().int().nonnegative();
const allocationSchema = z.object({ policyHash: z.literal(MUSE_TESTING_POLICY_HASH), actor: hash, approvedAt: z.string().datetime(), firstRequestHash: hash, firstMaximumMicros: micros.positive().max(500000), fundedMicros: micros.max(1_854_992),
  historicalIds: z.array(z.string().uuid()).length(4), historicalHash: hash }).strict();
export const testingMetadataSchema = z.object({ assessmentId: z.string().uuid(), businessId: z.string().min(1).max(100), inputHash: hash, sourceManifestHash: hash, analysisCacheKey: hash,
  reasoning: z.enum(["minimal", "low"]), promptVersion: z.string().max(100), outputSchemaVersion: z.enum(["assessment-muse-output-v3", "assessment-muse-output-v4"]),
  selectionSchemaVersion: z.literal("assessment-muse-selection-output-v5").optional() }).strict().superRefine((value, context) => {
    const v5 = value.selectionSchemaVersion === "assessment-muse-selection-output-v5";
    if (v5 ? value.promptVersion !== "assessment-muse-prompt-v5" || value.outputSchemaVersion !== "assessment-muse-output-v4" || value.reasoning !== "minimal" : value.promptVersion === "assessment-muse-prompt-v5")
      context.addIssue({ code: "custom", message: "V5 testing requires its exact selector, prompt, v4 renderer and minimal reasoning." });
    if (!v5 && value.outputSchemaVersion === "assessment-muse-output-v4" && (value.promptVersion !== "assessment-muse-prompt-v4" || value.reasoning !== "minimal"))
      context.addIssue({ code: "custom", message: "V4 testing requires its exact prompt and minimal reasoning." });
  });
export const testingReceiptSchema = z.object({ assessmentId: z.string().uuid(), inputHash: hash, requestHash: hash, model: z.literal("muse-spark-1.3"), reasoning: z.enum(["minimal", "low"]),
  inputTokens: micros.nullable(), outputTokens: micros.nullable(), reasoningTokens: micros.nullable(), estimatedTokenMicros: micros.nullable(), reservedMicros: micros.max(500000), ledgerChargeMicros: micros.nullable(),
  attemptId: z.string().uuid().nullable(), requestId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/).nullable(), httpStatus: z.number().int().min(100).max(599).nullable(),
  completionStatus: z.enum(["completed", "incomplete", "failed", "in_progress", "queued", "cancelled"]).nullable(), incompletionReason: z.string().regex(/^[a-z_]{1,64}$/).nullable(),
  failureCategory: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable(), providerError: z.object({ code: z.string().max(128).nullable(), type: z.string().max(128).nullable(), message: z.string().max(512).nullable() }).strict().nullable(),
  schemaValid: z.boolean().nullable(), idsValid: z.boolean().nullable(), persisted: z.boolean(), analysisId: z.string().uuid().nullable(), cacheHit: z.boolean(),
  selectedIds: z.object({ strengths: z.array(z.string().max(160)).max(3), weaknesses: z.array(z.string().max(160)).max(3), recommendations: z.array(z.string().max(160)).max(3) }).strict().nullable(),
  selectionVersion: z.enum(["assessment-muse-selection-output-v4", "assessment-muse-selection-output-v5"]).optional(),
  decisionLabels: transparencySelectionSchema.optional(),
}).strict().superRefine((value, context) => {
  const v5 = value.selectionVersion === "assessment-muse-selection-output-v5";
  if ((value.decisionLabels !== undefined) !== (v5 && value.idsValid === true)
    || value.decisionLabels && JSON.stringify(value.decisionLabels.selected.map(row => row.id)) !== JSON.stringify(value.selectedIds?.recommendations))
    context.addIssue({ code: "custom", message: "Only semantically validated v5 labels may be retained, in the recorded selection order." });
});
export type TestingReceipt = z.infer<typeof testingReceiptSchema>;
export const testingFail = (code = "AI_TESTING_UNAVAILABLE") => { throw new AiUsageError(code, "Controlled testing authorization or accounting did not validate; no additional request is permitted."); };
export const testingExists = (db: DatabaseSync) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='muse_testing_allocation'").get();
const historical = (db: DatabaseSync, ids: string[]) => ({ policy: db.prepare(db.prepare("SELECT name FROM sqlite_master WHERE name='ai_policy_before_shared'").get() ? "SELECT budget,daily,calls FROM ai_policy_before_shared" : "SELECT budget,daily,calls FROM policy WHERE id=1").get(),
  attempts: ids.map(id => db.prepare("SELECT * FROM attempts WHERE id=?").get(id)), intents: ids.map(id => db.prepare("SELECT * FROM intents WHERE id=(SELECT intent_id FROM attempts WHERE id=?)").get(id)),
  amendments: ["hello_diagnostic_amendment", "corrected_hello_amendment", "minimal_hello_amendment"].map(name => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) ? db.prepare(`SELECT * FROM ${name} ORDER BY id`).all() : null) });
export function testingAllocation(db: DatabaseSync) {
  if (!testingExists(db)) return null;
  const row = db.prepare("SELECT * FROM muse_testing_allocation WHERE id=1").get();
  if (!row || typeof row.payload !== "string" || digest(JSON.parse(row.payload)) !== row.checksum) return testingFail();
  const record = allocationSchema.parse(JSON.parse(row.payload));
  if (digest(historical(db, record.historicalIds)) !== record.historicalHash) return testingFail();
  return record;
}
export function activateTesting(db: DatabaseSync, actor: string, confirmation: { confirmed: boolean; policyHash: string; requestHash: string; maximumMicros: number }) {
  if (!hash.safeParse(actor).success || !confirmation.confirmed || confirmation.policyHash !== MUSE_TESTING_POLICY_HASH || !hash.safeParse(confirmation.requestHash).success || !Number.isSafeInteger(confirmation.maximumMicros) || confirmation.maximumMicros < 1 || confirmation.maximumMicros > 500000) return testingFail("AI_APPROVAL_MISMATCH");
  if (testingExists(db)) return testingFail("AI_TESTING_ALREADY_ACTIVATED");
  const rows = db.prepare("SELECT * FROM attempts ORDER BY rowid").all(), policy = db.prepare("SELECT * FROM policy WHERE id=1").get();
  if (rows.length !== 4 || rows.some(row => row.mode !== "poc" || !["success", "failed"].includes(String(row.status))) || rows.reduce((sum, row) => sum + Number(row.charged_micros), 0) !== 145008
    || !policy || policy.budget !== 152744 || policy.daily !== 152744 || policy.calls !== 4 || policy.halted !== 0
    || db.prepare("SELECT id FROM intents WHERE approved_at IS NOT NULL AND consumed_at IS NULL LIMIT 1").get()) return testingFail("AI_TESTING_BASELINE_MISMATCH");
  // A $5 policy ceiling is not permission to consume the protected $148 reserve.
  const fundedMicros = Math.min(MUSE_TESTING_POLICY.budgetMicros, MUSE_TESTING_POLICY.promotionalPoolMicros - MUSE_TESTING_POLICY.protectedDemoMicros - 145008);
  if (confirmation.maximumMicros > fundedMicros) return testingFail("AI_TESTING_FUNDING");
  const historicalIds = rows.map(row => String(row.id));
  const allocation = allocationSchema.parse({ policyHash: MUSE_TESTING_POLICY_HASH, actor, approvedAt: new Date().toISOString(), firstRequestHash: confirmation.requestHash, firstMaximumMicros:confirmation.maximumMicros, fundedMicros, historicalIds, historicalHash: digest(historical(db, historicalIds)) });
  db.exec("CREATE TABLE muse_testing_allocation(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE muse_testing_intents(intent_id TEXT PRIMARY KEY REFERENCES intents(id),request_hash TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE muse_testing_receipts(intent_id TEXT PRIMARY KEY REFERENCES muse_testing_intents(intent_id),payload TEXT NOT NULL,checksum TEXT NOT NULL)");
  db.prepare("INSERT INTO muse_testing_allocation VALUES(1,?,?)").run(JSON.stringify(allocation), digest(allocation));
  return allocation;
}
export function testingIntent(db: DatabaseSync, id: string) {
  if (!testingExists(db)) return null;
  testingAllocation(db);
  const row = db.prepare("SELECT * FROM muse_testing_intents WHERE intent_id=?").get(id);
  if (!row) return null;
  const value = JSON.parse(String(row.payload));
  if (digest(value) !== row.checksum) return testingFail();
  return testingMetadataSchema.parse(value);
}
export function testingStatus(db: DatabaseSync) {
  const allocation = testingAllocation(db); if (!allocation) return null;
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare("SELECT a.* FROM attempts a JOIN muse_testing_intents t ON t.intent_id=a.intent_id ORDER BY a.rowid").all();
  const alt = wordPressAltStatus(db);
  const allowance = wordPressAllowanceAccounting(db);
  return { policy: MUSE_TESTING_POLICY, allocation, calls: rows.length, chargedMicros: rows.reduce((n,r)=>n+Number(r.charged_micros),0), dailyReservedMicros: rows.filter(r=>String(r.reserved_at).startsWith(today)).reduce((n,r)=>n+Number(r.reserve_micros),0) + (alt?.dailyReservedMicros ?? 0) + (allowance?.dailyReservedMicros ?? 0),
    incompleteReceipts: rows.filter(r=>!db.prepare("SELECT intent_id FROM muse_testing_receipts WHERE intent_id=?").get(String(r.intent_id))).length + (alt?.incompleteReceipts ?? 0) + (allowance?.incompleteReceipts ?? 0),
    ...(alt || allowance ? { effectiveFundedMicros: allocation.fundedMicros - (alt?.funding.request.reserveMicros ?? 0) - (allowance ? 150000 : 0), effectiveMaxCalls: 10 - (alt ? 1 : 0) - (allowance ? 3 : 0), earmarkedWordPressAltMicros: (alt?.funding.request.reserveMicros ?? 0) + (allowance ? 150000 : 0) } : {}) };
}
export function verifyTestingBudget(db: DatabaseSync, requestHash: string, reserve: number) {
  const status = testingStatus(db); if (!status) return testingFail("AI_TESTING_NOT_ACTIVATED");
  if (status.earmarkedWordPressAltMicros !== undefined && db.prepare("SELECT halted FROM policy WHERE id=1").get()?.halted !== 0) return testingFail("AI_USAGE_HALTED");
  if (reserve > 500000 || status.calls >= (status.effectiveMaxCalls ?? 10) || status.chargedMicros + reserve > Math.min(5000000,status.effectiveFundedMicros ?? status.allocation.fundedMicros) || status.dailyReservedMicros + reserve > 2000000) return testingFail("AI_TESTING_LIMIT");
  if (status.incompleteReceipts) return testingFail("AI_TESTING_REVIEW_REQUIRED");
  if (status.calls === 0 && (requestHash !== status.allocation.firstRequestHash || reserve !== status.allocation.firstMaximumMicros)) return testingFail("AI_APPROVAL_MISMATCH");
}
export function saveTestingReceipt(db: DatabaseSync, intentId: string, input: unknown) {
  const metadata = testingIntent(db,intentId); if (!metadata) return testingFail();
  const receipt = testingReceiptSchema.parse(input);
  const v4 = metadata.outputSchemaVersion === "assessment-muse-output-v4";
  const selector = metadata.selectionSchemaVersion ?? (v4 ? "assessment-muse-selection-output-v4" : undefined);
  if (selector !== receipt.selectionVersion
    || v4 && receipt.selectedIds && (receipt.selectedIds.strengths.length || receipt.selectedIds.weaknesses.length
      || new Set(receipt.selectedIds.recommendations).size !== receipt.selectedIds.recommendations.length)) return testingFail();
  const intent = db.prepare("SELECT * FROM intents WHERE id=?").get(intentId), payload = JSON.parse(String(intent?.payload));
  const attempt = db.prepare("SELECT * FROM attempts WHERE intent_id=?").get(intentId);
  if (receipt.assessmentId !== metadata.assessmentId || receipt.inputHash !== metadata.inputHash || receipt.requestHash !== payload.requestHash || receipt.reservedMicros !== payload.reserveMicros
    || receipt.reasoning !== metadata.reasoning || receipt.model !== payload.model || receipt.cacheHit || !attempt || attempt.status === "reserved" || receipt.attemptId !== attempt.id || receipt.ledgerChargeMicros !== attempt.charged_micros
    || receipt.requestId !== attempt.request_id || receipt.inputTokens !== attempt.input_tokens || receipt.outputTokens !== attempt.output_tokens) return testingFail();
  if (receipt.persisted && (!receipt.schemaValid || !receipt.idsValid || !receipt.analysisId || attempt.status !== "success")) return testingFail();
  db.prepare("INSERT INTO muse_testing_receipts VALUES(?,?,?)").run(intentId,JSON.stringify(receipt),digest(receipt));
  return receipt;
}
export function readTestingReceipts(db: DatabaseSync) {
  if (!testingAllocation(db)) return [];
  return db.prepare("SELECT * FROM muse_testing_receipts ORDER BY rowid").all().map(row=>{const value=JSON.parse(String(row.payload));if(digest(value)!==row.checksum)return testingFail();return testingReceiptSchema.parse(value);});
}
