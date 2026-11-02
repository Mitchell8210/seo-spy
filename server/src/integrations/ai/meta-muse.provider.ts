import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { AiUsageStore } from "./ai-usage.store.js";
import { AiUsageError, type AiLiveMode, type AiModel, type AiUsageIntent, type AiUsageLimits } from "./ai-usage.types.js";
import { prepareMuseHello, prepareMinimalMuseHello, MUSE_MINIMAL_HELLO_SCOPE } from "./muse-hello-request.js";
import { estimateMuseCost, museUsageCostMicros, MuseCostError, MUSE_INPUT_PRICE_MICROS_PER_MILLION, MUSE_OUTPUT_PRICE_MICROS_PER_MILLION, type MuseCostEstimate } from "./muse-cost.js";

export const META_MUSE_ENDPOINT = "https://api.meta.ai/v1/responses";
export const META_MUSE_MAX_RESPONSE_BYTES = 512 * 1024;
const MODELS = new Set(["muse-spark-1.3", "muse-spark-1.2"]);
const dispatchGrants = new WeakMap<object, { hash: string; diagnostic?: boolean }>();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const safeId = (value: unknown): string | null => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : null;

export class MetaMuseError extends Error {
  constructor(public readonly code: string, message: string, public readonly diagnostics?: MetaMuseDiagnostics) { super(message); this.name = "MetaMuseError"; }
}
export interface MetaMuseDiagnostics { httpStatus: number | null; requestId: string | null; responseStatus?: string | null; incompletionReason?: string | null; reasoningTokens?: number | null; inputTokens?: number | null; outputTokens?: number | null; estimatedActualMicros?: number | null; providerError?: MetaMuseHttpResponse["providerError"] | null }
const failure = (code: string, message: string) => new MetaMuseError(code, message);

export interface MetaMuseHttpResponse { status: number; body: string; requestId: string | null; providerError?: { code: string | null; type: string | null; message: string | null } }
export interface MetaMuseGeneration { output: unknown; model: string; usage: { inputTokens: number; outputTokens: number }; requestId: string | null; attemptId?: string; diagnostics?: MetaMuseDiagnostics }
export interface MetaMuseInput { instructions: string; input: unknown; schema: Record<string, unknown>; reasoningEffort?: "minimal" }
export interface MetaMusePrepared extends MuseCostEstimate { payload: string; requestHash: string; model: AiModel }
export interface MetaMuseAuthorization { intentId: string; actor: string; scope: string }
export interface MuseHelloReport {
  requestHash: string; attemptId: string; httpStatus: number | null; requestId: string | null; responseStatus: string | null;
  requestedModel: "muse-spark-1.3"; returnedModel: string | null; accepted: boolean; authenticationAccepted: boolean | null; requestedModelResponded: boolean;
  text: string | null; inputTokens: number | null; outputTokens: number | null; estimatedActualMicros: number | null;
  reserveMicros: number; failureStage: string | null; errorCode: string | null; providerError: MetaMuseHttpResponse["providerError"] | null;
  incompletionReason: string | null; assistantMessageStatuses: (string | null)[]; reasoningTokens: number | null; httpErrorCategory: string | null;
}

/** The transport never follows redirects or accepts a caller-selected destination. */
export function redactMuseDiagnostic(value: unknown, key: string, maximum = 512): string | null {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return null;
  return (key ? value.replaceAll(key, "[redacted]") : value).replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/\b(?:sk[-_]|meta[-_])[A-Za-z0-9_-]{8,}\b/g, "[redacted]").replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]").replace(/\p{Cc}/gu, " ").slice(0, maximum);
}
export function readMetaMuseResponse(response: IncomingMessage, diagnosticKey?: string): Promise<MetaMuseHttpResponse> {
  return new Promise((resolve, reject) => {
    const status = response.statusCode ?? 0;
    const enrich = (error: MetaMuseError) => diagnosticKey === undefined ? error : new MetaMuseError(error.code, error.message, { httpStatus: status, requestId: safeId(response.headers["x-request-id"]) });
    const stop = (error: MetaMuseError) => { reject(enrich(error)); response.destroy(); };
    response.on("error", () => reject(enrich(failure("AI_NETWORK_ERROR", "The model response could not be received."))));
    response.on("aborted", () => reject(enrich(failure("AI_NETWORK_ERROR", "The model response was interrupted."))));
    if (status >= 300 && status < 400) { stop(failure("AI_REDIRECT_REJECTED", "Model provider redirects are not allowed.")); return; }
    // Error bodies are neither needed for classification nor safe to expose.
    if (status !== 200 && diagnosticKey === undefined) { resolve({ status, body: "", requestId: safeId(response.headers["x-request-id"]) }); response.destroy(); return; }
    if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") { stop(failure("AI_INVALID_OUTPUT", "The model returned an unsupported response encoding.")); return; }
    if (status === 200 && !/^application\/json(?:\s*;|$)/i.test(String(response.headers["content-type"] ?? ""))) { stop(failure("AI_INVALID_OUTPUT", "The model did not return JSON.")); return; }
    const size = response.headers["content-length"];
    if (size && (!/^\d+$/.test(size) || Number(size) > META_MUSE_MAX_RESPONSE_BYTES)) { stop(failure("AI_RESPONSE_TOO_LARGE", "The model response exceeded its size limit.")); return; }
    let bytes = 0;
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > META_MUSE_MAX_RESPONSE_BYTES) { stop(failure("AI_RESPONSE_TOO_LARGE", "The model response exceeded its size limit.")); return; }
      chunks.push(chunk);
    });
    response.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8"), requestId = safeId(response.headers["x-request-id"]);
      if (status === 200 || diagnosticKey === undefined) { resolve({status,body,requestId}); return; }
      let error: Record<string, unknown> | null = null;
      try { const parsed = object(JSON.parse(body)); error = object(parsed?.error) ?? parsed; } catch { /* Sanitized text only. */ }
      resolve({status,body:"",requestId,providerError:{code:redactMuseDiagnostic(error?.code,diagnosticKey,128),type:redactMuseDiagnostic(error?.type,diagnosticKey,128),message:redactMuseDiagnostic(error?.message ?? body,diagnosticKey)}});
    });
  });
}

@Injectable()
export class MetaMuseTransport {
  async post(payload: string, key: string, signal: AbortSignal, grant?: object): Promise<MetaMuseHttpResponse> {
    const approved = grant && dispatchGrants.get(grant);
    if (grant) dispatchGrants.delete(grant);
    if (!approved || approved.hash !== hash(payload)) throw failure("AI_APPROVAL_REQUIRED", "A one-use persistent spending reservation is required before model dispatch.");
    return new Promise((resolve, reject) => {
      const request = httpsRequest(META_MUSE_ENDPOINT, {
        method: "POST", agent: false, signal, maxHeaderSize: 16384,
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json", "accept-encoding": "identity", "content-length": Buffer.byteLength(payload) },
      }, response => { void readMetaMuseResponse(response, approved.diagnostic ? key : undefined).then(resolve, reject); });
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
  private developmentLimits(): AiUsageLimits {
    return {
      budgetMicros: this.integer("AI_DEV_BUDGET_MICROS", 2_000_000, 0, 2_000_000),
      dailyMicros: this.integer("AI_DEV_DAILY_MICROS", 500_000, 0, 500_000),
      maxCalls: this.integer("AI_DEV_MAX_CALLS", 10, 0, 10),
    };
  }

  /** Only the fixed, ledger-amended Hello request; no generic plain-text bypass. */
  async generateHelloDiagnostic(authorization: MetaMuseAuthorization): Promise<MuseHelloReport> {
    if (this.config.get("AI_ENABLED") !== true || this.config.get("MOCK_AI") !== false || this.mode() !== "poc") throw failure("AI_MOCK_MODE", "Explicit private POC mode is required for the diagnostic.");
    const key = this.config.get<string>("MODEL_API_KEY") ?? "";
    if (!key.trim() || key.length > 1024 || /[\r\n]/.test(key)) throw failure("AI_NOT_CONFIGURED", "A valid server-side model credential is required.");
    if (!authorization?.actor || !authorization.intentId) throw failure("AI_APPROVAL_REQUIRED", "The diagnostic requires a new single-use administrator approval.");
    const prepared = authorization.scope === MUSE_MINIMAL_HELLO_SCOPE ? prepareMinimalMuseHello() : prepareMuseHello();
    const timeout = this.integer("AI_TIMEOUT_MS",60000,1000,120000);
    const amendment = await this.ledger.readHelloAmendment();
    if (!amendment || amendment.intentId !== authorization.intentId || amendment.actor !== authorization.actor || amendment.scope !== authorization.scope || amendment.scope !== prepared.scope || amendment.requestHash !== prepared.requestHash) throw failure("AI_APPROVAL_MISMATCH", "Only the amended Hello intent can dispatch this diagnostic.");
    const reservation = await this.ledger.reserve(authorization.intentId, { ...authorization, mode:"poc", requestHash:prepared.requestHash, cacheKey:prepared.requestHash,
      model:prepared.model,maxInputTokens:prepared.maxInputTokens,maxOutputTokens:prepared.maxOutputTokens,reserveMicros:prepared.reserveMicros,priceVersion:prepared.priceVersion,
      inputPriceMicrosPerMillion:prepared.inputPriceMicrosPerMillion,outputPriceMicrosPerMillion:prepared.outputPriceMicrosPerMillion }, this.developmentLimits());
    const result: MuseHelloReport = {requestHash:prepared.requestHash,attemptId:reservation.id,httpStatus:null,requestId:null,responseStatus:null,requestedModel:prepared.model,returnedModel:null,
      accepted:false,authenticationAccepted:null,requestedModelResponded:false,text:null,inputTokens:null,outputTokens:null,estimatedActualMicros:null,reserveMicros:prepared.reserveMicros,failureStage:null,errorCode:null,providerError:null,
      incompletionReason:null,assistantMessageStatuses:[],reasoningTokens:null,httpErrorCategory:null};
    const controller = new AbortController();
    let timedOut = false, definitive = false;
    const timer = setTimeout(()=>{timedOut=true;controller.abort();},timeout); timer.unref();
    const aborted = new Promise<never>((_resolve,reject)=>controller.signal.addEventListener("abort",()=>reject(failure("AI_TIMEOUT","The diagnostic deadline expired; remote completion is unknown.")),{once:true}));
    const grant = {};
    try {
      dispatchGrants.set(grant,{hash:prepared.requestHash,diagnostic:true});
      const response = await Promise.race([this.transport.post(prepared.payload,key,controller.signal,grant),aborted]);
      result.httpStatus=response.status;result.requestId=safeId(response.requestId);result.providerError=response.providerError??null;
      definitive=[400,401,402,403,404,405,413,422,429].includes(response.status);
      if (response.status===401||response.status===403) result.authenticationAccepted=false;
      if (response.status!==200) {
        result.httpErrorCategory=[401,403].includes(response.status)?"authentication":response.status===402?"quota":response.status===429?"rate_limit":response.status===404?"model_or_endpoint":response.status>=500?"provider_server":[400,405,413,422].includes(response.status)?"invalid_request":"http_error";
        result.failureStage="provider-http-rejection"; throw failure("AI_PROVIDER_FAILED","The diagnostic provider returned an HTTP error.");
      }
      const responseValue = object(JSON.parse(response.body));
      if (!responseValue) throw failure("AI_INVALID_OUTPUT","The diagnostic response is not an object.");
      result.authenticationAccepted=true;
      result.responseStatus=redactMuseDiagnostic(responseValue.status,key,64);
      result.returnedModel=redactMuseDiagnostic(responseValue.model,key,128);
      result.requestedModelResponded=responseValue.model===prepared.model;
      const incomplete=object(responseValue.incomplete_details),reason=redactMuseDiagnostic(incomplete?.reason,key,64);
      result.incompletionReason=reason&&/^[a-z_]{1,64}$/.test(reason)?reason:null;
      const items=Array.isArray(responseValue.output)?responseValue.output:[];
      result.assistantMessageStatuses=items.filter(item=>object(item)?.type==="message"&&object(item)?.role==="assistant").slice(0,16).map(item=>{
        const status=object(item)?.status;return typeof status==="string"&&["completed","incomplete","in_progress"].includes(status)?status:null;
      });
      const usage=object(responseValue.usage);
      if (usage && Number.isSafeInteger(usage.input_tokens) && Number(usage.input_tokens)>=0 && Number.isSafeInteger(usage.output_tokens) && Number(usage.output_tokens)>=0) {
        result.inputTokens=Number(usage.input_tokens);result.outputTokens=Number(usage.output_tokens);
        result.estimatedActualMicros=museUsageCostMicros(result.inputTokens,result.outputTokens,prepared);
        definitive=true;
        const reasoning=object(usage.output_tokens_details)?.reasoning_tokens;
        if (Number.isSafeInteger(reasoning)&&Number(reasoning)>=0&&Number(reasoning)<=result.outputTokens) result.reasoningTokens=Number(reasoning);
        if (result.inputTokens>prepared.maxInputTokens||result.outputTokens>prepared.maxOutputTokens||result.estimatedActualMicros>prepared.reserveMicros) { definitive=false; throw failure("AI_USAGE_EXCEEDED","Diagnostic usage exceeded its reservation."); }
      }
      if (responseValue.error) {
        const error=object(responseValue.error);
        result.providerError={code:redactMuseDiagnostic(error?.code,key,128),type:redactMuseDiagnostic(error?.type,key,128),message:redactMuseDiagnostic(error?.message,key)};
      }
      if (responseValue.status==="incomplete") throw failure("AI_TRUNCATED","The diagnostic generation was incomplete; no completed text was accepted.");
      if (responseValue.status!=="completed"||responseValue.error) throw failure("AI_PROVIDER_FAILED","The diagnostic did not complete successfully.");
      const visible=items.filter(item=>object(item)?.type!=="reasoning");
      const message=object(visible[0]);
      if (visible.length!==1||message?.type!=="message"||message.role!=="assistant"||message.status!=="completed"||!Array.isArray(message.content)) throw failure("AI_INVALID_OUTPUT","Unexpected or incomplete diagnostic output items.");
      const parts=message.content.map(object);
      if (parts.some(part=>part?.type!=="output_text"||typeof part.text!=="string")) throw failure("AI_INVALID_OUTPUT","The diagnostic did not return plain assistant text.");
      const text=redactMuseDiagnostic(parts.map(part=>part!.text).join(""),key,4096);
      result.requestedModelResponded=responseValue.model===prepared.model;
      if (!result.requestedModelResponded||!text||result.estimatedActualMicros===null) throw failure("AI_INVALID_OUTPUT","The diagnostic did not establish a completed response with valid usage.");
      result.text=text;
      result.accepted=true;
    } catch (error) {
      const safe=error instanceof MetaMuseError?error:failure(result.httpStatus===null?"AI_NETWORK_ERROR":"AI_INVALID_OUTPUT","The diagnostic could not be completed or validated.");
      if (safe.diagnostics) {result.httpStatus=safe.diagnostics.httpStatus;result.requestId=safe.diagnostics.requestId;}
      result.errorCode=timedOut?"AI_TIMEOUT":safe.code;
      result.failureStage??=result.httpStatus===null?(timedOut?"timeout-before-http-response":"connection-before-http-response"):"response-validation";
    } finally {clearTimeout(timer);dispatchGrants.delete(grant);}
    // One immutable settlement; failed and uncertain requests retain their reservation.
    await this.ledger.settle(reservation.id,{status:result.accepted?"success":definitive?"failed":"unknown",requestId:result.requestId,errorCode:result.errorCode??undefined,
      ...(result.inputTokens!==null&&result.outputTokens!==null&&result.estimatedActualMicros!==null?{inputTokens:result.inputTokens,outputTokens:result.outputTokens,actualMicros:result.estimatedActualMicros}:{})});
    return result;
  }

  /** Pure cost preview: no credentials, network or spending reservation. */
  prepare(input: MetaMuseInput): MetaMusePrepared {
    const model = this.config.get<string>("AI_MODEL") ?? "muse-spark-1.3";
    const processingMode = this.config.get<string>("AI_PROCESSING_MODE") ?? "standard";
    const effort = input.reasoningEffort ?? this.config.get<string>("AI_REASONING_EFFORT") ?? "low";
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
        reasoning: { effort }, max_output_tokens: maximumTokens, tools: [], tool_choice: "auto", truncation: "disabled",
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
      const mode = this.mode() === "demo" ? "demo" : "poc";
      return await this.ledger.estimate({ ...cost, cacheKey: prepared.requestHash, actor: context.actor, scope: context.scope, reason: context.reason, mode }, mode === "poc" ? this.developmentLimits() : undefined);
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
      }, mode === "poc" ? this.developmentLimits() : undefined);
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
    const controlledTesting = this.config.get("AI_CONTROLLED_TESTING") === true;
    const diagnostics: MetaMuseDiagnostics = { httpStatus:null, requestId:null };
    try {
      if (signal?.aborted) throw failure("AI_CANCELLED", "Model analysis was cancelled before dispatch.");
      // Only this module can mint a payload-bound grant after persistent reservation.
      dispatchGrants.set(grant, { hash: prepared.requestHash, ...(controlledTesting ? { diagnostic:true } : {}) });
      dispatched = true;
      const response = await Promise.race([this.transport.post(prepared.payload, key, controller.signal, grant), cancelled]);
      requestId = safeId(response.requestId);
      if(controlledTesting)Object.assign(diagnostics,{httpStatus:response.status,requestId,providerError:response.providerError??null});
      if ([400, 401, 402, 403, 404, 405, 413, 422, 429].includes(response.status)) definitiveFailure = true;
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
      if(controlledTesting){
        const reason=redactMuseDiagnostic(object(result.incomplete_details)?.reason,key,64);
        diagnostics.responseStatus=typeof result.status==="string"&&["completed","incomplete","failed","in_progress","queued","cancelled"].includes(result.status)?result.status:null;
        diagnostics.incompletionReason=reason&&/^[a-z_]{1,64}$/.test(reason)?reason:null;
        const providerError=object(result.error);if(providerError)diagnostics.providerError={code:redactMuseDiagnostic(providerError.code,key,128),type:redactMuseDiagnostic(providerError.type,key,128),message:redactMuseDiagnostic(providerError.message,key)};
      }
      const usage = object(result.usage);
      if (usage && Number.isSafeInteger(usage.input_tokens) && Number(usage.input_tokens) >= 0 && Number.isSafeInteger(usage.output_tokens) && Number(usage.output_tokens) >= 0) {
        const inputTokens = Number(usage.input_tokens), outputTokens = Number(usage.output_tokens);
        knownUsage = { inputTokens, outputTokens, actualMicros: museUsageCostMicros(inputTokens, outputTokens, prepared) };
        if(controlledTesting){const reasoning=object(usage.output_tokens_details)?.reasoning_tokens;Object.assign(diagnostics,{inputTokens,outputTokens,estimatedActualMicros:knownUsage.actualMicros,reasoningTokens:Number.isSafeInteger(reasoning)&&Number(reasoning)>=0&&Number(reasoning)<=outputTokens?Number(reasoning):null});}
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
      return { output, model: prepared.model, usage: { inputTokens: knownUsage.inputTokens, outputTokens: knownUsage.outputTokens }, requestId, attemptId: reservation.id, ...(controlledTesting?{diagnostics}: {}) };
    } catch (error) {
      const safe = error instanceof MetaMuseError ? error : error instanceof MuseCostError ? failure(error.code, error.message) : failure("AI_NETWORK_ERROR", "The model request could not be completed; remote completion is unknown.");
      if (!settled) {
        try { await this.ledger.settle(reservation.id, { status: !dispatched || definitiveFailure ? "failed" : "unknown", ...knownUsage, requestId, errorCode: safe.code }); }
        catch (accounting) { throw this.accountingError(accounting); }
      }
      throw controlledTesting?new MetaMuseError(safe.code,safe.message,{...diagnostics,...safe.diagnostics}):safe;
    } finally {
      dispatchGrants.delete(grant);
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    }
  }
}

