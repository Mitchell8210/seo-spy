import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MetaMuseProvider, type MetaMuseAuthorization, type MetaMuseHttpResponse } from "../../integrations/ai/meta-muse.provider.js";
import { offlineAiProposal, plannerMuseInput, PLANNER_AI_SCOPE, type AiSnapshot } from "./planner-ai.domain.js";
import { parsePlannerMuseResponse, plannerMuseConfig, PlannerMuseError, preparePlannerMuse, type PlannerMuseRequest } from "./planner-muse.request.js";

export const PLANNER_AI_AUTHORIZATION = Symbol("PLANNER_AI_AUTHORIZATION");
export const PLANNER_MUSE_EXECUTOR = Symbol("PLANNER_MUSE_EXECUTOR");
/** Trusted central allowance adapter, not a new ledger. Preflight must authenticate
 * the actor and atomically reserve dedicated planner capacity for this exact request.
 * Automatic approval within an authorized planner allowance is permitted; never
 * borrow general development/assessment/Fix allocations.
 */
export interface PlannerAiAuthorization {
  preflight(input: { businessId: string; scope: string; snapshotHash: string; requestHash: string; settingsHash: string; reserveMicros: number; generationId: string;
    model: string; maxInputTokens: number; maxOutputTokens: number; priceVersion: string; perGenerationMicros: number; allowanceCeilingMicros: number }): Promise<MetaMuseAuthorization | null>;
}
/** Existing authenticated transport/accounting owner implements this narrow seam.
 * Reuse its credential and one-use dispatch grant. Settle actual usage even for
 * invalid/truncated responses; retain unknown reservations on network/timeout errors.
 * Register only when dedicated central allowance support enforces these bounds.
 */
export interface PlannerMuseExecutor {
  execute(request: PlannerMuseRequest, authorization: MetaMuseAuthorization, context: { businessId: string; generationId: string }, signal: AbortSignal): Promise<{
    response: MetaMuseHttpResponse; accountingAttemptId: string; requestHash: string; settingsHash: string; scope: string;
  }>;
}
export class PlannerAiGenerationError extends PlannerMuseError {}
export interface PlannerFrontendContext { actor: string; businessId: string; siteUrl: string }
@Injectable()
export class PlannerAiGateway {
  constructor(@Optional() private readonly config?: ConfigService,
    @Optional() @Inject(PLANNER_AI_AUTHORIZATION) private readonly authorization?: PlannerAiAuthorization,
    @Optional() @Inject(PLANNER_MUSE_EXECUTOR) private readonly executor?: PlannerMuseExecutor,
    @Optional() private readonly provider?: MetaMuseProvider) {}
  async generate(snapshot: AiSnapshot, mode: "mock" | "live", generationId: string, frontend?: PlannerFrontendContext) {
    if (mode === "mock") return { output: offlineAiProposal(snapshot), model: "offline-simulation", requestIdentity: null, accountingAttemptId: null };
    if (frontend) {
      if (!this.provider || frontend.businessId !== snapshot.businessId) throw new PlannerAiGenerationError("AI_PLANNING_APPROVAL_REQUIRED", "Your account is not authorized for this planning request.");
      const input = { ...plannerMuseInput(snapshot), reasoningEffort: "minimal" as const };
      try {
        const prepared = this.provider.prepare(input);
        const generated = await this.provider.generateFrontend(input, { ...frontend, task: "planner", resourceKey: generationId });
        if (!generated.attemptId || generated.model !== prepared.model) throw new Error("Unmatched accounting result");
        return { output: generated.output, model: generated.model, requestIdentity: prepared.requestHash, accountingAttemptId: generated.attemptId };
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "AI_PLANNING_PROVIDER_FAILED";
        const message = /COST|LIMIT|FUNDING/.test(code)
          ? "This planning request exceeds the current AI allowance. Increase the allowance before generating; no calendar changes were made."
          : "The AI planning request could not complete within your authorized allowance. Check your saved result and allowance before requesting again.";
        throw new PlannerAiGenerationError(code, message);
      }
    }
    if (!this.authorization || !this.executor) throw new PlannerAiGenerationError("AI_PLANNING_APPROVAL_REQUIRED", "Muse scheduling is not enabled for this business yet. A separate scheduling allowance is required. No model request was made; Offline Preview remains available.");
    // Feature limits are independent; existing application-wide safety switches
    // still prohibit dispatch. Reading them does not alter their configuration.
    const enabled = this.config?.get("AI_ENABLED"), mock = this.config?.get("MOCK_AI"), aiMode = this.config?.get("AI_MODE");
    if (enabled !== true && enabled !== "true" || mock !== false && mock !== "false" || !["poc", "demo"].includes(String(aiMode))) throw new PlannerAiGenerationError("AI_PLANNING_DISABLED", "Live Muse requests are disabled by the application's existing safety switches. Offline Preview remains available.");
    const prepared = preparePlannerMuse(snapshot, plannerMuseConfig(this.config));
    const scope = `${PLANNER_AI_SCOPE}:${snapshot.businessId}`;
    let approval: MetaMuseAuthorization | null;
    try {
      approval = await this.authorization.preflight({ businessId: snapshot.businessId, scope, snapshotHash: prepared.snapshotHash, requestHash: prepared.requestHash, settingsHash: prepared.settingsHash,
        reserveMicros: prepared.reserveMicros, generationId, model: prepared.model, maxInputTokens: prepared.maxInputTokens, maxOutputTokens: prepared.maxOutputTokens,
        priceVersion: prepared.priceVersion, perGenerationMicros: prepared.perGenerationMicros, allowanceCeilingMicros: prepared.allowanceCeilingMicros });
    } catch { throw new PlannerAiGenerationError("AI_PLANNING_ALLOWANCE_UNAVAILABLE", "Dedicated Muse scheduling capacity could not be reserved. No model request was made; other features' allowances were not used."); }
    if (!approval?.intentId || !approval.actor || approval.scope !== scope) throw new PlannerAiGenerationError("AI_PLANNING_APPROVAL_REQUIRED", "No authorized Muse scheduling allowance is available for this business. No model request was made.");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new PlannerAiGenerationError("AI_PLANNING_TIMEOUT", "Muse scheduling timed out. Its outcome may be uncertain; it was not retried automatically.")); }, prepared.timeoutMs); timer.unref(); });
    try {
      const result = await Promise.race([this.executor.execute(prepared, approval, { businessId: snapshot.businessId, generationId }, controller.signal), timeout]);
      if (typeof result.accountingAttemptId !== "string" || !result.accountingAttemptId || result.accountingAttemptId.length > 128 || result.requestHash !== prepared.requestHash || result.settingsHash !== prepared.settingsHash || result.scope !== scope) throw new PlannerAiGenerationError("AI_PLANNING_ACCOUNTING_MISMATCH", "Muse scheduling did not return a matching central accounting receipt. No proposal was accepted.");
      const decoded = parsePlannerMuseResponse(result.response, prepared);
      return { ...decoded, requestIdentity: prepared.requestHash, accountingAttemptId: result.accountingAttemptId };
    } catch (error) {
      if (error instanceof PlannerMuseError) throw error;
      throw new PlannerAiGenerationError("AI_PLANNING_PROVIDER_FAILED", "Muse scheduling failed or its outcome is uncertain. No automatic paid retry or calendar change occurred.");
    } finally { if (timer) clearTimeout(timer); }
  }
}
