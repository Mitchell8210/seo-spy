import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import { activateWordPressAllowance, prepareWordPressAllowance, wordPressAllowanceStatus, validateAllowanceEstimate, linkAllowanceIntent, verifyAllowanceBudget, saveAllowanceReceipt } from "../src/integrations/ai/muse-wordpress-allowance.js";
import { activateFrontendAllowance, prepareFrontendAllowance, validateFrontendEstimate, linkFrontendIntent, verifyFrontendBudget, saveFrontendReceipt, wordPressAllowanceAccounting } from "../src/integrations/ai/muse-wordpress-allowance.js";
import type { AiUsageEstimateInput } from "../src/integrations/ai/ai-usage.types.js";

const actor = "a".repeat(64), admin = "b".repeat(64), requestHash = "c".repeat(64), evidenceId = randomUUID();
const input = { actor, businessId: "demo-guzman" as const, siteUrl: "https://example.com/", mediaIds: [5658] as [5658] };
const scope = { actor, businessId: input.businessId, siteUrl: input.siteUrl, mediaId: 5658, evidenceId };
const testing = { allocation: { actor: admin, fundedMicros: 1854992 }, calls: 3, chargedMicros: 18782, incompleteReceipts: 0, dailyReservedMicros: 100000, effectiveFundedMicros: 1820902, effectiveMaxCalls: 9 };
const estimate: AiUsageEstimateInput = { actor, scope: `wordpress-alt:demo-guzman:${evidenceId}`, requestHash, cacheKey: requestHash, mode: "poc", model: "muse-spark-1.3", maxInputTokens: 100,
  maxOutputTokens: 1500, reserveMicros: 34090, priceVersion: "fixture", reason: "Explicit scoped disposable allowance test", inputPriceMicrosPerMillion: 1250000, outputPriceMicrosPerMillion: 4250000 };
describe("one-time customer WordPress allowance (memory-only, no providers)", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE policy(id INTEGER PRIMARY KEY,halted INTEGER); INSERT INTO policy VALUES(1,0); CREATE TABLE intents(id TEXT PRIMARY KEY,payload TEXT,approved_at TEXT,consumed_at TEXT,expires_at TEXT); CREATE TABLE attempts(id TEXT,intent_id TEXT,status TEXT,reserved_at TEXT,reserve_micros INTEGER,charged_micros INTEGER,input_tokens INTEGER,output_tokens INTEGER,request_id TEXT)");
  });
  afterEach(() => db.close());
  function activate() { const p = prepareWordPressAllowance(db, admin, input, testing); return activateWordPressAllowance(db, admin, input, { confirmed: true, policyHash: p.policyHash, fundingHash: p.fundingHash }, testing); }
  function intent() {
    const id = randomUUID(); const metadata = validateAllowanceEstimate(db, estimate, scope);
    db.prepare("INSERT INTO intents VALUES(?,?,NULL,NULL,?)").run(id, JSON.stringify(estimate), new Date(Date.now() + 60000).toISOString()); linkAllowanceIntent(db, id, metadata); return id;
  }
  test("preview is inactive; exact explicit setup required; bounded transfer preserves old rows", () => {
    const before = db.prepare("SELECT * FROM policy").all(), p = prepareWordPressAllowance(db, admin, input, testing);
    expect(wordPressAllowanceStatus(db, actor, input.businessId, input.siteUrl, 5658).status).toBe("pending_approval");
    expect(() => activateWordPressAllowance(db, admin, input, { confirmed: false, policyHash: p.policyHash, fundingHash: p.fundingHash }, testing)).toThrow();
    activate(); expect(db.prepare("SELECT * FROM policy").all()).toEqual(before);
    expect(wordPressAllowanceStatus(db, actor, input.businessId, input.siteUrl, 5658)).toMatchObject({ status: "active", writeAuthorized: true, remainingAttempts: 3, remainingMicros: 150000 });
    expect(() => activate()).toThrow();
  });
  test("hash mismatch, unauthorized admin, short funding, active/uncertain outcome and incomplete receipts block setup", () => {
    const p = prepareWordPressAllowance(db, admin, input, testing);
    expect(() => activateWordPressAllowance(db, admin, input, { confirmed: true, policyHash: p.policyHash, fundingHash: "d".repeat(64) }, testing)).toThrow();
    expect(() => prepareWordPressAllowance(db, actor, input, testing)).toThrow();
    expect(() => prepareWordPressAllowance(db, admin, input, { ...testing, effectiveFundedMicros: 150000 })).toThrow();
    expect(() => prepareWordPressAllowance(db, admin, input, { ...testing, incompleteReceipts: 1 })).toThrow();
    db.prepare("INSERT INTO attempts(id,status) VALUES('uncertain','unknown')").run(); expect(() => prepareWordPressAllowance(db, admin, input, testing)).toThrow();
  });
  test("actor/site/media/model/cap/cost bindings reject arbitrary requests", () => {
    activate();
    for (const changed of [{ actor: admin }, { siteUrl: "https://other.test/" }, { mediaId: 5659 }]) expect(() => validateAllowanceEstimate(db, estimate, { ...scope, ...changed })).toThrow();
    for (const changed of [{ model: "muse-spark-1.2" as const }, { reserveMicros: 50001 }, { reserveMicros: 1 }, { maxOutputTokens: 1501 }, { mode: "demo" as const }]) expect(() => validateAllowanceEstimate(db, { ...estimate, ...changed }, scope)).toThrow();
    expect(() => verifyAllowanceBudget(db, intent(), testing)).not.toThrow();
  });
  test("expiry stops generation and write delegation without renewing timestamps", () => {
    const grant = activate(); jest.useFakeTimers({ now: Date.parse(grant.expiresAt) + 1 });
    expect(wordPressAllowanceStatus(db, actor, input.businessId, input.siteUrl, 5658)).toMatchObject({ status: "expired", writeAuthorized: false });
    jest.useRealTimers();
  });
  test("single-use receipt binds actual settlement, invalid-output remains charged and blocks until receipt", () => {
    activate(); const id = intent(), attemptId = randomUUID();
    db.prepare("INSERT INTO attempts VALUES(?,?,'failed',?,34090,34090,NULL,NULL,NULL)").run(attemptId, id, new Date().toISOString());
    expect(() => verifyAllowanceBudget(db, id, testing)).toThrow();
    const receipt = { requestHash, evidenceContextId: evidenceId, attemptId, reservedMicros: 34090, ledgerChargeMicros: 34090, inputTokens: null, outputTokens: null,
      requestId: null, httpStatus: 200, completionStatus: "completed" as const, schemaValid: false, persisted: false, generationId: null, failureCategory: "AI_OUTPUT_INVALID" };
    expect(() => saveAllowanceReceipt(db, id, { ...receipt, ledgerChargeMicros: 0 })).toThrow(); saveAllowanceReceipt(db, id, receipt);
    expect(wordPressAllowanceStatus(db, actor, input.businessId, input.siteUrl, 5658).remainingMicros).toBe(115910);
    expect(() => saveAllowanceReceipt(db, id, receipt)).toThrow();
  });
  test("last generation cannot prevent applying its saved valid proposal", () => {
    activate(); for (let i = 0; i < 3; i++) db.prepare("INSERT INTO attempts VALUES(?,?,'success',?,30000,1000,1,1,'fixture')").run(randomUUID(), intent(), new Date().toISOString());
    expect(wordPressAllowanceStatus(db, actor, input.businessId, input.siteUrl, 5658)).toMatchObject({ status: "exhausted", remainingAttempts: 0, writeAuthorized: true });
  });
  test("central safety halt blocks scoped generation and write delegation", () => {
    activate(); db.prepare("UPDATE policy SET halted=1").run();
    expect(wordPressAllowanceStatus(db, actor, input.businessId, input.siteUrl, 5658)).toMatchObject({ status: "blocked", writeAuthorized: false });
    expect(() => validateAllowanceEstimate(db, estimate, scope)).toThrow();
  });
  test("tampered immutable grant fails closed", () => {
    activate(); const row = db.prepare("SELECT payload FROM muse_wordpress_allowance").get()!;
    db.prepare("UPDATE muse_wordpress_allowance SET payload=?").run(String(row.payload).replace("5658", "5659"));
    expect(() => wordPressAllowanceStatus(db, actor, input.businessId, input.siteUrl, 5658)).toThrow();
  });
  test("additive frontend scope preserves the original grant, money, attempts, expiry and WordPress write scope", () => {
    const grant = activate(), before = db.prepare("SELECT * FROM muse_wordpress_allowance").all();
    const frontend = { actor, businessId: input.businessId, siteUrl: input.siteUrl, task: "planner" as const, resourceKey: randomUUID() };
    const prepared = { ...estimate, scope: `frontend:planner:${input.businessId}:${frontend.resourceKey}` };
    expect(() => validateFrontendEstimate(db, prepared, frontend)).toThrow();
    const preview = prepareFrontendAllowance(db, admin);
    expect(preview).toMatchObject({ activated: false, expiresAt: grant.expiresAt, remainingAttempts: 3, remainingMicros: 150000 });
    expect(() => activateFrontendAllowance(db, actor, { confirmed: true, policyHash: preview.policyHash, approvalHash: preview.approvalHash })).toThrow();
    expect(() => activateFrontendAllowance(db, admin, { confirmed: true, policyHash: preview.policyHash, approvalHash: "f".repeat(64) })).toThrow();
    activateFrontendAllowance(db, admin, { confirmed: true, policyHash: preview.policyHash, approvalHash: preview.approvalHash });
    expect(db.prepare("SELECT * FROM muse_wordpress_allowance").all()).toEqual(before);
    expect(wordPressAllowanceStatus(db, actor, input.businessId, input.siteUrl, 5659)).toMatchObject({ status: "active", writeAuthorized: false });
    expect(wordPressAllowanceStatus(db, actor, input.businessId, input.siteUrl, 5658)).toMatchObject({ status: "active", writeAuthorized: true });
    for (const wrong of [{ actor: admin }, { siteUrl: "https://other.test/" }, { businessId: "other" }, { task: "arbitrary" }])
      expect(() => validateFrontendEstimate(db, prepared, { ...frontend, ...wrong } as typeof frontend)).toThrow();
    const id = randomUUID(), metadata = validateFrontendEstimate(db, prepared, frontend);
    db.prepare("INSERT INTO intents VALUES(?,?,NULL,NULL,?)").run(id, JSON.stringify(prepared), new Date(Date.now() + 60000).toISOString()); linkFrontendIntent(db, id, metadata);
    expect(() => verifyFrontendBudget(db, id, testing)).not.toThrow();
    db.prepare("INSERT INTO attempts VALUES(?,?,'failed',?,34090,34090,NULL,NULL,NULL)").run(randomUUID(), id, new Date().toISOString());
    expect(wordPressAllowanceAccounting(db)).toMatchObject({ calls: 1, chargedMicros: 34090, incompleteReceipts: 1 });
    saveFrontendReceipt(db, id); saveFrontendReceipt(db, id);
    expect(wordPressAllowanceAccounting(db)).toMatchObject({ calls: 1, chargedMicros: 34090, incompleteReceipts: 0 });
    expect(wordPressAllowanceStatus(db, actor, input.businessId, input.siteUrl, 5658)).toMatchObject({ remainingAttempts: 2, remainingMicros: 115910 });
    expect(() => prepareFrontendAllowance(db, admin)).toThrow();
  });
});
