import { z } from "zod";
import type { GoogleTokenProvider } from "./google-auth.js";
import { GoogleApiError, type GoogleTransport } from "./google-transport.js";
import type { Ga4LeadPolicy } from "./google-lead-policy.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const metadata = z.object({ subjectToThresholding: z.boolean(), dataLossFromOtherRow: z.boolean(),
  sampling: z.array(z.object({ samplesReadCount: z.string().regex(/^\d{1,30}$/), samplingSpaceSize: z.string().regex(/^\d{1,30}$/) }).strict()).max(5),
}).strict();
export const googleAnalysisDataSchema = z.object({
  schemaVersion: z.literal("seo-spy.google-analysis-data.v2"), propertyId: z.string().regex(/^[1-9]\d{0,19}$/),
  hostname: z.string().min(1).max(253), collectedAt: z.string().datetime(),
  dateRange: z.object({ startDate: date, endDate: date, timeZone: z.string().min(1).max(100) }).strict(),
  totals: z.object({ users: count, sessions: count, conversions: count.nullable(), rate: z.number().finite().min(0).max(100).nullable() }).strict(),
  daily: z.array(z.object({ date, users: count, sessions: count, conversions: count.nullable() }).strict()).max(30),
  conversion: z.object({ eventName: z.string().nullable(), pagePaths: z.array(z.string()).max(10), users: count.nullable(),
    status: z.enum(["available", "unavailable"]), reason: z.enum(["not_configured", "no_recorded_submissions", "limited_data", "query_failed"]).nullable(),
  }).strict(),
  channels: z.array(z.object({ label: z.string().min(1).max(200), value: count }).strict()).max(100),
  devices: z.array(z.object({ label: z.string().min(1).max(200), value: count }).strict()).max(20),
  pages: z.array(z.object({ path: z.string().min(1).max(2048), users: count }).strict()).max(5),
  metadata: z.array(metadata).min(5).max(7), limitations: z.array(z.string().max(1000)).max(15),
}).strict();
export type GoogleAnalysisData = z.infer<typeof googleAnalysisDataSchema>;
export const googleAnalysisEnvelopeSchema = z.object({
  schemaVersion: z.literal("seo-spy.google-analysis.v2"), businessId: z.string().min(1), provider: z.literal("ga4"),
  availability: z.enum(["available", "empty", "unavailable"]), data: googleAnalysisDataSchema.nullable(),
  lastAttemptAt: z.string().datetime(), errorCode: z.string().max(80).nullable(),
}).strict();
export type GoogleAnalysisEnvelope = z.infer<typeof googleAnalysisEnvelopeSchema>;
const invalid = () => new GoogleApiError("GOOGLE_INVALID_RESPONSE", "Google returned an incompatible analytics report.");
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
};
const numeric = (value: unknown) => {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) throw invalid();
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw invalid();
  return result;
};
function parseReport(value: unknown, dimensions: string[], metrics: string[], limit: number, top = false) {
  const report = object(value);
  if (report.error) throw invalid();
  const headers = (key: string) => {
    const raw = report[key] ?? [];
    if (!Array.isArray(raw)) throw invalid();
    return raw.map(item => object(item).name);
  };
  // GA4 can omit headers entirely for a successful dimensionless no-data report.
  // Only absent headers with no rows may inherit the exact request's column names.
  const empty = report.rows === undefined || Array.isArray(report.rows) && report.rows.length === 0;
  const dimNames = empty && report.dimensionHeaders === undefined ? dimensions : headers("dimensionHeaders");
  const metricNames = empty && report.metricHeaders === undefined ? metrics : headers("metricHeaders");
  if (dimNames.length !== dimensions.length || dimensions.some((name, index) => name !== dimNames[index]) ||
      metricNames.length !== metrics.length || new Set(metricNames).size !== metrics.length || metrics.some(name => !metricNames.includes(name))) throw invalid();
  const rawRows = report.rows ?? [];
  if (!Array.isArray(rawRows) || rawRows.length > limit || report.rowCount !== undefined &&
    (!Number.isSafeInteger(report.rowCount) || Number(report.rowCount) < rawRows.length || !top && report.rowCount !== rawRows.length)) throw invalid();
  const seen = new Set<string>();
  const rows = rawRows.map(raw => {
    const row = object(raw), dims = row.dimensionValues ?? [], values = row.metricValues;
    if (!Array.isArray(dims) || dims.length !== dimensions.length || !Array.isArray(values) || values.length !== metrics.length) throw invalid();
    const keys = dims.map(item => {
      const key = object(item).value;
      if (typeof key !== "string" || !key || key.length > 2048 || [...key].some(character => character.charCodeAt(0) < 32)) throw invalid();
      return key;
    });
    const identity = JSON.stringify(keys);
    if (seen.has(identity)) throw invalid();
    seen.add(identity);
    const measurements = Object.fromEntries(metricNames.map((name, index) => [String(name), numeric(object(values[index]).value)]));
    return { keys, measurements };
  });
  const rawMetadata = object(report.metadata);
  const timeZone = rawMetadata.timeZone;
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 100) throw invalid();
  try { new Intl.DateTimeFormat("en", { timeZone }); } catch { throw invalid(); }
  for (const key of ["subjectToThresholding", "dataLossFromOtherRow"]) if (rawMetadata[key] !== undefined && typeof rawMetadata[key] !== "boolean") throw invalid();
  const sampling = rawMetadata.samplingMetadatas ?? [];
  if (!Array.isArray(sampling)) throw invalid();
  const normalized = metadata.parse({ subjectToThresholding: rawMetadata.subjectToThresholding === true,
    dataLossFromOtherRow: rawMetadata.dataLossFromOtherRow === true, sampling: sampling.map(item => {
      const sample = object(item);
      return { samplesReadCount: sample.samplesReadCount, samplingSpaceSize: sample.samplingSpaceSize };
    }) });
  if (normalized.sampling.some(sample => BigInt(sample.samplesReadCount) > BigInt(sample.samplingSpaceSize))) throw invalid();
  return { rows, timeZone, metadata: normalized, restricted: !!rawMetadata.schemaRestrictionResponse,
    truncated: Array.isArray(rawMetadata.dataTruncationReasons) && rawMetadata.dataTruncationReasons.length > 0 };
}

/** Five website-filtered reports in one read-only batch. Never sum daily unique users into monthly users. */
export async function collectGoogleAnalysis(auth: GoogleTokenProvider, transport: GoogleTransport, propertyId: string, hostname: string, policy: Ga4LeadPolicy | null = null): Promise<GoogleAnalysisData> {
  if (!/^[1-9]\d{0,19}$/.test(propertyId) || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname))
    throw new GoogleApiError("GOOGLE_NOT_CONFIGURED", "The website analytics binding is invalid.");
  const definitions = [
    { dimensions: [], metrics: ["totalUsers", "sessions"], limit: 1 },
    { dimensions: ["date"], metrics: ["totalUsers", "sessions"], limit: 30 },
    { dimensions: ["sessionDefaultChannelGroup"], metrics: ["sessions"], limit: 100 },
    { dimensions: ["deviceCategory"], metrics: ["totalUsers"], limit: 20 },
    { dimensions: ["pagePath"], metrics: ["totalUsers"], limit: 5 },
  ];
  const accessToken = await auth.getAccessToken(), collectedAt = new Date().toISOString();
  const raw = object(await transport.post(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`, {
    requests: definitions.map((definition, index) => ({ dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      dimensions: definition.dimensions.map(name => ({ name })), metrics: definition.metrics.map(name => ({ name })), limit: String(definition.limit),
      dimensionFilter: { filter: { fieldName: "hostName", inListFilter: { values: [hostname, `www.${hostname}`], caseSensitive: false } } },
      ...(index === 1 ? { orderBys: [{ dimension: { dimensionName: "date" } }] } : index >= 2 ? { orderBys: [{ metric: { metricName: definition.metrics[0] }, desc: true }] } : {}),
      keepEmptyRows: false,
    })),
  }, { accessToken }));
  if (!Array.isArray(raw.reports) || raw.reports.length !== 5) throw invalid();
  const reports = definitions.map((definition, index) => parseReport((raw.reports as unknown[])[index], definition.dimensions, definition.metrics, definition.limit, index === 4));
  const timeZone = reports[0].timeZone;
  if (reports.some(report => report.timeZone !== timeZone)) throw invalid();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(collectedAt));
  const part = (key: string) => parts.find(item => item.type === key)!.value;
  const midnight = Date.parse(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  const startDate = new Date(midnight - 30 * 86400000).toISOString().slice(0, 10), endDate = new Date(midnight - 86400000).toISOString().slice(0, 10);
  const summary = reports[0].rows[0]?.measurements;
  const daily = reports[1].rows.map(row => {
    if (!/^\d{8}$/.test(row.keys[0])) throw invalid();
    const date = `${row.keys[0].slice(0, 4)}-${row.keys[0].slice(4, 6)}-${row.keys[0].slice(6)}`;
    if (date < startDate || date > endDate || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw invalid();
    return { date, users: row.measurements.totalUsers, sessions: row.measurements.sessions, conversions: null as number | null };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const limitations = [
    "Users are GA4 totalUsers for the whole period, not a sum of daily, device or page users. A visitor can appear in multiple breakdown rows.",
    "Conversions count only the configured lead-submission event and allowed page paths. The rate is distinct submitting users divided by whole-period website users; login, page views, scrolls and general engagement are excluded.",
    "All reports exclude today and filter hostName to the registered website and its www alias. Missing daily rows are not filled with invented values.",
    "Top Pages contains at most five paths ranked by totalUsers. Google channel names are retained, including Unassigned and (not set).",
  ];
  let conversions: number | null = null, rate: number | null = null;
  const conversion: GoogleAnalysisData["conversion"] = { eventName: policy?.eventName ?? null, pagePaths: policy?.pagePaths ?? [], users: null,
    status: "unavailable", reason: policy ? "no_recorded_submissions" : "not_configured" };
  if (policy) {
    try {
      // Separate event-filtered reports preserve the unfiltered traffic denominator.
      const expressions = [
        { filter: { fieldName: "hostName", inListFilter: { values: [hostname, `www.${hostname}`], caseSensitive: false } } },
        { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: policy.eventName, caseSensitive: true } } },
        ...(policy.pagePaths.length ? [{ filter: { fieldName: "pagePath", inListFilter: { values: policy.pagePaths, caseSensitive: true } } }] : []),
      ];
      const result = object(await transport.post(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`, {
        requests: [[], ["date"]].map((dimensions, index) => ({ dateRanges: [{ startDate, endDate }], dimensions: dimensions.map(name => ({ name })),
          metrics: (index === 0 ? ["eventCount", "totalUsers"] : ["eventCount"]).map(name => ({ name })),
          dimensionFilter: { andGroup: { expressions } }, limit: index === 0 ? "1" : "30", keepEmptyRows: false,
          ...(index === 1 ? { orderBys: [{ dimension: { dimensionName: "date" } }] } : {}),
        })),
      }, { accessToken }));
      if (!Array.isArray(result.reports) || result.reports.length !== 2) throw invalid();
      const leads = [parseReport(result.reports[0], [], ["eventCount", "totalUsers"], 1), parseReport(result.reports[1], ["date"], ["eventCount"], 30)];
      if (leads.some(report => report.timeZone !== timeZone)) throw invalid();
      reports.push(...leads);
      const limited = (report: typeof reports[number]) => report.metadata.subjectToThresholding || report.metadata.dataLossFromOtherRow || report.restricted || report.truncated ||
        report.metadata.sampling.some(sample => BigInt(sample.samplesReadCount) < BigInt(sample.samplingSpaceSize));
      if (leads.some(limited) || limited(reports[0])) conversion.reason = "limited_data";
      else if (!leads[0].rows.length || leads[0].rows[0].measurements.eventCount === 0 && leads[0].rows[0].measurements.totalUsers === 0) {
        if (leads[1].rows.some(row => row.measurements.eventCount !== 0)) throw invalid();
        conversions = 0; rate = 0;
        conversion.users = 0; conversion.status = "available"; conversion.reason = "no_recorded_submissions";
        for (const day of daily) day.conversions = 0;
        limitations.push("Google returned no recorded inquiry submissions for the configured forms. Zero describes the successful report; it does not verify form tracking coverage or prove that no untracked inquiries occurred.");
      }
      else if (leads[0].rows.length && leads[0].rows[0].measurements.eventCount > 0) {
        const leadTotal = leads[0].rows[0].measurements;
        if (!summary?.totalUsers || !leadTotal.totalUsers || leadTotal.totalUsers > summary.totalUsers || leadTotal.totalUsers > leadTotal.eventCount) throw invalid();
        const byDate = new Map(leads[1].rows.map(row => {
          if (!/^\d{8}$/.test(row.keys[0])) throw invalid();
          const date = `${row.keys[0].slice(0, 4)}-${row.keys[0].slice(4, 6)}-${row.keys[0].slice(6)}`;
          if (!daily.some(day => day.date === date)) throw invalid();
          return [date, row.measurements.eventCount] as const;
        }));
        if ([...byDate.values()].reduce((sum, value) => sum + value, 0) !== leadTotal.eventCount) throw invalid();
        conversions = leadTotal.eventCount;
        rate = leadTotal.totalUsers / summary.totalUsers * 100;
        conversion.users = leadTotal.totalUsers; conversion.status = "available"; conversion.reason = null;
        for (const day of daily) day.conversions = byDate.get(day.date) ?? 0;
      }
    } catch { conversion.reason = "query_failed"; }
  }
  if (conversion.status === "unavailable") limitations.push("Lead conversion reporting is unavailable for this period. Missing configuration, restricted data or failed queries are not zero leads. Traffic remains measured separately.");
  if (reports.some(report => report.metadata.subjectToThresholding)) limitations.push("Google reported privacy thresholding; returned data may omit suppressed measurements.");
  if (reports.some(report => report.metadata.dataLossFromOtherRow || report.truncated)) limitations.push("Google reported aggregation or truncation; returned data has limited coverage.");
  if (reports.some(report => report.metadata.sampling.some(sample => BigInt(sample.samplesReadCount) < BigInt(sample.samplingSpaceSize)))) limitations.push("Google reported sampling; the measurements are not an unsampled census.");
  if (reports.some(report => report.restricted)) limitations.push("Google reported metric restrictions; some measurements may be restricted.");
  return googleAnalysisDataSchema.parse({ schemaVersion: "seo-spy.google-analysis-data.v2", propertyId, hostname, collectedAt,
    dateRange: { startDate, endDate, timeZone }, totals: { users: summary?.totalUsers ?? 0, sessions: summary?.sessions ?? 0,
      conversions, rate }, daily, conversion,
    channels: reports[2].rows.map(row => ({ label: row.keys[0], value: row.measurements.sessions })),
    devices: reports[3].rows.map(row => ({ label: row.keys[0], value: row.measurements.totalUsers })),
    pages: reports[4].rows.map(row => ({ path: row.keys[0], users: row.measurements.totalUsers })), metadata: reports.map(report => report.metadata), limitations });
}
