import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { z } from "zod";
import { MUSE_INPUT_PRICE_MICROS_PER_MILLION, MUSE_OUTPUT_PRICE_MICROS_PER_MILLION, MUSE_PRICE_VALID_UNTIL, MUSE_PRICE_VERSION, museUsageCostMicros } from "../../integrations/ai/muse-cost.js";
import type { MetaMuseHttpResponse } from "../../integrations/ai/meta-muse.provider.js";
import { aiOutputSchema, aiSnapshotSchema, plannerMuseInput, snapshotHash, type AiSnapshot } from "./planner-ai.domain.js";
import { canonical } from "./planner.types.js";

export class PlannerMuseError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
const fail = (code: string, message: string): never => { throw new PlannerMuseError(code, message); };
const boundedInteger = (min: number, max: number) => z.preprocess(value => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value, z.number().int().min(min).max(max));
const integer = (defaultValue: number, min: number, max: number) => boundedInteger(min, max).default(defaultValue);
const configSchema = z.object({
  model: z.enum(["muse-spark-1.3", "muse-spark-1.2"]).default("muse-spark-1.3"),
  // Explicit choice: provider docs do not publish this model's exact output cap.
  // Never silently inherit 1500, or presume a larger allowance is supported.
  maxOutputTokens: boundedInteger(512, 16384), maxRequestBytes: integer(98304, 8192, 131072),
  timeoutMs: integer(90000, 1000, 120000), perGenerationMicros: integer(500000, 1, 1000000),
  allowanceCeilingMicros: integer(0, 0, 100000000),
}).strict();
export type PlannerMuseConfig = z.infer<typeof configSchema>;
export function plannerMuseConfig(config = new ConfigService()): PlannerMuseConfig {
  const parsed = configSchema.safeParse({ model: config.get("PLANNER_MUSE_MODEL"), maxOutputTokens: config.get("PLANNER_MUSE_MAX_OUTPUT_TOKENS"),
    maxRequestBytes: config.get("PLANNER_MUSE_MAX_REQUEST_BYTES"), timeoutMs: config.get("PLANNER_MUSE_TIMEOUT_MS"),
    perGenerationMicros: config.get("PLANNER_MUSE_PER_GENERATION_MICROS"), allowanceCeilingMicros: config.get("PLANNER_MUSE_ALLOWANCE_CEILING_MICROS") });
  if (!parsed.success) return fail("AI_PLANNING_CONFIG_INVALID", "Set a verified planner-specific output-token limit and valid scheduling configuration before live generation. No model request was made.");
  return parsed.data;
}
export interface PlannerMuseRequest {
  payload: string; requestHash: string; settingsHash: string; snapshotHash: string; model: PlannerMuseConfig["model"];
  maxInputTokens: number; maxOutputTokens: number; reserveMicros: number; priceVersion: string;
  inputPriceMicrosPerMillion: number; outputPriceMicrosPerMillion: number; timeoutMs: number; perGenerationMicros: number; allowanceCeilingMicros: number;
}
/** Pure preparation: no credentials, HTTP, ledger access or allowance activation. */
export function preparePlannerMuse(snapshot: AiSnapshot, config: PlannerMuseConfig, now = Date.now()): PlannerMuseRequest {
  if (!configSchema.safeParse(config).success) return fail("AI_PLANNING_CONFIG_INVALID", "Planner Muse configuration is invalid.");
  if (!aiSnapshotSchema.safeParse(snapshot).success) return fail("AI_PLANNING_SNAPSHOT_INVALID", "The planner snapshot is invalid. No model request was made.");
  if (!Number.isFinite(now) || now < Date.parse("2026-10-31T00:00:00Z") || now >= Date.parse(MUSE_PRICE_VALID_UNTIL)) return fail("AI_PLANNING_PRICING_UNAVAILABLE", "Reviewed Muse pricing needs renewal before planner generation can run.");
  const input = plannerMuseInput(snapshot);
  const payload = JSON.stringify({ model: config.model, store: false, stream: false, background: false, instructions: input.instructions,
    input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(input.input) }] }],
    text: { format: { type: "json_schema", name: "planner_muse_schedule", strict: true, schema: input.schema } },
    reasoning: { effort: "minimal" }, max_output_tokens: config.maxOutputTokens, tools: [], tool_choice: "auto", truncation: "disabled" });
  const bytes = Buffer.byteLength(payload);
  if (bytes > config.maxRequestBytes) return fail("AI_PLANNING_INPUT_LIMIT", "The task snapshot exceeds the configured Muse scheduling request size. No model request was made.");
  // Same conservative whole-wire reservation rule/prices as the existing accounting;
  // local bounds only, never a modification of shared estimator or ledger policy.
  const maxInputTokens = bytes * 4 + 4096;
  if (maxInputTokens + config.maxOutputTokens > 1048576) return fail("AI_PLANNING_INPUT_LIMIT", "The scheduling request exceeds the conservative model context bound.");
  const prices = { inputPriceMicrosPerMillion: MUSE_INPUT_PRICE_MICROS_PER_MILLION, outputPriceMicrosPerMillion: MUSE_OUTPUT_PRICE_MICROS_PER_MILLION };
  const reserveMicros = museUsageCostMicros(maxInputTokens, config.maxOutputTokens, prices);
  if (reserveMicros > config.perGenerationMicros) return fail("AI_PLANNING_COST_LIMIT", "This request exceeds the per-generation Muse scheduling cost limit. No model request was made.");
  // A configured ceiling is an additional restriction, never evidence of funding.
  if (config.allowanceCeilingMicros > 0 && reserveMicros > config.allowanceCeilingMicros) return fail("AI_PLANNING_COST_LIMIT", "This request exceeds the configured scheduling allowance ceiling. No model request was made.");
  return { payload, requestHash: createHash("sha256").update(payload).digest("hex"), settingsHash: createHash("sha256").update(canonical(config)).digest("hex"), snapshotHash: snapshotHash(snapshot), model: config.model,
    maxInputTokens, maxOutputTokens: config.maxOutputTokens, reserveMicros, priceVersion: MUSE_PRICE_VERSION, ...prices, timeoutMs: config.timeoutMs, perGenerationMicros: config.perGenerationMicros, allowanceCeilingMicros: config.allowanceCeilingMicros };
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const tokens = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
/** Feature-owned Responses API decoder. Financial settlement must happen centrally
 * even when this decoder rejects the content or usage after a chargeable response.
 */
export function parsePlannerMuseResponse(response: MetaMuseHttpResponse, request: PlannerMuseRequest) {
  if (response.status !== 200) return fail("AI_PLANNING_PROVIDER_REJECTED", response.status === 400 ? "Muse rejected the scheduling request or its configured output limit. No schedule was changed." : "Muse scheduling could not complete. It was not retried automatically.");
  if (Buffer.byteLength(response.body) > 512 * 1024) return fail("AI_PLANNING_OUTPUT_LIMIT", "Muse scheduling returned a response above the allowed size.");
  let value: unknown;
  try { value = JSON.parse(response.body) as unknown; } catch { return fail("AI_PLANNING_RESPONSE_INVALID", "Muse scheduling returned malformed JSON."); }
  if (!object(value) || value.status !== "completed" || value.error != null || value.incomplete_details != null) return fail("AI_PLANNING_RESPONSE_INCOMPLETE", "Muse scheduling did not return a complete response. No proposal was accepted and no paid retry was started.");
  if (value.model !== request.model || !object(value.usage) || !tokens(value.usage.input_tokens) || !tokens(value.usage.output_tokens)) return fail("AI_PLANNING_RESPONSE_INVALID", "Muse scheduling returned an unexpected model or missing usage metadata.");
  if (value.usage.input_tokens > request.maxInputTokens || value.usage.output_tokens > request.maxOutputTokens) return fail("AI_PLANNING_USAGE_LIMIT", "Muse scheduling exceeded its reserved token limits. Further paid generation must remain blocked pending accounting review.");
  if (!Array.isArray(value.output)) return fail("AI_PLANNING_RESPONSE_INVALID", "Muse scheduling returned no structured assistant output.");
  const visible = value.output.filter(item => !object(item) || item.type !== "reasoning");
  const message = visible[0];
  if (visible.length !== 1 || !object(message) || message.type !== "message" || message.role !== "assistant" || message.status !== "completed" || !Array.isArray(message.content) || message.content.length !== 1) return fail("AI_PLANNING_RESPONSE_INVALID", "Muse scheduling returned unexpected output or an incomplete message.");
  const content = message.content[0];
  if (!object(content) || content.type !== "output_text" || typeof content.text !== "string" || Buffer.byteLength(content.text) > 256 * 1024) return fail("AI_PLANNING_RESPONSE_INVALID", "Muse scheduling did not return bounded structured text.");
  let output: unknown;
  try { output = JSON.parse(content.text) as unknown; } catch { return fail("AI_PLANNING_RESPONSE_INVALID", "Muse scheduling returned truncated or invalid proposal JSON."); }
  const parsed = aiOutputSchema.safeParse(output);
  if (!parsed.success) return fail("AI_PLANNING_RESPONSE_INVALID", "Muse scheduling returned a proposal outside the required planning contract.");
  return { output: parsed.data, model: request.model };
}
