import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AiUsageError, type AiUsageEstimateInput } from "./ai-usage.types.js";
import { wordPressAltReceiptSchema } from "./muse-wordpress-alt-ledger.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const fail = (code = "AI_WORDPRESS_ALLOWANCE_REQUIRED"): never => { throw new AiUsageError(code, "This website needs its one-time AI allowance approval before this fix can continue."); };
const exists = (db: DatabaseSync, name: string) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
export const WORDPRESS_ALLOWANCE_POLICY = { version: "wordpress-alt-allowance-v1", maximumMicros: 150000, maxCalls: 3, perRequestMicros: 50000,
  validityDays: 7, concurrent: 1, retries: 0, protectedDemoMicros: 148000000, model: "muse-spark-1.3", processing: "standard", reasoning: "minimal", maxOutputTokens: 1500,
  capability: "wordpress.media.alt_text.update", allowWordPressAltApply: true, liveEnabled: true, automaticRelease: false } as const;
export const WORDPRESS_ALLOWANCE_POLICY_HASH = digest(WORDPRESS_ALLOWANCE_POLICY);
export const allowanceInputSchema = z.object({ actor: hash, businessId: z.literal("demo-guzman"), siteUrl: z.string().url().max(2048).refine(v => {
  const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/";
}).transform(v => new URL(v).href), mediaIds: z.tuple([z.literal(5658)]) }).strict();
export type WordPressAllowanceScope = { actor: string; businessId: string; siteUrl: string; mediaId: number; evidenceId: string };
export type FrontendAllowanceScope = { actor: string; businessId: string; siteUrl: string; task: "wordpress-alt" | "planner" | "investigation" | "facebook-post"; resourceKey: string };
export const FRONTEND_ALLOWANCE_POLICY = { version: "frontend-muse-scope-v1", tasks: ["wordpress-alt", "planner"], explicitAuthenticatedRequestsOnly: true,
  newFundingMicros: 0, newAttempts: 0, renewExpiry: false, expandWordPressWrites: false } as const;
export const FRONTEND_ALLOWANCE_POLICY_HASH = digest(FRONTEND_ALLOWANCE_POLICY);
type Testing = { calls: number; chargedMicros: number; incompleteReceipts: number; dailyReservedMicros: number;
  allocation: { actor: string; fundedMicros: number }; effectiveFundedMicros?: number; effectiveMaxCalls?: number } | null;
const previewSchema = z.object({ policyHash: z.literal(WORDPRESS_ALLOWANCE_POLICY_HASH), adminActor: hash, input: allowanceInputSchema,
  sourceFundedMicros: z.number().int().nonnegative(), sourceAvailableCalls: z.number().int().nonnegative(), historyHash: hash }).strict();
const grantSchema = previewSchema.extend({ fundingHash: hash, approvedAt: z.string().datetime(), expiresAt: z.string().datetime() }).strict();
const metadataSchema = z.object({ fundingHash: hash, requestHash: hash, actor: hash, businessId: z.string(), siteUrl: z.string().url(), mediaId: z.number().int().positive(), evidenceId: z.string().uuid() }).strict();
const frontendMetadataSchema = z.object({ fundingHash: hash, requestHash: hash, actor: hash, businessId: z.string(), siteUrl: z.string().url(), task: z.enum(["wordpress-alt", "planner"]), resourceKey: z.string().min(1).max(160) }).strict();
const amendmentPreviewSchema = z.object({ policyHash: z.literal(FRONTEND_ALLOWANCE_POLICY_HASH), fundingHash: hash, adminActor: hash, historyHash: hash }).strict();
const amendmentSchema = amendmentPreviewSchema.extend({ approvalHash: hash, approvedAt: z.string().datetime() }).strict();
const receiptSchema = wordPressAltReceiptSchema.extend({ reservedMicros: z.number().int().positive().max(50000) });
const historyHash = (db: DatabaseSync) => digest(["policy", "demo_authorizations", "attempts", "muse_testing_allocation", "muse_testing_receipts", "muse_wordpress_alt_funding", "muse_wordpress_alt_receipts"]
  .filter(t => exists(db, t)).map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
export function wordPressAllowanceGrant(db: DatabaseSync) {
  if (!exists(db, "muse_wordpress_allowance")) return null;
  const row = db.prepare("SELECT * FROM muse_wordpress_allowance WHERE id=1").get();
  if (!row) return fail();
  const value: unknown = JSON.parse(String(row.payload)); if (digest(value) !== row.checksum) return fail();
  const grant = grantSchema.parse(value), { fundingHash, approvedAt, expiresAt, ...preview } = grant;
  if (digest(preview) !== fundingHash || Date.parse(expiresAt) - Date.parse(approvedAt) !== 7 * 86400000) return fail();
  return grant;
}
export function wordPressAllowanceAccounting(db: DatabaseSync) {
  const grant = wordPressAllowanceGrant(db); if (!grant) return null;
  const rows = db.prepare("SELECT a.* FROM attempts a WHERE a.intent_id IN (SELECT intent_id FROM muse_wordpress_allowance_intents)" + (exists(db, "muse_frontend_allowance_intents") ? " OR a.intent_id IN (SELECT intent_id FROM muse_frontend_allowance_intents)" : "")).all();
  return { grant, calls: rows.length, chargedMicros: rows.reduce((n, r) => n + Number(r.charged_micros), 0),
    dailyReservedMicros: rows.filter(r => String(r.reserved_at).startsWith(new Date().toISOString().slice(0, 10))).reduce((n, r) => n + Number(r.reserve_micros), 0),
    incompleteReceipts: rows.filter(r => !db.prepare("SELECT intent_id FROM muse_wordpress_allowance_receipts WHERE intent_id=?").get(String(r.intent_id))
      && (!exists(db, "muse_frontend_allowance_receipts") || !db.prepare("SELECT intent_id FROM muse_frontend_allowance_receipts WHERE intent_id=?").get(String(r.intent_id)))).length };
}
export function frontendAllowanceAmendment(db: DatabaseSync) {
  if (!exists(db, "muse_frontend_allowance_scope")) return null;
  const row = db.prepare("SELECT payload,checksum FROM muse_frontend_allowance_scope WHERE id=1").get(); if (!row) return fail();
  const value: unknown = JSON.parse(String(row.payload)); if (digest(value) !== row.checksum) return fail();
  const amendment = amendmentSchema.parse(value), { approvalHash, approvedAt, ...preview } = amendment; void approvedAt;
  if (approvalHash !== digest(preview) || amendment.fundingHash !== wordPressAllowanceGrant(db)?.fundingHash) return fail();
  return amendment;
}
export function prepareFrontendAllowance(db: DatabaseSync, adminActor: string) {
  const state = wordPressAllowanceAccounting(db), grant = state?.grant;
  if (!grant || adminActor !== grant.adminActor || frontendAllowanceAmendment(db) || Date.parse(grant.expiresAt) <= Date.now()
    || state.incompleteReceipts || db.prepare("SELECT halted FROM policy WHERE id=1").get()?.halted !== 0
    || db.prepare("SELECT id FROM attempts WHERE status IN ('reserved','unknown') LIMIT 1").get()
    || db.prepare("SELECT id FROM intents WHERE approved_at IS NOT NULL AND consumed_at IS NULL AND expires_at>? LIMIT 1").get(new Date().toISOString())) return fail();
  const preview = amendmentPreviewSchema.parse({ policyHash: FRONTEND_ALLOWANCE_POLICY_HASH, fundingHash: grant.fundingHash, adminActor,
    historyHash: digest([historyHash(db), ...["muse_wordpress_allowance", "muse_wordpress_allowance_intents", "muse_wordpress_allowance_receipts"].map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()])]) });
  return { ...preview, approvalHash: digest(preview), policy: FRONTEND_ALLOWANCE_POLICY, activated: false, expiresAt: grant.expiresAt,
    remainingAttempts: Math.max(0, 3 - state.calls), remainingMicros: Math.max(0, 150000 - state.chargedMicros) };
}
export function activateFrontendAllowance(db: DatabaseSync, adminActor: string, confirmation: { confirmed: boolean; policyHash: string; approvalHash: string }) {
  const prepared = prepareFrontendAllowance(db, adminActor);
  if (confirmation.confirmed !== true || confirmation.policyHash !== prepared.policyHash || confirmation.approvalHash !== prepared.approvalHash) return fail("AI_APPROVAL_MISMATCH");
  const amendment = amendmentSchema.parse({ policyHash: prepared.policyHash, fundingHash: prepared.fundingHash, adminActor, historyHash: prepared.historyHash, approvalHash: prepared.approvalHash, approvedAt: new Date().toISOString() });
  db.exec("CREATE TABLE muse_frontend_allowance_scope(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE muse_frontend_allowance_intents(intent_id TEXT PRIMARY KEY REFERENCES intents(id),payload TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE muse_frontend_allowance_receipts(intent_id TEXT PRIMARY KEY REFERENCES muse_frontend_allowance_intents(intent_id),payload TEXT NOT NULL,checksum TEXT NOT NULL)");
  db.prepare("INSERT INTO muse_frontend_allowance_scope VALUES(1,?,?)").run(JSON.stringify(amendment), digest(amendment)); return amendment;
}
export function prepareWordPressAllowance(db: DatabaseSync, adminActor: string, input: unknown, testing: Testing) {
  const scope = allowanceInputSchema.parse(input);
  if (!hash.safeParse(adminActor).success || !testing || adminActor !== testing.allocation.actor || wordPressAllowanceGrant(db)
    || testing.incompleteReceipts || db.prepare("SELECT id FROM attempts WHERE status IN ('reserved','unknown') LIMIT 1").get()
    || db.prepare("SELECT id FROM intents WHERE approved_at IS NOT NULL AND consumed_at IS NULL AND expires_at>? LIMIT 1").get(new Date().toISOString())
    || db.prepare("SELECT halted FROM policy WHERE id=1").get()?.halted !== 0) return fail();
  const sourceFundedMicros = testing.effectiveFundedMicros ?? testing.allocation.fundedMicros;
  const sourceAvailableCalls = (testing.effectiveMaxCalls ?? 10) - testing.calls;
  if (sourceFundedMicros - testing.chargedMicros < 150000 || sourceAvailableCalls < 3) return fail("AI_WORDPRESS_ALLOWANCE_FUNDING");
  const preview = previewSchema.parse({ policyHash: WORDPRESS_ALLOWANCE_POLICY_HASH, adminActor, input: scope, sourceFundedMicros, sourceAvailableCalls, historyHash: historyHash(db) });
  return { ...preview, fundingHash: digest(preview), policy: WORDPRESS_ALLOWANCE_POLICY, activated: false };
}
export function activateWordPressAllowance(db: DatabaseSync, adminActor: string, input: unknown, confirmation: { confirmed: boolean; policyHash: string; fundingHash: string }, testing: Testing) {
  const { policy: _policy, activated: _activated, ...prepared } = prepareWordPressAllowance(db, adminActor, input, testing); void _policy; void _activated;
  if (confirmation.confirmed !== true || confirmation.policyHash !== prepared.policyHash || confirmation.fundingHash !== prepared.fundingHash) return fail("AI_APPROVAL_MISMATCH");
  const now = Date.now(), grant = grantSchema.parse({ ...prepared, approvedAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * 86400000).toISOString() });
  db.exec("CREATE TABLE muse_wordpress_allowance(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE muse_wordpress_allowance_intents(intent_id TEXT PRIMARY KEY REFERENCES intents(id),payload TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE muse_wordpress_allowance_receipts(intent_id TEXT PRIMARY KEY REFERENCES muse_wordpress_allowance_intents(intent_id),payload TEXT NOT NULL,checksum TEXT NOT NULL)");
  db.prepare("INSERT INTO muse_wordpress_allowance VALUES(1,?,?)").run(JSON.stringify(grant), digest(grant));
  return grant;
}
export function wordPressAllowanceStatus(db: DatabaseSync, actor: string, businessId: string, siteUrl: string, mediaId: number) {
  const state = wordPressAllowanceAccounting(db), grant = state?.grant;
  const owned = grant && grant.input.actor === actor && grant.input.businessId === businessId && grant.input.siteUrl === new URL(siteUrl).href;
  const matches = owned && (grant.input.mediaIds.includes(mediaId as 5658) || !!frontendAllowanceAmendment(db));
  const blocked = !!matches && (db.prepare("SELECT halted FROM policy WHERE id=1").get()?.halted !== 0 || !!db.prepare("SELECT id FROM attempts WHERE status IN ('reserved','unknown') LIMIT 1").get());
  const status = !matches ? "pending_approval" : Date.parse(grant.expiresAt) <= Date.now() ? "expired" : blocked ? "blocked" : state.calls >= 3 || state.chargedMicros >= 150000 ? "exhausted" : "active";
  const writeAuthorized = !!owned && grant.input.mediaIds.includes(mediaId as 5658) && Date.parse(grant.expiresAt) > Date.now() && !blocked;
  return { status, generationAuthorized: status === "active", allowWordPressAltApply: writeAuthorized, writeAuthorized, remainingAttempts: matches ? Math.max(0, 3 - state.calls) : 0,
    remainingMicros: matches ? Math.max(0, 150000 - state.chargedMicros) : 0, expiresAt: matches ? grant.expiresAt : null };
}
export function allowanceIntent(db: DatabaseSync, id: string) {
  const grant = wordPressAllowanceGrant(db); if (!grant) return null;
  const row = db.prepare("SELECT * FROM muse_wordpress_allowance_intents WHERE intent_id=?").get(id); if (!row) return null;
  const value: unknown = JSON.parse(String(row.payload)); if (digest(value) !== row.checksum) return fail();
  const metadata = metadataSchema.parse(value);
  if (metadata.fundingHash !== grant.fundingHash || metadata.actor !== grant.input.actor || metadata.businessId !== grant.input.businessId || metadata.siteUrl !== grant.input.siteUrl || !grant.input.mediaIds.includes(metadata.mediaId as 5658) && !frontendAllowanceAmendment(db)) return fail();
  return { grant, metadata };
}
export function validateAllowanceEstimate(db: DatabaseSync, input: AiUsageEstimateInput, scope: WordPressAllowanceScope) {
  const grant = wordPressAllowanceGrant(db);
  if (!grant || wordPressAllowanceStatus(db, scope.actor, scope.businessId, scope.siteUrl, scope.mediaId).status !== "active"
    || input.actor !== scope.actor || input.mode !== "poc" || input.model !== "muse-spark-1.3" || input.maxOutputTokens !== 1500 || input.reserveMicros > 50000
    || input.scope !== `wordpress-alt:${scope.businessId}:${scope.evidenceId}`
    || input.reserveMicros < Math.ceil((input.maxInputTokens * (input.inputPriceMicrosPerMillion ?? 1250000) + input.maxOutputTokens * (input.outputPriceMicrosPerMillion ?? 4250000)) / 1000000)) return fail();
  return metadataSchema.parse({ ...scope, siteUrl: new URL(scope.siteUrl).href, fundingHash: grant.fundingHash, requestHash: input.requestHash });
}
export function linkAllowanceIntent(db: DatabaseSync, id: string, metadata: z.infer<typeof metadataSchema>) {
  db.prepare("INSERT INTO muse_wordpress_allowance_intents VALUES(?,?,?)").run(id, JSON.stringify(metadata), digest(metadata));
}
export function verifyAllowanceBudget(db: DatabaseSync, id: string, testing: Testing) {
  const binding = allowanceIntent(db, id); if (!binding || !testing) return fail();
  const state = wordPressAllowanceAccounting(db)!;
  const intent = db.prepare("SELECT payload FROM intents WHERE id=?").get(id);
  const value = JSON.parse(String(intent?.payload)) as AiUsageEstimateInput;
  validateAllowanceEstimate(db, value, binding.metadata);
  if (state.incompleteReceipts || testing.incompleteReceipts || state.chargedMicros + value.reserveMicros > 150000
    || testing.dailyReservedMicros + value.reserveMicros > 2000000 || db.prepare("SELECT halted FROM policy WHERE id=1").get()?.halted !== 0) return fail("AI_WORDPRESS_ALLOWANCE_LIMIT");
}
export function saveAllowanceReceipt(db: DatabaseSync, id: string, input: unknown) {
  const binding = allowanceIntent(db, id); if (!binding) return fail();
  const receipt = receiptSchema.parse(input), attempt = db.prepare("SELECT * FROM attempts WHERE intent_id=?").get(id);
  if (!attempt || attempt.status === "reserved" || receipt.requestHash !== binding.metadata.requestHash || receipt.evidenceContextId !== binding.metadata.evidenceId
    || receipt.attemptId !== attempt.id || receipt.reservedMicros !== attempt.reserve_micros || receipt.ledgerChargeMicros !== attempt.charged_micros
    || receipt.inputTokens !== attempt.input_tokens || receipt.outputTokens !== attempt.output_tokens || receipt.requestId !== attempt.request_id
    || receipt.persisted && (attempt.status !== "success" || !receipt.schemaValid || !receipt.generationId || receipt.completionStatus !== "completed" || receipt.httpStatus !== 200)) return fail();
  db.prepare("INSERT INTO muse_wordpress_allowance_receipts VALUES(?,?,?)").run(id, JSON.stringify(receipt), digest(receipt)); return receipt;
}
export function readAllowanceReceipt(db: DatabaseSync, id: string) {
  if (!allowanceIntent(db, id)) return null;
  const row = db.prepare("SELECT payload,checksum FROM muse_wordpress_allowance_receipts WHERE intent_id=?").get(id);
  if (!row) return null;
  const value: unknown = JSON.parse(String(row.payload)); if (digest(value) !== row.checksum) return fail();
  return receiptSchema.parse(value);
}
export function frontendAllowanceIntent(db: DatabaseSync, id: string) {
  if (!frontendAllowanceAmendment(db)) return null;
  const row = db.prepare("SELECT payload,checksum FROM muse_frontend_allowance_intents WHERE intent_id=?").get(id); if (!row) return null;
  const value: unknown = JSON.parse(String(row.payload)); if (digest(value) !== row.checksum) return fail();
  const metadata = frontendMetadataSchema.parse(value), grant = wordPressAllowanceGrant(db)!;
  if (metadata.fundingHash !== grant.fundingHash || metadata.actor !== grant.input.actor || metadata.businessId !== grant.input.businessId || metadata.siteUrl !== grant.input.siteUrl) return fail();
  return { grant, metadata };
}
export function validateFrontendEstimate(db: DatabaseSync, input: AiUsageEstimateInput, scope: FrontendAllowanceScope) {
  const grant = wordPressAllowanceGrant(db);
  if (input.reserveMicros > 50000) return fail("AI_FRONTEND_REQUEST_LIMIT");
  if (!grant || !frontendAllowanceAmendment(db) || wordPressAllowanceStatus(db, scope.actor, scope.businessId, scope.siteUrl, 5658).status !== "active"
    || input.actor !== scope.actor || input.mode !== "poc" || input.model !== "muse-spark-1.3" || input.maxOutputTokens !== 1500 || input.reserveMicros > 50000
    || input.scope !== `frontend:${scope.task}:${scope.businessId}:${scope.resourceKey}`
    || input.reserveMicros < Math.ceil((input.maxInputTokens * (input.inputPriceMicrosPerMillion ?? 1250000) + input.maxOutputTokens * (input.outputPriceMicrosPerMillion ?? 4250000)) / 1000000)) return fail();
  return frontendMetadataSchema.parse({ ...scope, siteUrl: new URL(scope.siteUrl).href, fundingHash: grant.fundingHash, requestHash: input.requestHash });
}
export function linkFrontendIntent(db: DatabaseSync, id: string, metadata: z.infer<typeof frontendMetadataSchema>) {
  db.prepare("INSERT INTO muse_frontend_allowance_intents VALUES(?,?,?)").run(id, JSON.stringify(metadata), digest(metadata));
}
export function verifyFrontendBudget(db: DatabaseSync, id: string, testing: Testing) {
  const binding = frontendAllowanceIntent(db, id); if (!binding || !testing) return fail();
  const state = wordPressAllowanceAccounting(db)!;
  const intent = db.prepare("SELECT payload FROM intents WHERE id=?").get(id);
  const value = JSON.parse(String(intent?.payload)) as AiUsageEstimateInput;
  validateFrontendEstimate(db, value, binding.metadata);
  if (state.incompleteReceipts || testing.incompleteReceipts || state.chargedMicros + value.reserveMicros > 150000
    || testing.dailyReservedMicros + value.reserveMicros > 2000000) return fail("AI_WORDPRESS_ALLOWANCE_LIMIT");
}
export function saveFrontendReceipt(db: DatabaseSync, id: string) {
  const binding = frontendAllowanceIntent(db, id); if (!binding) return fail();
  const attempt = db.prepare("SELECT * FROM attempts WHERE intent_id=?").get(id);
  if (!attempt || attempt.status === "reserved") return false;
  const receipt = { intentId: id, requestHash: binding.metadata.requestHash, task: binding.metadata.task, resourceKey: binding.metadata.resourceKey,
    attemptId: String(attempt.id), status: String(attempt.status), reservedMicros: Number(attempt.reserve_micros), chargedMicros: Number(attempt.charged_micros),
    inputTokens: attempt.input_tokens, outputTokens: attempt.output_tokens, requestId: attempt.request_id, completedAt: attempt.completed_at };
  const existing = db.prepare("SELECT payload,checksum FROM muse_frontend_allowance_receipts WHERE intent_id=?").get(id);
  if (existing) { if (String(existing.payload) !== JSON.stringify(receipt) || existing.checksum !== digest(receipt)) return fail(); return true; }
  db.prepare("INSERT INTO muse_frontend_allowance_receipts VALUES(?,?,?)").run(id, JSON.stringify(receipt), digest(receipt)); return true;
}
