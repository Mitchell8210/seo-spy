import type { CheerioAPI } from "cheerio";

export interface WebsiteBusinessEntity { name: string | null; url: string | null; phone: string | null; hours: Record<string, string>[] | null }
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 2048 ? value.trim() : null;

/** Bounded schema.org observations only. Never treats page text or missing markup as confirmed absence. */
export function extractWebsiteBusinessEntities($: CheerioAPI): WebsiteBusinessEntity[] {
  const entities: WebsiteBusinessEntity[] = [];
  let visited = 0;
  const walk = (value: unknown, depth: number) => {
    if (depth > 5 || ++visited > 100 || entities.length >= 10) return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 20)) walk(item, depth + 1); return; }
    const item = object(value);
    if (!item) return;
    const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
    if (types.some(type => typeof type === "string" && /^(?:https?:\/\/schema\.org\/)?(?:Organization|LocalBusiness|AccountingService|ProfessionalService|FinancialService|Corporation)$/.test(type))) {
      const rawHours = Array.isArray(item.openingHoursSpecification) ? item.openingHoursSpecification : item.openingHoursSpecification ? [item.openingHoursSpecification] : null;
      const hours: Record<string, string>[] = [];
      for (const value of rawHours?.slice(0, 14) ?? []) {
        const rule = object(value);
        if (!rule) continue;
        const days = Array.isArray(rule.dayOfWeek) ? rule.dayOfWeek : [rule.dayOfWeek];
        for (const day of days.slice(0, 7)) {
          if (text(day) && text(rule.opens) && text(rule.closes)) hours.push({ day: text(day)!, opens: text(rule.opens)!, closes: text(rule.closes)! });
        }
      }
      entities.push({ name: text(item.name), url: text(item.url), phone: text(item.telephone), hours: rawHours ? hours : null });
    }
    if (item["@graph"]) walk(item["@graph"], depth + 1);
    if (item.mainEntity) walk(item.mainEntity, depth + 1);
  };
  $("script[type='application/ld+json']").slice(0, 10).each((_, element) => {
    const raw = $(element).text();
    if (Buffer.byteLength(raw) > 32768) return;
    try { walk(JSON.parse(raw) as unknown, 0); } catch { /* Invalid markup remains unknown. */ }
  });
  return entities;
}
