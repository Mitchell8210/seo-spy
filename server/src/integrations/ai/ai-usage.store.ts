import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, writeFileSync, fsyncSync, readFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, resolve, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { activateTesting, testingExists, testingAllocation, testingIntent, testingStatus, testingMetadataSchema, verifyTestingBudget, saveTestingReceipt, readTestingReceipts, testingFail } from "./muse-testing-ledger.js";
import { MUSE_HELLO_HASH, MUSE_HELLO_SCOPE, MUSE_HELLO_V1_HASH, MUSE_HELLO_V1_SCOPE, prepareMuseHello, MUSE_MINIMAL_HELLO_HASH, MUSE_MINIMAL_HELLO_SCOPE, prepareMinimalMuseHello } from "./muse-hello-request.js";
import { AiUsageError, type AiDemoAuthorization, type AiUsageAuthorization, type AiUsageEstimateInput, type AiUsageIntent, type AiUsageLimits, type AiUsageReservation, type AiUsageSettlement, type AiUsageSummary } from "./ai-usage.types.js";
import { prepareWordPressAltFunding, activateWordPressAltFunding, wordPressAltFunding, wordPressAltIntent, wordPressAltStatus, validateWordPressAltEstimate, linkWordPressAltIntent, verifyWordPressAltBudget, saveWordPressAltReceipt, readWordPressAltReceipts } from "./muse-wordpress-alt-ledger.js";

const DEFAULT_LIMITS: AiUsageLimits = { budgetMicros: 2_000_000, dailyMicros: 500_000, maxCalls: 10 };
const MAX_DEMO_MICROS = 148_000_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const safeLabel = z.string().min(1).max(300);
const inputSchema = z.object({
  actor: z.string().min(1).max(256), scope: safeLabel, requestHash: hash, cacheKey: hash,
  mode: z.enum(["poc", "demo"]), model: z.enum(["muse-spark-1.3", "muse-spark-1.2"]),
  maxInputTokens: z.number().int().min(1).max(1_048_576), maxOutputTokens: z.number().int().min(1).max(1500),
  reserveMicros: z.number().int().positive().max(MAX_DEMO_MICROS), priceVersion: z.string().min(1).max(100), reason: z.string().trim().min(10).max(1000),
  inputPriceMicrosPerMillion: z.number().int().min(1_250_000).max(1_000_000_000).default(1_250_000),
  outputPriceMicrosPerMillion: z.number().int().min(4_250_000).max(1_000_000_000).default(4_250_000),
}).strict();
const fail = (code = "AI_USAGE_UNAVAILABLE", message = "Persistent AI usage tracking is unavailable; real API calls are blocked.") => new AiUsageError(code, message);
const digest = (input: string) => createHash("sha256").update(input).digest("hex");
const rowDigest = (input: unknown) => { const serialized = JSON.stringify(input); if (serialized === undefined) throw fail(); return digest(serialized); };
const safeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const utcDay = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
const date = (value: unknown): string => { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw fail(); return value; };

/** One durable ledger governs all real calls. No reset/delete/retry/automatic-unlock API exists. */
@Injectable()
export class AiUsageStore implements OnModuleDestroy {
  private readonly path: string;
  private database?: DatabaseSync;
  private inode?: number;
  private device?: number;

  constructor(config: ConfigService) {
    this.path = resolve(fileURLToPath(new URL("../../../", import.meta.url)), config.get<string>("AI_USAGE_DB") ?? "reports/ai-usage.sqlite");
  }
  onModuleDestroy(): void { this.database?.close(); this.database = undefined; }

  private safeFile(path: string, required: boolean): boolean {
    if (!existsSync(path)) { if (required) throw fail(); return false; }
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw fail();
    return true;
  }
  private ready(): DatabaseSync {
    try {
      const directory = dirname(this.path);
      if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
      const directoryInfo = lstatSync(directory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw fail();
      const existing = this.safeFile(this.path, Boolean(this.database));
      const sentinel = this.safeFile(`${this.path}.initialized`, false);
      if (!existing && sentinel) throw fail();
      for (const suffix of ["-wal", "-shm", "-journal"]) this.safeFile(this.path + suffix, false);
      if (this.database) {
        const stat = lstatSync(this.path);
        if (stat.ino !== this.inode || stat.dev !== this.device) throw fail();
        return this.database;
      }
      // Never treat an existing damaged/empty database as a new development phase.
      const database = new DatabaseSync(this.path, { enableForeignKeyConstraints: true, allowExtension: false });
      try {
        database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
        const version = database.prepare("PRAGMA user_version").get()?.user_version;
        if (existing && version !== 1 && version !== 2) throw fail();
        if (!existing) {
          database.exec(`BEGIN IMMEDIATE;
            CREATE TABLE policy (id INTEGER PRIMARY KEY CHECK(id=1), budget INTEGER NOT NULL CHECK(budget>=0), daily INTEGER NOT NULL CHECK(daily>=0), calls INTEGER NOT NULL CHECK(calls>=0), halted INTEGER NOT NULL DEFAULT 0 CHECK(halted IN (0,1)));
            INSERT INTO policy(id,budget,daily,calls) VALUES(1,2000000,500000,10);
            CREATE TABLE demo_authorizations (id TEXT PRIMARY KEY, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL, budget INTEGER NOT NULL, daily INTEGER NOT NULL, calls INTEGER NOT NULL, reason TEXT);
            CREATE TABLE intents (id TEXT PRIMARY KEY, payload TEXT NOT NULL, checksum TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, approved_at TEXT, approved_by TEXT, consumed_at TEXT, demo_id TEXT REFERENCES demo_authorizations(id));
            CREATE TABLE attempts (id TEXT PRIMARY KEY, intent_id TEXT NOT NULL UNIQUE REFERENCES intents(id), mode TEXT NOT NULL CHECK(mode IN ('poc','demo')), model TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('reserved','success','failed','unknown')), reserved_at TEXT NOT NULL, completed_at TEXT, reserve_micros INTEGER NOT NULL CHECK(reserve_micros>0), charged_micros INTEGER NOT NULL CHECK(charged_micros>=0), input_tokens INTEGER, output_tokens INTEGER, request_id TEXT, error_code TEXT);
            CREATE INDEX attempts_mode_date ON attempts(mode,reserved_at);
            PRAGMA user_version=2;
            COMMIT;`);
        }
        if (existing && version === 1) {
          database.exec("BEGIN IMMEDIATE; ALTER TABLE demo_authorizations ADD COLUMN reason TEXT; PRAGMA user_version=2; COMMIT;");
        }
        if (database.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") throw fail();
        this.database = database;
        const stat = lstatSync(this.path);
        if (stat.isSymbolicLink() || !stat.isFile()) throw fail();
        this.inode = stat.ino; this.device = stat.dev;
        chmodSync(this.path, 0o600);
        if (!sentinel) {
          const descriptor = openSync(`${this.path}.initialized`, "wx", 0o600);
          try { writeFileSync(descriptor, "seo-spy.ai-usage.v1\n"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
        }
        return database;
      } catch (error) { database.close(); this.database = undefined; throw error; }
    } catch (error) { if (error instanceof AiUsageError) throw error; throw fail(); }
  }
  private transaction<T>(operation: (database: DatabaseSync) => T): T {
    const database = this.ready();
    try {
      database.exec("BEGIN IMMEDIATE");
      const value = operation(database);
      database.exec("COMMIT");
      return value;
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch { /* Preserve the original safe failure. */ }
      if (error instanceof AiUsageError) throw error;
      throw fail();
    }
  }
  /** Optional additive audit table: created only by the explicitly approved amendment. */
  private originalHelloAmendment(database: DatabaseSync) {
    if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hello_diagnostic_amendment'").get()) return null;
    const row = database.prepare("SELECT * FROM hello_diagnostic_amendment WHERE id=1").get();
    if (!row || typeof row.record_json !== "string" || digest(row.record_json) !== row.checksum) throw fail();
    const record = z.object({ intentId: z.string().uuid(), actor: hash, requestHash: hash, scope: z.enum([MUSE_HELLO_V1_SCOPE, MUSE_HELLO_SCOPE]), reserveMicros: z.number().int().positive().max(10000),
      originalAttemptId: z.string().uuid(), originalIntentId: z.string().uuid(), originalAttemptHash: hash, originalIntentHash: hash,
      approvedAt: z.string().datetime(), before: z.object({ budgetMicros: z.literal(131460), dailyMicros: z.literal(131460), maxCalls: z.literal(1) }).strict(),
      after: z.object({ budgetMicros: z.number().int().max(141460), dailyMicros: z.number().int().max(141460), maxCalls: z.literal(2) }).strict() }).strict().parse(JSON.parse(row.record_json));
    if (record.requestHash !== (record.scope === MUSE_HELLO_V1_SCOPE ? MUSE_HELLO_V1_HASH : MUSE_HELLO_HASH) || record.after.budgetMicros !== 131460 + record.reserveMicros || record.after.dailyMicros !== 131460 + record.reserveMicros
      || rowDigest(database.prepare("SELECT * FROM attempts WHERE id=?").get(record.originalAttemptId)) !== record.originalAttemptHash
      || rowDigest(database.prepare("SELECT * FROM intents WHERE id=?").get(record.originalIntentId)) !== record.originalIntentHash) throw fail();
    return record;
  }
  private correctedHelloAmendment(database: DatabaseSync) {
    const prior = this.originalHelloAmendment(database);
    if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='corrected_hello_amendment'").get()) return prior;
    const row = database.prepare("SELECT * FROM corrected_hello_amendment WHERE id=1").get();
    if (!prior || !row || typeof row.record_json !== "string" || digest(row.record_json) !== row.checksum) throw fail();
    const record = z.object({ intentId: z.string().uuid(), actor: hash, requestHash: z.literal(MUSE_HELLO_HASH), scope: z.literal(MUSE_HELLO_SCOPE), reserveMicros: z.literal(6544),
      priorAmendmentHash: hash, previousAttemptId: z.string().uuid(), previousIntentId: z.string().uuid(), previousAttemptHash: hash, previousIntentHash: hash,
      approvedAt: z.string().datetime(), before: z.object({ budgetMicros: z.literal(138004), dailyMicros: z.literal(138004), maxCalls: z.literal(2) }).strict(),
      after: z.object({ budgetMicros: z.literal(144548), dailyMicros: z.literal(144548), maxCalls: z.literal(3) }).strict() }).strict().parse(JSON.parse(row.record_json));
    if (prior.scope !== MUSE_HELLO_V1_SCOPE || record.priorAmendmentHash !== rowDigest(database.prepare("SELECT * FROM hello_diagnostic_amendment WHERE id=1").get())
      || record.previousIntentId !== prior.intentId
      || record.previousAttemptHash !== rowDigest(database.prepare("SELECT * FROM attempts WHERE id=?").get(record.previousAttemptId))
      || record.previousIntentHash !== rowDigest(database.prepare("SELECT * FROM intents WHERE id=?").get(record.previousIntentId))) throw fail();
    return record;
  }
  private helloAmendment(database: DatabaseSync) {
    const prior = this.correctedHelloAmendment(database);
    if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='minimal_hello_amendment'").get()) return prior;
    const row = database.prepare("SELECT * FROM minimal_hello_amendment WHERE id=1").get();
    if (!prior || !row || typeof row.record_json !== "string" || digest(row.record_json) !== row.checksum) throw fail();
    const record = z.object({ intentId: z.string().uuid(), actor: hash, requestHash: z.literal(MUSE_MINIMAL_HELLO_HASH), scope: z.literal(MUSE_MINIMAL_HELLO_SCOPE), reserveMicros: z.literal(8196),
      priorAmendmentHash: hash, previousAttemptId: z.string().uuid(), previousIntentId: z.string().uuid(), previousAttemptHash: hash, previousIntentHash: hash,
      approvedAt: z.string().datetime(), before: z.object({ budgetMicros: z.literal(144548), dailyMicros: z.literal(144548), maxCalls: z.literal(3) }).strict(),
      after: z.object({ budgetMicros: z.literal(152744), dailyMicros: z.literal(152744), maxCalls: z.literal(4) }).strict() }).strict().parse(JSON.parse(row.record_json));
    if (prior.scope !== MUSE_HELLO_SCOPE || record.priorAmendmentHash !== rowDigest(database.prepare("SELECT * FROM corrected_hello_amendment WHERE id=1").get())
      || record.previousIntentId !== prior.intentId
      || record.previousAttemptHash !== rowDigest(database.prepare("SELECT * FROM attempts WHERE id=?").get(record.previousAttemptId))
      || record.previousIntentHash !== rowDigest(database.prepare("SELECT * FROM intents WHERE id=?").get(record.previousIntentId))) throw fail();
    return record;
  }
  /** Final separately approved minimal/512 diagnostic only; immutable prior receipts. */
  async amendMinimalHelloDiagnostic(adminActor: string, confirmation: { confirmed: boolean; requestHash: string; maximumMicros: number }) {
    const prepared = prepareMinimalMuseHello();
    if (!hash.safeParse(adminActor).success || confirmation.confirmed !== true || confirmation.requestHash !== prepared.requestHash || confirmation.maximumMicros !== 8196)
      throw fail("AI_APPROVAL_MISMATCH", "Exact confirmation of the minimal diagnostic and 8196-microdollar reservation is required.");
    return this.transaction(database => {
      const prior = this.helloAmendment(database);
      if (!prior || prior.scope !== MUSE_HELLO_SCOPE || !("priorAmendmentHash" in prior)) throw fail("AI_DIAGNOSTIC_ALREADY_AUTHORIZED", "The final diagnostic requires three consumed attempts and cannot be renewed.");
      const policy = database.prepare("SELECT * FROM policy WHERE id=1").get();
      const attempts = database.prepare("SELECT * FROM attempts ORDER BY rowid").all(), previous = attempts[2];
      if (!policy || policy.budget !== 144548 || policy.daily !== 144548 || policy.calls !== 3 || policy.halted !== 0 || attempts.length !== 3
        || !previous || previous.intent_id !== prior.intentId || previous.mode !== "poc" || previous.status !== "failed" || previous.reserve_micros !== 6544 || previous.charged_micros !== 6544 || previous.error_code !== "AI_INVALID_OUTPUT" || previous.input_tokens !== 10 || previous.output_tokens !== 128
        || this.intent(database, prior.intentId).requestHash !== MUSE_HELLO_HASH
        || database.prepare("SELECT id FROM intents WHERE consumed_at IS NULL AND approved_at IS NOT NULL LIMIT 1").get()) throw fail("AI_DIAGNOSTIC_STATE_MISMATCH", "The three historical receipts or permanent limits differ; stop.");
      const now = Date.now(), createdAt = new Date(now).toISOString(), intentId = randomUUID();
      const { payload: _payload, scope: _scope, ...cost } = prepared; void _payload; void _scope;
      const input = inputSchema.parse({ ...cost, actor: adminActor, scope: prepared.scope, cacheKey: prepared.requestHash, mode: "poc", reason: "Final explicit authorization: one minimal/512 Hello diagnostic, 8196 micros, no retries or other scopes." });
      const serialized = JSON.stringify(input);
      const record = { intentId, actor: adminActor, requestHash: prepared.requestHash, scope: prepared.scope, reserveMicros: 8196 as const,
        priorAmendmentHash: rowDigest(database.prepare("SELECT * FROM corrected_hello_amendment WHERE id=1").get()),
        previousAttemptId: String(previous.id), previousIntentId: prior.intentId, previousAttemptHash: rowDigest(previous), previousIntentHash: rowDigest(database.prepare("SELECT * FROM intents WHERE id=?").get(prior.intentId)), approvedAt: createdAt,
        before: { budgetMicros: 144548 as const, dailyMicros: 144548 as const, maxCalls: 3 as const }, after: { budgetMicros: 152744 as const, dailyMicros: 152744 as const, maxCalls: 4 as const } };
      const audit = JSON.stringify(record);
      database.prepare("INSERT INTO intents(id,payload,checksum,created_at,expires_at,demo_id) VALUES(?,?,?,?,?,NULL)").run(intentId, serialized, digest(serialized), createdAt, new Date(now + 15 * 60000).toISOString());
      database.exec("CREATE TABLE minimal_hello_amendment(id INTEGER PRIMARY KEY CHECK(id=1),record_json TEXT NOT NULL,checksum TEXT NOT NULL)");
      database.prepare("INSERT INTO minimal_hello_amendment(id,record_json,checksum) VALUES(1,?,?)").run(audit, digest(audit));
      database.prepare("UPDATE policy SET budget=152744,daily=152744,calls=4 WHERE id=1").run();
      this.helloAmendment(database);
      return record;
    });
  }
  /** Separately authorized corrected Hello only: append a receipt, never renew the old grant. */
  async amendCorrectedHelloDiagnostic(adminActor: string, confirmation: { confirmed: boolean; requestHash: string; maximumMicros: number }) {
    const prepared = prepareMuseHello();
    if (!hash.safeParse(adminActor).success || confirmation.confirmed !== true || confirmation.requestHash !== prepared.requestHash || confirmation.maximumMicros !== 6544 || prepared.reserveMicros !== 6544)
      throw fail("AI_APPROVAL_MISMATCH", "Exact confirmation of the corrected Hello request and 6544-microdollar reservation is required.");
    return this.transaction(database => {
      const prior = this.helloAmendment(database);
      if (!prior || prior.scope !== MUSE_HELLO_V1_SCOPE) throw fail("AI_DIAGNOSTIC_ALREADY_AUTHORIZED", "The corrected diagnostic requires the original consumed amendment and cannot be renewed.");
      const policy = database.prepare("SELECT * FROM policy WHERE id=1").get();
      const attempts = database.prepare("SELECT * FROM attempts ORDER BY rowid").all();
      const previous = attempts[1];
      if (!policy || policy.budget !== 138004 || policy.daily !== 138004 || policy.calls !== 2 || policy.halted !== 0 || attempts.length !== 2
        || !previous || previous.intent_id !== prior.intentId || previous.mode !== "poc" || previous.status !== "failed" || previous.reserve_micros !== 6544 || previous.charged_micros !== 6544 || previous.error_code !== "AI_PROVIDER_FAILED"
        || this.intent(database, prior.intentId).requestHash !== MUSE_HELLO_V1_HASH
        || database.prepare("SELECT id FROM intents WHERE consumed_at IS NULL AND approved_at IS NOT NULL LIMIT 1").get()) throw fail("AI_DIAGNOSTIC_STATE_MISMATCH", "The two historical failed receipts or narrowed limits differ; stop.");
      const now = Date.now(), createdAt = new Date(now).toISOString(), intentId = randomUUID();
      const { payload: _payload, scope: _scope, ...cost } = prepared; void _payload; void _scope;
      const input = inputSchema.parse({ ...cost, actor: adminActor, scope: prepared.scope, cacheKey: prepared.requestHash, mode: "poc", reason: "Separate explicit authorization: one corrected Hello diagnostic, 6544 micros, one attempt, no retries or other scopes." });
      const serialized = JSON.stringify(input);
      const record = { intentId, actor: adminActor, requestHash: prepared.requestHash, scope: prepared.scope, reserveMicros: 6544 as const,
        priorAmendmentHash: rowDigest(database.prepare("SELECT * FROM hello_diagnostic_amendment WHERE id=1").get()),
        previousAttemptId: String(previous.id), previousIntentId: prior.intentId, previousAttemptHash: rowDigest(previous), previousIntentHash: rowDigest(database.prepare("SELECT * FROM intents WHERE id=?").get(prior.intentId)), approvedAt: createdAt,
        before: { budgetMicros: 138004 as const, dailyMicros: 138004 as const, maxCalls: 2 as const }, after: { budgetMicros: 144548 as const, dailyMicros: 144548 as const, maxCalls: 3 as const } };
      const audit = JSON.stringify(record);
      database.prepare("INSERT INTO intents(id,payload,checksum,created_at,expires_at,demo_id) VALUES(?,?,?,?,?,NULL)").run(intentId, serialized, digest(serialized), createdAt, new Date(now + 15 * 60000).toISOString());
      database.exec("CREATE TABLE corrected_hello_amendment(id INTEGER PRIMARY KEY CHECK(id=1),record_json TEXT NOT NULL,checksum TEXT NOT NULL)");
      database.prepare("INSERT INTO corrected_hello_amendment(id,record_json,checksum) VALUES(1,?,?)").run(audit, digest(audit));
      database.prepare("UPDATE policy SET budget=144548,daily=144548,calls=3 WHERE id=1").run();
      this.helloAmendment(database);
      return record;
    });
  }
  /** One fixed Hello exception, not a general limit-increase API. No dispatch. */
  async amendHelloDiagnostic(adminActor: string, confirmation: { confirmed: boolean; requestHash: string; maximumMicros: number }) {
    const prepared = prepareMuseHello();
    if (!hash.safeParse(adminActor).success || confirmation.confirmed !== true || confirmation.requestHash !== prepared.requestHash || confirmation.maximumMicros !== prepared.reserveMicros)
      throw fail("AI_APPROVAL_MISMATCH", "Exact administrator confirmation of the fixed Hello request and reservation is required.");
    return this.transaction(database => {
      if (this.helloAmendment(database)) throw fail("AI_DIAGNOSTIC_ALREADY_AUTHORIZED", "The single diagnostic amendment has already been used; no renewal is allowed.");
      const policy = database.prepare("SELECT * FROM policy WHERE id=1").get();
      const attempts = database.prepare("SELECT * FROM attempts ORDER BY rowid").all();
      if (!policy || policy.budget !== 131460 || policy.daily !== 131460 || policy.calls !== 1 || policy.halted !== 0 || attempts.length !== 1) throw fail("AI_DIAGNOSTIC_STATE_MISMATCH", "The original narrowed ledger state differs; no amendment is permitted.");
      const original = attempts[0], originalIntent = database.prepare("SELECT * FROM intents WHERE id=?").get(String(original.intent_id));
      if (original.mode !== "poc" || original.status !== "failed" || original.reserve_micros !== 131460 || original.charged_micros !== 131460 || original.error_code !== "AI_PROVIDER_FAILED"
        || this.intent(database, String(original.intent_id)).requestHash !== "d4c2fdb6694981d374ed304dd1ecbc477e85d0ed2709cb9c5cf2ea48ddf0aa39"
        || database.prepare("SELECT id FROM intents WHERE consumed_at IS NULL AND approved_at IS NOT NULL LIMIT 1").get()) throw fail("AI_DIAGNOSTIC_STATE_MISMATCH", "Original receipt or outstanding approval state differs; stop.");
      const now = Date.now(), createdAt = new Date(now).toISOString(), intentId = randomUUID();
      const after = { budgetMicros: 131460 + prepared.reserveMicros, dailyMicros: 131460 + prepared.reserveMicros, maxCalls: 2 as const };
      const { payload: _payload, scope: _scope, ...cost } = prepared; void _payload; void _scope;
      const input = inputSchema.parse({ ...cost, actor: adminActor, scope: MUSE_HELLO_SCOPE, cacheKey: prepared.requestHash, mode: "poc", reason: "Explicit user exception: one additional fixed Hello connectivity diagnostic, no retries or other scopes." });
      const serialized = JSON.stringify(input);
      database.prepare("INSERT INTO intents(id,payload,checksum,created_at,expires_at,demo_id) VALUES(?,?,?,?,?,NULL)").run(intentId, serialized, digest(serialized), createdAt, new Date(now + 15 * 60000).toISOString());
      const record = { intentId, actor: adminActor, requestHash: prepared.requestHash, scope: MUSE_HELLO_SCOPE, reserveMicros: prepared.reserveMicros,
        originalAttemptId: String(original.id), originalIntentId: String(original.intent_id), originalAttemptHash: rowDigest(original), originalIntentHash: rowDigest(originalIntent), approvedAt: createdAt,
        before: { budgetMicros: 131460 as const, dailyMicros: 131460 as const, maxCalls: 1 as const }, after };
      const audit = JSON.stringify(record);
      database.exec("CREATE TABLE hello_diagnostic_amendment(id INTEGER PRIMARY KEY CHECK(id=1),record_json TEXT NOT NULL,checksum TEXT NOT NULL)");
      database.prepare("INSERT INTO hello_diagnostic_amendment(id,record_json,checksum) VALUES(1,?,?)").run(audit, digest(audit));
      database.prepare("UPDATE policy SET budget=?,daily=?,calls=? WHERE id=1").run(after.budgetMicros, after.dailyMicros, after.maxCalls);
      this.helloAmendment(database);
      return record;
    });
  }
  async readHelloAmendment() { return this.transaction(database => this.helloAmendment(database)); }
  private intent(database: DatabaseSync, id: string): AiUsageIntent {
    if (!UUID.test(id)) throw fail("AI_APPROVAL_REQUIRED", "A valid persisted per-call approval is required.");
    const row = database.prepare("SELECT * FROM intents WHERE id=?").get(id);
    if (!row) throw fail("AI_APPROVAL_REQUIRED", "A persisted per-call estimate and approval are required.");
    try {
      if (typeof row.payload !== "string" || digest(row.payload) !== row.checksum) throw fail();
      const parsed = inputSchema.parse(JSON.parse(row.payload));
      return { ...parsed, id, createdAt: date(row.created_at), expiresAt: date(row.expires_at),
        approvedAt: row.approved_at === null ? null : date(row.approved_at), approvedBy: row.approved_by === null ? null : z.string().min(1).max(256).parse(row.approved_by), consumedAt: row.consumed_at === null ? null : date(row.consumed_at), demoAuthorizationId: row.demo_id === null ? null : z.string().uuid().parse(row.demo_id) };
    } catch { throw fail(); }
  }
  private demo(database: DatabaseSync, id?: string | null): AiDemoAuthorization | null {
    const row = id ? database.prepare("SELECT * FROM demo_authorizations WHERE id=?").get(id) : database.prepare("SELECT * FROM demo_authorizations ORDER BY approved_at DESC,rowid DESC LIMIT 1").get();
    if (!row) return null;
    if (![row.budget, row.daily, row.calls].every(safeInteger) || Number(row.budget) > MAX_DEMO_MICROS || Number(row.daily) > Number(row.budget) || Number(row.calls) < 1 || typeof row.id !== "string" || !UUID.test(row.id) || typeof row.approved_by !== "string") throw fail();
    if (row.reason !== null && (typeof row.reason !== "string" || row.reason.length < 10 || row.reason.length > 1000)) throw fail();
    return { id: row.id, approvedBy: row.approved_by, approvedAt: date(row.approved_at), budgetMicros: Number(row.budget), dailyMicros: Number(row.daily), maxCalls: Number(row.calls), ...(typeof row.reason === "string" ? { reason: row.reason } : {}) };
  }
  private developmentLimits(database: DatabaseSync, requested?: AiUsageLimits): AiUsageLimits {
    const row = database.prepare("SELECT * FROM policy WHERE id=1").get();
    if (!row || ![row.budget, row.daily, row.calls].every(safeInteger) || Number(row.budget) > DEFAULT_LIMITS.budgetMicros || Number(row.daily) > DEFAULT_LIMITS.dailyMicros || Number(row.calls) > 10 || ![0, 1].includes(Number(row.halted))) throw fail();
    const limits = { budgetMicros: Number(row.budget), dailyMicros: Number(row.daily), maxCalls: Number(row.calls) };
    if (requested) {
      if (![requested.budgetMicros, requested.dailyMicros, requested.maxCalls].every(safeInteger) || requested.budgetMicros > DEFAULT_LIMITS.budgetMicros || requested.dailyMicros > DEFAULT_LIMITS.dailyMicros || requested.maxCalls > 10) throw fail("AI_BUDGET_POLICY_INVALID", "Development limits cannot exceed the protected development allocation.");
      limits.budgetMicros = Math.min(limits.budgetMicros, requested.budgetMicros);
      limits.dailyMicros = Math.min(limits.dailyMicros, requested.dailyMicros);
      limits.maxCalls = Math.min(limits.maxCalls, requested.maxCalls);
      database.prepare("UPDATE policy SET budget=?,daily=?,calls=? WHERE id=1").run(limits.budgetMicros, limits.dailyMicros, limits.maxCalls);
    }
    return limits;
  }
  private totals(database: DatabaseSync, mode: "poc" | "demo", today: string) {
    const excludeTesting = (testingExists(database) ? " AND intent_id NOT IN (SELECT intent_id FROM muse_testing_intents)" : "")
      + (wordPressAltFunding(database) ? " AND intent_id NOT IN (SELECT intent_id FROM muse_wordpress_alt_intents)" : "");
    const row = database.prepare("SELECT COALESCE(SUM(charged_micros),0) charged, COALESCE(SUM(CASE WHEN substr(reserved_at,1,10)=? THEN charged_micros ELSE 0 END),0) daily, COUNT(*) calls FROM attempts WHERE mode=?" + excludeTesting).get(today, mode)!;
    if (![row.charged, row.daily, row.calls].every(safeInteger)) throw fail();
    return { chargedMicros: Number(row.charged), todayChargedMicros: Number(row.daily), calls: Number(row.calls) };
  }
  private verifyBudget(database: DatabaseSync, intent: AiUsageIntent, limits?: AiUsageLimits): void {
    if (wordPressAltIntent(database, intent.id)) { verifyWordPressAltBudget(database, intent.id); return; }
    if (testingIntent(database,intent.id)) { verifyTestingBudget(database,intent.requestHash,intent.reserveMicros); return; }
    const hello = this.helloAmendment(database);
    if (intent.mode === "poc" && hello && (intent.id !== hello.intentId || intent.requestHash !== hello.requestHash || intent.scope !== hello.scope || intent.actor !== hello.actor))
      throw fail("AI_DIAGNOSTIC_SCOPE_LOCKED", "Amended development capacity is exclusively bound to the one Hello intent.");
    if (intent.mode === "demo" && intent.demoAuthorizationId !== this.demo(database)?.id) throw fail("AI_DEMO_APPROVAL_REQUIRED", "Demo authorization changed; review a fresh estimate under the current limits.");
    const selected = intent.mode === "poc" ? this.developmentLimits(database, limits) : this.demo(database, intent.demoAuthorizationId);
    if (!selected) throw fail("AI_DEMO_APPROVAL_REQUIRED", "Demo mode requires separate persisted administrator authorization.");
    if (intent.mode === "demo" && limits && (limits.budgetMicros !== selected.budgetMicros || limits.dailyMicros !== selected.dailyMicros || limits.maxCalls !== selected.maxCalls)) throw fail("AI_DEMO_APPROVAL_REQUIRED", "The configured demo limits differ from their administrator authorization.");
    const totals = this.totals(database, intent.mode, utcDay(Date.now()));
    if (totals.calls >= selected.maxCalls) throw fail("AI_REQUEST_LIMIT", "The authorized cumulative real-request limit has been reached.");
    if (totals.chargedMicros + intent.reserveMicros > selected.budgetMicros) throw fail("AI_DEVELOPMENT_BUDGET", "This request would exceed the authorized cumulative AI allocation.");
    if (totals.todayChargedMicros + intent.reserveMicros > selected.dailyMicros) throw fail("AI_DAILY_BUDGET", "This request would exceed the authorized UTC daily AI spending limit.");
  }

  async estimate(input: AiUsageEstimateInput, limits?: AiUsageLimits): Promise<AiUsageIntent> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw fail("AI_ESTIMATE_INVALID", "A bounded scoped estimate and proof-of-concept reason are required.");
    // Standard Spark prices are at least $1.25/$4.25 per million input/output
    // tokens. Never accept a lower reservation even if a caller underestimates.
    const minimum = Math.ceil((parsed.data.maxInputTokens * parsed.data.inputPriceMicrosPerMillion + parsed.data.maxOutputTokens * parsed.data.outputPriceMicrosPerMillion) / 1_000_000);
    if (parsed.data.reserveMicros < minimum) throw fail("AI_ESTIMATE_INVALID", "The maximum-cost reservation is below the supported Standard pricing floor.");
    if (parsed.data.mode === "poc") this.transaction(database => { if (this.helloAmendment(database)) throw fail("AI_DIAGNOSTIC_SCOPE_LOCKED", "No other development estimate may use the diagnostic amendment."); });
    if (parsed.data.mode === "poc" && limits) this.transaction(database => this.developmentLimits(database, limits));
    return this.transaction(database => {
      const now = Date.now();
      const demo = parsed.data.mode === "demo" ? this.demo(database) : null;
      if (parsed.data.mode === "demo" && !demo) throw fail("AI_DEMO_APPROVAL_REQUIRED", "Demo mode requires separate persisted administrator authorization.");
      const intent: AiUsageIntent = { ...parsed.data, id: randomUUID(), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 15 * 60_000).toISOString(), approvedAt: null, approvedBy: null, consumedAt: null, demoAuthorizationId: demo?.id ?? null };
      this.verifyBudget(database, intent, limits);
      const payload = JSON.stringify(parsed.data);
      database.prepare("INSERT INTO intents(id,payload,checksum,created_at,expires_at,demo_id) VALUES(?,?,?,?,?,?)").run(intent.id, payload, digest(payload), intent.createdAt, intent.expiresAt, intent.demoAuthorizationId);
      return intent;
    });
  }
  async readIntent(id: string): Promise<AiUsageIntent> { return this.transaction(database => this.intent(database, id)); }
  async approve(id: string, adminActor: string): Promise<AiUsageIntent> {
    if (typeof adminActor !== "string" || !adminActor || adminActor.length > 256) throw fail("AI_APPROVAL_REQUIRED", "An authenticated administrator must approve this exact request.");
    return this.transaction(database => {
      const intent = this.intent(database, id);
      const alt = wordPressAltIntent(database, id);
      if (alt && adminActor !== alt.adminActor) throw fail("AI_APPROVAL_MISMATCH", "The exact funding administrator must approve this request.");
      if (Date.parse(intent.expiresAt) <= Date.now() || intent.consumedAt || intent.approvedAt) throw fail("AI_APPROVAL_STALE", "This approval is expired, consumed or already recorded; it cannot authorize another call.");
      this.verifyBudget(database, intent);
      const approvedAt = new Date(Date.now()).toISOString();
      database.prepare("UPDATE intents SET approved_at=?,approved_by=? WHERE id=?").run(approvedAt, adminActor, id);
      return { ...intent, approvedAt, approvedBy: adminActor };
    });
  }
  async reserve(id: string, authorization: AiUsageAuthorization, limits?: AiUsageLimits): Promise<AiUsageReservation> {
    const controlledTesting = this.transaction(database => !!testingIntent(database,id) || !!wordPressAltIntent(database,id));
    if (authorization?.mode === "poc" && !controlledTesting) this.transaction(database => { const hello = this.helloAmendment(database); if (hello && (id !== hello.intentId || authorization.actor !== hello.actor || authorization.requestHash !== hello.requestHash || authorization.scope !== hello.scope)) throw fail("AI_DIAGNOSTIC_SCOPE_LOCKED", "Only the exact fixed diagnostic authorization may reserve this capacity."); });
    // Persist reductions even if this particular request is subsequently rejected;
    // restoring a larger environment value cannot silently restore old capacity.
    if (authorization?.mode === "poc" && limits && !controlledTesting) this.transaction(database => this.developmentLimits(database, limits));
    return this.transaction(database => {
      const intent = this.intent(database, id);
      if (!authorization || authorization.mode !== intent.mode || authorization.requestHash !== intent.requestHash || authorization.actor !== intent.actor) throw fail("AI_APPROVAL_MISMATCH", "Approval is bound to another operator, mode or exact request.");
      for (const key of ["scope", "model", "maxInputTokens", "maxOutputTokens", "reserveMicros", "priceVersion", "cacheKey", "inputPriceMicrosPerMillion", "outputPriceMicrosPerMillion"] as const)
        if (authorization[key] !== undefined && authorization[key] !== intent[key]) throw fail("AI_APPROVAL_MISMATCH", "The prepared request no longer matches its approved scope, model, limits or price snapshot.");
      if (intent.consumedAt || !intent.approvedAt || !intent.approvedBy || Date.parse(intent.expiresAt) <= Date.now()) throw fail("AI_APPROVAL_REQUIRED", "A fresh unused administrator approval is required for every real call.");
      const policy = database.prepare("SELECT halted FROM policy WHERE id=1").get();
      if (policy?.halted !== 0) throw fail("AI_USAGE_HALTED", "AI usage accounting requires administrator investigation; further real calls are blocked.");
      if (database.prepare("SELECT id FROM attempts WHERE status IN ('reserved','unknown') LIMIT 1").get()) throw fail("AI_REAL_REQUEST_ACTIVE", "A real API request is active or uncertain; inspect it before further calls.");
      const latest = database.prepare("SELECT reserved_at FROM attempts ORDER BY reserved_at DESC LIMIT 1").get();
      if (latest && Date.now() - Date.parse(date(latest.reserved_at)) < 60_000) throw fail("AI_RATE_LIMIT", "Development allows at most one real request per minute.");
      this.verifyBudget(database, intent, limits);
      const reservedAt = new Date(Date.now()).toISOString();
      const attemptId = randomUUID();
      database.prepare("UPDATE intents SET consumed_at=? WHERE id=? AND consumed_at IS NULL").run(reservedAt, id);
      database.prepare("INSERT INTO attempts(id,intent_id,mode,model,status,reserved_at,reserve_micros,charged_micros) VALUES(?,?,?,?,'reserved',?,?,?)").run(attemptId, id, intent.mode, intent.model, reservedAt, intent.reserveMicros, intent.reserveMicros);
      return { id: attemptId, intentId: id, reservedAt, reserveMicros: intent.reserveMicros, intent: { ...intent, consumedAt: reservedAt } };
    });
  }
  async settle(id: string, outcome: AiUsageSettlement): Promise<void> {
    this.transaction(database => {
      if (!UUID.test(id)) throw fail();
      const row = database.prepare("SELECT * FROM attempts WHERE id=?").get(id);
      if (!row) throw fail();
      // Settlement is immutable; never refund a previous failure/unknown result.
      if (row.status !== "reserved") throw fail("AI_USAGE_ALREADY_SETTLED", "This real-request outcome has already been recorded and cannot be replaced.");
      const intent = this.intent(database, String(row.intent_id));
      let status = outcome.status;
      let charged = Number(row.reserve_micros);
      const usageValid = safeInteger(outcome.inputTokens) && safeInteger(outcome.outputTokens) && safeInteger(outcome.actualMicros);
      const usageExceeds = usageValid && (outcome.inputTokens! > intent.maxInputTokens || outcome.outputTokens! > intent.maxOutputTokens || outcome.actualMicros! > intent.reserveMicros);
      if (!["success", "failed", "unknown"].includes(status) || status === "success" && !usageValid || usageExceeds) status = "unknown";
      if (status === "success") {
        const floor = Math.ceil((outcome.inputTokens! * intent.inputPriceMicrosPerMillion + outcome.outputTokens! * intent.outputPriceMicrosPerMillion) / 1_000_000);
        if (outcome.actualMicros! < floor) status = "unknown";
        else charged = outcome.actualMicros!;
      }
      if (status === "unknown" && safeInteger(outcome.actualMicros)) charged = Math.max(charged, outcome.actualMicros);
      if (status === "unknown") database.prepare("UPDATE policy SET halted=1 WHERE id=1").run();
      const requestId = typeof outcome.requestId === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(outcome.requestId) ? outcome.requestId : null;
      const errorCode = typeof outcome.errorCode === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(outcome.errorCode) ? outcome.errorCode : status === "unknown" ? "AI_USAGE_UNCERTAIN" : null;
      database.prepare("UPDATE attempts SET status=?,completed_at=?,charged_micros=?,input_tokens=?,output_tokens=?,request_id=?,error_code=? WHERE id=?").run(status, new Date(Date.now()).toISOString(), charged, safeInteger(outcome.inputTokens) ? outcome.inputTokens : null, safeInteger(outcome.outputTokens) ? outcome.outputTokens : null, requestId, errorCode, id);
    });
  }
  async authorizeDemo(adminActor: string, limits: AiUsageLimits, reason = "Explicit administrator demo authorization"): Promise<AiDemoAuthorization> {
    if (typeof adminActor !== "string" || !adminActor || adminActor.length > 256 || !limits || ![limits.budgetMicros, limits.dailyMicros, limits.maxCalls].every(safeInteger) || limits.budgetMicros < 1 || limits.budgetMicros > MAX_DEMO_MICROS || limits.dailyMicros < 1 || limits.dailyMicros > limits.budgetMicros || limits.maxCalls < 1 || limits.maxCalls > 1000) throw fail("AI_DEMO_APPROVAL_REQUIRED", "Explicit bounded administrator authorization is required for demo mode.");
    if (typeof reason !== "string" || reason.trim().length < 10 || reason.length > 1000) throw fail("AI_DEMO_APPROVAL_REQUIRED", "The administrator must record a bounded reason for enabling demo mode.");
    return this.transaction(database => {
      const now = Date.now();
      const totals = this.totals(database, "demo", utcDay(now));
      if (limits.budgetMicros < totals.chargedMicros || limits.maxCalls < totals.calls) throw fail("AI_DEMO_APPROVAL_REQUIRED", "Demo limits cannot discard already charged usage.");
      const authorization: AiDemoAuthorization = { id: randomUUID(), approvedBy: adminActor, approvedAt: new Date(now).toISOString(), ...limits, reason: reason.trim() };
      database.prepare("INSERT INTO demo_authorizations(id,approved_by,approved_at,budget,daily,calls,reason) VALUES(?,?,?,?,?,?,?)").run(authorization.id, adminActor, authorization.approvedAt, limits.budgetMicros, limits.dailyMicros, limits.maxCalls, authorization.reason!);
      return authorization;
    });
  }
  async status(): Promise<AiUsageSummary> {
    return this.transaction(database => {
      const limits = this.developmentLimits(database);
      const today = utcDay(Date.now());
      const active = database.prepare("SELECT id FROM attempts WHERE status IN ('reserved','unknown') ORDER BY reserved_at LIMIT 1").get();
      const latest = database.prepare("SELECT reserved_at FROM attempts ORDER BY reserved_at DESC LIMIT 1").get();
      const attempts = database.prepare("SELECT * FROM attempts ORDER BY reserved_at DESC,rowid DESC LIMIT 50").all();
      return {
        schemaVersion: "seo-spy.ai-usage.v1", development: { ...limits, ...this.totals(database, "poc", today) }, demo: { ...this.totals(database, "demo", today), authorization: this.demo(database) },
        ...(testingExists(database) ? { testing: testingStatus(database) } : {}),
        ...(wordPressAltFunding(database) ? { wordPressAlt: wordPressAltStatus(database) } : {}),
        activeAttemptId: active ? String(active.id) : null, halted: database.prepare("SELECT halted FROM policy WHERE id=1").get()?.halted !== 0,
        lastReservedAt: latest ? date(latest.reserved_at) : null,
        recentAttempts: attempts.map(row => ({ id: String(row.id), intentId: String(row.intent_id), mode: row.mode as "poc" | "demo", model: row.model as "muse-spark-1.3" | "muse-spark-1.2", status: String(row.status), reservedAt: date(row.reserved_at), completedAt: row.completed_at === null ? null : date(row.completed_at), reserveMicros: Number(row.reserve_micros), chargedMicros: Number(row.charged_micros), inputTokens: row.input_tokens === null ? null : Number(row.input_tokens), outputTokens: row.output_tokens === null ? null : Number(row.output_tokens), requestId: row.request_id === null ? null : String(row.request_id), errorCode: row.error_code === null ? null : String(row.error_code) })),
      };
    });
  }
  async activateTestingAllocation(actor: string, confirmation: { confirmed: boolean; policyHash: string; requestHash: string; maximumMicros: number }) {
    return this.transaction(database=>activateTesting(database,actor,confirmation));
  }
  async estimateTesting(input: AiUsageEstimateInput, metadata: unknown) {
    const prepared=inputSchema.parse(input), context=testingMetadataSchema.parse(metadata);
    if(prepared.mode!=="poc"||prepared.model!=="muse-spark-1.3"||prepared.scope!==`assessment:${context.businessId}:${context.assessmentId}`
      ||prepared.reserveMicros<Math.ceil((prepared.maxInputTokens*prepared.inputPriceMicrosPerMillion+prepared.maxOutputTokens*prepared.outputPriceMicrosPerMillion)/1000000))return testingFail("AI_ESTIMATE_INVALID");
    return this.transaction(database=>{
      const allocation=testingAllocation(database);if(!allocation||allocation.actor!==prepared.actor)return testingFail("AI_APPROVAL_MISMATCH");
      verifyTestingBudget(database,prepared.requestHash,prepared.reserveMicros);
      if(database.prepare("SELECT id FROM intents WHERE consumed_at IS NULL AND approved_at IS NOT NULL LIMIT 1").get())return testingFail("AI_TESTING_REVIEW_REQUIRED");
      const now=Date.now(),intentId=randomUUID(),createdAt=new Date(now).toISOString(),expiresAt=new Date(now+15*60000).toISOString(),serialized=JSON.stringify(prepared),contextJson=JSON.stringify(context);
      database.prepare("INSERT INTO intents(id,payload,checksum,created_at,expires_at,demo_id) VALUES(?,?,?,?,?,NULL)").run(intentId,serialized,digest(serialized),createdAt,expiresAt);
      database.prepare("INSERT INTO muse_testing_intents VALUES(?,?,?,?)").run(intentId,prepared.requestHash,contextJson,digest(contextJson));
      return this.intent(database,intentId);
    });
  }
  async testingAttempt(intentId: string) { return this.transaction(database=>{if(!testingIntent(database,intentId))return testingFail();const row=database.prepare("SELECT * FROM attempts WHERE intent_id=?").get(intentId);return row??null;}); }
  async completeTestingReceipt(actor: string,intentId: string,receipt: unknown) { return this.transaction(database=>{if(this.intent(database,intentId).actor!==actor)return testingFail("AI_APPROVAL_MISMATCH");return saveTestingReceipt(database,intentId,receipt);}); }
  async testingReceipts() { return this.transaction(database=>readTestingReceipts(database)); }
  /** A stable private copy is inspected; this never opens or initializes the source ledger. */
  async prepareWordPressAltFunding(adminActor: string, request: unknown) {
    const paths = [this.path, this.path + ".initialized", this.path + "-wal", this.path + "-shm", this.path + "-journal"];
    const fingerprints = () => paths.map((path, index) => {
      if (!existsSync(path)) { if (index < 2) throw fail(); return null; }
      const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw fail();
      return digest(readFileSync(path).toString("base64"));
    });
    const before = fingerprints(), directory = mkdtempSync(join(tmpdir(), "seo-spy-alt-funding-preview-")), copy = join(directory, "usage.sqlite");
    let database: DatabaseSync | undefined;
    try {
      paths.forEach((path, index) => { if (before[index] !== null && index !== 3) copyFileSync(path, copy + path.slice(this.path.length)); });
      database = new DatabaseSync(copy, { readOnly: true });
      const preview = prepareWordPressAltFunding(database, adminActor, request, testingStatus(database));
      if (JSON.stringify(fingerprints()) !== JSON.stringify(before)) throw fail("AI_USAGE_UNAVAILABLE", "Ledger changed during read-only funding preparation; no authorization was created.");
      return preview;
    } finally {
      database?.close();
      if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) rmSync(directory, { recursive: true });
    }
  }
  /** Future explicit funding-only activation. Does not estimate, approve, reserve or dispatch. */
  async activateWordPressAltFunding(adminActor: string, request: unknown, confirmation: { confirmed: boolean; policyHash: string; fundingHash: string }) {
    return this.transaction(database => activateWordPressAltFunding(database, adminActor, request, confirmation, testingStatus(database)));
  }
  async estimateWordPressAlt(input: AiUsageEstimateInput) {
    const prepared = inputSchema.parse(input);
    return this.transaction(database => {
      const grant = validateWordPressAltEstimate(database, prepared);
      if (database.prepare("SELECT id FROM intents WHERE approved_at IS NOT NULL AND consumed_at IS NULL LIMIT 1").get()) throw fail("AI_TESTING_REVIEW_REQUIRED");
      const now = Date.now(), id = randomUUID(), createdAt = new Date(now).toISOString(), expiresAt = new Date(now + 15 * 60000).toISOString(), payload = JSON.stringify(prepared);
      database.prepare("INSERT INTO intents(id,payload,checksum,created_at,expires_at,demo_id) VALUES(?,?,?,?,?,NULL)").run(id, payload, digest(payload), createdAt, expiresAt);
      linkWordPressAltIntent(database, id, grant);
      verifyWordPressAltBudget(database, id);
      return this.intent(database, id);
    });
  }
  async wordPressAltAttempt(intentId: string) { return this.transaction(database => {
    if (!wordPressAltIntent(database, intentId)) throw fail("AI_WORDPRESS_ALT_UNAVAILABLE");
    return database.prepare("SELECT * FROM attempts WHERE intent_id=?").get(intentId) ?? null;
  }); }
  async wordPressAltApproval(actor: string, scope: string, requestHash: string) {
    return this.transaction(database => {
      const grant = wordPressAltFunding(database);
      if (!grant || grant.request.actor !== actor || grant.scope !== scope || grant.request.requestHash !== requestHash)
        return { status: "pending_approval" as const };
      const row = database.prepare("SELECT intent_id FROM muse_wordpress_alt_intents WHERE grant_id=1").get();
      if (!row) return { status: "pending_approval" as const };
      const intent = this.intent(database, String(row.intent_id));
      if (intent.consumedAt) return { status: "used" as const };
      if (Date.parse(intent.expiresAt) <= Date.now()) return { status: "expired" as const };
      return intent.approvedAt ? { status: "approved" as const, intentId: intent.id } : { status: "pending_approval" as const };
    });
  }
  async completeWordPressAltReceipt(actor: string, intentId: string, receipt: unknown) { return this.transaction(database => {
    const grant = wordPressAltIntent(database, intentId);
    if (!grant || actor !== grant.adminActor) throw fail("AI_APPROVAL_MISMATCH");
    return saveWordPressAltReceipt(database, intentId, receipt);
  }); }
  async wordPressAltReceipts() { return this.transaction(database => readWordPressAltReceipts(database)); }
}
