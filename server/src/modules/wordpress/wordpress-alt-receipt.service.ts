import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";
import { AiUsageStore } from "../../integrations/ai/ai-usage.store.js";
import { WordPressFixStore } from "./wordpress-fix.store.js";
import { altEvidenceSchema, altOutputSchema, validateAltOutput } from "./wordpress-fix.types.js";

export interface AltReceiptOutcome {
  businessId: string; actor: string; intentId: string; evidenceId: string; requestHash: string;
  generationId: string | null; schemaValid: boolean; persisted: boolean; httpStatus: number | null;
  completionStatus: "completed" | "incomplete" | "failed" | "in_progress" | "queued" | "cancelled" | null;
  failureCategory: string | null;
}
const attemptSchema = z.object({ id: z.string().uuid(), intent_id: z.string().uuid(), status: z.enum(["reserved", "success", "failed", "unknown"]),
  reserve_micros: z.number().int().positive(), charged_micros: z.number().int().nonnegative(), input_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(), request_id: z.string().nullable() }).passthrough();
const generationSchema = z.object({ id: z.string().uuid(), kind: z.literal("generation"), businessId: z.string(), actor: z.string(),
  evidenceId: z.string().uuid(), requestHash: z.string(), isMock: z.literal(false), provider: z.literal("meta"), output: altOutputSchema,
  attemptId: z.string().uuid() }).passthrough();
const rejected = () => new ServiceUnavailableException({ code: "WORDPRESS_ALT_RECEIPT_UNAVAILABLE", message: "The settled generation receipt could not be verified or saved. No retry was made; inspect the protected attempt." });

/** Records one settled attempt only; never authorizes, dispatches, retries or renews evidence. */
@Injectable()
export class WordPressAltReceiptService {
  constructor(private readonly usage: AiUsageStore, private readonly fixes: WordPressFixStore) {}
  async publish(outcome: AltReceiptOutcome): Promise<boolean> {
    const state = await this.usage.status(), grant = state.wordPressAlt?.funding;
    if (!grant) return false;
    if (grant.request.actor !== outcome.actor || grant.request.businessId !== outcome.businessId
      || grant.request.evidenceContextId !== outcome.evidenceId || grant.request.requestHash !== outcome.requestHash) throw rejected();
    const raw = await this.usage.wordPressAltAttempt(outcome.intentId);
    if (!raw) return false;
    const attempt = attemptSchema.parse(raw);
    if (attempt.intent_id !== outcome.intentId) throw rejected();
    if (attempt.status === "reserved") return false;
    if (outcome.persisted !== (outcome.generationId !== null)) throw rejected();
    if (outcome.persisted) {
      if (!outcome.schemaValid || attempt.status !== "success" || outcome.completionStatus !== "completed") throw rejected();
      const evidence = altEvidenceSchema.parse(this.fixes.read(outcome.businessId, outcome.actor, outcome.evidenceId));
      const generation = generationSchema.parse(this.fixes.read(outcome.businessId, outcome.actor, outcome.generationId!));
      if (evidence.id !== outcome.evidenceId || evidence.businessId !== outcome.businessId || evidence.actor !== outcome.actor
        || generation.id !== outcome.generationId || generation.businessId !== outcome.businessId || generation.actor !== outcome.actor
        || generation.evidenceId !== outcome.evidenceId || generation.requestHash !== outcome.requestHash
        || generation.attemptId !== attempt.id) throw rejected();
      validateAltOutput(generation.output, evidence);
    }
    await this.usage.completeWordPressAltReceipt(grant.adminActor, outcome.intentId, { requestHash: outcome.requestHash, evidenceContextId: outcome.evidenceId,
      attemptId: attempt.id, reservedMicros: attempt.reserve_micros, ledgerChargeMicros: attempt.charged_micros,
      inputTokens: attempt.input_tokens, outputTokens: attempt.output_tokens, requestId: attempt.request_id,
      httpStatus: outcome.httpStatus, completionStatus: outcome.completionStatus, schemaValid: outcome.schemaValid,
      persisted: outcome.persisted, generationId: outcome.generationId, failureCategory: outcome.failureCategory });
    return true;
  }
}
