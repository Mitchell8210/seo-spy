import "reflect-metadata";
import { jest } from "@jest/globals";
import { ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleFacebookVisitsService } from "../src/modules/google/facebook-visits.service.js";
import { GoogleReportingService } from "../src/modules/google/google.service.js";
import { GoogleCacheStore, type GoogleCacheEntry } from "../src/modules/google/google-cache.store.js";
import { GoogleReportingClient } from "../src/integrations/google/google-reporting.js";
import { FACEBOOK_SESSION_SOURCE_PATTERN, type Ga4FacebookVisitsReportData } from "../src/integrations/google/google-reporting.types.js";
import { GoogleApiError } from "../src/integrations/google/google-transport.js";
import type { BusinessRepository } from "../src/persistence/repositories.js";
import type { GoogleTokenProvider } from "../src/integrations/google/google-auth.js";

const businessId = "business-one", since = "2026-10-02T07:00:00.000Z", until = "2026-11-01T07:00:00.000Z";
const data = (): Ga4FacebookVisitsReportData => ({ schemaVersion: "seo-spy.google-ga4-facebook-visits.v1", provider: "google-analytics-data", propertyId: "123",
  collectedAt: "2026-11-01T17:00:00.000Z", availability: "available", hostname: "example.com", sourceDimension: "sessionSource",
  attribution: "facebook-session-source-v1", sourcePattern: FACEBOOK_SESSION_SOURCE_PATTERN, dateRange: { startDate: "2026-10-02", endDate: "2026-10-31", timeZone: "America/Los_Angeles" },
  sessions: 8, metadata: { subjectToThresholding: false, dataLossFromOtherRow: false, sampling: [] }, limitations: ["Sessions attributed to Facebook, not individual link clicks."] });
function fixture() {
  const entries = new Map<string, GoogleCacheEntry>();
  const read = jest.fn((key: string): GoogleCacheEntry | null => entries.get(key) ?? null);
  const write = jest.fn((entry: GoogleCacheEntry) => { entries.set(entry.key, structuredClone(entry)); });
  const configuredGa4Asset = jest.fn<GoogleReportingService["configuredGa4Asset"]>().mockImplementation(async id => {
    if (id !== businessId) throw new ForbiddenException("Wrong business");
    return "123";
  });
  const visits = jest.fn<GoogleReportingClient["ga4FacebookVisits"]>().mockResolvedValue(data());
  const getAccessToken = jest.fn<GoogleTokenProvider["getAccessToken"]>().mockResolvedValue("private-token-must-not-be-used");
  const authorizationCacheKey = jest.fn<GoogleTokenProvider["authorizationCacheKey"]>().mockResolvedValue("authorization-one");
  const findById = jest.fn<BusinessRepository["findById"]>().mockResolvedValue({ id: businessId, name: "Example business", website: "https://www.example.com/", createdAt: "2026-01-01T00:00:00.000Z" });
  const service = new GoogleFacebookVisitsService({ configuredGa4Asset } as unknown as GoogleReportingService,
    { ga4FacebookVisits: visits } as unknown as GoogleReportingClient, { getAccessToken, authorizationCacheKey },
    { read, write } as unknown as GoogleCacheStore, { findById, connections: async () => [] },
    new ConfigService({ GOOGLE_CACHE_TTL_SECONDS: 900, GOOGLE_ERROR_CACHE_TTL_SECONDS: 60 }));
  return { service, entries, read, write, configuredGa4Asset, visits, getAccessToken, authorizationCacheKey, findById };
}

describe("Business-scoped saved Facebook website visits", () => {
  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date("2026-11-01T17:00:00.000Z")); });
  afterEach(() => { jest.useRealTimers(); });

  it("saved reads do not request a report or exchange tokens, including a cache miss", async () => {
    const f = fixture();
    expect(await f.service.saved(businessId, since, until)).toBeNull();
    expect(f.visits).not.toHaveBeenCalled(); expect(f.getAccessToken).not.toHaveBeenCalled();
    expect(f.authorizationCacheKey).toHaveBeenCalledTimes(1);
    await f.service.collect(businessId, since, until);
    f.visits.mockClear();
    expect(await f.service.saved(businessId, since, until)).toMatchObject({ status: "available", total: 8, since, until, businessId });
    expect(f.visits).not.toHaveBeenCalled(); expect(f.getAccessToken).not.toHaveBeenCalled();
  });

  it("binds the explicit query dates/property/hostname and reuses the saved success", async () => {
    const f = fixture();
    const first = await f.service.collect(businessId, since, until);
    expect(first).toMatchObject({ provider: "ga4", metric: "sessions", status: "available", total: 8, timeZone: "America/Los_Angeles" });
    expect(f.visits).toHaveBeenCalledWith("123", "2026-10-02", "2026-10-31", "example.com");
    expect(await f.service.collect(businessId, since, until)).toEqual(first);
    expect(f.visits).toHaveBeenCalledTimes(1); expect(f.write).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toContain("private-token");
  });

  it("distinguishes successful empty zero from provider failure and negatively caches failures", async () => {
    const empty = fixture();
    empty.visits.mockResolvedValue({ ...data(), availability: "empty", sessions: 0 });
    expect(await empty.service.collect(businessId, since, until)).toMatchObject({ status: "available", total: 0 });
    const failed = fixture();
    failed.visits.mockRejectedValue(new GoogleApiError("GOOGLE_PERMISSION_DENIED", "Provider failure"));
    expect(await failed.service.collect(businessId, since, until)).toMatchObject({ status: "unavailable", total: null, failureCode: "GOOGLE_PERMISSION_DENIED" });
    expect(await failed.service.collect(businessId, since, until)).toMatchObject({ status: "unavailable", total: null });
    expect(failed.visits).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["bad", until], [since, "bad"], ["", until], [since, ""],
    ["2026-10-03T07:00:00.000Z", until], ["2026-10-02T00:00:00.000Z", "2026-11-01T00:00:00.000Z"],
    [since, "2026-11-02T08:00:00.000Z"],
    ["2026-02-30T08:00:00.000Z", "2026-04-01T07:00:00.000Z"],
  ])("rejects invalid/incomplete/non-Pacific/future windows before collection %#", async (start, end) => {
    const f = fixture();
    await expect(f.service.collect(businessId, start, end)).rejects.toThrow();
    expect(f.visits).not.toHaveBeenCalled(); expect(f.authorizationCacheKey).not.toHaveBeenCalled();
    expect(f.getAccessToken).not.toHaveBeenCalled();
  });

  it("uses exact Pacific calendar dates over the daylight-saving transition rather than elapsed 24-hour blocks", async () => {
    jest.setSystemTime(new Date("2026-11-03T18:00:00.000Z"));
    const f = fixture();
    f.visits.mockResolvedValue({ ...data(), dateRange: { ...data().dateRange, startDate: "2026-10-04", endDate: "2026-11-02" } });
    expect(await f.service.collect(businessId, "2026-10-04T07:00:00.000Z", "2026-11-03T08:00:00.000Z")).toMatchObject({ status: "available", total: 8 });
    expect(f.visits).toHaveBeenCalledWith("123", "2026-10-04", "2026-11-02", "example.com");
  });

  it("enforces configured business, property and registered-business presence before upstream reads", async () => {
    for (const kind of ["business", "asset", "missing-business"] as const) {
      const f = fixture();
      if (kind === "asset") f.configuredGa4Asset.mockResolvedValue("");
      if (kind === "missing-business") f.findById.mockResolvedValue(null);
      await expect(f.service.collect(kind === "business" ? "another-business" : businessId, since, until)).rejects.toThrow();
      expect(f.visits).not.toHaveBeenCalled(); expect(f.getAccessToken).not.toHaveBeenCalled();
    }
  });

  it("fails closed on wrong-scope client measurements without publishing numeric values", async () => {
    for (const patch of [
      { propertyId: "456" }, { hostname: "another.example" },
      { dateRange: { ...data().dateRange, startDate: "2026-10-01", endDate: "2026-10-30" } },
    ]) {
      const f = fixture(); f.visits.mockResolvedValue({ ...data(), ...patch });
      expect(await f.service.collect(businessId, since, until)).toMatchObject({ status: "unavailable", total: null });
      expect(await f.service.saved(businessId, since, until)).toMatchObject({ status: "unavailable", total: null });
      expect(f.visits).toHaveBeenCalledTimes(1);
    }
  });

  it("fails closed on corrupt/wrong-scope cached payloads before requesting replacement reports", async () => {
    for (const kind of ["corrupt", "business", "asset", "hostname", "dates", "entry-scope", "data-scope"] as const) {
      const f = fixture(); await f.service.collect(businessId, since, until); f.visits.mockClear();
      const entry = [...f.entries.values()][0]!;
      const payload = entry.payload as Record<string, unknown>;
      if (kind === "corrupt") f.read.mockImplementation(() => { throw new Error("private-storage-detail"); });
      if (kind === "business") payload.businessId = "other";
      if (kind === "asset") payload.asset = "456";
      if (kind === "hostname") payload.hostname = "another.example";
      if (kind === "dates") payload.since = "2026-10-01T07:00:00.000Z";
      if (kind === "entry-scope") entry.businessId = "other";
      if (kind === "data-scope") payload.data = { ...data(), hostname: "another.example" };
      const saved = await f.service.saved(businessId, since, until);
      const collected = await f.service.collect(businessId, since, until);
      expect(saved).toMatchObject({ status: "unavailable", total: null });
      expect(collected).toMatchObject({ status: "unavailable", total: null, failureCode: "GOOGLE_CACHE_UNAVAILABLE" });
      expect(JSON.stringify(saved)).not.toContain("private-storage-detail");
      expect(f.visits).not.toHaveBeenCalled(); expect(f.getAccessToken).not.toHaveBeenCalled();
    }
  });

  it("keeps an incompatible or unknown property timezone unavailable", async () => {
    for (const timeZone of ["America/New_York", null]) {
      const f = fixture(); f.visits.mockResolvedValue({ ...data(), dateRange: { ...data().dateRange, timeZone } });
      expect(await f.service.collect(businessId, since, until)).toMatchObject({ status: "unavailable", total: null, failureCode: "GOOGLE_TIMEZONE_MISMATCH" });
      expect(await f.service.saved(businessId, since, until)).toMatchObject({ status: "unavailable", total: null });
      expect(f.visits).toHaveBeenCalledTimes(1);
    }
  });

  it("scopes cache identity to authorization fingerprint and never reuses another account's result", async () => {
    const f = fixture(); await f.service.collect(businessId, since, until);
    f.authorizationCacheKey.mockResolvedValue("authorization-two");
    expect(await f.service.saved(businessId, since, until)).toBeNull();
    f.visits.mockResolvedValue({ ...data(), sessions: 2 });
    expect(await f.service.collect(businessId, since, until)).toMatchObject({ total: 2 });
    expect(f.entries.size).toBe(2); expect(f.visits).toHaveBeenCalledTimes(2);
  });

  it("deduplicates identical concurrent collections without issuing parallel provider reports", async () => {
    const f = fixture();
    let release!: (value: Ga4FacebookVisitsReportData) => void;
    let started!: () => void;
    const dispatch = new Promise<void>(resolve => { started = resolve; });
    f.visits.mockImplementation(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const first = f.service.collect(businessId, since, until);
    const second = f.service.collect(businessId, since, until);
    await dispatch;
    release(data());
    expect(await Promise.all([first, second])).toEqual([expect.objectContaining({ total: 8 }), expect.objectContaining({ total: 8 })]);
    expect(f.visits).toHaveBeenCalledTimes(1); expect(f.write).toHaveBeenCalledTimes(1);
  });

  it("retains prior data after a failed expired refresh but never displays it as a successful current value", async () => {
    const f = fixture(); await f.service.collect(businessId, since, until);
    const entry = [...f.entries.values()][0]!; entry.expiresAt = "2026-11-01T16:00:00.000Z";
    expect(await f.service.saved(businessId, since, until)).toMatchObject({ status: "available", total: 8, collectedAt: data().collectedAt });
    expect(f.visits).toHaveBeenCalledTimes(1);
    f.visits.mockRejectedValue(new GoogleApiError("GOOGLE_TIMEOUT", "Safe timeout"));
    expect(await f.service.collect(businessId, since, until)).toMatchObject({ status: "unavailable", total: null, failureCode: "GOOGLE_TIMEOUT" });
    expect((([...f.entries.values()][0]!.payload) as { data: unknown }).data).toEqual(data());
    expect(await f.service.saved(businessId, since, until)).toMatchObject({ status: "unavailable", total: null });
  });

  it("does not publish an uncached measurement when persistence fails", async () => {
    const f = fixture(); f.write.mockImplementation(() => { throw new Error("private-cache-detail"); });
    const result = await f.service.collect(businessId, since, until);
    expect(result).toMatchObject({ status: "unavailable", total: null, failureCode: "GOOGLE_CACHE_UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("private-cache-detail");
    expect(f.visits).toHaveBeenCalledTimes(1);
  });
});
