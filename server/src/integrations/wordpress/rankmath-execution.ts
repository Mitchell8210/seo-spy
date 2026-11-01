import { Logger } from "@nestjs/common";
import { WordPressRequestError, type WordPressDiagnostic } from "./wordpress.client.js";

export type RankMathStatus = "success" | "failed" | "timeout" | "unsupported" | "unknown";
export type DiagnosticRead = (path: string, method?: "GET" | "OPTIONS", observer?: (diagnostic: WordPressDiagnostic) => void) => Promise<unknown>;
type RecordValue = Record<string, unknown>;
const object = (v: unknown): v is RecordValue => typeof v === "object" && v !== null && !Array.isArray(v);
const logger = new Logger("RankMathExecution");
const safeCode = (v: unknown): string | number | null => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(v) ? v : null;
export interface RankMathDiagnostic {
  stage: "discovery" | "execution";
  tool: "audit-site-seo" | "analyze-post-content";
  durationMs: number;
  http: WordPressDiagnostic | null;
  responseType: string;
  envelope: "direct" | "jsonrpc" | "mcp-structured" | "mcp-text";
  providerError: { code: string | number | null; status: number | null; isError: boolean } | null;
  parsingFailure: string | null;
  recognizedFields: string[];
}
export interface ToolReadResult { status: RankMathStatus; value: unknown; diagnostic: RankMathDiagnostic }

function errorStatus(code: string | number | null, status: number | null): RankMathStatus {
  if (code === "WORDPRESS_TIMEOUT" || code === "WORDPRESS_CONNECTION_TIMEOUT" || code === "ETIMEDOUT" || status === 408 || status === 504) return "timeout";
  if (status === 404 || status === 405 || status === 501 || code === -32601 || code === "rest_ability_not_found") return "unsupported";
  if (status !== null && status >= 500) return "unknown";
  return "failed";
}
function providerError(value: unknown): RankMathDiagnostic["providerError"] {
  if (!object(value)) return null;
  const err = object(value.error) ? value.error : typeof value.code === "string" && (object(value.data) || typeof value.message === "string") ? value : null;
  if (!err && value.isError !== true) return null;
  const data = err && object(err.data) ? err.data : null;
  return { code: safeCode(err?.code), status: typeof data?.status === "number" ? data.status : null, isError: value.isError === true };
}

/** Logs only allowlisted metadata, never response text, input, URLs or error messages. */
export async function readRankMathTool(read: DiagnosticRead, tool: RankMathDiagnostic["tool"], stage: RankMathDiagnostic["stage"], query = ""): Promise<ToolReadResult> {
  const start = Date.now();
  const diagnostic: RankMathDiagnostic = { tool, stage, durationMs: 0, http: null, responseType: "none", envelope: "direct", providerError: null, parsingFailure: null, recognizedFields: [] };
  let status: RankMathStatus = "unknown";
  let value: unknown = null;
  const captureError = (candidate: unknown) => {
    const next = providerError(candidate);
    if (!next) return;
    const prior = diagnostic.providerError;
    diagnostic.providerError = { code: prior?.code ?? next.code, status: prior?.status ?? next.status, isError: prior?.isError === true || next.isError };
  };
  try {
    value = await read(`/wp-abilities/v1/abilities/rank-math/${tool}${stage === "execution" ? `/run${query}` : ""}`, "GET", http => { diagnostic.http = http; });
    diagnostic.responseType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    // Direct Abilities REST and standard JSON-RPC/MCP tool results are distinct envelopes.
    captureError(value);
    if (object(value) && value.jsonrpc === "2.0" && Object.hasOwn(value, "result")) { value = value.result; diagnostic.envelope = "jsonrpc"; }
    captureError(value);
    if (object(value) && object(value.structuredContent)) { value = value.structuredContent; diagnostic.envelope = "mcp-structured"; }
    else if (object(value) && Array.isArray(value.content)) {
      const blocks = value.content.filter(v => object(v) && v.type === "text" && typeof v.text === "string");
      if (blocks.length === 1 && object(blocks[0]) && typeof blocks[0].text === "string" && blocks[0].text.length <= 2 * 1024 * 1024) {
        try { value = JSON.parse(blocks[0].text) as unknown; diagnostic.envelope = "mcp-text"; }
        catch { diagnostic.parsingFailure = "mcp_text_invalid_json"; }
      } else diagnostic.parsingFailure = "mcp_content_not_single_json_result";
    }
    captureError(value);
    if (object(value)) {
      const parsed = value;
      diagnostic.recognizedFields = ["name", "input_schema", "output_schema", "meta", "findings", "score", "remote_api_status", "last_run_at", "post_id", "tests_to_run", "content", "error"].filter(key => Object.hasOwn(parsed, key));
    }
    if (diagnostic.providerError) status = errorStatus(diagnostic.providerError.code, diagnostic.providerError.status);
    else if (!diagnostic.parsingFailure) status = "success"; // Caller must still validate the tool-specific contract.
  } catch (failure) {
    if (failure instanceof WordPressRequestError) {
      diagnostic.http = failure.diagnostic ?? diagnostic.http;
      diagnostic.providerError = diagnostic.http?.providerError ? { ...diagnostic.http.providerError, isError: diagnostic.http.mcpIsError === true } : { code: safeCode(failure.code), status: failure.httpStatus ?? null, isError: false };
      status = errorStatus(failure.code, failure.httpStatus ?? null);
      if (status !== "timeout" && diagnostic.http?.providerError) {
        status = errorStatus(diagnostic.http.providerError.code, diagnostic.http.providerError.status ?? failure.httpStatus ?? null);
      }
      if (["WORDPRESS_REQUEST_FAILED", "WORDPRESS_INVALID_RESPONSE", "WORDPRESS_RESPONSE_INTERRUPTED"].includes(failure.code)) status = "unknown";
      if (diagnostic.http?.parseFailure) diagnostic.parsingFailure = "http_invalid_json";
    } else status = "unknown";
  }
  diagnostic.durationMs = Date.now() - start;
  logger.log({ event: "rankmath_tool_request", status, ...diagnostic });
  return { status, value, diagnostic };
}

export function toolInput(input: Record<string, string | number | boolean>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) query.set(`input[${key}]`, String(value));
  return `?${query.toString()}`;
}

export function logRankMathOutcome(tool: RankMathDiagnostic["tool"], status: RankMathStatus, diagnostics: RankMathDiagnostic[]) {
  logger.log({ event: "rankmath_tool_outcome", tool, status, diagnostics });
}

async function collectPostEvidence(read: DiagnosticRead, postId: number) {
  if (!Number.isSafeInteger(postId) || postId < 1) throw new Error("A positive post ID is required.");
  const diagnostics: RankMathDiagnostic[] = [];
  const definition = await readRankMathTool(read, "analyze-post-content", "discovery");
  diagnostics.push(definition.diagnostic);
  const base = { provider: "rank-math" as const, version: "rank-math-post-evidence-v1" as const, collectedAt: new Date().toISOString(), postId, status: definition.status, score: null, findings: [], testsToRun: [] as string[], contentSummary: null as Record<string, number | boolean> | null, diagnostics, limitation: "This tool gathers evidence and test definitions. It does not execute Rank Math's browser scoring engine; no AI or backend scoring was invoked." };
  if (definition.status !== "success") return base;
  const def = definition.value;
  if (!object(def) || def.name !== "rank-math/analyze-post-content" || !object(def.meta) || !object(def.meta.annotations) || def.meta.annotations.readonly !== true || !object(def.input_schema) || !object(def.input_schema.properties) || !object(def.input_schema.properties.post_id) || def.input_schema.properties.post_id.type !== "integer") { base.status = "unsupported"; return base; }
  const response = await readRankMathTool(read, "analyze-post-content", "execution", toolInput({ post_id: postId }));
  diagnostics.push(response.diagnostic);
  base.status = response.status;
  if (response.status !== "success") return base;
  const v = response.value;
  if (!object(v) || v.post_id !== postId || !Array.isArray(v.tests_to_run) || v.tests_to_run.length > 100 || !v.tests_to_run.every(t => typeof t === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(t)) || !object(v.content)) {
    base.status = "unknown"; response.diagnostic.parsingFailure = "post_evidence_schema_mismatch"; return base;
  }
  base.testsToRun = v.tests_to_run as string[];
  base.contentSummary = { titleAvailable: typeof v.content.title === "string", descriptionAvailable: typeof v.content.description === "string", bodyAvailable: typeof v.content.body === "string", bodyCharacters: typeof v.content.body === "string" ? v.content.body.length : 0, wordCount: typeof v.content.word_count === "number" ? v.content.word_count : 0, headings: Array.isArray(v.content.headings) ? v.content.headings.length : 0, images: Array.isArray(v.content.images) ? v.content.images.length : 0, links: Array.isArray(v.content.links) ? v.content.links.length : 0 };
  return base;
}

export async function analyzeRankMathPost(read: DiagnosticRead, postId: number) {
  const result = await collectPostEvidence(read, postId);
  logRankMathOutcome("analyze-post-content", result.status, result.diagnostics);
  return result;
}
