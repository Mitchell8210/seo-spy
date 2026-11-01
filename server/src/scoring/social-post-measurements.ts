import type { SocialCriterionId } from "./social-performance.types.js";

const DAY = 86400000;
export interface SocialMeasuredPost { id: string; message: string | null; createdTime: string | null; messageStatus?: "available" | "not-returned" | "not-retained" }

/** Observable textual structures only; these patterns do not establish semantic usefulness or relevance. */
export function observablePostStructures(text: string): string[] {
  const structures: string[] = [];
  if (/https?:\/\/[^\s]+/iu.test(text)) structures.push("resource-link");
  if (/[?¿]/u.test(text)) structures.push("question");
  if (/(?:\+?\d[\d\s().-]{6,}\d)|(?:[\w.+-]+@[\w.-]+\.[a-z]{2,})|\b(?:call|contact|message|book|schedule|llama|llame|contacta|contacte|agenda|escr[ií]be(?:nos|me))\b/iu.test(text)) structures.push("contact-next-step");
  if (/(?:^|\n)\s*(?:[-*•✓✔✅]|\d+[.)])\s*\S/u.test(text) || /\b(?:how to|steps to|tips for|learn how|c[oó]mo|consejos|pasos para)\b/iu.test(text)) structures.push("explanatory-structure");
  return structures;
}
export function descriptionSignalCount(text: string): number {
  if (!text.trim()) return 0;
  // Presence plus an observable service/explanation or next-step cue; not a semantic writing-quality judgment.
  return 1 + Number(observablePostStructures(text).length > 0 || /\b(?:services?|we offer|we help|provid(?:e|es|ing)|servicios?|ofrecemos|ayudamos)\b/iu.test(text));
}

/** Call only after the adapter has independently verified complete, owned 90-day coverage. Invalid input fails closed. */
export function derive90DayPostMeasurements(items: readonly SocialMeasuredPost[], since: string, until: string, contentComplete: boolean): Partial<Record<SocialCriterionId, number>> {
  const start = Date.parse(since), end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 90 * DAY || end % DAY !== 0 || items.length > 250
    || new Set(items.map(item => item.id)).size !== items.length || items.some(item => !/^\d+_\d+$/.test(item.id) || typeof item.createdTime !== "string"
      || !Number.isFinite(Date.parse(item.createdTime)) || Date.parse(item.createdTime) < start || Date.parse(item.createdTime) >= end)) return {};
  const dates = items.map(item => Date.parse(item.createdTime!)).sort((a, b) => a - b);
  const weeks = new Set(dates.filter(date => date >= end - 84 * DAY).map(date => Math.floor((end - date - 1) / (7 * DAY))));
  const boundaries = [start, ...dates, end];
  const result: Partial<Record<SocialCriterionId, number>> = {
    "posts-per-week": dates.length * 7 / 90,
    "posting-recency-days": dates.length ? (end - dates.at(-1)!) / DAY : 90,
    "active-week-ratio": weeks.size / 12,
    "longest-gap-days": Math.max(...boundaries.slice(1).map((date, index) => (date - boundaries[index]!) / DAY)),
  };
  // With no content or unknown/media-only text, a language-independent pattern score is not supportable.
  if (!dates.length || !contentComplete || items.some(item => item.messageStatus !== undefined && item.messageStatus !== "available" || typeof item.message !== "string" || !item.message.trim())) return result;
  const structures = items.map(item => observablePostStructures(item.message!));
  const distinct = new Set(items.map(item => item.message!.normalize("NFC").toLocaleLowerCase("und").trim().replace(/\s+/gu, " ")));
  result["actionable-post-ratio"] = structures.filter(item => item.length > 0).length / items.length;
  result["observable-structure-count"] = new Set(structures.flat()).size;
  result["distinct-post-ratio"] = distinct.size / items.length;
  return result;
}
