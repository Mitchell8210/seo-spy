import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const limitations = z.array(z.string().max(1000)).max(12);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const availability = z.enum(["available", "empty"]);
const metadataSchema = z.object({
  subjectToThresholding: z.boolean(),
  dataLossFromOtherRow: z.boolean(),
  sampling: z.array(z.object({ samplesReadCount: z.string().regex(/^\d{1,30}$/), samplingSpaceSize: z.string().regex(/^\d{1,30}$/) }).strict()).max(5),
}).strict();

export const FACEBOOK_SESSION_SOURCE_PATTERN = "^(facebook|fb|([a-z0-9-]+\\.)*facebook\\.com)$";
export const ga4FacebookVisitsReportDataSchema = z.object({
  schemaVersion: z.literal("seo-spy.google-ga4-facebook-visits.v1"), provider: z.literal("google-analytics-data"),
  propertyId: z.string().regex(/^[1-9]\d{0,19}$/), collectedAt: z.string().datetime(), availability,
  hostname: z.string().min(1).max(253), sourceDimension: z.literal("sessionSource"),
  attribution: z.literal("facebook-session-source-v1"), sourcePattern: z.literal(FACEBOOK_SESSION_SOURCE_PATTERN),
  dateRange: z.object({ startDate: date, endDate: date, timeZone: z.string().min(1).max(100).nullable() }).strict(),
  sessions: count, metadata: metadataSchema, limitations,
}).strict().superRefine((value, context) => {
  const { startDate, endDate } = value.dateRange;
  const start = Date.parse(`${startDate}T00:00:00.000Z`), end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString().slice(0, 10) !== startDate ||
      new Date(end).toISOString().slice(0, 10) !== endDate || end - start !== 29 * 86400000)
    context.addIssue({ code: "custom", message: "Exactly 30 valid inclusive calendar dates are required." });
});

export const ga4ReportDataSchema = z.object({
  schemaVersion: z.literal("seo-spy.google-ga4.v1"), provider: z.literal("google-analytics-data"),
  propertyId: z.string().regex(/^[1-9]\d{0,19}$/), collectedAt: z.string().datetime(), availability,
  windows: z.array(z.object({
    days: z.union([z.literal(7), z.literal(30)]),
    dateRange: z.object({ startDate: z.enum(["7daysAgo", "30daysAgo"]), endDate: z.literal("yesterday"), timeZone: z.string().min(1).max(100).nullable(), resolvedStartDate: date.nullable(), resolvedEndDate: date.nullable() }).strict(),
    availability, sessions: count, activeUsers: count, pageViews: count,
    metadata: metadataSchema, limitations,
  }).strict()).length(2),
  limitations,
}).strict().superRefine((value, context) => {
  if (value.windows[0]?.days !== 7 || value.windows[1]?.days !== 30 || value.windows.some(window => window.dateRange.startDate !== `${window.days}daysAgo`)) context.addIssue({ code: "custom", message: "The exact independent 7/30-day windows are required." });
});

export const searchConsoleMetricsSchema = z.object({
  clicks: count, impressions: count, ctr: z.number().finite().min(0).max(1).nullable(),
  averagePosition: z.number().finite().nonnegative().nullable(),
}).strict();
export const searchConsoleReportDataSchema = z.object({
  schemaVersion: z.literal("seo-spy.google-search-console.v1"), provider: z.literal("google-search-console"),
  siteUrl: z.string().min(1).max(2048), collectedAt: z.string().datetime(), days: z.union([z.literal(7), z.literal(30)]),
  view: z.enum(["summary", "queries"]),
  dateRange: z.object({ startDate: date, endDate: date, timeZone: z.literal("America/Los_Angeles"), dataState: z.literal("final") }).strict(),
  availability, summary: searchConsoleMetricsSchema.nullable(),
  topQueries: z.array(z.object({ query: z.string().min(1).max(512), ...searchConsoleMetricsSchema.shape }).strict()).max(10),
  queryLimit: z.literal(10).nullable(), limitations,
}).strict().superRefine((value, context) => {
  if (value.view === "queries" && (value.summary !== null || value.queryLimit !== 10)
    || value.view === "summary" && (value.summary === null || value.queryLimit !== null || value.topQueries.length > 0)) context.addIssue({ code: "custom", message: "Query samples and sitewide totals must remain separate." });
});

export type Ga4ReportData = z.infer<typeof ga4ReportDataSchema>;
export type Ga4FacebookVisitsReportData = z.infer<typeof ga4FacebookVisitsReportDataSchema>;
export type SearchConsoleReportData = z.infer<typeof searchConsoleReportDataSchema>;
export type SearchConsoleMetrics = z.infer<typeof searchConsoleMetricsSchema>;
