import { Injectable } from "@nestjs/common";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export class CollectionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_BYTES = 2 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 5000;
const CONNECTION_ERRORS = new Set([
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EADDRNOTAVAIL",
  "EPIPE",
]);

function isConnectionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    !(error instanceof CollectionError) &&
    "code" in error &&
    typeof error.code === "string" &&
    CONNECTION_ERRORS.has(error.code)
  );
}
export function publicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export function publicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CollectionError(
      "INVALID_URL",
      "A valid public HTTP or HTTPS URL is required.",
    );
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    (isIP(host) && !publicAddress(host))
  ) {
    throw new CollectionError(
      "BLOCKED_DESTINATION",
      "Only public HTTP/HTTPS destinations on standard ports are supported.",
    );
  }
  url.hash = "";
  return url;
}

export interface PageResponse {
  status: number;
  location?: string;
  contentType: string;
  robots: string;
  body: Buffer;
}
export interface CollectedPage {
  requestedUrl: string;
  finalUrl: string;
  collectedAt: string;
  status: number;
  contentType: string;
  robots: string;
  bytes: number;
  redirects: string[];
  body: Buffer;
}

@Injectable()
export class WebsiteDns {
  async resolve(host: string): Promise<string[]> {
    return (await lookup(host, { all: true, verbatim: true })).map(
      (item) => item.address,
    );
  }
}

@Injectable()
export class WebsiteTransport {
  fetch(url: URL, address: string, signal: AbortSignal): Promise<PageResponse> {
    return new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          agent: false,
          signal,
          maxHeaderSize: 16384,
          family: isIP(address),
          // Pin the validated address while retaining the URL hostname for Host and TLS verification.
          lookup: (_host, _options, callback) =>
            callback(null, address, isIP(address)),
          headers: {
            "user-agent": "SEO-Spy/0.1 (single-page audit)",
            accept: "text/html",
            "accept-encoding": "identity",
          },
        },
        (response) => {
          void readPageResponse(response, address).then(resolve, reject);
        },
      );
      // Give other validated addresses a chance without limiting a healthy response's body time.
      const connectionTimer = setTimeout(() => {
        request.destroy(
          Object.assign(new Error("Connection timed out."), {
            code: "ETIMEDOUT",
          }),
        );
      }, CONNECT_TIMEOUT_MS);
      connectionTimer.unref();
      const clearConnectionTimer = () => clearTimeout(connectionTimer);
      request.on("socket", (socket) => {
        socket.once(
          url.protocol === "https:" ? "secureConnect" : "connect",
          clearConnectionTimer,
        );
      });
      request.on("close", clearConnectionTimer);
      request.on("error", clearConnectionTimer);
      request.on("error", reject);
      request.end();
    });
  }
}

export function readPageResponse(
  response: IncomingMessage,
  address: string,
): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    response.on("error", reject);
    if (
      !response.socket.remoteAddress ||
      !publicAddress(response.socket.remoteAddress) ||
      ipaddr.process(response.socket.remoteAddress).toString() !==
        ipaddr.process(address).toString()
    ) {
      response.destroy(
        new CollectionError(
          "BLOCKED_DESTINATION",
          "The connection destination did not match the validated address.",
        ),
      );
      return;
    }
    const status = response.statusCode ?? 0;
    const contentType = response.headers["content-type"] ?? "";
    const robotsHeader = response.headers["x-robots-tag"];
    const result = {
      status,
      location: response.headers.location,
      contentType,
      robots: Array.isArray(robotsHeader)
        ? robotsHeader.join(", ")
        : (robotsHeader ?? ""),
      body: Buffer.alloc(0),
    };

    if ([301, 302, 303, 307, 308].includes(status)) {
      resolve(result);
      response.destroy();
      return;
    }
    if (status < 200 || status >= 300) {
      reject(
        new CollectionError(
          "HTTP_ERROR",
          `The homepage returned HTTP ${status}.`,
        ),
      );
      response.destroy();
      return;
    }
    if (!/^text\/html(?:\s*;|\s*$)/i.test(contentType)) {
      reject(
        new CollectionError(
          "UNSUPPORTED_CONTENT_TYPE",
          "The homepage did not return HTML.",
        ),
      );
      response.destroy();
      return;
    }
    if (
      response.headers["content-encoding"] &&
      response.headers["content-encoding"] !== "identity"
    ) {
      reject(
        new CollectionError(
          "UNSUPPORTED_ENCODING",
          "The server returned compressed content despite an identity request.",
        ),
      );
      response.destroy();
      return;
    }
    if (Number(response.headers["content-length"]) > MAX_BYTES) {
      reject(
        new CollectionError(
          "RESPONSE_TOO_LARGE",
          "The homepage exceeds the 2 MiB limit.",
        ),
      );
      response.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES)
        response.destroy(
          new CollectionError(
            "RESPONSE_TOO_LARGE",
            "The homepage exceeds the 2 MiB limit.",
          ),
        );
      else chunks.push(chunk);
    });
    response.on("end", () =>
      resolve({ ...result, body: Buffer.concat(chunks) }),
    );
  });
}

@Injectable()
export class WebsiteCollector {
  private active = 0;
  constructor(
    private readonly dns: WebsiteDns,
    private readonly transport: WebsiteTransport,
  ) {}

  async collect(input: string, shutdown?: AbortSignal, allowedSite?: string): Promise<CollectedPage> {
    if (this.active >= 2)
      throw new CollectionError(
        "COLLECTOR_BUSY",
        "The collector is busy. Try again later.",
      );
    this.active++;
    const timeout = AbortSignal.timeout(30000);
    const signal = shutdown ? AbortSignal.any([timeout, shutdown]) : timeout;
    try {
      let url = publicUrl(input);
      const requestedUrl = url.href;
      const redirects: string[] = [];
      for (;;) {
        signal.throwIfAborted();
        if (allowedSite) {
          const site = publicUrl(allowedSite);
          if (url.protocol !== "https:" || url.hostname.replace(/^www\./, "") !== site.hostname.replace(/^www\./, ""))
            throw new CollectionError("TARGET_SITE_MISMATCH", "Verification collection must stay on the registered HTTPS website.");
        }
        const host = url.hostname.replace(/^\[|\]$/g, "");
        const addresses = isIP(host)
          ? [host]
          : await this.withAbort(this.dns.resolve(host), signal);
        if (
          !addresses.length ||
          addresses.some((address) => !publicAddress(address))
        )
          throw new CollectionError(
            "BLOCKED_DESTINATION",
            "DNS resolved to a non-public destination.",
          );
        const response = await this.fetchAddresses(url, addresses, signal);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (!response.location || redirects.length >= 5)
            throw new CollectionError(
              "REDIRECT_LIMIT",
              "The homepage has an invalid or excessive redirect chain.",
            );
          const next = publicUrl(new URL(response.location, url).href);
          if (url.protocol === "https:" && next.protocol !== "https:")
            throw new CollectionError(
              "INSECURE_REDIRECT",
              "HTTPS to HTTP redirects are not supported.",
            );
          redirects.push(next.href);
          url = next;
          continue;
        }
        return {
          requestedUrl,
          finalUrl: url.href,
          collectedAt: new Date().toISOString(),
          status: response.status,
          contentType: response.contentType,
          robots: response.robots,
          bytes: response.body.length,
          redirects,
          body: response.body,
        };
      }
    } catch (error) {
      if (error instanceof CollectionError) throw error;
      if (signal.aborted)
        throw new CollectionError(
          shutdown?.aborted ? "SERVER_STOPPING" : "COLLECTION_TIMEOUT",
          "Homepage collection was interrupted or exceeded 30 seconds.",
        );
      throw new CollectionError(
        "COLLECTION_FAILED",
        "The homepage could not be collected. Check DNS, TLS, and connectivity.",
      );
    } finally {
      this.active--;
    }
  }

  private async fetchAddresses(
    url: URL,
    addresses: string[],
    signal: AbortSignal,
  ): Promise<PageResponse> {
    let lastError: unknown;
    for (const address of new Set(addresses)) {
      signal.throwIfAborted();
      try {
        return await this.transport.fetch(url, address, signal);
      } catch (error) {
        // Never retry policy, HTTP, content, TLS validation, or cancellation failures.
        if (signal.aborted || !isConnectionError(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  private withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason as Error);
      signal.addEventListener("abort", abort, { once: true });
      promise
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) abort();
    });
  }
}
