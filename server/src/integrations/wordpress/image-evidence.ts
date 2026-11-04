import { load, loadBuffer } from "cheerio";

export interface ImageObservation {
  src: string | null;
  alt: string | null;
  attributes: Record<string, string>;
  attachmentIds: number[];
  pictureSources: Record<string, string>[];
}
export interface MediaSources { mediaId: number; sourceUrls: string[] }
const direct = ["src", "data-src", "data-lazy-src", "data-original"];
const sets = ["srcset", "data-srcset", "data-lazy-srcset"];

/** Bounded inert HTML observations. Never downloads pixels or executes scripts. */
export function observeImages(html: Buffer | string): ImageObservation[] {
  if (Buffer.byteLength(html) > 2 * 1024 * 1024) throw new Error("Image HTML limit exceeded");
  const $ = typeof html === "string" ? load(html) : loadBuffer(html);
  const elements = $("img");
  if (elements.length > 5000) throw new Error("Image count limit exceeded");
  return elements.toArray().map(element => {
    const image = $(element);
    const attributes = Object.fromEntries([...direct, ...sets].flatMap(key => image.attr(key) === undefined ? [] : [[key, image.attr(key)!]]));
    const attachmentIds = (image.attr("class") ?? "").split(/\s+/).flatMap(value => /^wp-image-[1-9]\d*$/.test(value) ? [Number(value.slice(9))] : []);
    const attachment = image.attr("data-attachment-id");
    if (attachment !== undefined) attachmentIds.push(/^[1-9]\d*$/.test(attachment) ? Number(attachment) : -1);
    const sources = image.parent("picture").children("source");
    if (sources.length > 10) throw new Error("Picture source limit exceeded");
    return { src: image.attr("src") ?? null, alt: image.attr("alt") ?? null, attributes, attachmentIds: [...new Set(attachmentIds)],
      pictureSources: sources.toArray().map(source => Object.fromEntries([...sets, "type", "media"].flatMap(key => $(source).attr(key) === undefined ? [] : [[key, $(source).attr(key)!]]))) };
  });
}

function url(value: string, base: string): string | null {
  if (!value || value.length > 2048 || /\s/u.test(value) || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null;
  try {
    const parsed = new URL(value, base);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) return null;
    return parsed.href;
  } catch { return null; }
}
function candidates(image: ImageObservation): string[] | null {
  const values: string[] = [];
  for (const key of direct) if (image.attributes[key] !== undefined) values.push(image.attributes[key]);
  for (const attrs of [image.attributes, ...image.pictureSources]) for (const key of sets) {
    const value = attrs[key];
    if (value === undefined) continue;
    if (value.length > 8192) return null;
    const entries = value.split(",");
    if (entries.length > 20) return null;
    for (const entry of entries) {
      const match = /^\s*(\S+)(?:\s+([1-9]\d{0,4}w|(?:[1-9]\d{0,2}(?:\.\d{1,3})?|0\.\d{1,3})x))?\s*$/.exec(entry);
      if (!match) return null;
      values.push(match[1]);
    }
  }
  if (values.length > 100) return null;
  return values;
}

/** Exact metadata URL + explicit attachment identity. No inferred dimension suffixes. */
export function matchMediaImages(images: ImageObservation[], pageUrl: string, catalog: MediaSources[], mediaId: number): {
  status: "matched" | "ambiguous" | "absent"; matches: ImageObservation[]; renderedUrls: string[];
} {
  const matches: ImageObservation[] = [], rendered = new Set<string>();
  const owners = new Map<string, Set<number>>();
  let ambiguous = false;
  if (catalog.length > 100 || images.length > 5000 || !url(pageUrl, pageUrl)) return { status: "ambiguous", matches, renderedUrls: [] };
  for (const media of catalog) {
    if (!Number.isSafeInteger(media.mediaId) || media.mediaId < 1 || !media.sourceUrls.length || media.sourceUrls.length > 100) return { status: "ambiguous", matches, renderedUrls: [] };
    for (const value of media.sourceUrls) {
      const source = url(value, pageUrl);
      if (!source) return { status: "ambiguous", matches, renderedUrls: [] };
      const ids = owners.get(source) ?? new Set<number>(); ids.add(media.mediaId); owners.set(source, ids);
    }
  }
  for (const image of images) {
    const values = candidates(image);
    const identity = image.attachmentIds.includes(mediaId);
    if (!values) { if (identity) ambiguous = true; continue; }
    const sources = values.filter(value => !/^data:image\//i.test(value)).map(value => url(value, pageUrl));
    const relevant = sources.some(source => source !== null && owners.get(source)?.has(mediaId));
    if (!identity && !relevant) continue;
    if (!identity || image.attachmentIds.some(id => id !== mediaId) || !sources.length || sources.some(source => source === null || owners.get(source)?.size !== 1 || !owners.get(source)?.has(mediaId))) {
      ambiguous = true; continue;
    }
    matches.push(image);
    sources.forEach(source => rendered.add(source!));
  }
  return { status: ambiguous ? "ambiguous" : matches.length ? "matched" : "absent", matches, renderedUrls: [...rendered].sort() };
}
