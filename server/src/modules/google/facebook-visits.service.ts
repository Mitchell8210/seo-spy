import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { BUSINESS_REPOSITORY, type BusinessRepository } from "../../persistence/repositories.js";
import { GOOGLE_TOKEN_PROVIDER, type GoogleTokenProvider } from "../../integrations/google/google-auth.js";
import { GoogleReportingClient } from "../../integrations/google/google-reporting.js";
import { ga4FacebookVisitsReportDataSchema } from "../../integrations/google/google-reporting.types.js";
import { GoogleApiError } from "../../integrations/google/google-transport.js";
import { createFacebookReportingWindow } from "../../integrations/facebook/reporting-window.js";
import { GoogleReportingService } from "./google.service.js";
import { GoogleCacheStore } from "./google-cache.store.js";

export interface FacebookWebsiteVisits {
  businessId: string; provider: "ga4"; metric: "sessions"; attribution: "facebook-session-source-v1";
  since: string; until: string; timeZone: "America/Los_Angeles";
  status: "available" | "unavailable"; total: number | null; collectedAt: string | null;
  failureCode?: string; limitations: string[];
}
const stored = z.object({ schemaVersion: z.literal("seo-spy.google-facebook-visits-cache.v1"), businessId: z.string(),
  provider: z.literal("ga4"), asset: z.string(), hostname: z.string(), since: z.string().datetime(), until: z.string().datetime(),
  lastAttemptAt: z.string().datetime(), data: ga4FacebookVisitsReportDataSchema.nullable(), errorCode: z.string().max(80).nullable(),
}).strict();
type Stored = z.infer<typeof stored>;
const dateInPacific = (input: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(input);
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

/** Explicit collection and strictly local saved reads. No model, Facebook or write transport. */
@Injectable()
export class GoogleFacebookVisitsService {
  private readonly active = new Map<string, Promise<FacebookWebsiteVisits>>();
  constructor(private readonly reports: GoogleReportingService, private readonly client: GoogleReportingClient,
    @Inject(GOOGLE_TOKEN_PROVIDER) private readonly auth: GoogleTokenProvider, private readonly cache: GoogleCacheStore,
    @Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository, private readonly config: ConfigService) {}

  private async context(businessId: string, since: string, until: string) {
    const start = new Date(since), end = new Date(until);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.toISOString() !== since || end.toISOString() !== until || end.getTime() > Date.now()) throw new BadRequestException("Canonical UTC dates for a completed 30-day reporting window are required.");
    const window = createFacebookReportingWindow(end);
    if (window.since !== start.toISOString() || window.until !== end.toISOString()) throw new BadRequestException("The reporting window must contain exactly 30 complete Pacific days.");
    const asset = await this.reports.configuredGa4Asset(businessId);
    if (!/^[1-9]\d{0,19}$/.test(asset)) throw new GoogleApiError("GOOGLE_NOT_CONFIGURED", "GA4 target unavailable.");
    const business = await this.businesses.findById(businessId);
    if (!business) throw new Error("Business unavailable");
    const hostname = new URL(business.website).hostname.toLowerCase().replace(/^www\./, "");
    const authKey = await this.auth.authorizationCacheKey(); // Local credential identity only; never a token exchange.
    const key = createHash("sha256").update(JSON.stringify({ version: "facebook-visits-cache-v1", businessId, asset, hostname, since: window.since, until: window.until, authKey })).digest("hex");
    return { key, businessId, asset, hostname, since: window.since, until: window.until,
      startDate: dateInPacific(start), endDate: dateInPacific(new Date(end.getTime() - 1)) };
  }
  private unavailable(businessId: string, since: string, until: string, failureCode: string): FacebookWebsiteVisits {
    return { businessId, provider: "ga4", metric: "sessions", attribution: "facebook-session-source-v1", since, until,
      timeZone: "America/Los_Angeles", status: "unavailable", total: null, collectedAt: null, failureCode,
      limitations: ["No usable Google-reported Facebook session count is available for this exact reporting window. Missing access or collection failure is not zero visits."] };
  }
  private read(context: Awaited<ReturnType<GoogleFacebookVisitsService["context"]>>) {
    const entry = this.cache.read(context.key);
    if (!entry) return null;
    const value = stored.parse(entry.payload);
    if (entry.businessId !== context.businessId || entry.provider !== "ga4" || value.businessId !== context.businessId || value.asset !== context.asset ||
      value.hostname !== context.hostname || value.since !== context.since || value.until !== context.until || value.data &&
      (value.data.propertyId !== context.asset || value.data.hostname !== context.hostname || value.data.dateRange.startDate !== context.startDate || value.data.dateRange.endDate !== context.endDate)) throw new Error("Invalid saved scope");
    return { value, expiresAt: entry.expiresAt };
  }
  private view(value: Stored): FacebookWebsiteVisits {
    if (value.errorCode || !value.data) return this.unavailable(value.businessId, value.since, value.until, value.errorCode ?? "GOOGLE_UNAVAILABLE");
    if (value.data.dateRange.timeZone !== "America/Los_Angeles") return this.unavailable(value.businessId, value.since, value.until, "GOOGLE_TIMEZONE_MISMATCH");
    return { businessId: value.businessId, provider: "ga4", metric: "sessions", attribution: "facebook-session-source-v1",
      since: value.since, until: value.until, timeZone: "America/Los_Angeles", status: "available", total: value.data.sessions,
      collectedAt: value.data.collectedAt, limitations: value.data.limitations };
  }
  async saved(businessId: string, since: string, until: string): Promise<FacebookWebsiteVisits | null> {
    try {
      const context = await this.context(businessId, since, until);
      const entry = this.read(context);
      return entry ? this.view(entry.value) : null;
    } catch { return this.unavailable(businessId, since, until, "GOOGLE_SAVED_VISITS_UNAVAILABLE"); }
  }
  async collect(businessId: string, since: string, until: string): Promise<FacebookWebsiteVisits> {
    const context = await this.context(businessId, since, until);
    let entry: ReturnType<GoogleFacebookVisitsService["read"]>;
    try { entry = this.read(context); }
    catch { return this.unavailable(businessId, since, until, "GOOGLE_CACHE_UNAVAILABLE"); }
    if (entry && Date.parse(entry.expiresAt) > Date.now()) return this.view(entry.value);
    const pending = this.active.get(context.key);
    if (pending) return pending;
    const job = (async () => {
      let value: Stored;
      try {
        const data = await this.client.ga4FacebookVisits(context.asset, context.startDate, context.endDate, context.hostname);
        value = stored.parse({ schemaVersion: "seo-spy.google-facebook-visits-cache.v1", businessId, provider: "ga4", asset: context.asset,
          hostname: context.hostname, since: context.since, until: context.until, lastAttemptAt: new Date().toISOString(), data, errorCode: null });
        // Validate identity/date scope before publishing or persisting a measurement.
        if (data.propertyId !== context.asset || data.hostname !== context.hostname || data.dateRange.startDate !== context.startDate || data.dateRange.endDate !== context.endDate) throw new GoogleApiError("GOOGLE_INVALID_RESPONSE", "Google returned a different report scope.");
      } catch (error) {
        value = { schemaVersion: "seo-spy.google-facebook-visits-cache.v1", businessId, provider: "ga4", asset: context.asset,
          hostname: context.hostname, since: context.since, until: context.until, lastAttemptAt: new Date().toISOString(), data: entry?.value.data ?? null,
          errorCode: error instanceof GoogleApiError ? error.code : "GOOGLE_UNAVAILABLE" };
      }
      const ttl = Number(this.config.get(value.errorCode ? "GOOGLE_ERROR_CACHE_TTL_SECONDS" : "GOOGLE_CACHE_TTL_SECONDS") ?? (value.errorCode ? 60 : 900));
      try { this.cache.write({ key: context.key, businessId, provider: "ga4", expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), payload: value }); }
      catch { return this.unavailable(businessId, since, until, "GOOGLE_CACHE_UNAVAILABLE"); }
      return this.view(value);
    })();
    this.active.set(context.key, job);
    try { return await job; } finally { this.active.delete(context.key); }
  }
}
