import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AiUsageError } from "./ai-usage.types.js";

export const WORDPRESS_ALT_FUNDING_POLICY = { version: "muse-wordpress-alt-funding-v2", maxGrants: 1, maxCalls: 1, maximumMicros: 34090,
  amendment: { previousMaximumMicros: 33615, businessId: "demo-guzman", mediaId: 5659, parentPageId: 5652,
    evidenceContextId: "5b14c90d-5ba1-4775-b1a8-32af42d63e8e", requestHash: "5e36713e596ebc536cdeb62391e4b2ab1388bd65228e9eceb0a794cee379740c" },
  source: "explicit-assessment-testing-reallocation", globalCalls: 10, globalDailyReservationMicros: 2000000, protectedDemoMicros: 148000000,
  retries: 0, automaticRelease: false } as const;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const WORDPRESS_ALT_FUNDING_POLICY_HASH = digest(WORDPRESS_ALT_FUNDING_POLICY);
const hash = z.string().regex(/^[a-f0-9]{64}$/), micros = z.number().int().nonnegative();
export const wordPressAltFundingRequestSchema = z.object({ actor: hash, businessId: z.string().min(1).max(100), evidenceContextId: z.string().uuid(),
  requestHash: hash, model: z.literal("muse-spark-1.3"), processingMode: z.literal("standard"), reasoningEffort: z.literal("minimal"),
  maxInputTokens: z.number().int().positive().max(1048576), maxOutputTokens: z.number().int().min(16).max(1500),
  reserveMicros: micros.positive().max(WORDPRESS_ALT_FUNDING_POLICY.maximumMicros), priceVersion: z.string().min(1).max(100),
  inputPriceMicrosPerMillion: z.number().int().min(1250000).max(1000000000), outputPriceMicrosPerMillion: z.number().int().min(4250000).max(1000000000) }).strict().refine(value =>
    value.reserveMicros <= WORDPRESS_ALT_FUNDING_POLICY.amendment.previousMaximumMicros ||
    value.businessId === WORDPRESS_ALT_FUNDING_POLICY.amendment.businessId && value.evidenceContextId === WORDPRESS_ALT_FUNDING_POLICY.amendment.evidenceContextId
      && value.requestHash === WORDPRESS_ALT_FUNDING_POLICY.amendment.requestHash, "The additional 475 micros apply only to the separately approved exact request.");
export type WordPressAltFundingRequest = z.infer<typeof wordPressAltFundingRequestSchema>;
const historySchema = z.record(z.string(), z.array(hash).max(1000));
const previewSchema = z.object({ policyHash: z.literal(WORDPRESS_ALT_FUNDING_POLICY_HASH), adminActor: hash, request: wordPressAltFundingRequestSchema,
  scope: z.string(), history: historySchema, sourceFundedMicros: micros.max(1854992),
  assessmentBefore: z.object({ fundedMicros: micros, availableCalls: micros }), assessmentAfter: z.object({ fundedMicros: micros, availableCalls: micros }) }).strict();
const grantSchema = previewSchema.extend({ fundingHash: hash, approvedAt: z.string().datetime() }).strict();
export const wordPressAltReceiptSchema = z.object({ requestHash: hash, evidenceContextId: z.string().uuid(), attemptId: z.string().uuid(),
  reservedMicros: micros.positive().max(WORDPRESS_ALT_FUNDING_POLICY.maximumMicros), ledgerChargeMicros: micros, inputTokens: micros.nullable(), outputTokens: micros.nullable(),
  requestId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/).nullable(), httpStatus: z.number().int().min(100).max(599).nullable(),
  completionStatus: z.enum(["completed", "incomplete", "failed", "in_progress", "queued", "cancelled"]).nullable(),
  schemaValid: z.boolean(), persisted: z.boolean(), generationId: z.string().uuid().nullable(),
  failureCategory: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable() }).strict();
export type WordPressAltReceipt = z.infer<typeof wordPressAltReceiptSchema>;
const fail = (code = "AI_WORDPRESS_ALT_UNAVAILABLE"): never => { throw new AiUsageError(code, "The exact WordPress alt funding, authorization or receipt did not validate; no request is permitted."); };
const exists = (db: DatabaseSync, table: string) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
const historyTables = ["policy", "demo_authorizations", "intents", "attempts", "muse_testing_allocation", "muse_testing_intents", "muse_testing_receipts",
  "hello_diagnostic_amendment", "corrected_hello_amendment", "minimal_hello_amendment"];
const history = (db: DatabaseSync) => Object.fromEntries(historyTables.filter(table => exists(db, table)).map(table => {
  // Halt is a mutable safety latch, not a spending cap. Unknown settlement must
  // still permit its immutable receipt to be written and independently read.
  const sql = table === "policy" ? (exists(db, "ai_policy_before_shared") ? "SELECT budget,daily,calls FROM ai_policy_before_shared" : "SELECT budget,daily,calls FROM policy") : `SELECT * FROM ${table}${table === "intents" ? " WHERE consumed_at IS NOT NULL" : ""}`;
  return [table, db.prepare(sql).all().map(row => digest(row)).sort()];
}));

export function wordPressAltFunding(db: DatabaseSync) {
  if (!exists(db, "muse_wordpress_alt_funding")) return null;
  const row = db.prepare("SELECT payload,checksum FROM muse_wordpress_alt_funding WHERE id=1").get();
  if (!row || typeof row.payload !== "string") return fail();
  const value: unknown = JSON.parse(row.payload);
  if (digest(value) !== row.checksum) return fail();
  const grant = grantSchema.parse(value), { fundingHash, approvedAt: _approvedAt, ...preview } = grant; void _approvedAt;
  if (digest(preview) !== fundingHash || grant.scope !== `wordpress-alt:${grant.request.businessId}:${grant.request.evidenceContextId}`
    || grant.assessmentBefore.fundedMicros !== grant.sourceFundedMicros || grant.assessmentAfter.fundedMicros !== grant.sourceFundedMicros - grant.request.reserveMicros
    || grant.assessmentAfter.availableCalls !== grant.assessmentBefore.availableCalls - 1) return fail();
  const now = history(db);
  if (Object.entries(grant.history).some(([table, rows]) => rows.some(hash => !now[table]?.includes(hash)))) return fail("AI_WORDPRESS_ALT_HISTORY_CHANGED");
  return grant;
}

/** Pure SQL reads only; caller must use a stable source snapshot, not open/create the protected store. */
export function prepareWordPressAltFunding(db: DatabaseSync, adminActor: string, request: unknown, testing: { calls: number; chargedMicros: number; dailyReservedMicros: number; incompleteReceipts: number; allocation: { actor: string; fundedMicros: number } } | null) {
  const target = wordPressAltFundingRequestSchema.parse(request);
  if (!hash.safeParse(adminActor).success || !testing || testing.allocation.actor !== adminActor || testing.calls < 1 || testing.incompleteReceipts
    || db.prepare("SELECT id FROM attempts WHERE status IN ('reserved','unknown') LIMIT 1").get()
    || db.prepare("SELECT id FROM intents WHERE approved_at IS NOT NULL AND consumed_at IS NULL LIMIT 1").get()
    || db.prepare("SELECT halted FROM policy WHERE id=1").get()?.halted !== 0) return fail("AI_WORDPRESS_ALT_FUNDING_BLOCKED");
  if (wordPressAltFunding(db)) return fail("AI_WORDPRESS_ALT_ALREADY_FUNDED");
  const minimum = Math.ceil((target.maxInputTokens * target.inputPriceMicrosPerMillion + target.maxOutputTokens * target.outputPriceMicrosPerMillion) / 1000000);
  if (target.reserveMicros < minimum || testing.calls >= 10 || testing.chargedMicros + target.reserveMicros > testing.allocation.fundedMicros
    || testing.dailyReservedMicros + target.reserveMicros > 2000000) return fail("AI_WORDPRESS_ALT_FUNDING_LIMIT");
  const preview = previewSchema.parse({ policyHash: WORDPRESS_ALT_FUNDING_POLICY_HASH, adminActor, request: target,
    scope: `wordpress-alt:${target.businessId}:${target.evidenceContextId}`, history: history(db), sourceFundedMicros: testing.allocation.fundedMicros,
    assessmentBefore: { fundedMicros: testing.allocation.fundedMicros, availableCalls: 10 - testing.calls },
    assessmentAfter: { fundedMicros: testing.allocation.fundedMicros - target.reserveMicros, availableCalls: 9 - testing.calls } });
  return { ...preview, fundingHash: digest(preview), policy: WORDPRESS_ALT_FUNDING_POLICY, transferMicros: target.reserveMicros,
    noAuthorizationCreated: true, noPaidIntentCreated: true, noRequestDispatched: true };
}

export function activateWordPressAltFunding(db: DatabaseSync, adminActor: string, request: unknown, confirmation: { confirmed: boolean; policyHash: string; fundingHash: string }, testing: Parameters<typeof prepareWordPressAltFunding>[3]) {
  const prepared = prepareWordPressAltFunding(db, adminActor, request, testing);
  if (confirmation.confirmed !== true || confirmation.policyHash !== prepared.policyHash || confirmation.fundingHash !== prepared.fundingHash) return fail("AI_APPROVAL_MISMATCH");
  const { policy: _policy, transferMicros: _transfer, noAuthorizationCreated: _noAuthorization, noPaidIntentCreated: _noIntent, noRequestDispatched: _noDispatch, ...preview } = prepared;
  void _policy; void _transfer; void _noAuthorization; void _noIntent; void _noDispatch;
  const grant = grantSchema.parse({ ...preview, approvedAt: new Date().toISOString() });
  db.exec("CREATE TABLE muse_wordpress_alt_funding(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE muse_wordpress_alt_intents(intent_id TEXT PRIMARY KEY REFERENCES intents(id),grant_id INTEGER NOT NULL UNIQUE CHECK(grant_id=1),payload TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE muse_wordpress_alt_receipts(intent_id TEXT PRIMARY KEY REFERENCES muse_wordpress_alt_intents(intent_id),payload TEXT NOT NULL,checksum TEXT NOT NULL)");
  db.prepare("INSERT INTO muse_wordpress_alt_funding VALUES(1,?,?)").run(JSON.stringify(grant), digest(grant));
  return grant;
}

export function wordPressAltIntent(db: DatabaseSync, id: string) {
  if (!exists(db, "muse_wordpress_alt_intents")) return null;
  const row = db.prepare("SELECT payload,checksum FROM muse_wordpress_alt_intents WHERE intent_id=?").get(id);
  if (!row) return null;
  const value: unknown = JSON.parse(String(row.payload));
  if (digest(value) !== row.checksum) return fail();
  const grant = wordPressAltFunding(db);
  if (!grant || digest(value) !== digest({ fundingHash: grant.fundingHash, requestHash: grant.request.requestHash, evidenceContextId: grant.request.evidenceContextId })) return fail();
  return grant;
}

export function wordPressAltStatus(db: DatabaseSync) {
  const funding = wordPressAltFunding(db); if (!funding) return null;
  const rows = db.prepare("SELECT a.* FROM attempts a JOIN muse_wordpress_alt_intents t ON a.intent_id=t.intent_id ORDER BY a.rowid").all();
  const receipts = readWordPressAltReceipts(db);
  const incompleteReceipts = rows.filter(row => !db.prepare("SELECT intent_id FROM muse_wordpress_alt_receipts WHERE intent_id=?").get(String(row.intent_id))).length;
  const today = new Date().toISOString().slice(0, 10);
  return { funding, calls: rows.length, chargedMicros: rows.reduce((n, row) => n + Number(row.charged_micros), 0),
    dailyReservedMicros: rows.filter(row => String(row.reserved_at).startsWith(today)).reduce((n, row) => n + Number(row.reserve_micros), 0),
    incompleteReceipts, receiptCount: receipts.length, receiptStatus: !rows.length ? "not_dispatched" : incompleteReceipts ? "required" : "saved" };
}

export function validateWordPressAltEstimate(db: DatabaseSync, input: { actor: string; scope: string; requestHash: string; cacheKey: string; mode: string; model: string; maxInputTokens: number; maxOutputTokens: number; reserveMicros: number; priceVersion: string; inputPriceMicrosPerMillion: number; outputPriceMicrosPerMillion: number }) {
  const grant = wordPressAltFunding(db);
  if (!grant) return fail("AI_WORDPRESS_ALT_NOT_FUNDED");
  const request = grant.request;
  if (input.mode !== "poc" || input.scope !== grant.scope || input.cacheKey !== request.requestHash
    || ["actor", "requestHash", "model", "maxInputTokens", "maxOutputTokens", "reserveMicros", "priceVersion", "inputPriceMicrosPerMillion", "outputPriceMicrosPerMillion"].some(key => input[key as keyof typeof input] !== request[key as keyof typeof request])) return fail("AI_APPROVAL_MISMATCH");
  if (db.prepare("SELECT intent_id FROM muse_wordpress_alt_intents LIMIT 1").get()) return fail("AI_WORDPRESS_ALT_INTENT_EXISTS");
  return grant;
}

export function linkWordPressAltIntent(db: DatabaseSync, id: string, grant: NonNullable<ReturnType<typeof wordPressAltFunding>>) {
  const metadata = { fundingHash: grant.fundingHash, requestHash: grant.request.requestHash, evidenceContextId: grant.request.evidenceContextId };
  db.prepare("INSERT INTO muse_wordpress_alt_intents VALUES(?,1,?,?)").run(id, JSON.stringify(metadata), digest(metadata));
}

export function verifyWordPressAltBudget(db: DatabaseSync, intentId: string) {
  const grant = wordPressAltIntent(db, intentId); if (!grant) return fail("AI_WORDPRESS_ALT_NOT_FUNDED");
  const state = wordPressAltStatus(db)!;
  if (db.prepare("SELECT halted FROM policy WHERE id=1").get()?.halted !== 0) return fail("AI_USAGE_HALTED");
  if (state.calls || state.incompleteReceipts) return fail("AI_WORDPRESS_ALT_REQUEST_USED");
  const testingAttempts = db.prepare("SELECT a.* FROM attempts a JOIN muse_testing_intents t ON a.intent_id=t.intent_id").all();
  const today = new Date().toISOString().slice(0, 10);
  if (testingAttempts.length >= 10 || testingAttempts.filter(row => String(row.reserved_at).startsWith(today)).reduce((n, row) => n + Number(row.reserve_micros), 0) + grant.request.reserveMicros > 2000000
    || testingAttempts.some(row => !db.prepare("SELECT intent_id FROM muse_testing_receipts WHERE intent_id=?").get(String(row.intent_id)))) return fail("AI_TESTING_REVIEW_REQUIRED");
}

export function saveWordPressAltReceipt(db: DatabaseSync, intentId: string, input: unknown) {
  const grant = wordPressAltIntent(db, intentId); if (!grant) return fail();
  const receipt = wordPressAltReceiptSchema.parse(input), attempt = db.prepare("SELECT * FROM attempts WHERE intent_id=?").get(intentId);
  if (!attempt || attempt.status === "reserved" || receipt.requestHash !== grant.request.requestHash || receipt.evidenceContextId !== grant.request.evidenceContextId
    || receipt.attemptId !== attempt.id || receipt.reservedMicros !== attempt.reserve_micros || receipt.ledgerChargeMicros !== attempt.charged_micros
    || receipt.inputTokens !== attempt.input_tokens || receipt.outputTokens !== attempt.output_tokens || receipt.requestId !== attempt.request_id
    || receipt.persisted && (attempt.status !== "success" || !receipt.schemaValid || !receipt.generationId || receipt.completionStatus !== "completed" || receipt.httpStatus !== 200)) return fail();
  db.prepare("INSERT INTO muse_wordpress_alt_receipts VALUES(?,?,?)").run(intentId, JSON.stringify(receipt), digest(receipt));
  return receipt;
}

export function readWordPressAltReceipts(db: DatabaseSync) {
  if (!wordPressAltFunding(db)) return [];
  return db.prepare("SELECT payload,checksum FROM muse_wordpress_alt_receipts ORDER BY rowid").all().map(row => {
    const value: unknown = JSON.parse(String(row.payload)); if (digest(value) !== row.checksum) return fail(); return wordPressAltReceiptSchema.parse(value);
  });
}
