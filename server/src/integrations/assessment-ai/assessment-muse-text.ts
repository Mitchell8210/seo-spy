/** New business interpretation text only. Historical v1/v2 excerpts stay byte-stable. */
const trailingClosers = /[\s”’"')\]}]+$/u;
const unfinishedAbbreviation = /(?:\b(?:dr|mr|mrs|ms|prof|sr|jr|vs|no)|\be\.g|\bi\.e)\.$/iu;

function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

/** A conservative completeness check, not a grammatical or factual guarantee.
 * Ellipses and semicolons alone are not proof that a recommendation finished.
 */
export function isCompleteBusinessText(value: string): boolean {
  if (typeof value !== "string" || !value.trim() || !wellFormed(value) || /\p{Cc}/u.test(value)) return false;
  const trimmed = value.trim();
  const ending = trimmed.replace(trailingClosers, "");
  if (!/[.!?。！？]$/u.test(ending) || /\.{2,}$/u.test(ending) || unfinishedAbbreviation.test(ending)) return false;
  const stack: string[] = [];
  const closers: Record<string, string> = { ")": "(", "]": "[", "}": "{", "”": "“" };
  for (const character of trimmed) {
    if (["(", "[", "{", "“"].includes(character)) stack.push(character);
    else if (Object.hasOwn(closers, character) && stack.pop() !== closers[character]) return false;
  }
  // A quoted sentence can end after its punctuation, but never inside a quote.
  if (stack.length || (trimmed.match(/"/g)?.length ?? 0) % 2 !== 0) return false;
  return true;
}

function preservePunctuation(value: string, replacement: string): string {
  return replacement + (value.match(/[.!?;:]+$/u)?.[0] ?? "");
}

function redact(value: string): string {
  return value
    .replace(/-----BEGIN[\s\S]*/gu, "[secret omitted]")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+|data:[^\s<>]+/giu, match => preservePunctuation(match, "[link omitted]"))
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[contact omitted]")
    .replace(/(?:\+?\d[\s().-]*){8,15}/gu, match => preservePunctuation(match, "[contact omitted]"))
    .replace(/["']?\bauthorization["']?(?:\s*[:=]\s*|\s+)(?:(?:bearer|basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, match => preservePunctuation(match, "[secret omitted]"))
    .replace(/\bbearer\s+(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, match => preservePunctuation(match, "[secret omitted]"))
    .replace(/["']?\b(?:api[_ -]?key|password|private[_ -]?key|token)["']?(?:\s*[:=]\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, match => preservePunctuation(match, "[secret omitted]"))
    .replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim();
}

/** Redact first, then retain a prefix of complete sentences that fits the bound.
 * Never add punctuation to disguise a cut-off fragment. If no safe sentence fits,
 * return the caller's complete, trusted fallback rather than reconstructing facts.
 * The bound uses UTF-16 length, matching Zod string limits, without slicing text.
 */
export function safeBusinessExcerpt(value: unknown, max: number, fallback: string): string {
  if (!Number.isSafeInteger(max) || max < 1 || !isCompleteBusinessText(fallback) || fallback.length > max)
    throw new RangeError("Supply a complete trusted fallback within the excerpt bound.");
  if (typeof value !== "string" || !value.trim() || !wellFormed(value)) return fallback;
  // Inputs come from already bounded saved records. Do not partially redact a
  // physically cut secret or private-key block in an unexpectedly large value.
  if (value.length > 65536) return fallback;
  const text = redact(value);
  let result = "";
  // Inspect punctuation boundaries directly. ICU sentence segmentation can merge
  // complete sentences followed by lower-case privacy markers such as [link omitted].
  for (let index = 0; index < text.length; index++) {
    if (!/[.!?。！？]/u.test(text[index])) continue;
    if (text[index] === "." && /\d/u.test(text[index - 1] ?? "") && /\d/u.test(text[index + 1] ?? "")) continue;
    let end = index + 1;
    while (end < text.length && /[”’"')\]}]/u.test(text[end])) end++;
    if (end < text.length && !/\s/u.test(text[end])) continue;
    const candidate = text.slice(0, end).trim();
    if (candidate.length > max) break;
    if (isCompleteBusinessText(candidate)) result = candidate;
  }
  return result || fallback;
}
