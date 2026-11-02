import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { CollectionError, MAX_BYTES, publicAddress, publicUrl, WebsiteDns, WebsiteTransport } from "../website/collector.js";

const rejected = (code: string, message: string) => new CollectionError(code, message);
function source(input: string, siteInput: string): URL {
  if (input.length > 2048 || siteInput.length > 2048 || input !== input.trim() || siteInput !== siteInput.trim()) throw rejected("INVALID_URL", "A bounded exact image URL is required.");
  // publicUrl intentionally removes fragments for page collection; image identity
  // must reject them rather than silently changing the reviewed resource.
  let raw: URL, rawSite: URL;
  try { raw = new URL(input); rawSite = new URL(siteInput); } catch { throw rejected("INVALID_URL", "A valid exact image/site URL is required."); }
  if (raw.hash || rawSite.hash) throw rejected("INVALID_URL", "Image/site URL fragments are not supported.");
  const url = publicUrl(input), site = publicUrl(siteInput);
  if (url.protocol !== "https:" || site.protocol !== "https:" || url.hostname.replace(/^www\./, "") !== site.hostname.replace(/^www\./, ""))
    throw rejected("TARGET_SITE_MISMATCH", "Image collection must remain on the connected HTTPS installation.");
  return url;
}
function rasterMagic(contentType: string, body: Buffer): boolean {
  switch (contentType.split(";")[0].trim().toLowerCase()) {
    case "image/png": return body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/jpeg": return body.length >= 5 && body[0] === 255 && body[1] === 216 && body[2] === 255 && body[body.length - 2] === 255 && body[body.length - 1] === 217;
    case "image/webp": return body.length >= 12 && body.toString("ascii", 0, 4) === "RIFF" && body.toString("ascii", 8, 12) === "WEBP";
    case "image/gif": return body.length >= 6 && ["GIF87a", "GIF89a"].includes(body.toString("ascii", 0, 6));
    default: return false;
  }
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

/** Hash bounded source bytes only. No decoding, visual inference, credentials or persistence. */
@Injectable()
export class WordPressImageContent {
  private active = 0;
  constructor(private readonly dns: WebsiteDns, private readonly transport: WebsiteTransport) {}
  async fingerprint(sourceUrl: string, siteUrl: string, shutdown?: AbortSignal): Promise<{ sourceUrl: string; sha256: string; bytes: number; collectedAt: string }> {
    if (this.active >= 2) throw rejected("COLLECTOR_BUSY", "Image collection is busy.");
    const signal = shutdown ? AbortSignal.any([AbortSignal.timeout(30000), shutdown]) : AbortSignal.timeout(30000);
    this.active++;
    try {
      signal.throwIfAborted();
      const url = source(sourceUrl, siteUrl), host = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = isIP(host) ? [host] : await abortable(this.dns.resolve(host), signal);
      if (!addresses.length || addresses.some(address => !publicAddress(address))) throw rejected("BLOCKED_DESTINATION", "Image DNS did not establish exclusively public destinations.");
      // Exactly one pinned request. Other answers are validated but never retried.
      const response = await abortable(this.transport.fetch(url, addresses[0], signal, "raster-image"), signal);
      signal.throwIfAborted();
      if ([301, 302, 303, 307, 308].includes(response.status)) throw rejected("IMAGE_REDIRECT_REJECTED", "Image redirects require a separately reviewed exact resource.");
      if (response.status !== 200) throw rejected("HTTP_ERROR", "The exact image did not return HTTP 200.");
      if (!Buffer.isBuffer(response.body) || response.body.length > MAX_BYTES) throw rejected("RESPONSE_TOO_LARGE", "Image content exceeds the supported 2 MiB bound.");
      if (!rasterMagic(response.contentType, response.body)) throw rejected("IMAGE_CONTENT_INVALID", "Image MIME and basic raster signature did not agree.");
      return { sourceUrl: url.href, sha256: createHash("sha256").update(response.body).digest("hex"), bytes: response.body.length, collectedAt: new Date().toISOString() };
    } catch (error) {
      if (signal.aborted) throw rejected(shutdown?.aborted ? "SERVER_STOPPING" : "COLLECTION_TIMEOUT", "Image collection was interrupted or exceeded its 30 second deadline.");
      if (error instanceof CollectionError) throw error;
      throw rejected("COLLECTION_FAILED", "The exact image could not be collected safely.");
    } finally { this.active--; }
  }
}
