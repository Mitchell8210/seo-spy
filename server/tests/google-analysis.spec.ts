import "reflect-metadata";
import { jest } from "@jest/globals";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { configureApp } from "../src/configure-app.js";
import { GoogleReportingModule } from "../src/modules/google/google.module.js";
import { GOOGLE_TOKEN_PROVIDER } from "../src/integrations/google/google-auth.js";
import { GoogleApiError, GoogleTransport } from "../src/integrations/google/google-transport.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";
import { analysisBatch, leadBatch } from "./fixtures/google-analysis.js";
import { leadPolicy } from "../src/integrations/google/google-lead-policy.js";

describe("Local Analysis page Google reporting", () => {
  let app: INestApplication, database: AppDatabase, settings: Record<string, unknown>;
  let post: ReturnType<typeof jest.fn<GoogleTransport["post"]>>;
  const path = "/api/businesses/demo-guzman/analytics";
  const get = () => request(app.getHttpServer()).get(path).set("Host", "localhost:5173");
  const expire = () => database.connection().prepare("UPDATE google_reporting_cache SET expires_at='2020-01-01T00:00:00.000Z'").run();
  beforeEach(async () => {
    settings = { NODE_ENV: "test", DATABASE_PATH: ":memory:", GOOGLE_OPERATOR_KEY: "private-operator-fixture-with-32-characters", GOOGLE_BUSINESS_ID: "demo-guzman", GA4_PROPERTY_ID: "123456789", GSC_SITE_URL: "https://guzmantaxaccounting.com/" };
    settings.GA4_LEAD_EVENT_NAME = "form_submit"; settings.GA4_LEAD_PAGE_PATHS = "/contacto/,/consulta-gratuita/";
    post = jest.fn<GoogleTransport["post"]>().mockImplementation(async (_url, body) => (body as { requests: unknown[] }).requests.length === 2 ? leadBatch() : analysisBatch());
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), GoogleReportingModule] })
      .overrideProvider(ConfigService).useValue(new ConfigService(settings))
      .overrideProvider(GOOGLE_TOKEN_PROVIDER).useValue({ getAccessToken: async () => "private-access-token", authorizationCacheKey: async () => "private-account-fingerprint" })
      .overrideProvider(GoogleTransport).useValue({ post }).compile();
    app = configureApp(module.createNestApplication()); await app.init(); database = app.get(AppDatabase);
  });
  afterEach(async () => { await app.close(); });
  it("provides all page fields with independent totals, actual rates, exact hostname filters and a reusable cache", async () => {
    const first = await get().expect(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body).toMatchObject({ businessId: "demo-guzman", availability: "available", errorCode: null, cache: { hit: false, stale: false },
      data: { totals: { users: 12, sessions: 20, conversions: 5, rate: 25 }, channels: [{ label: "Organic Search", value: 12 }, { label: "Unassigned", value: 8 }],
        devices: [{ label: "desktop", value: 9 }, { label: "mobile", value: 5 }], pages: [{ path: "/", users: 10 }, { path: "/contact", users: 8 }] } });
    expect(first.body.data.daily.map((row: { users: number }) => row.users)).toEqual([9, 9]);
    expect(first.body.data.daily).toHaveLength(2); // No invented zero dates.
    const body = post.mock.calls[0][1] as { requests: Record<string, unknown>[] };
    expect(body.requests).toHaveLength(5);
    for (const report of body.requests) expect(report).toMatchObject({ dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
      dimensionFilter: { filter: { fieldName: "hostName", inListFilter: { values: ["guzmantaxaccounting.com", "www.guzmantaxaccounting.com"] } } } });
    expect(body.requests[4]).toMatchObject({ dimensions: [{ name: "pagePath" }], limit: "5", orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }] });
    const cached = await get().expect(200);
    expect(cached.body.data).toEqual(first.body.data); expect(cached.body.cache.hit).toBe(true); expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][1]).toMatchObject({ requests: [expect.objectContaining({
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }], dimensionFilter: { andGroup: { expressions: [
        expect.objectContaining({ filter: expect.objectContaining({ fieldName: "hostName" }) }),
        { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "form_submit", caseSensitive: true } } },
        { filter: { fieldName: "pagePath", inListFilter: { values: ["/consulta-gratuita/", "/contacto/"], caseSensitive: true } } },
      ] } },
    }), expect.anything()] });
    for (const secret of [String(settings.GOOGLE_OPERATOR_KEY), "private-access-token", "private-account-fingerprint", "private_key", "client_email"]) expect(first.text).not.toContain(secret);
    await request(app.getHttpServer()).get("/api/businesses/demo-guzman/google/ga4").set("Host", "localhost:3001").expect(401);
  });
  it.each([
    ["Host", "attacker.example"], ["Origin", "https://attacker.example"], ["Sec-Fetch-Site", "cross-site"],
    ["X-Forwarded-For", "127.0.0.1"], ["X-Forwarded-Host", "localhost:5173"], ["Forwarded", "for=127.0.0.1"],
  ])("rejects an invalid local read %s before upstream access", async (header, value) => {
    await get().set(header, value).expect(403); expect(post).not.toHaveBeenCalled();
  });
  it("validates configured access and business binding without contacting Google", async () => {
    settings.GOOGLE_BUSINESS_ID = "different"; await get().expect(403);
    settings.GOOGLE_BUSINESS_ID = "demo-guzman"; settings.GSC_SITE_URL = "https://another.example/"; await get().expect(403);
    settings.GOOGLE_OPERATOR_KEY = ""; await get().expect(503); expect(post).not.toHaveBeenCalled();
  });
  it("keeps failures unavailable, negative-caches them and retains historical data without presenting it as current", async () => {
    const first = await get().expect(200); expire();
    post.mockRejectedValueOnce(new GoogleApiError("GOOGLE_PERMISSION_DENIED", "private-google-error"));
    const failure = await get().expect(200);
    expect(failure.body).toMatchObject({ availability: "unavailable", errorCode: "GOOGLE_PERMISSION_DENIED", data: first.body.data, cache: { stale: true } });
    expect(failure.text).not.toContain("private-google-error");
    await get().expect(200); expect(post).toHaveBeenCalledTimes(3);
  });
  it("represents successful empty reports as zero counts, separately from request failures", async () => {
    const batch = analysisBatch(); for (const report of batch.reports) { report.rows = []; report.rowCount = 0; }
    post.mockResolvedValueOnce(batch);
    const response = await get().expect(200);
    expect(response.body).toMatchObject({ availability: "empty", errorCode: null, data: { totals: { users: 0, sessions: 0, conversions: null, rate: null }, daily: [], channels: [], devices: [], pages: [] } });
  });
  it.each(["header", "count", "duplicate", "timezone", "window", "truncated", "missing-report"])("rejects incompatible provider data: %s", async fault => {
    const batch = analysisBatch();
    if (fault === "header") batch.reports[0].metricHeaders[0].name = "activeUsers";
    if (fault === "count") batch.reports[0].rows[0].metricValues[0].value = "NaN";
    if (fault === "duplicate") batch.reports[1].rows[1].dimensionValues[0].value = batch.reports[1].rows[0].dimensionValues[0].value;
    if (fault === "timezone") batch.reports[2].metadata.timeZone = "America/Los_Angeles";
    if (fault === "window") batch.reports[1].rows[0].dimensionValues[0].value = "20200101";
    if (fault === "truncated") batch.reports[2].rowCount = 101;
    if (fault === "missing-report") batch.reports.pop();
    post.mockResolvedValueOnce(batch);
    const response = await get().expect(200);
    expect(response.body).toMatchObject({ availability: "unavailable", data: null, errorCode: "GOOGLE_INVALID_RESPONSE" });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("fails closed on corrupt cache storage without another provider request", async () => {
    await get().expect(200);
    database.connection().prepare("UPDATE google_reporting_cache SET data_json='{}'").run();
    await get().expect(503); expect(post).toHaveBeenCalledTimes(2);
  });
  it.each(["failed", "too-many-users", "inconsistent-days", "thresholded"])("keeps traffic available when lead reporting is %s", async fault => {
    const leads = leadBatch();
    if (fault === "too-many-users") leads.reports[0].rows[0].metricValues[1].value = "15";
    if (fault === "inconsistent-days") leads.reports[1].rows[0].metricValues[0].value = "50";
    if (fault === "thresholded") Object.assign(leads.reports[0].metadata, { subjectToThresholding: true });
    post.mockImplementationOnce(async () => analysisBatch());
    if (fault === "failed") post.mockRejectedValueOnce(new GoogleApiError("GOOGLE_UNAVAILABLE", "private lead failure"));
    else post.mockResolvedValueOnce(leads);
    const response = await get().expect(200);
    expect(response.body).toMatchObject({ availability: "available", data: { totals: { users: 12, sessions: 20, conversions: null, rate: null }, conversion: { status: "unavailable" } } });
    expect(response.body.data.daily.every((row: { conversions: number | null }) => row.conversions === null)).toBe(true);
  });
  it("requires an explicit submission policy and rejects broad engagement events", async () => {
    settings.GA4_LEAD_EVENT_NAME = "";
    const response = await get().expect(200);
    expect(response.body.data).toMatchObject({ totals: { conversions: null, rate: null }, conversion: { reason: "not_configured" } });
    expect(post).toHaveBeenCalledTimes(1);
    for (const event of ["page_view", "scroll", "session_start", "form_start", "click", "contact_link_click"]) expect(leadPolicy(event, "")).toBeNull();
    expect(leadPolicy("form_submit", "")).toBeNull();
    expect(leadPolicy("form_submit", "/contacto/*")).toBeNull();
  });
  it("reports zero recorded submissions for GA4's headerless successful empty query", async () => {
    post.mockImplementationOnce(async () => analysisBatch());
    post.mockResolvedValueOnce({ reports: [{ metadata: { timeZone: "UTC" } }, { dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "eventCount" }], metadata: { timeZone: "UTC" } }] });
    const response = await get().expect(200);
    expect(response.body.data.conversion).toMatchObject({ status: "available", users: 0, reason: "no_recorded_submissions" });
    expect(response.body.data.totals).toMatchObject({ users: 12, conversions: 0, rate: 0 });
    expect(response.body.data.daily.every((row: { conversions: number }) => row.conversions === 0)).toBe(true);
  });
});
