import { Injectable } from "@nestjs/common";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { publicAddress, publicUrl, WebsiteDns } from "../website/collector.js";

export interface WordPressConnection {
  businessId: string;
  siteUrl: string;
  username: string;
  applicationPassword: string;
}
export type WordPressMethod = "GET" | "OPTIONS" | "POST";
export const WORDPRESS_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = 256 * 1024;

export interface WordPressDiagnostic {
  httpStatus: number | null;
  durationMs: number;
  responseType: string;
  parseFailure: boolean;
  errorCode: string | null;
  providerError: { code: string | number | null; status: number | null } | null;
  mcpIsError: boolean | null;
  contentTypes: string[];
}
type ResponseDiagnostic = Omit<WordPressDiagnostic, "durationMs" | "errorCode">;
export type WordPressDiagnosticObserver = (diagnostic: WordPressDiagnostic) => void;

const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
function responseShape(value: unknown): Pick<ResponseDiagnostic, "responseType" | "providerError" | "mcpIsError" | "contentTypes"> {
  const root = object(value);
  const nested = object(root.error);
  const code = root.code ?? nested.code;
  const safeCode = typeof code === "number" && Number.isFinite(code) ? code : typeof code === "string" && /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(code) ? code : null;
  const status = object(root.data).status ?? object(nested.data).status;
  return {
    responseType: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
    providerError: safeCode !== null || root.error !== undefined && root.error !== null && root.error !== false ? { code: safeCode, status: typeof status === "number" && Number.isInteger(status) ? status : null } : null,
    mcpIsError: typeof root.isError === "boolean" ? root.isError : null,
    contentTypes: Array.isArray(root.content) ? [...new Set(root.content.slice(0, 100).map(item => object(item).type).filter((type): type is string => typeof type === "string" && ["text", "image", "audio", "resource", "resource_link"].includes(type)))] : [],
  };
}

export class WordPressRequestError extends Error {
  diagnostic?: WordPressDiagnostic;
  constructor(public readonly code: string, message: string, public readonly httpStatus?: number) { super(message); }
}

function error(code: string, message: string, status?: number) {
  return new WordPressRequestError(code, message, status);
}

/** Destination and JSON boundaries are enforced before application-level schemas. */
export function readWordPressResponse(response: IncomingMessage, address: string, observe?: (diagnostic: ResponseDiagnostic) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const diagnostic: ResponseDiagnostic = { httpStatus: response.statusCode ?? null, responseType: "unavailable", parseFailure: false, providerError: null, mcpIsError: null, contentTypes: [] };
    observe?.({ ...diagnostic });
    response.on("error", reject);
    const fail = (failure: WordPressRequestError) => { reject(failure); response.destroy(); };
    if (!response.socket.remoteAddress || !publicAddress(response.socket.remoteAddress) ||
        ipaddr.process(response.socket.remoteAddress).toString() !== ipaddr.process(address).toString()) {
      fail(error("WORDPRESS_BLOCKED_DESTINATION", "WordPress connection did not match its validated destination.")); return;
    }
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) { fail(error("WORDPRESS_REDIRECT_REJECTED", "WordPress redirects are not followed with credentials.", status)); return; }
    const httpFailure = status < 200 || status >= 300 ? error(status === 401 || status === 403 ? "WORDPRESS_ACCESS_DENIED" : "WORDPRESS_HTTP_ERROR",
      status === 401 || status === 403 ? "WordPress rejected authentication or permission for this operation." : "WordPress could not complete this operation.", status) : null;
    if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|\s*$)/i.test(response.headers["content-type"] ?? "")) {
      fail(httpFailure ?? error("WORDPRESS_INVALID_RESPONSE", "WordPress did not return a JSON response.", status)); return;
    }
    if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
      fail(error("WORDPRESS_UNSUPPORTED_ENCODING", "WordPress returned unsupported compressed content.")); return;
    }
    if (Number(response.headers["content-length"]) > WORDPRESS_MAX_BYTES) {
      fail(error("WORDPRESS_RESPONSE_TOO_LARGE", "WordPress response exceeded the size limit.")); return;
    }
    let bytes = 0;
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > WORDPRESS_MAX_BYTES) { fail(error("WORDPRESS_RESPONSE_TOO_LARGE", "WordPress response exceeded the size limit.")); return; }
      chunks.push(chunk);
    });
    response.on("end", () => {
      let value: unknown;
      try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
      catch {
        diagnostic.parseFailure = true;
        observe?.({ ...diagnostic });
        reject(httpFailure ?? error("WORDPRESS_INVALID_RESPONSE", "WordPress returned invalid JSON.", status));
        return;
      }
      Object.assign(diagnostic, responseShape(value));
      observe?.({ ...diagnostic });
      if (httpFailure) reject(httpFailure);
      else resolve(value);
    });
    response.on("aborted", () => reject(error("WORDPRESS_RESPONSE_INTERRUPTED", "WordPress response was interrupted.")));
  });
}

@Injectable()
export class WordPressTransport {
  send(url: URL, address: string, method: WordPressMethod, authorization: string, body: string | undefined, signal: AbortSignal, observe?: (diagnostic: ResponseDiagnostic) => void): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = httpsRequest(url, {
        method, agent: false, signal, maxHeaderSize: 16384, family: isIP(address),
        lookup: (_host, _options, callback) => callback(null, address, isIP(address)),
        headers: { accept: "application/json", "accept-encoding": "identity", authorization,
          "user-agent": "SEO-Spy/0.1 (WordPress integration)",
          ...(body === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(body) }) },
      }, (response) => { void readWordPressResponse(response, address, observe).then(resolve, reject); });
      const timer = setTimeout(() => request.destroy(error("WORDPRESS_CONNECTION_TIMEOUT", "WordPress connection timed out.")), 5000);
      timer.unref();
      request.on("socket", socket => socket.once("secureConnect", () => clearTimeout(timer)));
      request.on("close", () => clearTimeout(timer));
      request.on("error", failure => { clearTimeout(timer); reject(failure); });
      // No retries: an uncertain POST must be reconciled by the action service.
      request.end(body);
    });
  }
}

@Injectable()
export class WordPressClient {
  private active = 0;
  constructor(private readonly dns: WebsiteDns, private readonly transport: WordPressTransport) {}

  async request(connection: WordPressConnection, method: WordPressMethod, path: string, body?: object, observe?: WordPressDiagnosticObserver): Promise<unknown> {
    const started = performance.now();
    const diagnostic: WordPressDiagnostic = { httpStatus: null, durationMs: 0, responseType: "unavailable", parseFailure: false, errorCode: null, providerError: null, mcpIsError: null, contentTypes: [] };
    if (this.active >= 2) throw error("WORDPRESS_BUSY", "WordPress request concurrency limit reached.");
    this.active++;
    const signal = AbortSignal.timeout(30000);
    let onAbort: (() => void) | undefined;
    try {
      if (!["GET", "OPTIONS", "POST"].includes(method) || (method !== "POST" && body !== undefined))
        throw error("WORDPRESS_INVALID_REQUEST", "Unsupported WordPress request method or body.");
      let site: URL;
      try { site = publicUrl(connection.siteUrl); }
      catch { throw error("WORDPRESS_BLOCKED_DESTINATION", "A public HTTPS WordPress site is required."); }
      if (site.protocol !== "https:" || site.pathname !== "/" || site.search || site.hash || new URL(connection.siteUrl).hash)
        throw error("WORDPRESS_BLOCKED_DESTINATION", "WordPress requires an HTTPS origin without a path, query or fragment.");
      if (!path.startsWith("/wp-json/") || path.length > 8192 || /[\\\r\n#]|%(?:2e|2f|5c)|\/(?:\.|\.\.)(?:\/|\?|$)/i.test(path))
        throw error("WORDPRESS_INVALID_PATH", "Only fixed WordPress REST paths are supported.");
      const url = new URL(path, site);
      if (url.origin !== site.origin || !url.pathname.startsWith("/wp-json/")) throw error("WORDPRESS_INVALID_PATH", "WordPress request escaped the registered installation.");
      if (typeof connection.username !== "string" || !connection.username || connection.username.length > 512 || /[:\r\n]/.test(connection.username) ||
          typeof connection.applicationPassword !== "string" || !connection.applicationPassword.trim() || connection.applicationPassword.length > 512)
        throw error("WORDPRESS_CREDENTIALS_MISSING", "WordPress credentials are missing or invalid.");
      const encoded = body === undefined ? undefined : JSON.stringify(body);
      if (encoded !== undefined && Buffer.byteLength(encoded) > MAX_REQUEST_BYTES) throw error("WORDPRESS_REQUEST_TOO_LARGE", "WordPress update exceeded the request size limit.");
      const addresses = await Promise.race([
        this.dns.resolve(site.hostname.replace(/^\[|\]$/g, "")),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(error("WORDPRESS_TIMEOUT", "WordPress request timed out."));
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      if (!addresses.length || addresses.some(address => !publicAddress(address))) throw error("WORDPRESS_BLOCKED_DESTINATION", "WordPress DNS returned a non-public destination.");
      signal.throwIfAborted();
      const authorization = `Basic ${Buffer.from(`${connection.username}:${connection.applicationPassword.replace(/\s/g, "")}`).toString("base64")}`;
      // Prefer a validated IPv4 address where available, without retrying writes.
      const address = addresses.find(value => isIP(value) === 4) ?? addresses[0]!;
      const value = await this.transport.send(url, address, method, authorization, encoded, signal, details => Object.assign(diagnostic, details));
      Object.assign(diagnostic, responseShape(value));
      return value;
    } catch (failure) {
      const safeFailure = failure instanceof WordPressRequestError ? failure : error(signal.aborted ? "WORDPRESS_TIMEOUT" : "WORDPRESS_REQUEST_FAILED", signal.aborted ? "WordPress request timed out." : "The WordPress request failed. Its outcome may require reconciliation.");
      diagnostic.errorCode = safeFailure.code;
      diagnostic.httpStatus ??= safeFailure.httpStatus ?? null;
      safeFailure.diagnostic = diagnostic;
      throw safeFailure;
    } finally {
      diagnostic.durationMs = Math.max(0, Math.round(performance.now() - started));
      // Diagnostic observers must never alter dispatch, cleanup or request outcomes.
      try { observe?.({ ...diagnostic }); } catch { /* Caller diagnostics are best effort. */ }
      if (onAbort) signal.removeEventListener("abort", onAbort);
      this.active--;
    }
  }
}
