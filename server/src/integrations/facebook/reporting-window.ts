import { z } from "zod";

export interface FacebookReportingWindow {
  since: string;
  until: string;
  requestedDays: 30;
  timeZone: "America/Los_Angeles";
  basis: "complete-provider-days";
  dayEnds: string[];
}

const timeZone = "America/Los_Angeles";
const localParts = new Intl.DateTimeFormat("en-US", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function partsAt(value: Date): Record<string, number> {
  return Object.fromEntries(localParts.formatToParts(value)
    .filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
}

// Resolve each calendar midnight independently: a reporting day can be 23 or 25 hours.
function midnight(year: number, month: number, day: number): string {
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const expected = calendar.getTime();
  let instant = expected;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = partsAt(new Date(instant));
    const represented = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
    const adjustment = expected - represented;
    if (adjustment === 0) return new Date(instant).toISOString();
    instant += adjustment;
  }
  throw new Error("Facebook reporting midnight could not be resolved.");
}

export function createFacebookReportingWindow(now: Date): FacebookReportingWindow {
  if (!Number.isFinite(now.getTime())) throw new Error("A valid collection date is required.");
  const today = partsAt(now);
  const boundaries = Array.from({ length: 31 }, (_, index) =>
    midnight(today.year!, today.month!, today.day! - 30 + index));
  return {
    since: boundaries[0]!, until: boundaries[30]!, requestedDays: 30,
    timeZone, basis: "complete-provider-days", dayEnds: boundaries.slice(1),
  };
}

export interface FacebookDailyAggregation {
  points: { endTime: string; value: number }[];
  total: number | null;
  status: "available" | "missing" | "unavailable";
  failureCode?: string;
  coverage: { complete: boolean; expectedDays: number; returnedDays: number };
}

const count = z.number().int().nonnegative().refine(Number.isSafeInteger);
const timestamp = z.string().max(64)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/)
  .refine(value => Number.isFinite(Date.parse(value)));

export function aggregateFacebookDailyValues(
  raw: unknown,
  metricName: string,
  window: FacebookReportingWindow,
  reactionType?: "like",
): FacebookDailyAggregation {
  const unavailable = (failureCode: string): FacebookDailyAggregation => ({
    points: [], total: null, status: "unavailable", failureCode,
    coverage: { complete: false, expectedDays: 30, returnedDays: 0 },
  });
  try {
    const valueSchema = reactionType
      ? z.record(z.string().regex(/^[a-z_]+$/), count)
      : count;
    const parsed = z.object({ data: z.array(z.object({
      name: z.literal(metricName), period: z.literal("day"),
      values: z.array(z.object({ end_time: timestamp, value: valueSchema })).max(100),
    })).max(1) }).parse(raw);
    const values = parsed.data[0]?.values ?? [];
    if (values.length === 0) return {
      points: [], total: null, status: "missing",
      coverage: { complete: false, expectedDays: 30, returnedDays: 0 },
    };
    const allowed = new Set(window.dayEnds);
    if (window.dayEnds.length !== 30 || allowed.size !== 30) return unavailable("INVALID_REPORTING_WINDOW");
    const seen = new Set<string>();
    const points: FacebookDailyAggregation["points"] = [];
    for (const entry of values) {
      const endTime = new Date(entry.end_time).toISOString();
      if (seen.has(endTime)) return unavailable("DUPLICATE_PERIODS");
      seen.add(endTime);
      if (!allowed.has(endTime)) continue;
      // Meta's dictionary contains only reaction types with observations that day.
      const value = typeof entry.value === "number" ? entry.value : entry.value[reactionType!] ?? 0;
      points.push({ endTime, value });
    }
    points.sort((left, right) => left.endTime.localeCompare(right.endTime));
    const complete = points.length === 30;
    const total = complete ? points.reduce((sum, point) => sum + point.value, 0) : null;
    if (total !== null && !Number.isSafeInteger(total)) return unavailable("INVALID_RESPONSE");
    return { points, total, status: complete ? "available" : "unavailable",
      ...(!complete ? { failureCode: "INCOMPLETE_DAILY_COVERAGE" } : {}),
      coverage: { complete, expectedDays: 30, returnedDays: points.length },
    };
  } catch {
    return unavailable("INVALID_RESPONSE");
  }
}
