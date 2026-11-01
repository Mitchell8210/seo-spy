import "reflect-metadata";
import { jest } from "@jest/globals";
import { FACEBOOK_SESSION_SOURCE_PATTERN, GoogleReportingClient } from "../src/integrations/google/google-reporting.js";
import { ga4FacebookVisitsReportDataSchema } from "../src/integrations/google/google-reporting.types.js";
import type { GoogleTokenProvider } from "../src/integrations/google/google-auth.js";
import { GoogleApiError, GoogleTransport } from "../src/integrations/google/google-transport.js";

const report = () => ({ metricHeaders: [{ name: "sessions", type: "TYPE_INTEGER" }], rows: [{ metricValues: [{ value: "8" }] }], rowCount: 1,
  metadata: { timeZone: "America/Los_Angeles" } });
const startDate = "2026-10-02", endDate = "2026-10-31";
describe("Facebook-attributed GA4 website visits", () => {
  let token: ReturnType<typeof jest.fn<GoogleTokenProvider["getAccessToken"]>>;
  let post: ReturnType<typeof jest.fn<GoogleTransport["post"]>>;
  let client: GoogleReportingClient;
  beforeEach(() => {
    token = jest.fn<GoogleTokenProvider["getAccessToken"]>().mockResolvedValue("private-token-fixture");
    post = jest.fn<GoogleTransport["post"]>().mockResolvedValue({ reports: [report()] });
    client = new GoogleReportingClient({ getAccessToken: token, authorizationCacheKey: async () => "fixture" }, { post } as unknown as GoogleTransport);
  });
  it("requests one exact 30-day sessions total with Facebook session-source and bound hostname filters", async () => {
    const result = await client.ga4FacebookVisits("123", startDate, endDate, "WWW.Example.com");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("https://analyticsdata.googleapis.com/v1beta/properties/123:batchRunReports", {
      requests: [{ dateRanges: [{ startDate, endDate }], metrics: [{ name: "sessions" }],
        dimensionFilter: { andGroup: { expressions: [
          { filter: { fieldName: "sessionSource", stringFilter: { matchType: "FULL_REGEXP", value: FACEBOOK_SESSION_SOURCE_PATTERN, caseSensitive: false } } },
          { filter: { fieldName: "hostName", inListFilter: { values: ["example.com", "www.example.com"], caseSensitive: false } } },
        ] } }, limit: "1", keepEmptyRows: false }],
    }, { accessToken: "private-token-fixture" });
    expect(result).toMatchObject({ sessions: 8, hostname: "example.com", attribution: "facebook-session-source-v1", sourceDimension: "sessionSource",
      dateRange: { startDate, endDate, timeZone: "America/Los_Angeles" }, availability: "available" });
    expect(ga4FacebookVisitsReportDataSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private-token-fixture");
  });
  it("matches only declared source aliases/domains, not lookalikes or unrelated social sources", () => {
    const source = new RegExp(FACEBOOK_SESSION_SOURCE_PATTERN, "i");
    for (const value of ["facebook", "Facebook", "fb", "FB", "facebook.com", "l.facebook.com", "lm.facebook.com", "m.facebook.com", "web.facebook.com"]) expect(source.test(value)).toBe(true);
    for (const value of ["notfacebook.com", "facebook.com.evil.test", "instagram", "organic_social", "firstUserFacebook", "facebook-ads", "facebook.com/path"]) expect(source.test(value)).toBe(false);
  });
  it.each([
    ["../123", startDate, endDate, "example.com"], ["123", "2026-02-30", "2026-03-31", "example.com"],
    ["123", startDate, "2026-10-30", "example.com"], ["123", endDate, startDate, "example.com"],
    ["123", startDate, endDate, "https://example.com"], ["123", startDate, endDate, "localhost"],
    ["123", startDate, endDate, "127.0.0.1"], ["123", startDate, endDate, "example.com/path"],
  ])("rejects invalid asset/date/hostname before credential access %#", async (property, start, end, hostname) => {
    await expect(client.ga4FacebookVisits(property, start, end, hostname)).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
    expect(token).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  });
  it("accepts leap-day calendar arithmetic and preserves independently configured property timezone", async () => {
    post.mockResolvedValue({ reports: [{ ...report(), metadata: { timeZone: "America/New_York" } }] });
    const result = await client.ga4FacebookVisits("123", "2024-02-01", "2024-03-01", "example.com");
    expect(result.dateRange).toEqual({ startDate: "2024-02-01", endDate: "2024-03-01", timeZone: "America/New_York" });
  });
  it("keeps measured zero and a successful empty result distinct from provider/access failures", async () => {
    post.mockResolvedValue({ reports: [{ ...report(), rows: [{ metricValues: [{ value: "0" }] }] }] });
    expect(await client.ga4FacebookVisits("123", startDate, endDate, "example.com")).toMatchObject({ sessions: 0, availability: "available" });
    post.mockResolvedValue({ reports: [{ ...report(), rows: [], rowCount: 0 }] });
    expect(await client.ga4FacebookVisits("123", startDate, endDate, "example.com")).toMatchObject({ sessions: 0, availability: "empty" });
    post.mockRejectedValue(new GoogleApiError("GOOGLE_PERMISSION_DENIED", "Safe failure"));
    await expect(client.ga4FacebookVisits("123", startDate, endDate, "example.com")).rejects.toMatchObject({ code: "GOOGLE_PERMISSION_DENIED" });
  });
  it("retains sampling, thresholding and data-loss caveats without claiming exact unfiltered traffic", async () => {
    post.mockResolvedValue({ reports: [{ ...report(), metadata: { timeZone: "America/Los_Angeles", subjectToThresholding: true, dataLossFromOtherRow: true,
      samplingMetadatas: [{ samplesReadCount: "10", samplingSpaceSize: "100" }], dataTruncationReasons: [{}], schemaRestrictionResponse: {} } }] });
    const result = await client.ga4FacebookVisits("123", startDate, endDate, "example.com");
    expect(result.metadata).toEqual({ subjectToThresholding: true, dataLossFromOtherRow: true, sampling: [{ samplesReadCount: "10", samplingSpaceSize: "100" }] });
    expect(result.limitations.join(" ")).toMatch(/thresholding/);
    expect(result.limitations.join(" ")).toMatch(/sampled/);
    expect(result.limitations.join(" ")).toMatch(/truncation/);
    expect(result.limitations.join(" ")).toMatch(/particular Facebook Page/);
  });
  it("retains unknown timezone instead of inventing period compatibility", async () => {
    for (const metadata of [{}, { timeZone: "not-a-timezone" }]) {
      post.mockResolvedValue({ reports: [{ ...report(), metadata }] });
      expect((await client.ga4FacebookVisits("123", startDate, endDate, "example.com")).dateRange.timeZone).toBeNull();
    }
  });
  it.each([
    { reports: [] }, { reports: [report(), report()] }, { reports: [{ ...report(), error: {} }] },
    { reports: [{ ...report(), metricHeaders: [{ name: "activeUsers" }] }] },
    { reports: [{ ...report(), metricHeaders: [{ name: "sessions" }, { name: "sessions" }] }] },
    { reports: [{ ...report(), dimensionHeaders: [{ name: "sessionSource" }] }] },
    { reports: [{ ...report(), rows: [{ metricValues: [{ value: "1" }], dimensionValues: [{ value: "facebook" }] }] }] },
    { reports: [{ ...report(), rows: [{ metricValues: [{ value: "-1" }] }] }] },
    { reports: [{ ...report(), rows: [{ metricValues: [{ value: "1.5" }] }] }] },
    { reports: [{ ...report(), rows: [{ metricValues: [{ value: "9007199254740992" }] }] }] },
    { reports: [{ ...report(), rowCount: 2 }] },
    { reports: [{ ...report(), metadata: { subjectToThresholding: "true" } }] },
    { reports: [{ ...report(), metadata: { samplingMetadatas: [{ samplesReadCount: "100", samplingSpaceSize: "10" }] } }] },
  ])("rejects incompatible reporting responses without invented totals %#", async value => {
    post.mockResolvedValue(value);
    await expect(client.ga4FacebookVisits("123", startDate, endDate, "example.com")).rejects.toMatchObject({ code: "GOOGLE_INVALID_RESPONSE" });
  });
});
