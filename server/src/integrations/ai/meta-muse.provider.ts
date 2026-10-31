import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { AiUsageStore } from "./ai-usage.store.js";
import { AiUsageError, type AiLiveMode, type AiModel, type AiUsageIntent } from "./ai-usage.types.js";
import { estimateMuseCost, museUsageCostMicros, MuseCostError, MUSE_INPUT_PRICE_MICROS_PER_MILLION, MUSE_OUTPUT_PRICE_MICROS_PER_MILLION, type MuseCostEstimate } from "./muse-cost.js";

export const META_MUSE_ENDPOINT = "https://api.meta.ai/v1/responses";
export const META_MUSE_MAX_RESPONSE_BYTES = 512 * 1024;
const MODELS = new Set(["muse-spark-1.3", "muse-spark-1.2"]);
const dispatchGrants = new WeakMap<object, string>();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const safeId = (value: unknown): string | null => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : null;

export class MetaMuseError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "MetaMuseError"; }
}
const failure = (code: string, message: string) => new MetaMuseError(code, message);

export interface MetaMuseHttpResponse { status: number; body: string; requestId: string | null }
export interface MetaMuseGeneration { output: unknown; model: string; usage: { inputTokens: number; outputTokens: number }; requestId: string | null; attemptId?: string }
export interface MetaMuseInput { instructions: string; input: unknown; schema: Record<string, unknown> }
export interface MetaMusePrepared extends MuseCostEstimate { payload: string; requestHash: string; model: AiModel }
export interface MetaMuseAuthorization { intentId: string; actor: string; scope: string }

/** The transport never follows redirects or accepts a caller-selected destination. */
export function readMetaMuseResponse(response: IncomingMessage): Promise<MetaMuseHttpResponse> {
  return new Promise((resolve, reject) => {
    const status = response.statusCode ?? 0;
    const stop = (error: MetaMuseError) => { reject(error); response.destroy(); };
    response.on("error", () => reject(failure("AI_NETWORK_ERROR", "The model response could not be received.")));
    response.on("aborted", () => reject(failure("AI_NETWORK_ERROR", "The model response was interrupted.")));
    if (status >= 300 && status < 400) { stop(failure("AI_REDIRECT_REJECTED", "Model provider redirects are not allowed.")); return; }
    // Error bodies are neither needed for classification nor safe to expose.
    if (status !== 200) { resolve({ status, body: "", requestId: safeId(response.headers["x-request-id"]) }); response.destroy(); return; }
    if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") { stop(failure("AI_INVALID_OUTPUT", "The model returned an unsupported response encoding.")); return; }
    if (!/^application\/json(?:\s*;|$)/i.test(String(response.headers["content-type"] ?? ""))) { stop(failure("AI_INVALID_OUTPUT", "The model did not return JSON.")); return; }
    const size = response.headers["content-length"];
    if (size && (!/^\d+$/.test(size) || Number(size) > META_MUSE_MAX_RESPONSE_BYTES)) { stop(failure("AI_RESPONSE_TOO_LARGE", "The model response exceeded its size limit.")); return; }
    let bytes = 0;
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > META_MUSE_MAX_RESPONSE_BYTES) { stop(failure("AI_RESPONSE_TOO_LARGE", "The model response exceeded its size limit.")); return; }
      chunks.push(chunk);
    });
    response.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8"), requestId: safeId(response.headers["x-request-id"]) }));
  });
}

@Injectable()
export class MetaMuseTransport {
  async post(payload: string, key: string, signal: AbortSignal, grant?: object): Promise<MetaMuseHttpResponse> {
    const approvedHash = grant && dispatchGrants.get(grant);
    if (grant) dispatchGrants.delete(grant);
    if (!approvedHash || approvedHash !== hash(payload)) throw failure("AI_APPROVAL_REQUIRED", "A one-use persistent spending reservation is required before model dispatch.");
    return new Promise((resolve, reject) => {
      const request = httpsRequest(META_MUSE_ENDPOINT, {
        method: "POST", agent: false, signal, maxHeaderSize: 16384,
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json", "accept-encoding": "identity", "content-length": Buffer.byteLength(payload) },
      }, response => { void readMetaMuseResponse(response).then(resolve, reject); });
      request.on("error", () => reject(failure("AI_NETWORK_ERROR", "The model provider could not be reached.")));
      request.end(payload);
    });
  }
}

/** All real model requests pass through durable approval, budget and usage accounting. */
@Injectable()
export class MetaMuseProvider {
  constructor(private readonly config: ConfigService, private readonly transport: MetaMuseTransport, private readonly ledger: AiUsageStore) {}

  private integer(name: string, fallback: number, minimum: number, maximum: number): number {
    const value = Number(this.config.get(name) ?? fallback);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw failure("AI_NOT_CONFIGURED", "Model request limits are not configured correctly.");
    return value;
  }
  private mode(): "mock" | AiLiveMode {
    const value = this.config.get<string>("AI_MODE") ?? "mock";
    if (!["mock", "poc", "demo"].includes(value)) throw failure("AI_NOT_CONFIGURED", "An explicit supported AI operating mode is required.");
    return value as "mock" | AiLiveMode;
  }
  private accountingError(error: unknown): MetaMuseError {
    return error instanceof AiUsageError ? failure(error.code, error.message) : failure("AI_BUDGET_STORAGE_ERROR", "Persistent model authorization and budget accounting are unavailable; no further request is permitted.");
  }

  /** Pure cost preview: no credentials, network or spending reservation. */
  prepare(input: MetaMuseInput): MetaMusePrepared {
    const model = this.config.get<string>("AI_MODEL") ?? "muse-spark-1.3";
    const processingMode = this.config.get<string>("AI_PROCESSING_MODE") ?? "standard";
    const effort = this.config.get<string>("AI_REASONING_EFFORT") ?? "low";
    if (!MODELS.has(model) || processingMode !== "standard" || !["minimal", "low"].includes(effort)) throw failure("AI_NOT_CONFIGURED", "Only the configured Standard model and conservative reasoning settings are supported.");
    const maximumBytes = this.integer("AI_MAX_INPUT_BYTES", 32768, 4096, 32768);
    const maximumTokens = this.integer("AI_MAX_OUTPUT_TOKENS", 1500, 16, 1500);
    this.integer("AI_MAX_CONCURRENCY", 1, 1, 1);
    let payload: string;
    try {
      if (typeof input.instructions !== "string" || !input.instructions.trim() || !object(input.schema)) throw new Error();
      const evidence = JSON.stringify(input.input);
      if (evidence === undefined) throw new Error();
      payload = JSON.stringify({
        model, store: false, stream: false, background: false, instructions: input.instructions,
        input: [{ role: "user", content: [{ type: "input_text", text: evidence }] }],
        text: { format: { type: "json_schema", name: "wordpress_analysis", strict: true, schema: input.schema } },
        reasoning: { effort }, max_output_tokens: maximumTokens, tools: [], tool_choice: "none", truncation: "disabled",
      });
    } catch { throw failure("AI_INVALID_INPUT", "The model input could not be serialized safely."); }
    if (Buffer.byteLength(payload) > maximumBytes) throw failure("AI_INPUT_TOO_LARGE", "The model input exceeded its configured size limit.");
    try {
      const prices = {
        inputPriceMicrosPerMillion: this.integer("AI_INPUT_PRICE_MICROS_PER_MILLION", MUSE_INPUT_PRICE_MICROS_PER_MILLION, MUSE_INPUT_PRICE_MICROS_PER_MILLION, 1_000_000_000),
        outputPriceMicrosPerMillion: this.integer("AI_OUTPUT_PRICE_MICROS_PER_MILLION", MUSE_OUTPUT_PRICE_MICROS_PER_MILLION, MUSE_OUTPUT_PRICE_MICROS_PER_MILLION, 1_000_000_000),
      };
      return { payload, requestHash: hash(payload), model: model as AiModel, ...estimateMuseCost(payload, maximumTokens, prices) };
    } catch (error) {
      if (error instanceof MuseCostError) throw failure(error.code, error.message);
      throw error;
    }
  }

  /** Creates an exact immutable cost preview for separate administrator review. */
  async estimate(input: MetaMuseInput, context: { actor: string; scope: string; reason: string }): Promise<AiUsageIntent> {
    const prepared = this.prepare(input);
    const { payload: _payload, ...cost } = prepared;
    void _payload;
    try {
      return await this.ledger.estimate({ ...cost, cacheKey: prepared.requestHash, actor: context.actor, scope: context.scope, reason: context.reason, mode: this.mode() === "demo" ? "demo" : "poc" });
    } catch (error) { throw this.accountingError(error); }
  }

  async generate(input: MetaMuseInput, signal?: AbortSignal, authorization?: MetaMuseAuthorization): Promise<MetaMuseGeneration> {
    const enabled = this.config.get("AI_ENABLED");
    if (enabled !== true && enabled !== "true") throw failure("AI_DISABLED", "Model analysis is disabled.");
    const mode = this.mode();
    const mock = this.config.get("MOCK_AI") ?? true;
    if (mode === "mock" || mock !== false && mock !== "false") throw failure("AI_MOCK_MODE", "Mock mode cannot dispatch a real model request.");
    const key = this.config.get<string>("MODEL_API_KEY") ?? "";
    if (!key.trim() || key.length > 1024 || /[\r\n]/.test(key)) throw failure("AI_NOT_CONFIGURED", "An approved private model API key must be configured.");
    if (!authorization?.intentId || !authorization.actor || !authorization.scope) throw failure("AI_APPROVAL_REQUIRED", "A fresh exact administrator-approved request is required for every real model call.");
    if (signal?.aborted) throw failure("AI_CANCELLED", "Model analysis was cancelled before dispatch.");
    const prepared = this.prepare(input);
    const timeout = this.integer("AI_TIMEOUT_MS", 60000, 1000, 120000);
    let reservation;
    try {
      reservation = await this.ledger.reserve(authorization.intentId, {
        actor: authorization.actor, scope: authorization.scope, mode, requestHash: prepared.requestHash, cacheKey: prepared.requestHash,
        model: prepared.model, maxInputTokens: prepared.maxInputTokens, maxOutputTokens: prepared.maxOutputTokens,
        reserveMicros: prepared.reserveMicros, priceVersion: prepared.priceVersion,
        inputPriceMicrosPerMillion: prepared.inputPriceMicrosPerMillion, outputPriceMicrosPerMillion: prepared.outputPriceMicrosPerMillion,
      }, {
        budgetMicros: this.integer("AI_DEV_BUDGET_MICROS", 2_000_000, 0, 2_000_000),
        dailyMicros: this.integer("AI_DEV_DAILY_MICROS", 500_000, 0, 500_000),
        maxCalls: this.integer("AI_DEV_MAX_CALLS", 10, 0, 10),
      });
    } catch (error) { throw this.accountingError(error); }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    timer.unref();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(failure(timedOut ? "AI_TIMEOUT" : "AI_CANCELLED", timedOut ? "Model analysis exceeded its deadline; remote completion is unknown." : "Model analysis was cancelled; remote completion is unknown."));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const grant = {};
    let dispatched = false;
    let settled = false;
    let definitiveFailure = false;
    let knownUsage: { inputTokens: number; outputTokens: number; actualMicros: number } | undefined;
    let requestId: string | null = null;
    try {
      if (signal?.aborted) throw failure("AI_CANCELLED", "Model analysis was cancelled before dispatch.");
      // Only this module can mint a payload-bound grant after persistent reservation.
      dispatchGrants.set(grant, prepared.requestHash);
      dispatched = true;
      const response = await Promise.race([this.transport.post(prepared.payload, key, controller.signal, grant), cancelled]);
      requestId = safeId(response.requestId);
      if (response.status !== 200) definitiveFailure = true;
      if (Buffer.byteLength(response.body) > META_MUSE_MAX_RESPONSE_BYTES) throw failure("AI_RESPONSE_TOO_LARGE", "The model response exceeded its size limit.");
      if (response.status >= 300 && response.status < 400) throw failure("AI_REDIRECT_REJECTED", "Model provider redirects are not allowed.");
      if ([401, 403].includes(response.status)) throw failure("AI_AUTH_FAILED", "The model provider rejected authorization.");
      if (response.status === 402) throw failure("AI_QUOTA_EXCEEDED", "The model provider reported unavailable quota.");
      if (response.status === 429) throw failure("AI_RATE_LIMITED", "The model provider rate limit was reached.");
      if (response.status !== 200) throw failure("AI_PROVIDER_FAILED", "The model provider could not complete this request.");
      let value: unknown;
      try { value = JSON.parse(response.body); } catch { throw failure("AI_INVALID_OUTPUT", "The model returned malformed JSON."); }
      const result = object(value);
      if (!result) throw failure("AI_INVALID_OUTPUT", "The model response did not match the supported contract.");
      const usage = object(result.usage);
      if (usage && Number.isSafeInteger(usage.input_tokens) && Number(usage.input_tokens) >= 0 && Number.isSafeInteger(usage.output_tokens) && Number(usage.output_tokens) >= 0) {
        const inputTokens = Number(usage.input_tokens), outputTokens = Number(usage.output_tokens);
        knownUsage = { inputTokens, outputTokens, actualMicros: museUsageCostMicros(inputTokens, outputTokens, prepared) };
        definitiveFailure = true;
        if (inputTokens > prepared.maxInputTokens || outputTokens > prepared.maxOutputTokens || knownUsage.actualMicros > prepared.reserveMicros) {
          definitiveFailure = false;
          throw failure("AI_USAGE_EXCEEDED", "Reported model usage exceeded its reservation; further real calls require administrator investigation.");
        }
      }
      if (result.status === "incomplete") throw failure("AI_TRUNCATED", "The model response was incomplete; no analysis was accepted.");
      if (result.error || result.status === "failed") throw failure("AI_PROVIDER_FAILED", "The model provider reported an unsuccessful generation.");
      if (result.status !== "completed" || result.model !== prepared.model || !Array.isArray(result.output)) throw failure("AI_INVALID_OUTPUT", "The model response did not establish a completed generation for the configured model.");
      const messages = result.output.filter(entry => object(entry)?.type !== "reasoning");
      if (messages.length !== 1) throw failure("AI_INVALID_OUTPUT", "The model returned unsupported output items.");
      const message = object(messages[0]);
      if (message?.type !== "message" || message.role !== "assistant" || message.status !== "completed" || !Array.isArray(message.content)) throw failure("AI_INVALID_OUTPUT", "The model returned unsupported output items.");
      if (message.content.some(entry => object(entry)?.type === "refusal")) throw failure("AI_REFUSED", "The model declined the requested analysis.");
      if (message.content.length !== 1 || object(message.content[0])?.type !== "output_text" || typeof object(message.content[0])?.text !== "string") throw failure("AI_INVALID_OUTPUT", "The model did not return one structured analysis.");
      let output: unknown;
      try { output = JSON.parse(object(message.content[0])!.text as string); } catch { throw failure("AI_INVALID_OUTPUT", "The model analysis was not valid JSON."); }
      if (!knownUsage) throw failure("AI_INVALID_OUTPUT", "The model did not return valid token usage; further calls require accounting review.");
      settled = true;
      try { await this.ledger.settle(reservation.id, { status: "success", ...knownUsage, requestId }); }
      catch (error) { throw this.accountingError(error); }
      return { output, model: prepared.model, usage: { inputTokens: knownUsage.inputTokens, outputTokens: knownUsage.outputTokens }, requestId, attemptId: reservation.id };
    } catch (error) {
      const safe = error instanceof MetaMuseError ? error : error instanceof MuseCostError ? failure(error.code, error.message) : failure("AI_NETWORK_ERROR", "The model request could not be completed; remote completion is unknown.");
      if (!settled) {
        try { await this.ledger.settle(reservation.id, { status: !dispatched || definitiveFailure ? "failed" : "unknown", ...knownUsage, requestId, errorCode: safe.code }); }
        catch (accounting) { throw this.accountingError(accounting); }
      }
      throw safe;
    } finally {
      dispatchGrants.delete(grant);
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    }
  }
}

