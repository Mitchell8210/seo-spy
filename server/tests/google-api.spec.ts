import "reflect-metadata";
import { jest } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { configureApp } from "../src/configure-app.js";
import { GoogleReportingModule } from "../src/modules/google/google.module.js";
import { GOOGLE_TOKEN_PROVIDER, type GoogleTokenProvider } from "../src/integrations/google/google-auth.js";
import { GoogleApiError, GoogleTransport } from "../src/integrations/google/google-transport.js";
import { AppDatabase } from "../src/persistence/sqlite/app-database.js";

const businessId = "demo-guzman";
const prefix = `/api/businesses/${businessId}/google`;
const operator = "private-google-operator-fixture-at-least-32-characters";
const propertyId = "123456789";
const siteUrl = "https://guzmantaxaccounting.com/";
const ga4Report = () => ({ metricHeaders: [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }], rows: [{ metricValues: [{ value: "21" }, { value: "17" }, { value: "30" }] }], rowCount: 1, metadata: { timeZone: "America/Los_Angeles" } });

describe("Google reporting HTTP integration with offline fixtures and real SQLite", () => {
  let app: INestApplication;
  let database: AppDatabase;
  let settings: Record<string, unknown>;
  let post: ReturnType<typeof jest.fn<GoogleTransport["post"]>>;
  let getAccessToken: ReturnType<typeof jest.fn<GoogleTokenProvider["getAccessToken"]>>;
  let authorizationCacheKey: ReturnType<typeof jest.fn<GoogleTokenProvider["authorizationCacheKey"]>>;
  const get = (path: string, token = operator) => request(app.getHttpServer()).get(path).set("Host", "localhost:3001").set("Authorization", `Bearer ${token}`);
  const expire = () => database.connection().prepare("UPDATE google_reporting_cache SET expires_at=?").run("2020-01-01T00:00:00.000Z");

  beforeEach(async () => {
    settings = { NODE_ENV: "test", DATABASE_PATH: ":memory:", GOOGLE_OPERATOR_KEY: operator, GOOGLE_BUSINESS_ID: businessId, GA4_PROPERTY_ID: propertyId, GSC_SITE_URL: siteUrl, GOOGLE_CACHE_TTL_SECONDS: 900, GOOGLE_ERROR_CACHE_TTL_SECONDS: 60, MOCK_AI: true, AI_ENABLED: false };
    getAccessToken = jest.fn<GoogleTokenProvider["getAccessToken"]>().mockResolvedValue("private-google-access-token");
    authorizationCacheKey = jest.fn<GoogleTokenProvider["authorizationCacheKey"]>().mockResolvedValue("private-account-fingerprint");
    post = jest.fn<GoogleTransport["post"]>().mockImplementation(async (url, body) => {
      if (url.includes("analyticsdata.googleapis.com")) return { reports: [ga4Report(), ga4Report()] };
      const dimensions = (body as { dimensions?: string[] }).dimensions;
      return { rows: dimensions?.length ? [{ keys: ["tax accounting"], clicks: 3, impressions: 80, ctr: 0.0375, position: 6.5 }] : [{ clicks: 10, impressions: 200, ctr: 0.05, position: 8.2 }] };
    });
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), GoogleReportingModule] })
      .overrideProvider(ConfigService).useValue(new ConfigService(settings))
      .overrideProvider(GOOGLE_TOKEN_PROVIDER).useValue({ getAccessToken, authorizationCacheKey })
      .overrideProvider(GoogleTransport).useValue({ post }).compile();
    app = configureApp(module.createNestApplication());
    app.useLogger(false);
    await app.init();
    database = app.get(AppDatabase);
  });
  afterEach(async () => { await app.close(); });

  it("returns both GA4 periods through a single batch and persists/cache-serves the original report", async () => {
    const first = await get(`${prefix}/ga4`).expect(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body).toMatchObject({ businessId, provider: "ga4", authentication: "service_account", asset: propertyId, availability: "available", error: null, cache: { hit: false, stale: false } });
    expect(first.body.data.windows).toEqual([7, 30].map(days => expect.objectContaining({ days, sessions: 21, activeUsers: 17, pageViews: 30 })));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toMatchObject({ requests: [7, 30].map(days => ({ dateRanges: [{ startDate: `${days}daysAgo`, endDate: "yesterday" }], metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }] })) });
    const second = await get(`${prefix}/ga4`).expect(200);
    expect(second.body.cache.hit).toBe(true);
    expect(second.body.data).toEqual(first.body.data);
    expect(second.body.fetchedAt).toBe(first.body.fetchedAt);
    expect(second.body.lastAttemptAt).toBe(first.body.lastAttemptAt);
    expect(post).toHaveBeenCalledTimes(1);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(database.connection().prepare("SELECT COUNT(*) AS count FROM google_reporting_cache").get()?.count).toBe(1);
    for (const secret of [operator, "private-google-access-token", "private-account-fingerprint", "private_key", "client_email"]) expect(first.text + second.text).not.toContain(secret);
  });

  it("protects and caches exact-period Facebook website-session collection through the operator route", async () => {
    const params = new URLSearchParams({ since: "2026-10-02T07:00:00.000Z", until: "2026-11-01T07:00:00.000Z" });
    const path = `${prefix}/facebook-visits?${params}`;
    await request(app.getHttpServer()).get(path).set("Host", "localhost:3001").expect(401);
    await get(`${prefix}/facebook-visits?since=invalid&until=invalid`).expect(400);
    expect(post).not.toHaveBeenCalled();
    post.mockResolvedValue({ reports: [{ metricHeaders: [{ name: "sessions" }], rows: [{ metricValues: [{ value: "3" }] }], rowCount: 1, metadata: { timeZone: "America/Los_Angeles" } }] });
    const first = await get(path).expect(200);
    expect(first.body).toMatchObject({ businessId, provider: "ga4", metric: "sessions", status: "available", total: 3 });
    expect(first.headers["cache-control"]).toBe("no-store");
    const second = await get(path).expect(200);
    expect(second.body).toEqual(first.body);
    expect(post).toHaveBeenCalledTimes(1);
    expect(first.text).not.toContain(operator);
    expect(first.text).not.toContain("private-google-access-token");
  });

  it("keeps Search Console site totals separate from top-query measurements and caches each scope", async () => {
    const summary = await get(`${prefix}/search-console`).expect(200);
    expect(summary.body.data).toMatchObject({ days: 30, view: "summary", summary: { clicks: 10, impressions: 200, ctr: 0.05, averagePosition: 8.2 }, topQueries: [] });
    const queries = await get(`${prefix}/search-console?days=7&view=queries`).expect(200);
    expect(queries.body.data).toMatchObject({ days: 7, view: "queries", summary: null, topQueries: [{ query: "tax accounting", clicks: 3, impressions: 80, ctr: 0.0375, averagePosition: 6.5 }] });
    expect(post.mock.calls.map(call => (call[1] as { dimensions: string[] }).dimensions)).toEqual([[], ["query"]]);
    expect(post.mock.calls[0][0]).toContain(encodeURIComponent(siteUrl));
    await get(`${prefix}/search-console`).expect(200);
    await get(`${prefix}/search-console?days=7&view=queries`).expect(200);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("rejects absent/wrong authorization, public hosts and unapproved origins before any upstream access", async () => {
    await request(app.getHttpServer()).get(`${prefix}/ga4`).set("Host", "localhost:3001").expect(401);
    await get(`${prefix}/ga4`, "wrong").expect(401);
    await get(`${prefix}/ga4`).set("Host", "external.example").expect(403);
    await get(`${prefix}/ga4`).set("Origin", "https://external.example").expect(403);
    settings.GOOGLE_OPERATOR_KEY = "";
    await get(`${prefix}/ga4`).expect(503);
    expect(authorizationCacheKey).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("rejects unknown/unbound businesses and property/website mismatches before Google requests", async () => {
    await get("/api/businesses/unknown/google/ga4").expect(404);
    settings.GOOGLE_BUSINESS_ID = "another-business";
    await get(`${prefix}/ga4`).expect(403);
    settings.GOOGLE_BUSINESS_ID = businessId;
    settings.GSC_SITE_URL = "https://another-business.example/";
    await get(`${prefix}/search-console`).expect(403);
    expect(post).not.toHaveBeenCalled();
  });

  it.each(["days=1", "days=0", "days=NaN", "days=7&days=30", "view=all", "propertyId=999", "siteUrl=https://external.example", "unknown=1"])("validates Search Console query %s before dispatch", async query => {
    await get(`${prefix}/search-console?${query}`).expect(400);
    expect(post).not.toHaveBeenCalled();
  });

  it("truthfully distinguishes successful empty data from unavailable measurements", async () => {
    post.mockResolvedValueOnce({ rows: [] });
    const empty = await get(`${prefix}/search-console`).expect(200);
    expect(empty.body).toMatchObject({ availability: "empty", error: null, data: { summary: { clicks: 0, impressions: 0, ctr: null, averagePosition: null } } });
    post.mockRejectedValueOnce(new GoogleApiError("GOOGLE_PERMISSION_DENIED", "private-provider-error", 403, "insufficientPermissions"));
    const failed = await get(`${prefix}/ga4`).expect(200);
    expect(failed.body).toMatchObject({ availability: "unavailable", data: null, fetchedAt: null, error: { code: "GOOGLE_PERMISSION_DENIED", httpStatus: 403 } });
    expect(failed.text).not.toContain("private-provider-error");
    await get(`${prefix}/ga4`).expect(200);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it.each(["GOOGLE_API_DISABLED", "GOOGLE_RATE_LIMITED", "GOOGLE_TIMEOUT", "GOOGLE_UNAVAILABLE"] as const)("negatively caches %s without retrying or inventing zero traffic", async code => {
    post.mockRejectedValueOnce(new GoogleApiError(code, "private-error-body-and-email"));
    const first = await get(`${prefix}/ga4`).expect(200);
    expect(first.body).toMatchObject({ availability: "unavailable", data: null, error: { code }, cache: { hit: false, stale: false } });
    expect(first.text).not.toContain("private-error-body-and-email");
    const second = await get(`${prefix}/ga4`).expect(200);
    expect(second.body.cache.hit).toBe(true);
    expect(second.body.lastAttemptAt).toBe(first.body.lastAttemptAt);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("retains original dated data as stale after a failed refresh and negatively caches the failure", async () => {
    const original = await get(`${prefix}/ga4`).expect(200);
    expire();
    post.mockRejectedValueOnce(new GoogleApiError("GOOGLE_PERMISSION_DENIED", "private-provider-detail", 403));
    const failed = await get(`${prefix}/ga4`).expect(200);
    expect(failed.body).toMatchObject({ availability: "unavailable", fetchedAt: original.body.fetchedAt, data: original.body.data, error: { code: "GOOGLE_PERMISSION_DENIED" }, cache: { hit: false, stale: true } });
    const cached = await get(`${prefix}/ga4`).expect(200);
    expect(cached.body.cache).toMatchObject({ hit: true, stale: true });
    expect(cached.body.data).toEqual(original.body.data);
    expect(post).toHaveBeenCalledTimes(2);
    expire();
    const recovered = await get(`${prefix}/ga4`).expect(200);
    expect(recovered.body).toMatchObject({ availability: "available", error: null, cache: { stale: false } });
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("does not reuse cache across credential identities or return stale data when credential validation fails", async () => {
    await get(`${prefix}/ga4`).expect(200);
    authorizationCacheKey.mockResolvedValue("different-private-account");
    await get(`${prefix}/ga4`).expect(200);
    expect(post).toHaveBeenCalledTimes(2);
    authorizationCacheKey.mockRejectedValue(new GoogleApiError("GOOGLE_NOT_CONFIGURED", "private-key-path"));
    const missing = await get(`${prefix}/ga4`).expect(200);
    expect(missing.body).toMatchObject({ availability: "unavailable", data: null, error: { code: "GOOGLE_NOT_CONFIGURED" } });
    expect(missing.text).not.toContain("private-key-path");
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("returns a sanitized unavailable result for malformed Google responses and token failures", async () => {
    post.mockResolvedValueOnce({ reports: [{ private_key: "private-key-fixture" }] });
    const malformed = await get(`${prefix}/ga4`).expect(200);
    expect(malformed.body).toMatchObject({ availability: "unavailable", data: null, error: { code: "GOOGLE_INVALID_RESPONSE" } });
    expect(malformed.text).not.toContain("private-key-fixture");
    getAccessToken.mockRejectedValueOnce(new GoogleApiError("GOOGLE_AUTH_FAILED", "private-signing-error", 401));
    const unauthorized = await get(`${prefix}/search-console`).expect(200);
    expect(unauthorized.body).toMatchObject({ availability: "unavailable", data: null, error: { code: "GOOGLE_AUTH_FAILED" } });
    expect(unauthorized.text).not.toContain("private-signing-error");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("fails closed on corrupted SQLite cache before making another Google request", async () => {
    await get(`${prefix}/ga4`).expect(200);
    database.connection().prepare("UPDATE google_reporting_cache SET checksum=?").run("corrupted");
    const failed = await get(`${prefix}/ga4`).expect(503);
    expect(failed.body.error.code).toBe("GOOGLE_CACHE_UNAVAILABLE");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent cache misses into a single reporting request", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    post.mockImplementationOnce(async () => { entered(); await blocked; return { reports: [ga4Report(), ga4Report()] }; });
    const first = get(`${prefix}/ga4`).then(response => response);
    await started;
    const second = get(`${prefix}/ga4`).then(response => response);
    try {
      // Wait until both requests pass authorization/cache identity resolution.
      for (let attempt = 0; authorizationCacheKey.mock.calls.length < 2 && attempt < 100; attempt++) await new Promise(resolve => setImmediate(resolve));
      expect(authorizationCacheKey).toHaveBeenCalledTimes(2);
    } finally { release(); }
    const responses = await Promise.all([first, second]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(responses[0].body.data).toEqual(responses[1].body.data);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
