import { Inject, Injectable } from "@nestjs/common";
import { GOOGLE_TOKEN_PROVIDER, type GoogleTokenProvider } from "./google-auth.js";
import { GoogleApiError, GoogleTransport } from "./google-transport.js";
import { collectGoogleAnalysis } from "./google-analysis.js";
import type { Ga4LeadPolicy } from "./google-lead-policy.js";
import { FACEBOOK_SESSION_SOURCE_PATTERN, ga4FacebookVisitsReportDataSchema, ga4ReportDataSchema, searchConsoleReportDataSchema, type Ga4FacebookVisitsReportData, type Ga4ReportData, type SearchConsoleMetrics, type SearchConsoleReportData } from "./google-reporting.types.js";

export { FACEBOOK_SESSION_SOURCE_PATTERN } from "./google-reporting.types.js";

const object = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const invalid = () => new GoogleApiError("GOOGLE_INVALID_RESPONSE", "Google returned an incompatible reporting response; no metrics were invented.");
const configured = () => new GoogleApiError("GOOGLE_NOT_CONFIGURED", "The configured Google reporting asset or date range is invalid.");
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const metrics = ["sessions", "activeUsers", "screenPageViews"] as const;

function metricCount(value: unknown): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw invalid();
  const result = Number(value);
  if (!integer(result)) throw invalid();
  return result;
}

function calendarRange(days: number, now: Date, timeZone: string): { startDate: string; endDate: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  const midnight = Date.parse(`${part("year")}-${part("month")}-${part("day")}T00:00:00.000Z`);
  return { startDate: new Date(midnight - days * 86400000).toISOString().slice(0, 10), endDate: new Date(midnight - 86400000).toISOString().slice(0, 10) };
}

function ga4Window(value: unknown, days: 7 | 30, collectedAt: string): Ga4ReportData["windows"][number] {
  const report = object(value);
  if (!report || report.error || !Array.isArray(report.metricHeaders) || report.metricHeaders.length !== 3
    || report.dimensionHeaders !== undefined && (!Array.isArray(report.dimensionHeaders) || report.dimensionHeaders.length !== 0)) throw invalid();
  const names = report.metricHeaders.map(header => object(header)?.name);
  if (new Set(names).size !== 3 || metrics.some(name => !names.includes(name))) throw invalid();
  const rows: unknown[] = report.rows === undefined ? [] : Array.isArray(report.rows) ? report.rows : (() => { throw invalid(); })();
  if (rows.length > 1 || report.rowCount !== undefined && (!integer(report.rowCount) || report.rowCount !== rows.length)) throw invalid();
  const rawMetadata = report.metadata === undefined ? {} : object(report.metadata);
  if (!rawMetadata) throw invalid();
  for (const key of ["subjectToThresholding", "dataLossFromOtherRow"]) if (rawMetadata[key] !== undefined && typeof rawMetadata[key] !== "boolean") throw invalid();
  if (rawMetadata.timeZone !== undefined && (typeof rawMetadata.timeZone !== "string" || !rawMetadata.timeZone || rawMetadata.timeZone.length > 100)) throw invalid();
  const sampling = rawMetadata.samplingMetadatas === undefined ? [] : rawMetadata.samplingMetadatas;
  if (!Array.isArray(sampling) || sampling.length > 5) throw invalid();
  const normalizedSampling = sampling.map(value => {
    const sample = object(value);
    if (!sample || typeof sample.samplesReadCount !== "string" || typeof sample.samplingSpaceSize !== "string"
      || !/^\d{1,30}$/.test(sample.samplesReadCount) || !/^\d{1,30}$/.test(sample.samplingSpaceSize)
      || BigInt(sample.samplesReadCount) > BigInt(sample.samplingSpaceSize)) throw invalid();
    return { samplesReadCount: sample.samplesReadCount, samplingSpaceSize: sample.samplingSpaceSize };
  });
  const metadata = { subjectToThresholding: rawMetadata.subjectToThresholding === true, dataLossFromOtherRow: rawMetadata.dataLossFromOtherRow === true, sampling: normalizedSampling };
  const limitations = ["Totals cover one property-relative date range, excluding today. Active users are measured for the range and are never summed from daily users."];
  let timeZone: string | null = typeof rawMetadata.timeZone === "string" ? rawMetadata.timeZone : null;
  let resolved: { startDate: string; endDate: string } | null = null;
  if (timeZone) {
    try { resolved = calendarRange(days, new Date(collectedAt), timeZone); }
    catch { timeZone = null; }
  }
  if (!resolved) limitations.push("A usable property timezone was not established; absolute dates remain unknown and Google evaluates the requested relative dates.");
  else limitations.push("Absolute dates are resolved at the recorded collection time in the reported property timezone; Google evaluates relative dates when processing the request.");
  if (metadata.subjectToThresholding) limitations.push("Google reported privacy thresholding; returned values may omit suppressed data.");
  if (metadata.dataLossFromOtherRow) limitations.push("Google reported high-cardinality aggregation/data loss in the report source.");
  if (normalizedSampling.some(sample => BigInt(sample.samplesReadCount) < BigInt(sample.samplingSpaceSize))) limitations.push("Google reported sampled event data; these values are not an unsampled census.");
  if (Array.isArray(rawMetadata.dataTruncationReasons) && rawMetadata.dataTruncationReasons.length) limitations.push("Google reported report-data truncation; coverage is limited.");
  if (object(rawMetadata.schemaRestrictionResponse)) limitations.push("Google returned schema-restriction metadata; returned metric visibility may be restricted.");
  const values: Record<string, number> = { sessions: 0, activeUsers: 0, screenPageViews: 0 };
  if (rows.length) {
    const row = object(rows[0]);
    if (!row || !Array.isArray(row.metricValues) || row.metricValues.length !== 3 || row.dimensionValues !== undefined && (!Array.isArray(row.dimensionValues) || row.dimensionValues.length !== 0)) throw invalid();
    const metricValues = row.metricValues;
    names.forEach((name, index) => { values[String(name)] = metricCount(object(metricValues[index])?.value); });
  } else limitations.push("Google returned no rows for this range. Zero counts describe the successful empty response, not a failed or unavailable request.");
  return { days, dateRange: { startDate: `${days}daysAgo`, endDate: "yesterday", timeZone, resolvedStartDate: resolved?.startDate ?? null, resolvedEndDate: resolved?.endDate ?? null }, availability: rows.length ? "available" : "empty", sessions: values.sessions, activeUsers: values.activeUsers, pageViews: values.screenPageViews, metadata, limitations };
}

export function validSearchConsoleSite(input: string): boolean {
  if (typeof input !== "string" || !input || input.length > 2048 || /[\s\\]/.test(input)) return false;
  if (input.startsWith("sc-domain:")) return /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9-]{2,63}$/.test(input.slice(10));
  try {
    const url = new URL(input);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.port && !url.search && !url.hash && url.hostname !== "localhost" && !url.hostname.endsWith(".localhost") && url.hostname.includes(".");
  } catch { return false; }
}

/** Search Console reports dates in Pacific time; perform calendar arithmetic rather than elapsed local hours. */
export function searchConsoleDateRange(days: 7 | 30, now = new Date()): SearchConsoleReportData["dateRange"] {
  if (![7, 30].includes(days) || !Number.isFinite(now.getTime())) throw configured();
  return { ...calendarRange(days, now, "America/Los_Angeles"), timeZone: "America/Los_Angeles", dataState: "final" };
}

function searchMetrics(value: unknown): SearchConsoleMetrics {
  const row = object(value);
  if (!row || !integer(row.clicks) || !integer(row.impressions) || typeof row.ctr !== "number" || !Number.isFinite(row.ctr) || row.ctr < 0 || row.ctr > 1 || typeof row.position !== "number" || !Number.isFinite(row.position) || row.position < 0) throw invalid();
  return { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, averagePosition: row.position };
}

@Injectable()
export class GoogleReportingClient {
  constructor(@Inject(GOOGLE_TOKEN_PROVIDER) private readonly auth: GoogleTokenProvider, private readonly transport: GoogleTransport) {}

  analysis(propertyId: string, hostname: string, policy: Ga4LeadPolicy | null = null) { return collectGoogleAnalysis(this.auth, this.transport, propertyId, hostname, policy); }

  async ga4FacebookVisits(propertyId: string, startDate: string, endDate: string, hostname: string): Promise<Ga4FacebookVisitsReportData> {
    if (typeof propertyId !== "string" || !/^[1-9]\d{0,19}$/.test(propertyId) ||
        typeof startDate !== "string" || typeof endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw configured();
    const start = Date.parse(`${startDate}T00:00:00.000Z`), end = Date.parse(`${endDate}T00:00:00.000Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString().slice(0, 10) !== startDate ||
        new Date(end).toISOString().slice(0, 10) !== endDate || end - start !== 29 * 86400000 ||
        typeof hostname !== "string" || hostname.length > 253 ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)) throw configured();
    const normalizedHostname = hostname.toLowerCase().replace(/^www\./, "");
    const accessToken = await this.auth.getAccessToken();
    const collectedAt = new Date().toISOString();
    const raw = object(await this.transport.post(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`, {
      requests: [{ dateRanges: [{ startDate, endDate }], metrics: [{ name: "sessions" }],
        dimensionFilter: { andGroup: { expressions: [
          { filter: { fieldName: "sessionSource", stringFilter: { matchType: "FULL_REGEXP", value: FACEBOOK_SESSION_SOURCE_PATTERN, caseSensitive: false } } },
          { filter: { fieldName: "hostName", inListFilter: { values: [normalizedHostname, `www.${normalizedHostname}`], caseSensitive: false } } },
        ] } }, limit: "1", keepEmptyRows: false }],
    }, { accessToken }));
    if (!raw || raw.error || !Array.isArray(raw.reports) || raw.reports.length !== 1) throw invalid();
    const report = object(raw.reports[0]);
    if (!report || report.error || !Array.isArray(report.metricHeaders) || report.metricHeaders.length !== 1 || object(report.metricHeaders[0])?.name !== "sessions" ||
        report.dimensionHeaders !== undefined && (!Array.isArray(report.dimensionHeaders) || report.dimensionHeaders.length !== 0)) throw invalid();
    const rows: unknown[] = report.rows === undefined ? [] : Array.isArray(report.rows) ? report.rows : (() => { throw invalid(); })();
    if (rows.length > 1 || report.rowCount !== undefined && (!integer(report.rowCount) || report.rowCount !== rows.length)) throw invalid();
    let sessions = 0;
    if (rows.length) {
      const row = object(rows[0]);
      if (!row || !Array.isArray(row.metricValues) || row.metricValues.length !== 1 ||
          row.dimensionValues !== undefined && (!Array.isArray(row.dimensionValues) || row.dimensionValues.length !== 0)) throw invalid();
      sessions = metricCount(object(row.metricValues[0])?.value);
    }
    const metadata = report.metadata === undefined ? {} : object(report.metadata);
    if (!metadata) throw invalid();
    for (const key of ["subjectToThresholding", "dataLossFromOtherRow"]) if (metadata[key] !== undefined && typeof metadata[key] !== "boolean") throw invalid();
    if (metadata.timeZone !== undefined && (typeof metadata.timeZone !== "string" || !metadata.timeZone || metadata.timeZone.length > 100)) throw invalid();
    let timeZone = typeof metadata.timeZone === "string" ? metadata.timeZone : null;
    if (timeZone) try { new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(collectedAt)); } catch { timeZone = null; }
    const sampling = metadata.samplingMetadatas ?? [];
    if (!Array.isArray(sampling) || sampling.length > 5) throw invalid();
    const normalizedSampling = sampling.map(value => {
      const sample = object(value);
      if (!sample || typeof sample.samplesReadCount !== "string" || typeof sample.samplingSpaceSize !== "string" ||
          !/^\d{1,30}$/.test(sample.samplesReadCount) || !/^\d{1,30}$/.test(sample.samplingSpaceSize) ||
          BigInt(sample.samplesReadCount) > BigInt(sample.samplingSpaceSize)) throw invalid();
      return { samplesReadCount: sample.samplesReadCount, samplingSpaceSize: sample.samplingSpaceSize };
    });
    const limitations = ["Counts GA4 sessions attributed to matching Facebook session sources, not Facebook link clicks, unique people or individual messages.",
      "Includes paid and organic Facebook sources matching the declared filter; cannot identify clicks from a particular Facebook Page or untracked visits.",
      "Only sessions including the configured website hostname or its www alias are included. Dates use the GA4 property timezone; matching another reporting window requires timezone compatibility."];
    if (!timeZone) limitations.push("A usable GA4 property timezone was not established; date-window compatibility is unknown.");
    if (!rows.length) limitations.push("The successful Google response contained no matching rows; its session count is zero, not an access failure.");
    if (metadata.subjectToThresholding === true) limitations.push("Google reported privacy thresholding; returned values may omit suppressed data.");
    if (metadata.dataLossFromOtherRow === true) limitations.push("Google reported high-cardinality aggregation/data loss in the report source.");
    if (normalizedSampling.some(sample => BigInt(sample.samplesReadCount) < BigInt(sample.samplingSpaceSize))) limitations.push("Google reported sampled event data; these values are not an unsampled census.");
    if (metadata.dataTruncationReasons !== undefined && !Array.isArray(metadata.dataTruncationReasons)) throw invalid();
    if (Array.isArray(metadata.dataTruncationReasons) && metadata.dataTruncationReasons.length) limitations.push("Google reported report-data truncation; coverage is limited.");
    if (object(metadata.schemaRestrictionResponse)) limitations.push("Google returned schema-restriction metadata; metric visibility may be restricted.");
    return ga4FacebookVisitsReportDataSchema.parse({ schemaVersion: "seo-spy.google-ga4-facebook-visits.v1", provider: "google-analytics-data",
      propertyId, collectedAt, availability: rows.length ? "available" : "empty", hostname: normalizedHostname,
      sourceDimension: "sessionSource", attribution: "facebook-session-source-v1", sourcePattern: FACEBOOK_SESSION_SOURCE_PATTERN,
      dateRange: { startDate, endDate, timeZone }, sessions,
      metadata: { subjectToThresholding: metadata.subjectToThresholding === true, dataLossFromOtherRow: metadata.dataLossFromOtherRow === true, sampling: normalizedSampling }, limitations });
  }

  async ga4(propertyId: string): Promise<Ga4ReportData> {
    if (typeof propertyId !== "string" || !/^[1-9]\d{0,19}$/.test(propertyId)) throw configured();
    const accessToken = await this.auth.getAccessToken();
    const collectedAt = new Date().toISOString();
    const value = object(await this.transport.post(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`, {
      requests: ([7, 30] as const).map(days => ({ dateRanges: [{ startDate: `${days}daysAgo`, endDate: "yesterday" }], metrics: metrics.map(name => ({ name })), limit: "1", keepEmptyRows: false })),
    }, { accessToken }));
    if (!value || !Array.isArray(value.reports) || value.reports.length !== 2) throw invalid();
    const windows = [ga4Window(value.reports[0], 7, collectedAt), ga4Window(value.reports[1], 30, collectedAt)];
    return ga4ReportDataSchema.parse({ schemaVersion: "seo-spy.google-ga4.v1", provider: "google-analytics-data", propertyId, collectedAt, availability: windows.every(window => window.availability === "empty") ? "empty" : "available", windows,
      limitations: ["The 7/30-day ranges overlap and must not be added together.", "pageViews uses GA4 screenPageViews, which counts web page views and app screen views in the selected property. It is not people reached or a search metric.", "These are stored Google Analytics measurements, not an SEO Spy score, ranking guarantee or AI assessment."] });
  }

  async searchConsole(siteUrl: string, days: 7 | 30, view: "summary" | "queries", now = new Date()): Promise<SearchConsoleReportData> {
    if (!validSearchConsoleSite(siteUrl) || !["summary", "queries"].includes(view)) throw configured();
    const dateRange = searchConsoleDateRange(days, now);
    const accessToken = await this.auth.getAccessToken();
    const value = object(await this.transport.post(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      startDate: dateRange.startDate, endDate: dateRange.endDate, dimensions: view === "queries" ? ["query"] : [], type: "web", aggregationType: "auto", dataState: "final", rowLimit: view === "queries" ? 10 : 1, startRow: 0,
    }, { accessToken }));
    if (!value || value.error || value.rows !== undefined && !Array.isArray(value.rows)) throw invalid();
    const rows: unknown[] = Array.isArray(value.rows) ? value.rows : [];
    if (rows.length > (view === "queries" ? 10 : 1)) throw invalid();
    const limitations = ["Only finalized web-search data is requested; recent days can be delayed or omitted. An empty response does not establish that a site has no search traffic.", "CTR is a ratio from 0 to 1, not a percentage. Average position is a Google aggregate, not an exact ranking for every query."];
    let summary: SearchConsoleMetrics | null = null;
    const topQueries: SearchConsoleReportData["topQueries"] = [];
    if (view === "summary") {
      if (rows.length && object(rows[0])?.keys !== undefined && (!Array.isArray(object(rows[0])!.keys) || (object(rows[0])!.keys as unknown[]).length)) throw invalid();
      summary = rows.length ? searchMetrics(rows[0]) : { clicks: 0, impressions: 0, ctr: null, averagePosition: null };
      limitations.push("Summary values come from a separate unfiltered, dimensionless property query; they are never inferred by adding top-query rows.");
    } else {
      const seen = new Set<string>();
      for (const value of rows) {
        const row = object(value);
        if (!row || !Array.isArray(row.keys) || row.keys.length !== 1 || typeof row.keys[0] !== "string" || !row.keys[0] || row.keys[0].length > 512 || seen.has(row.keys[0])) throw invalid();
        seen.add(row.keys[0]);
        topQueries.push({ query: row.keys[0], ...searchMetrics(row) });
      }
      limitations.push("At most 10 top query rows are returned in Google's click order. Privacy filtering and Search Console's internal limits omit queries; these rows are not sitewide totals. No sitewide summary is included in this view.");
    }
    return searchConsoleReportDataSchema.parse({ schemaVersion: "seo-spy.google-search-console.v1", provider: "google-search-console", siteUrl, collectedAt: new Date().toISOString(), days, view, dateRange, availability: rows.length ? "available" : "empty", summary, topQueries, queryLimit: view === "queries" ? 10 : null, limitations });
  }
}
