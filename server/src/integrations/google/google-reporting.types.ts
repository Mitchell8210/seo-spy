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
export type SearchConsoleReportData = z.infer<typeof searchConsoleReportDataSchema>;
export type SearchConsoleMetrics = z.infer<typeof searchConsoleMetricsSchema>;
