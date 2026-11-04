import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { AssessmentMuseAdapter } from "../../integrations/assessment-ai/assessment-muse.js";
import { assessmentMuseAnalysisSchema } from "../../integrations/assessment-ai/assessment-muse.types.js";
import { MetaMuseProvider, MetaMuseTransport } from "../../integrations/ai/meta-muse.provider.js";
import { AiUsageStore } from "../../integrations/ai/ai-usage.store.js";
import type { AiUsageLimits, AiUsageSummary } from "../../integrations/ai/ai-usage.types.js";
import { readAiUsageSnapshot } from "../../integrations/ai/ai-usage-snapshot.js";
import { authenticateAiAdministrator } from "../ai/ai-admin.guard.js";
import { AssessmentAnalysisService } from "./assessment-analysis.service.js";
import { AssessmentStore } from "./assessment.store.js";
import type { AssessmentMuseEvidenceBundle } from "../../integrations/assessment-ai/assessment-muse.types.js";

export class AssessmentPocError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
const fail = (code: string, message: string): never => { throw new AssessmentPocError(code, message); };
const limitsSchema = z.object({ budgetMicros: z.number().int().nonnegative().max(2_000_000), dailyMicros: z.number().int().nonnegative().max(500_000), maxCalls: z.number().int().nonnegative().max(10) }).strict();
const approvalReason = z.object({ purpose: z.literal("single-assessment-poc-v1"), inputHash: z.string().regex(/^[a-f0-9]{64}$/), limits: limitsSchema, note: z.string().min(10).max(300) }).strict();
export interface PocConfirmation { confirmed: boolean; requestHash: string; inputHash: string; maximumMicros: number }

/** Local CLI only: intentionally not a Nest provider, controller or public route. */
export class AssessmentPocOperator {
  constructor(protected readonly config: ConfigService, protected readonly analyses: AssessmentAnalysisService, protected readonly store: AssessmentStore,
    protected readonly ledger: AiUsageStore, protected readonly transport: MetaMuseTransport,
    protected readonly snapshot: () => Promise<AiUsageSummary> = () => readAiUsageSnapshot(config)) {}

  protected actor(credential: string) { return authenticateAiAdministrator(this.config.get<string>("AI_ADMIN_KEY") ?? "", credential); }
  protected runtime(limits?: AiUsageLimits, live = false) {
    const fixed = { AI_MODEL: "muse-spark-1.3", AI_PROCESSING_MODE: "standard", AI_REASONING_EFFORT: "low", AI_MAX_OUTPUT_TOKENS: 1500 };
    for (const [name, expected] of Object.entries(fixed)) if (String(this.config.get(name) ?? expected) !== String(expected)) fail("ASSESSMENT_POC_SETTINGS", "The POC cannot change the configured model, reasoning or token limit.");
    // A private process-local ConfigService never calls set() or changes .env/defaults.
    return new ConfigService({ ...fixed, AI_MODE: "poc", MOCK_AI: false, AI_ENABLED: live,
      AI_MAX_INPUT_BYTES: this.config.get("AI_MAX_INPUT_BYTES") ?? 32768, AI_TIMEOUT_MS: this.config.get("AI_TIMEOUT_MS") ?? 60000, AI_MAX_CONCURRENCY: 1,
      AI_INPUT_PRICE_MICROS_PER_MILLION: this.config.get("AI_INPUT_PRICE_MICROS_PER_MILLION") ?? 1250000,
      AI_OUTPUT_PRICE_MICROS_PER_MILLION: this.config.get("AI_OUTPUT_PRICE_MICROS_PER_MILLION") ?? 4250000,
      ...(live ? { MODEL_API_KEY: this.config.get<string>("MODEL_API_KEY") } : {}),
      AI_DEV_BUDGET_MICROS: limits?.budgetMicros ?? 0, AI_DEV_DAILY_MICROS: limits?.dailyMicros ?? 0, AI_DEV_MAX_CALLS: limits?.maxCalls ?? 0 });
  }
  protected async evidence(businessId: string, assessmentId: string): Promise<Extract<AssessmentMuseEvidenceBundle, { schemaVersion: "seo-spy.assessment-muse-evidence.v3" | "seo-spy.assessment-muse-evidence.v4" | "seo-spy.assessment-muse-evidence.v5" }>> {
    return this.analyses.preparePocEvidence(businessId, assessmentId);
  }
  protected async prepared(businessId: string, assessmentId: string, limits?: AiUsageLimits, live = false) {
    const bundle = await this.evidence(businessId, assessmentId);
    const runtime = this.runtime(limits, live), provider = new MetaMuseProvider(runtime, this.transport, this.ledger), adapter = new AssessmentMuseAdapter(runtime, provider);
    const prepared = adapter.prepare(bundle), wire = provider.prepare(prepared.modelInput);
    return { bundle, adapter, provider, prepared, wire, scope: `assessment:${businessId}:${assessmentId}` };
  }
  protected confirmation(confirmation: PocConfirmation, prepared: Awaited<ReturnType<AssessmentPocOperator["prepared"]>>) {
    if (confirmation.confirmed !== true || confirmation.requestHash !== prepared.wire.requestHash || confirmation.inputHash !== prepared.prepared.inputHash || confirmation.maximumMicros !== prepared.wire.reserveMicros)
      fail("AI_APPROVAL_MISMATCH", "Confirm the exact current request hash, evidence input hash and full maximum reservation.");
  }
  private singleLimits(status: AiUsageSummary, reserve: number): AiUsageLimits {
    if (status.halted || status.activeAttemptId) fail("AI_USAGE_HALTED", "Active or uncertain accounting blocks this POC.");
    const limits = { budgetMicros: status.development.chargedMicros + reserve, dailyMicros: status.development.todayChargedMicros + reserve, maxCalls: status.development.calls + 1 };
    if (!limitsSchema.safeParse(limits).success || limits.budgetMicros > status.development.budgetMicros || limits.dailyMicros > Math.min(status.development.dailyMicros, Number(this.config.get("AI_DEV_DAILY_MICROS") ?? 500000)) || limits.maxCalls > Math.min(status.development.maxCalls, Number(this.config.get("AI_DEV_MAX_CALLS") ?? 10)))
      fail("AI_DEVELOPMENT_BUDGET", "The existing remaining persistent allocation cannot cover this one-request allowance; no policy increase is permitted.");
    return limits;
  }
  async preview(businessId: string, assessmentId: string) {
    const current = await this.prepared(businessId, assessmentId), usage = await this.snapshot();
    const configured = Number(this.config.get("AI_DEV_BUDGET_MICROS") ?? 2000000);
    const remaining = Math.max(0, Math.min(configured, usage.development.budgetMicros) - usage.development.chargedMicros);
    let eligible = true;
    try { this.singleLimits(usage, current.wire.reserveMicros); } catch { eligible = false; }
    const wire = JSON.parse(current.wire.payload) as Record<string, unknown>;
    return { stage: "preview", businessId, assessmentId, sourceManifest: current.bundle.sources, policyVersion: current.bundle.policyVersion, inputHash: current.prepared.inputHash,
      requestHash: current.wire.requestHash, scope: current.scope, wireBytes: Buffer.byteLength(current.wire.payload), maxInputTokens: current.wire.maxInputTokens, maximumMicros: current.wire.reserveMicros,
      request: { endpoint: "https://api.meta.ai/v1/responses", model: wire.model, processing: "standard", reasoning: wire.reasoning, max_output_tokens: wire.max_output_tokens, text: wire.text,
        tools: wire.tools, tool_choice: wire.tool_choice, store: wire.store, stream: wire.stream, background: wire.background, truncation: wire.truncation },
      currentEffectivePocBudgetMicros: Math.min(configured, usage.development.budgetMicros), remainingEffectivePocBudgetMicros: remaining, ledger: usage,
      gates: { evidenceValidated: true, fixedSettings: true, administratorConfigured: (this.config.get<string>("AI_ADMIN_KEY") ?? "").length >= 32, persistentAllocationCanCoverOneRequest: eligible,
        currentBudgetCoversRequest: remaining >= current.wire.reserveMicros, explicitAllowanceApproved: false, singleUseIntentApproved: false, deliberatePocExecutionSelected: false, allLiveGatesSatisfied: false },
      cachedLiveAnalysisId: (this.store.byCacheKey("analysis", businessId, current.prepared.cacheKey) as { id?: string } | null)?.id ?? null,
      noAuthorizationOrReservationCreated: true };
  }
  async approve(businessId: string, assessmentId: string, credential: string, confirmation: PocConfirmation & { authorizeOneRequest: boolean; reason: string }) {
    const actor = this.actor(credential), current = await this.prepared(businessId, assessmentId);
    this.confirmation(confirmation, current);
    if (!confirmation.authorizeOneRequest) fail("AI_APPROVAL_REQUIRED", "An explicit one-request process-local budget allowance is required.");
    if (this.store.byCacheKey("analysis", businessId, current.prepared.cacheKey)) fail("ASSESSMENT_POC_CACHED", "A saved live result already exists; review it without another approval.");
    const status = await this.ledger.status(), limits = this.singleLimits(status, current.wire.reserveMicros);
    const reason = approvalReason.parse({ purpose: "single-assessment-poc-v1", inputHash: current.prepared.inputHash, limits, note: confirmation.reason });
    const { payload: _payload, ...cost } = current.wire; void _payload;
    const intent = await this.ledger.estimate({ ...cost, actor, scope: current.scope, cacheKey: current.wire.requestHash, mode: "poc", reason: JSON.stringify(reason) }, limits);
    const approved = await this.ledger.approve(intent.id, actor);
    return { stage: "approved", intentId: approved.id, requestHash: approved.requestHash, inputHash: reason.inputHash, maximumMicros: approved.reserveMicros, limits, expiresAt: approved.expiresAt, modelDispatches: 0 };
  }
  async execute(businessId: string, assessmentId: string, credential: string, intentId: string, confirmation: PocConfirmation & { poc: boolean }) {
    const actor = this.actor(credential);
    if (!confirmation.poc) fail("AI_MOCK_MODE", "Select the isolated POC execution stage deliberately; development remains mock-only.");
    const intent = await this.ledger.readIntent(intentId);
    let reason: z.infer<typeof approvalReason>;
    try { reason = approvalReason.parse(JSON.parse(intent.reason)); } catch { return fail("AI_APPROVAL_MISMATCH", "Only this operator's exact one-request approval can execute an assessment POC."); }
    const current = await this.prepared(businessId, assessmentId, reason.limits, true);
    this.confirmation(confirmation, current);
    if (intent.actor !== actor || intent.approvedBy !== actor || intent.scope !== current.scope || intent.mode !== "poc" || intent.requestHash !== current.wire.requestHash || reason.inputHash !== current.prepared.inputHash || intent.reserveMicros !== current.wire.reserveMicros || !intent.approvedAt)
      fail("AI_APPROVAL_MISMATCH", "The administrator, assessment, evidence, request or allowance differs from the approved intent.");
    const cached = this.store.byCacheKey("analysis", businessId, current.prepared.cacheKey);
    if (cached) {
      const { createdAt: _createdAt, ...record } = cached as Record<string, unknown>; void _createdAt;
      const saved = current.adapter.validateRecord(current.bundle, record);
      if (saved.authorization?.intentId !== intentId) fail("AI_APPROVAL_MISMATCH", "The cached result belongs to another approval; use review instead.");
      return { stage: "review", providerResponseStatus: "completed", cached: true, modelDispatches: 0, analysis: saved };
    }
    if (intent.consumedAt || Date.parse(intent.expiresAt) <= Date.now()) fail("AI_APPROVAL_STALE", "This intent is expired or already attempted. No retry is permitted.");
    const analysis = await current.adapter.analyze(current.bundle, { intentId, actor });
    const record = assessmentMuseAnalysisSchema.parse({ ...analysis, authorization: { intentId, actor, requestHash: intent.requestHash, scope: intent.scope, maximumMicros: intent.reserveMicros } });
    // Revalidate the immutable sources after dispatch before publishing a result.
    const after = await this.prepared(businessId, assessmentId, reason.limits);
    if (after.prepared.inputHash !== current.prepared.inputHash) fail("ASSESSMENT_STORAGE_ERROR", "Saved evidence changed during generation; usage remains accounted and no analysis was published.");
    current.adapter.validateRecord(current.bundle, record);
    const stored = this.store.write("analysis", { ...record, createdAt: record.generatedAt }, current.prepared.cacheKey) as Record<string, unknown>;
    return { stage: "review", providerResponseStatus: "completed", cached: false, modelDispatches: 1, analysis: await this.analyses.read(businessId, assessmentId, String(stored.id)), ledger: await this.ledger.status(), evidenceValidated: true,
      provenance: "Meta Muse-assisted: model-selected verified priorities; backend-rendered explanatory prose." };
  }
  async review(businessId: string, assessmentId: string, credential: string, analysisId: string) {
    this.actor(credential);
    await this.analyses.preparePocEvidence(businessId, assessmentId);
    const analysis = await this.analyses.read(businessId, assessmentId, analysisId);
    return { stage: "review", analysis, ledger: await this.snapshot(), evidenceValidated: true, modelDispatches: 0 };
  }
}
