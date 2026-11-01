import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

export const GOOGLE_MAX_RESPONSE_BYTES = 1024 * 1024;
export const GOOGLE_MAX_REQUEST_BYTES = 128 * 1024;
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export type GoogleApiErrorCode = "GOOGLE_NOT_CONFIGURED" | "GOOGLE_AUTH_FAILED" | "GOOGLE_PERMISSION_DENIED" | "GOOGLE_API_DISABLED" | "GOOGLE_RATE_LIMITED" | "GOOGLE_UNAVAILABLE" | "GOOGLE_TIMEOUT" | "GOOGLE_INVALID_RESPONSE" | "GOOGLE_BUSY";

export class GoogleApiError extends Error {
  constructor(public readonly code: GoogleApiErrorCode, message: string, public readonly httpStatus: number | null = null, public readonly reason: string | null = null) { super(message); this.name = "GoogleApiError"; }
}
const fail = (code: GoogleApiErrorCode, message: string, status: number | null = null, reason: string | null = null) => new GoogleApiError(code, message, status, reason);
const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const reasons = new Set(["SERVICE_DISABLED", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "PERMISSION_DENIED", "UNAUTHENTICATED", "RESOURCE_EXHAUSTED", "API_KEY_SERVICE_BLOCKED", "accessNotConfigured", "insufficientPermissions", "forbidden", "authError", "rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "invalid_grant", "invalid_client", "unauthorized_client"]);

/** Only exact read-only Google report methods and the OAuth exchange are reachable. */
export function validateGoogleDestination(input: string): URL {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || /[\\\r\n]/.test(input)) throw new Error();
    if (url.href === GOOGLE_TOKEN_URL) return url;
    if (url.hostname === "analyticsdata.googleapis.com" && /^\/v1beta\/properties\/[1-9]\d{0,19}:batchRunReports$/.test(url.pathname)) return url;
    if (url.hostname === "www.googleapis.com") {
      const site = /^\/webmasters\/v3\/sites\/([^/]+)\/searchAnalytics\/query$/.exec(url.pathname)?.[1];
      if (site) {
        const decoded = decodeURIComponent(site);
        if (/^sc-domain:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(decoded)) return url;
        const target = new URL(decoded);
        if (["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.port && !target.search && !target.hash) return url;
      }
    }
  } catch { /* Only a fixed safe error may leave the URL boundary. */ }
  throw fail("GOOGLE_NOT_CONFIGURED", "The Google integration destination is not supported.");
}

function providerFailure(status: number, value: unknown): GoogleApiError {
  const error = object(value).error;
  const details = object(error);
  const candidates: unknown[] = [typeof error === "string" ? error : undefined, details.status];
  for (const item of Array.isArray(details.errors) ? details.errors.slice(0, 20) : []) candidates.push(object(item).reason);
  for (const item of Array.isArray(details.details) ? details.details.slice(0, 20) : []) candidates.push(object(item).reason);
  const accepted = candidates.filter((candidate): candidate is string => typeof candidate === "string" && reasons.has(candidate));
  const reason = accepted.find(candidate => ["SERVICE_DISABLED", "accessNotConfigured", "API_KEY_SERVICE_BLOCKED"].includes(candidate)) ?? accepted.find(candidate => candidate !== "PERMISSION_DENIED") ?? accepted[0] ?? null;
  if (reason && ["SERVICE_DISABLED", "accessNotConfigured", "API_KEY_SERVICE_BLOCKED"].includes(reason)) return fail("GOOGLE_API_DISABLED", "The required Google API is not enabled or is blocked for this project.", status, reason);
  if (status === 429 || reason && ["RESOURCE_EXHAUSTED", "rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"].includes(reason)) return fail("GOOGLE_RATE_LIMITED", "Google rejected this request because a rate or quota limit was reached.", status, reason);
  if (status === 401 || reason && ["UNAUTHENTICATED", "authError", "invalid_grant", "invalid_client", "unauthorized_client"].includes(reason)) return fail("GOOGLE_AUTH_FAILED", "Google could not authorize the configured service account.", status, reason);
  if (status === 403) return fail("GOOGLE_PERMISSION_DENIED", "The configured Google account cannot read this property. Check its property permissions and read scopes.", status, reason);
  return fail("GOOGLE_UNAVAILABLE", "Google could not complete this reporting request.", status, reason);
}

/** Never returns raw provider error messages, token bodies or credential identifiers. */
export function readGoogleResponse(response: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const status = response.statusCode ?? 0;
    const stop = (error: GoogleApiError) => { reject(error); response.destroy(); };
    response.on("error", () => reject(fail("GOOGLE_UNAVAILABLE", "The Google response was interrupted.")));
    response.on("aborted", () => reject(fail("GOOGLE_UNAVAILABLE", "The Google response was interrupted.")));
    if (status >= 300 && status < 400) { stop(fail("GOOGLE_INVALID_RESPONSE", "Google redirects are not followed.", status)); return; }
    if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") { stop(fail("GOOGLE_INVALID_RESPONSE", "Google returned an unsupported response encoding.", status)); return; }
    const contentType = String(response.headers["content-type"] ?? "");
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) { stop(status >= 400 ? providerFailure(status, null) : fail("GOOGLE_INVALID_RESPONSE", "Google did not return JSON.", status)); return; }
    const length = response.headers["content-length"];
    if (length && (!/^\d+$/.test(length) || Number(length) > GOOGLE_MAX_RESPONSE_BYTES)) { stop(fail("GOOGLE_INVALID_RESPONSE", "The Google response exceeded its size limit.", status)); return; }
    let bytes = 0;
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > GOOGLE_MAX_RESPONSE_BYTES) { stop(fail("GOOGLE_INVALID_RESPONSE", "The Google response exceeded its size limit.", status)); return; }
      chunks.push(chunk);
    });
    response.on("end", () => {
      let value: unknown;
      try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { reject(status >= 400 ? providerFailure(status, null) : fail("GOOGLE_INVALID_RESPONSE", "Google returned invalid JSON.", status)); return; }
      if (status < 200 || status >= 300) { reject(providerFailure(status, value)); return; }
      resolve(value);
    });
  });
}

@Injectable()
export class GoogleTransport {
  private active = 0;
  constructor(private readonly config: ConfigService) {}

  async post(destination: string, body: object | string, options: { accessToken?: string; contentType?: string } = {}): Promise<unknown> {
    const url = validateGoogleDestination(destination);
    const oauth = url.href === GOOGLE_TOKEN_URL;
    const contentType = options.contentType ?? "application/json";
    if (oauth ? contentType !== "application/x-www-form-urlencoded" || typeof body !== "string" || options.accessToken !== undefined : contentType !== "application/json" || typeof body !== "object" || body === null) throw fail("GOOGLE_NOT_CONFIGURED", "The Google request format is not supported.");
    if (!oauth && (!options.accessToken || options.accessToken.length > 8192 || /[\r\n]/.test(options.accessToken))) throw fail("GOOGLE_AUTH_FAILED", "A valid server-side Google access token is required.");
    const timeout = Number(this.config.get("GOOGLE_TIMEOUT_MS") ?? 15000);
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 30000) throw fail("GOOGLE_NOT_CONFIGURED", "The Google request deadline is not configured correctly.");
    let payload: string;
    try { payload = typeof body === "string" ? body : JSON.stringify(body); }
    catch { throw fail("GOOGLE_NOT_CONFIGURED", "The Google request could not be serialized safely."); }
    if (Buffer.byteLength(payload) > GOOGLE_MAX_REQUEST_BYTES) throw fail("GOOGLE_NOT_CONFIGURED", "The Google request exceeded its size limit.");
    if (this.active >= 2) throw fail("GOOGLE_BUSY", "The Google reporting transport is busy.");
    this.active++;
    const signal = AbortSignal.timeout(timeout);
    try {
      return await new Promise((resolve, reject) => {
        const request = httpsRequest(url, {
          method: "POST", agent: false, signal, maxHeaderSize: 16384,
          headers: { accept: "application/json", "accept-encoding": "identity", "content-type": contentType, "content-length": Buffer.byteLength(payload), ...(oauth ? {} : { authorization: `Bearer ${options.accessToken}` }) },
        }, response => { void readGoogleResponse(response).then(resolve, reject); });
        request.on("error", () => reject(fail(signal.aborted ? "GOOGLE_TIMEOUT" : "GOOGLE_UNAVAILABLE", signal.aborted ? "The Google request exceeded its deadline." : "The Google API connection could not be completed.")));
        // Never automatically retry token exchanges or report calls.
        request.end(payload);
      });
    } catch (error) {
      if (error instanceof GoogleApiError) throw error;
      throw fail(signal.aborted ? "GOOGLE_TIMEOUT" : "GOOGLE_UNAVAILABLE", "The Google request could not be completed.");
    } finally { this.active--; }
  }
}
