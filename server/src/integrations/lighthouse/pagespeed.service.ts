import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { publicUrl } from "../website/collector.js";
import { normalizeLighthouse } from "./normalize.js";
import {
  LIGHTHOUSE_CATEGORIES,
  PageSpeedError,
  type LighthouseStrategy,
} from "./types.js";

export const PAGESPEED_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
export const PAGESPEED_MAX_BYTES = 20 * 1024 * 1024;

@Injectable()
export class PageSpeedTransport {
  async fetch(
    target: string,
    strategy: LighthouseStrategy,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    // The endpoint is fixed and redirects are forbidden. The target is only an encoded query value;
    // Google performs browser requests remotely, without access to the backend's private network.
    const url = new URL(PAGESPEED_ENDPOINT);
    url.searchParams.set("url", target);
    url.searchParams.set("strategy", strategy);
    url.searchParams.set("locale", "en-US");
    for (const category of LIGHTHOUSE_CATEGORIES)
      url.searchParams.append("category", category);
    const response = await globalThis.fetch(url, {
      signal,
      redirect: "error",
      headers: {
        accept: "application/json",
        "accept-encoding": "identity",
        ...(apiKey ? { "x-goog-api-key": apiKey } : {}),
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429)
        throw new PageSpeedError(
          "PAGESPEED_QUOTA_EXCEEDED",
          "PageSpeed quota is exhausted or requests are being rate limited. Check the server API key and project quota.",
        );
      if ([401, 403].includes(response.status))
        throw new PageSpeedError(
          "PAGESPEED_ACCESS_DENIED",
          "PageSpeed denied access. Check that the server API key permits the PageSpeed Insights API.",
        );
      throw new PageSpeedError(
        "PAGESPEED_HTTP_ERROR",
        `PageSpeed returned HTTP ${response.status}.`,
      );
    }
    if (
      !/^application\/json(?:\s*;|\s*$)/i.test(
        response.headers.get("content-type") ?? "",
      ) ||
      !response.body
    ) {
      await response.body?.cancel();
      throw new PageSpeedError(
        "PAGESPEED_INVALID_RESPONSE",
        "PageSpeed did not return a JSON report.",
      );
    }
    if (Number(response.headers.get("content-length")) > PAGESPEED_MAX_BYTES) {
      await response.body.cancel();
      throw new PageSpeedError(
        "PAGESPEED_RESPONSE_TOO_LARGE",
        "The PageSpeed report exceeds the 20 MiB limit.",
      );
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > PAGESPEED_MAX_BYTES) {
          await reader.cancel();
          throw new PageSpeedError(
            "PAGESPEED_RESPONSE_TOO_LARGE",
            "The PageSpeed report exceeds the 20 MiB limit.",
          );
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      throw new PageSpeedError(
        "PAGESPEED_INVALID_RESPONSE",
        "PageSpeed returned malformed JSON.",
      );
    }
  }
}

@Injectable()
export class PageSpeedService {
  private active = false;
  constructor(
    private readonly config: ConfigService,
    private readonly transport: PageSpeedTransport,
  ) {}

  async run(
    target: string,
    strategy: LighthouseStrategy,
    shutdown?: AbortSignal,
  ) {
    if (this.active)
      throw new PageSpeedError(
        "PAGESPEED_BUSY",
        "Another Lighthouse measurement is running. Try again later.",
      );
    this.active = true;
    const timeout = AbortSignal.timeout(
      this.config.getOrThrow<number>("PAGESPEED_TIMEOUT_MS"),
    );
    const signal = shutdown ? AbortSignal.any([timeout, shutdown]) : timeout;
    try {
      signal.throwIfAborted();
      const url = publicUrl(target).href;
      const result = await this.transport.fetch(
        url,
        strategy,
        this.config.getOrThrow<string>("PAGESPEED_API_KEY"),
        signal,
      );
      signal.throwIfAborted();
      return normalizeLighthouse(result, url, strategy);
    } catch (error) {
      if (signal.aborted)
        throw new PageSpeedError(
          shutdown?.aborted ? "SERVER_STOPPING" : "PAGESPEED_TIMEOUT",
          "Lighthouse measurement was interrupted or exceeded its time limit.",
        );
      if (error instanceof PageSpeedError) throw error;
      // Provider errors can contain request headers or response excerpts. Never propagate them.
      throw new PageSpeedError(
        "PAGESPEED_UNAVAILABLE",
        "PageSpeed Insights could not be reached or returned an unsupported response.",
      );
    } finally {
      this.active = false;
    }
  }
}
