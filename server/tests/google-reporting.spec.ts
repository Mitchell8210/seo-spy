import "reflect-metadata";
import { jest } from "@jest/globals";
import { GoogleReportingClient, searchConsoleDateRange, validSearchConsoleSite } from "../src/integrations/google/google-reporting.js";
import { ga4ReportDataSchema, searchConsoleReportDataSchema } from "../src/integrations/google/google-reporting.types.js";
import { GoogleApiError, GoogleTransport } from "../src/integrations/google/google-transport.js";
import type { GoogleTokenProvider } from "../src/integrations/google/google-auth.js";

const propertyId = "123456789";
const siteUrl = "https://example.com/";
const report = () => ({ metricHeaders: [{ name: "sessions", type: "TYPE_INTEGER" }, { name: "activeUsers", type: "TYPE_INTEGER" }, { name: "screenPageViews", type: "TYPE_INTEGER" }], rows: [{ metricValues: [{ value: "14" }, { value: "11" }, { value: "22" }] }], rowCount: 1, metadata: { timeZone: "America/Los_Angeles" } });
const metrics = { clicks: 3, impressions: 100, ctr: 0.03, position: 8.4 };

describe("Google reporting clients with controlled offline responses", () => {
  let token: ReturnType<typeof jest.fn<GoogleTokenProvider["getAccessToken"]>>;
  let post: ReturnType<typeof jest.fn<GoogleTransport["post"]>>;
  let client: GoogleReportingClient;
  beforeEach(() => {
    token = jest.fn<GoogleTokenProvider["getAccessToken"]>().mockResolvedValue("private-access-token-fixture");
    post = jest.fn<GoogleTransport["post"]>().mockResolvedValue({ reports: [report(), report()] });
    client = new GoogleReportingClient({ getAccessToken: token, authorizationCacheKey: async () => "fixture-account" }, { post } as unknown as GoogleTransport);
  });
  afterEach(() => { jest.useRealTimers(); });

  it("retrieves both independent GA4 windows in one request, with no dimensions or daily-user summation", async () => {
    const result = await client.ga4(propertyId);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`, {
      requests: [7, 30].map(days => ({ dateRanges: [{ startDate: `${days}daysAgo`, endDate: "yesterday" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }], limit: "1", keepEmptyRows: false })),
    }, { accessToken: "private-access-token-fixture" });
    expect(result.windows.map(window => ({ days: window.days, sessions: window.sessions, activeUsers: window.activeUsers, pageViews: window.pageViews }))).toEqual([{ days: 7, sessions: 14, activeUsers: 11, pageViews: 22 }, { days: 30, sessions: 14, activeUsers: 11, pageViews: 22 }]);
    expect(ga4ReportDataSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private-access-token-fixture");
    expect(result.limitations.some(value => value.includes("screenPageViews"))).toBe(true);
  });
  it("maps GA4 metric headers by name even when the provider changes ordering", async () => {
    const reordered = { ...report(), metricHeaders: [{ name: "screenPageViews" }, { name: "sessions" }, { name: "activeUsers" }], rows: [{ metricValues: [{ value: "42" }, { value: "12" }, { value: "8" }] }] };
    post.mockResolvedValue({ reports: [reordered, report()] });
    expect((await client.ga4(propertyId)).windows[0]).toMatchObject({ sessions: 12, activeUsers: 8, pageViews: 42 });
  });
  it("keeps measured zero separate from an explicitly successful empty GA4 response", async () => {
    const zero = { ...report(), rows: [{ metricValues: [{ value: "0" }, { value: "0" }, { value: "0" }] }] };
    post.mockResolvedValue({ reports: [zero, { ...report(), rows: [], rowCount: 0 }] });
    const result = await client.ga4(propertyId);
    expect(result.windows[0]).toMatchObject({ availability: "available", sessions: 0, activeUsers: 0, pageViews: 0 });
    expect(result.windows[1]).toMatchObject({ availability: "empty", sessions: 0, activeUsers: 0, pageViews: 0 });
    expect(result.availability).toBe("available");
    post.mockResolvedValue({ reports: [{ ...report(), rows: [], rowCount: 0 }, { ...report(), rows: [], rowCount: 0 }] });
    expect((await client.ga4(propertyId)).availability).toBe("empty");
  });
  it("preserves sampling/thresholding limitations without converting them into clean findings", async () => {
    const sampled = { ...report(), metadata: { timeZone: "America/Los_Angeles", subjectToThresholding: true, dataLossFromOtherRow: true, samplingMetadatas: [{ samplesReadCount: "100", samplingSpaceSize: "1000" }], dataTruncationReasons: [{}] } };
    post.mockResolvedValue({ reports: [sampled, report()] });
    const result = await client.ga4(propertyId);
    expect(result.windows[0].metadata).toEqual({ subjectToThresholding: true, dataLossFromOtherRow: true, sampling: [{ samplesReadCount: "100", samplingSpaceSize: "1000" }] });
    expect(result.windows[0].limitations.some(value => value.includes("sampled"))).toBe(true);
    expect(result.windows[0].limitations.some(value => value.includes("thresholding"))).toBe(true);
  });
  it("freezes absolute GA4 calendar boundaries using the property timezone and collection time", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-11-02T07:30:00.000Z"));
    const result = await client.ga4(propertyId);
    expect(result.collectedAt).toBe("2026-11-02T07:30:00.000Z");
    expect(result.windows[0].dateRange).toMatchObject({ startDate: "7daysAgo", resolvedStartDate: "2026-10-25", resolvedEndDate: "2026-10-31", timeZone: "America/Los_Angeles" });
    expect(result.windows[1].dateRange.resolvedStartDate).toBe("2026-10-02");
    post.mockResolvedValue({ reports: [{ ...report(), metadata: { timeZone: "invalid-timezone" } }, { ...report(), metadata: {} }] });
    const missing = await client.ga4(propertyId);
    expect(missing.windows.every(window => window.dateRange.timeZone === null && window.dateRange.resolvedStartDate === null && window.dateRange.resolvedEndDate === null)).toBe(true);
  });
  it.each([
    null,
    { reports: [] },
    { reports: [report()] },
    { reports: [{ ...report(), metricHeaders: [{ name: "sessions" }, { name: "sessions" }, { name: "screenPageViews" }] }, report()] },
    { reports: [{ ...report(), rows: [{ metricValues: [{ value: "9007199254740992" }, { value: "1" }, { value: "1" }] }] }, report()] },
    { reports: [{ ...report(), rows: [{ metricValues: [{ value: "NaN" }, { value: "1" }, { value: "1" }] }] }, report()] },
    { reports: [{ ...report(), rows: [{ metricValues: [{ value: "-1" }, { value: "1" }, { value: "1" }] }] }, report()] },
    { reports: [{ ...report(), rowCount: 5 }, report()] },
    { reports: [{ ...report(), dimensionHeaders: [{ name: "date" }] }, report()] },
    { reports: [{ ...report(), metadata: { samplingMetadatas: [{ samplesReadCount: "100", samplingSpaceSize: "1" }] } }, report()] },
  ])("rejects incompatible GA4 measurements without publishing invented numbers %#", async body => {
    post.mockResolvedValue(body);
    await expect(client.ga4(propertyId)).rejects.toMatchObject({ code: "GOOGLE_INVALID_RESPONSE" });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it.each(["", "0", "properties/123", "123?key=private", "1/../../x", "abc"])("rejects an invalid configured GA4 property before credentials/network: %s", async value => {
    await expect(client.ga4(value)).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
    expect(token).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  });
  it("does not retry a Google permission failure or publish error-body text", async () => {
    post.mockRejectedValue(new GoogleApiError("GOOGLE_PERMISSION_DENIED", "Google denied reporting access.", 403, "PERMISSION_DENIED"));
    await expect(client.ga4(propertyId)).rejects.toMatchObject({ code: "GOOGLE_PERMISSION_DENIED" });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("retrieves actual sitewide Search Console metrics using a dimensionless query", async () => {
    post.mockResolvedValue({ rows: [{ ...metrics }], responseAggregationType: "byProperty" });
    const now = new Date("2026-10-31T14:00:00.000Z");
    const result = await client.searchConsole(siteUrl, 30, "summary", now);
    expect(post).toHaveBeenCalledWith(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { startDate: "2026-10-01", endDate: "2026-10-30", dimensions: [], type: "web", aggregationType: "auto", dataState: "final", rowLimit: 1, startRow: 0 }, { accessToken: "private-access-token-fixture" });
    expect(result.summary).toEqual({ clicks: 3, impressions: 100, ctr: 0.03, averagePosition: 8.4 });
    expect(result.topQueries).toEqual([]);
    expect(result.queryLimit).toBeNull();
    expect(searchConsoleReportDataSchema.safeParse(result).success).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("retrieves bounded top queries and never represents their sample as sitewide totals", async () => {
    post.mockResolvedValue({ rows: [{ keys: ["tax help"], ...metrics }, { keys: ["contabilidad en español"], clicks: 0, impressions: 4, ctr: 0, position: 21.5 }] });
    const result = await client.searchConsole("sc-domain:example.com", 7, "queries", new Date("2026-10-31T14:00:00.000Z"));
    expect(result.summary).toBeNull();
    expect(result.topQueries).toEqual([{ query: "tax help", clicks: 3, impressions: 100, ctr: 0.03, averagePosition: 8.4 }, { query: "contabilidad en español", clicks: 0, impressions: 4, ctr: 0, averagePosition: 21.5 }]);
    expect(post.mock.calls[0][1]).toMatchObject({ dimensions: ["query"], rowLimit: 10 });
    expect(result.limitations.some(value => value.includes("not sitewide totals"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private-access-token-fixture");
  });
  it("represents empty Search Console responses without fabricating CTR or ranking", async () => {
    post.mockResolvedValue({});
    const empty = await client.searchConsole(siteUrl, 7, "summary");
    expect(empty).toMatchObject({ availability: "empty", summary: { clicks: 0, impressions: 0, ctr: null, averagePosition: null } });
    const queries = await client.searchConsole(siteUrl, 7, "queries");
    expect(queries).toMatchObject({ availability: "empty", summary: null, topQueries: [] });
    post.mockResolvedValue({ rows: [{ clicks: 0, impressions: 10, ctr: 0, position: 8 }] });
    expect((await client.searchConsole(siteUrl, 7, "summary")).summary?.ctr).toBe(0);
  });
  it.each([
    { rows: "invalid" },
    { rows: [{ ...metrics, clicks: -1 }] },
    { rows: [{ ...metrics, ctr: 1.5 }] },
    { rows: [{ ...metrics, position: Number.NaN }] },
    { rows: [{ ...metrics, impressions: "100" }] },
    { rows: [{ keys: ["unexpected dimension"], ...metrics }] },
    { rows: [{ ...metrics }, { ...metrics }] },
  ])("rejects invalid Search Console summary contracts %#", async body => {
    post.mockResolvedValue(body);
    await expect(client.searchConsole(siteUrl, 7, "summary")).rejects.toMatchObject({ code: "GOOGLE_INVALID_RESPONSE" });
  });
  it.each([
    { rows: [{ ...metrics }] },
    { rows: [{ ...metrics, keys: [] }] },
    { rows: [{ ...metrics, keys: ["x", "y"] }] },
    { rows: [{ ...metrics, keys: [""] }] },
    { rows: [{ ...metrics, keys: ["x".repeat(513)] }] },
    { rows: [{ ...metrics, keys: ["duplicate"] }, { ...metrics, keys: ["duplicate"] }] },
    { rows: Array.from({ length: 11 }, (_, index) => ({ ...metrics, keys: [`query-${index}`] })) },
  ])("rejects invalid Search Console query samples %#", async body => {
    post.mockResolvedValue(body);
    await expect(client.searchConsole(siteUrl, 7, "queries")).rejects.toMatchObject({ code: "GOOGLE_INVALID_RESPONSE" });
  });
  it.each(["https://user:private@example.com/", "https://example.com/?secret=x", "https://example.com/#x", "https://example.com:444/", "file:///private", "https://localhost/", "sc-domain:example.com/private", "sc-domain:bad host", ""])("rejects invalid Search Console targets before authentication: %s", async target => {
    await expect(client.searchConsole(target, 7, "queries")).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
    expect(token).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  });
  it("supports exact URL-prefix and domain properties without silently changing the supplied asset", async () => {
    expect(validSearchConsoleSite("https://example.com/blog/")).toBe(true);
    expect(validSearchConsoleSite("sc-domain:example.com")).toBe(true);
    post.mockResolvedValue({ rows: [] });
    await client.searchConsole("https://example.com/blog/", 7, "queries");
    expect(post.mock.calls[0][0]).toContain(encodeURIComponent("https://example.com/blog/"));
  });
  it("computes Pacific calendar ranges across DST and UTC date boundaries", () => {
    expect(searchConsoleDateRange(7, new Date("2026-11-01T08:30:00.000Z"))).toMatchObject({ startDate: "2026-10-25", endDate: "2026-10-31" });
    expect(searchConsoleDateRange(7, new Date("2026-11-01T09:30:00.000Z"))).toMatchObject({ startDate: "2026-10-25", endDate: "2026-10-31" });
    expect(searchConsoleDateRange(7, new Date("2026-03-08T09:30:00.000Z"))).toMatchObject({ startDate: "2026-03-01", endDate: "2026-03-07" });
    expect(searchConsoleDateRange(7, new Date("2026-03-08T10:30:00.000Z"))).toMatchObject({ startDate: "2026-03-01", endDate: "2026-03-07" });
    expect(searchConsoleDateRange(30, new Date("2026-01-01T07:30:00.000Z"))).toMatchObject({ startDate: "2025-12-01", endDate: "2025-12-30" });
  });
});
