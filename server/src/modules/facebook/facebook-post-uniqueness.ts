/** Ignore casing, punctuation, spacing and repeated website CTAs when checking prior content. */
const normalized = (text: string) => text.normalize("NFKC").toLowerCase().replace(/https?:\/\/\S+/gu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function similarFacebookPost(text: string, previous: string) {
  const a = normalized(text), b = normalized(previous);
  if (a === b) return true;
  if (!a || !b || Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.7) return false;
  const grams = (value: string) => new Set(Array.from({ length: Math.max(0, value.length - 4) }, (_, index) => value.slice(index, index + 5)));
  const first = grams(a), second = grams(b);
  if (!first.size || !second.size) return false;
  const common = [...first].filter(item => second.has(item)).length;
  return 2 * common / (first.size + second.size) >= 0.9;
}
