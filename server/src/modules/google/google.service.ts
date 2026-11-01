import { ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { z } from "zod";
import { BUSINESS_REPOSITORY, type BusinessRepository } from "../../persistence/repositories.js";
import { GOOGLE_TOKEN_PROVIDER, type GoogleTokenProvider } from "../../integrations/google/google-auth.js";
import { GoogleReportingClient } from "../../integrations/google/google-reporting.js";
import { ga4ReportDataSchema, searchConsoleReportDataSchema } from "../../integrations/google/google-reporting.types.js";
import { GoogleApiError } from "../../integrations/google/google-transport.js";
import { GoogleCacheError, GoogleCacheStore } from "./google-cache.store.js";

const safeErrors: Record<string, string> = {
  GOOGLE_NOT_CONFIGURED: "Server-only Google credentials or reporting targets are missing or invalid.",
  GOOGLE_AUTH_FAILED: "Google could not authorize the service account. Check its key and read scopes.",
  GOOGLE_PERMISSION_DENIED: "The configured account cannot read this property. Grant GA4 Viewer access or appropriate Search Console property access.",
  GOOGLE_API_DISABLED: "The required Google API is disabled or blocked in the credential's Cloud project.",
  GOOGLE_RATE_LIMITED: "Google rejected the request because a quota or rate limit was reached. No automatic retry was attempted.",
  GOOGLE_UNAVAILABLE: "Google reporting could not complete this request. No automatic retry was attempted.",
  GOOGLE_TIMEOUT: "Google reporting exceeded its deadline. No automatic retry was attempted.",
  GOOGLE_INVALID_RESPONSE: "Google returned an incompatible reporting response; no measurements were invented.",
  GOOGLE_BUSY: "Google reporting capacity is currently in use.",
};
const errorSchema = z.object({ code: z.string(), message: z.string().max(1000), httpStatus: z.number().int().nullable(), reason: z.string().max(100).nullable() }).strict();
const base = {
  schemaVersion: z.literal("seo-spy.google-reporting.v1"), businessId: z.string().min(1), provider: z.enum(["ga4", "search-console"]),
  authentication: z.literal("service_account"), asset: z.string().min(1), availability: z.enum(["available", "empty", "unavailable"]),
  fetchedAt: z.string().datetime().nullable(), lastAttemptAt: z.string().datetime(), error: errorSchema.nullable(),
  limitations: z.array(z.string().max(2000)).max(20),
};
const envelopeSchema = z.object({ ...base, data: z.union([ga4ReportDataSchema, searchConsoleReportDataSchema]).nullable() }).strict();
type Envelope = z.infer<typeof envelopeSchema>;
type Provider = "ga4" | "search-console";
const hostname = (value: string) => new URL(value).hostname.toLowerCase().replace(/^www\./, "");

/** Reporting reads only. No AI, proposal/execution or WordPress imports exist in this service. */
@Injectable()
export class GoogleReportingService {
  private readonly active = new Map<string, Promise<Envelope>>();
  constructor(private readonly config: ConfigService, @Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository,
    private readonly client: GoogleReportingClient, @Inject(GOOGLE_TOKEN_PROVIDER) private readonly auth: GoogleTokenProvider, private readonly cache: GoogleCacheStore) {}

  private async binding(businessId: string, provider: Provider) {
    const business = await this.businesses.findById(businessId);
    if (!business) throw new NotFoundException({ code: "BUSINESS_NOT_FOUND", message: "Business not found." });
    const configured = this.config.get<string>("GOOGLE_BUSINESS_ID") || this.config.get<string>("WORDPRESS_BUSINESS_ID");
    if (!configured || configured !== businessId) throw new ForbiddenException({ code: "GOOGLE_BUSINESS_MISMATCH", message: "No Google reporting connection is bound to this business." });
    const siteUrl = this.config.get<string>("GSC_SITE_URL") ?? "";
    if (siteUrl) {
      try {
        const siteHost = siteUrl.startsWith("sc-domain:") ? siteUrl.slice(10).toLowerCase() : hostname(siteUrl);
        if (siteHost !== hostname(business.website)) throw new Error();
      } catch { throw new ForbiddenException({ code: "GOOGLE_SITE_MISMATCH", message: "The configured Google property does not match the registered business website." }); }
    }
    return provider === "ga4" ? (this.config.get<string>("GA4_PROPERTY_ID") ?? "") : siteUrl;
  }
  ga4(businessId: string) { return this.load(businessId, "ga4", 30, "summary"); }
  configuredGa4Asset(businessId: string) { return this.binding(businessId, "ga4"); }
  searchConsole(businessId: string, days: 7 | 30, view: "summary" | "queries") { return this.load(businessId, "search-console", days, view); }

  private failure(businessId: string, provider: Provider, asset: string, error: unknown, old: Envelope | null): Envelope {
    const failure = error instanceof GoogleApiError ? error : new GoogleApiError("GOOGLE_UNAVAILABLE", "Google reporting failed.");
    return {
      schemaVersion: "seo-spy.google-reporting.v1", businessId, provider, authentication: "service_account", asset: asset || "not-configured",
      availability: "unavailable", data: old?.data ?? null, fetchedAt: old?.fetchedAt ?? null, lastAttemptAt: new Date().toISOString(),
      error: { code: failure.code, message: safeErrors[failure.code] ?? safeErrors.GOOGLE_UNAVAILABLE, httpStatus: failure.httpStatus, reason: failure.reason },
      limitations: old?.data ? ["A newer request failed. Retained data is stale and keeps its original collection date; it does not establish current authorization."] : ["No usable report was established. Missing data or permissions are not zero traffic."],
    };
  }
  private storageFailure(): never { throw new ServiceUnavailableException({ code: "GOOGLE_CACHE_UNAVAILABLE", message: "The Google response cache cannot be accessed safely; no upstream request was started." }); }
  private matches(data: NonNullable<Envelope["data"]>, provider: Provider, asset: string, days: 7 | 30, view: "summary" | "queries") {
    return provider === "ga4" ? data.schemaVersion === "seo-spy.google-ga4.v1" && data.propertyId === asset
      : data.schemaVersion === "seo-spy.google-search-console.v1" && data.siteUrl === asset && data.days === days && data.view === view;
  }

  private async load(businessId: string, provider: Provider, days: 7 | 30, view: "summary" | "queries") {
    const asset = await this.binding(businessId, provider);
    let authKey: string;
    try {
      if (!asset) throw new GoogleApiError("GOOGLE_NOT_CONFIGURED", "Reporting target missing.");
      authKey = await this.auth.authorizationCacheKey();
    } catch (error) { return { ...this.failure(businessId, provider, asset, error, null), cache: { hit: false, stale: false, expiresAt: null } }; }
    const key = createHash("sha256").update(JSON.stringify({ version: "google-cache-v1", businessId, provider, asset, days, view, authKey })).digest("hex");
    let old: Envelope | null = null;
    try {
      const saved = this.cache.read(key);
      if (saved) {
        const parsed = envelopeSchema.safeParse(saved.payload);
        if (!parsed.success || parsed.data.businessId !== businessId || parsed.data.provider !== provider || parsed.data.asset !== asset || saved.businessId !== businessId || saved.provider !== provider) this.storageFailure();
        old = parsed.data;
        if (old.data && !this.matches(old.data, provider, asset, days, view)) this.storageFailure();
        if (Date.parse(saved.expiresAt) > Date.now()) return { ...old, cache: { hit: true, stale: !!old.error && !!old.data, expiresAt: saved.expiresAt } };
      }
    } catch { this.storageFailure(); }
    let pending = this.active.get(key);
    const shared = !!pending;
    if (!pending) {
      pending = this.collect(businessId, provider, asset, days, view, key, old);
      this.active.set(key, pending);
    }
    try {
      const result = await pending;
      const ttl = result.error ? Number(this.config.get("GOOGLE_ERROR_CACHE_TTL_SECONDS") ?? 60) : Number(this.config.get("GOOGLE_CACHE_TTL_SECONDS") ?? 900);
      return { ...result, cache: { hit: shared, stale: !!result.error && !!result.data, expiresAt: new Date(Date.parse(result.lastAttemptAt) + ttl * 1000).toISOString() } };
    } finally { if (this.active.get(key) === pending) this.active.delete(key); }
  }
  private async collect(businessId: string, provider: Provider, asset: string, days: 7 | 30, view: "summary" | "queries", key: string, old: Envelope | null): Promise<Envelope> {
    let result: Envelope;
    try {
      const data = provider === "ga4" ? await this.client.ga4(asset) : await this.client.searchConsole(asset, days, view);
      if (!this.matches(data, provider, asset, days, view)) throw new GoogleApiError("GOOGLE_INVALID_RESPONSE", "The report did not match the configured asset or scope.");
      result = envelopeSchema.parse({ schemaVersion: "seo-spy.google-reporting.v1", businessId, provider, authentication: "service_account", asset, availability: data.availability, data, fetchedAt: data.collectedAt, lastAttemptAt: new Date().toISOString(), error: null, limitations: data.limitations });
    } catch (error) { result = this.failure(businessId, provider, asset, error, old); }
    const ttl = result.error ? Number(this.config.get("GOOGLE_ERROR_CACHE_TTL_SECONDS") ?? 60) : Number(this.config.get("GOOGLE_CACHE_TTL_SECONDS") ?? 900);
    try { this.cache.write({ key, businessId, provider, expiresAt: new Date(Date.parse(result.lastAttemptAt) + ttl * 1000).toISOString(), payload: result }); }
    catch (error) {
      if (error instanceof GoogleCacheError) throw new ServiceUnavailableException({ code: "GOOGLE_CACHE_UNAVAILABLE", message: "The Google result could not be cached safely. No automatic retry was attempted." });
      throw new ServiceUnavailableException({ code: "GOOGLE_CACHE_UNAVAILABLE", message: "The Google result could not be persisted safely." });
    }
    return result;
  }
}
