import { load, loadBuffer } from "cheerio";

export interface ImageAltVerificationTarget {
  mediaId: number;
  sourceUrl: string;
  expectedAlt: string;
  pageUrl: string;
}

export interface ImageAltVerificationResult {
  status: "verified" | "mismatch" | "inconclusive";
  matchedImages: number;
  observedAlts: (string | null)[];
  limitations: string[];
}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_MATCHES = 20;
const MAX_ALT = 2000;
const MAX_URL = 2048;
const MAX_SRCSET = 8192;
const MAX_CANDIDATES = 20;
const MAX_IMAGES = 5000;

function imageUrl(value: string, base?: URL): URL | null {
  if (!value || value.length > MAX_URL || [...value].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return null;
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    url.hash = "";
    return url;
  } catch { return null; }
}

function sameImage(candidate: URL, source: URL): boolean {
  if (candidate.origin !== source.origin || candidate.search !== source.search) return false;
  if (candidate.pathname === source.pathname) return true;
  // Only WordPress dimension suffixes on the candidate basename are recognized.
  // Do not remove arbitrary path components, filename fragments or query transforms.
  const original = /^(.*)\.([a-zA-Z0-9]{1,10})$/.exec(source.pathname);
  const variant = /^(.*)-([1-9]\d{0,4})x([1-9]\d{0,4})\.([a-zA-Z0-9]{1,10})$/.exec(candidate.pathname);
  return Boolean(original && variant && original[1] === variant[1] && original[2] === variant[4]);
}

function srcsetUrls(value: string): { urls: string[]; uncertain: boolean } {
  if (value.length > MAX_SRCSET || /(?:^|[\s,])(?:data|blob|javascript):/i.test(value)) return { urls: [], uncertain: true };
  const entries = value.split(",");
  if (entries.length > MAX_CANDIDATES) return { urls: [], uncertain: true };
  const urls: string[] = [];
  let uncertain = false;
  for (const entry of entries) {
    const match = /^\s*(\S+)(?:\s+([1-9]\d{0,4}w|(?:[1-9]\d{0,2}(?:\.\d{1,3})?|0\.\d{1,3})x))?\s*$/.exec(entry);
    if (!match) { uncertain = true; continue; }
    urls.push(match[1]);
  }
  return { urls, uncertain };
}

/** Inspect already-collected HTML only. No images, scripts, builders or remote URLs are executed. */
export function verifyImageAlt(html: Buffer | string, target: ImageAltVerificationTarget): ImageAltVerificationResult {
  const limitations = [
    "This checks collected public HTML only; scripts, images and builder code are not executed.",
    "Caches, propagation delays, templates and widget overrides can explain a different public value.",
    "Matching alt text does not establish accessibility quality, ranking or performance improvement.",
  ];
  const result: ImageAltVerificationResult = { status: "inconclusive", matchedImages: 0, observedAlts: [], limitations };
  const source = imageUrl(target.sourceUrl);
  const page = imageUrl(target.pageUrl);
  if (!Number.isSafeInteger(target.mediaId) || target.mediaId < 1 || typeof target.expectedAlt !== "string" || target.expectedAlt.length > MAX_ALT || !source || !page) {
    limitations.push("A valid bounded image target, expected alternative and HTTP(S) source/page URLs are required.");
    return result;
  }
  const buffer = typeof html === "string" ? Buffer.from(html, "utf8") : html;
  if (buffer.length > MAX_BYTES) { limitations.push("The collected HTML exceeds the verification size limit."); return result; }
  try {
    // Decoded strings must not be encoded and sniffed again, which would corrupt
    // non-ASCII text when the HTML fragment omits a charset declaration.
    const $ = typeof html === "string" ? load(html) : loadBuffer(buffer);
    let uncertain = false;
    let mismatch = false;
    let scanned = 0;
    $("img").each((_index, element) => {
      if (++scanned > MAX_IMAGES) { uncertain = true; limitations.push("The image inspection limit was reached; coverage is incomplete."); return false; }
      const image = $(element);
      const classes = (image.attr("class") ?? "").split(/\s+/);
      const attachmentClasses = classes.filter(value => /^wp-image-[1-9]\d*$/.test(value));
      const targetClass = `wp-image-${target.mediaId}`;
      const exactClass = attachmentClasses.includes(targetClass);
      const conflictingClass = attachmentClasses.some(value => value !== targetClass);
      let urlMatch = false;
      let conflictingSource = false;
      let candidatesUncertain = false;
      const candidates: string[] = [];
      for (const attribute of ["src", "data-src", "data-lazy-src"]) {
        const value = image.attr(attribute);
        if (value !== undefined) { candidates.push(value); candidatesUncertain ||= value.length > MAX_URL; }
      }
      for (const attribute of ["srcset", "data-srcset", "data-lazy-srcset"]) {
        const value = image.attr(attribute);
        if (value === undefined) continue;
        const parsed = srcsetUrls(value);
        candidates.push(...parsed.urls);
        candidatesUncertain ||= parsed.uncertain;
      }
      // A picture source can replace the img's fallback URL at a viewport/type
      // boundary. Without a browser, every advertised candidate must agree.
      const pictureSources = image.parent("picture").children("source");
      if (pictureSources.length > 10) candidatesUncertain = true;
      pictureSources.slice(0, 10).each((_sourceIndex, element) => {
        for (const attribute of ["srcset", "data-srcset", "data-lazy-srcset"]) {
          const value = $(element).attr(attribute);
          if (value === undefined) continue;
          const parsed = srcsetUrls(value);
          candidates.push(...parsed.urls);
          candidatesUncertain ||= parsed.uncertain;
        }
      });
      for (const value of candidates) {
        // Inert embedded placeholders do not contradict a separately established
        // real lazy source. A class plus only a placeholder is never sufficient.
        if (/^data:image\//i.test(value)) continue;
        const candidate = imageUrl(value, page);
        if (!candidate) { candidatesUncertain = true; continue; }
        if (sameImage(candidate, source)) urlMatch = true;
        else conflictingSource = true;
      }
      if (conflictingClass) {
        if (exactClass || urlMatch) { uncertain = true; limitations.push("An image has an attachment ID conflicting with the requested media; its URL cannot establish identity."); }
        return;
      }
      if (!urlMatch) {
        uncertain ||= exactClass || candidatesUncertain;
        if (exactClass) limitations.push("An attachment class lacks a corroborating image source; classes alone do not establish the displayed media.");
        return;
      }
      if (conflictingSource || candidatesUncertain) {
        uncertain = true;
        limitations.push("Conflicting or unrecognized image source candidates prevent establishing which media the element displays.");
        return;
      }
      result.matchedImages++;
      if (result.matchedImages > MAX_MATCHES) {
        uncertain = true;
        limitations.push("More than 20 matching images were found; inspection stopped and the reported count is a lower bound.");
        return false;
      }
      const alt = image.attr("alt") ?? null;
      result.observedAlts.push(alt === null ? null : alt.slice(0, MAX_ALT));
      if (alt !== null && alt.length > MAX_ALT) { uncertain = true; limitations.push("An observed alternative exceeds the text limit and was truncated; it cannot establish verification."); }
      else if (alt !== target.expectedAlt) mismatch = true;
    });
    result.status = mismatch ? "mismatch" : result.matchedImages > 0 && !uncertain ? "verified" : "inconclusive";
    if (!result.matchedImages) limitations.push("No unambiguous matching rendered image was established; the image may be absent, lazy-inserted or stored in widget-specific markup.");
    if (uncertain && !limitations.some(value => value.includes("limit") || value.includes("conflicting"))) limitations.push("Malformed or excessive image-source candidates prevent complete matching.");
    // Repeated conflicting elements must not create an unbounded diagnostic array.
    result.limitations = [...new Set(limitations)].slice(0, 10);
    return result;
  } catch {
    limitations.push("The collected HTML could not be parsed for image verification.");
    return result;
  }
}
