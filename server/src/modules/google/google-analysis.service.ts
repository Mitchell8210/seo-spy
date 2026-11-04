import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { BUSINESS_REPOSITORY, type BusinessRepository } from "../../persistence/repositories.js";
import { GOOGLE_TOKEN_PROVIDER, type GoogleTokenProvider } from "../../integrations/google/google-auth.js";
import { googleAnalysisDataSchema, googleAnalysisEnvelopeSchema, type GoogleAnalysisEnvelope } from "../../integrations/google/google-analysis.js";
import { GoogleReportingClient } from "../../integrations/google/google-reporting.js";
import { GoogleApiError } from "../../integrations/google/google-transport.js";
import { GoogleReportingService } from "./google.service.js";
import { GoogleCacheStore } from "./google-cache.store.js";
import { leadPolicy, type Ga4LeadPolicy } from "../../integrations/google/google-lead-policy.js";

@Injectable()
export class GoogleAnalysisService {
  private readonly active = new Map<string, Promise<GoogleAnalysisEnvelope>>();
  constructor(private readonly reports: GoogleReportingService, private readonly client: GoogleReportingClient,
    @Inject(GOOGLE_TOKEN_PROVIDER) private readonly auth: GoogleTokenProvider, private readonly cache: GoogleCacheStore,
    @Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository, private readonly config: ConfigService) {}

  private failure(businessId: string, error: unknown, old: GoogleAnalysisEnvelope | null): GoogleAnalysisEnvelope {
    return { schemaVersion: "seo-spy.google-analysis.v2", businessId, provider: "ga4", availability: "unavailable",
      data: old?.data ?? null, lastAttemptAt: new Date().toISOString(), errorCode: error instanceof GoogleApiError ? error.code : "GOOGLE_UNAVAILABLE" };
  }
  private storageFailure(): never { throw new ServiceUnavailableException({ code: "GOOGLE_CACHE_UNAVAILABLE", message: "Website analytics storage is unavailable. No automatic retry was attempted." }); }
  private view(value: GoogleAnalysisEnvelope, hit: boolean, expiresAt: string | null) {
    return { ...value, cache: { hit, stale: value.availability === "unavailable" && value.data !== null, expiresAt } };
  }
  async read(businessId: string) {
    const asset = await this.reports.configuredGa4Asset(businessId);
    const business = (await this.businesses.findById(businessId))!;
    const hostname = new URL(business.website).hostname.toLowerCase().replace(/^www\./, "");
    let authKey: string;
    try {
      if (!/^[1-9]\d{0,19}$/.test(asset)) throw new GoogleApiError("GOOGLE_NOT_CONFIGURED", "Analytics is not configured.");
      authKey = await this.auth.authorizationCacheKey();
    } catch (error) { return this.view(this.failure(businessId, error, null), false, null); }
    const policy = leadPolicy(this.config.get<string>("GA4_LEAD_EVENT_NAME") ?? "", this.config.get<string>("GA4_LEAD_PAGE_PATHS") ?? "");
    const key = createHash("sha256").update(JSON.stringify({ version: "google-analysis-cache-v2", businessId, asset, hostname, authKey, policy })).digest("hex");
    let old: GoogleAnalysisEnvelope | null = null;
    try {
      const saved = this.cache.read(key);
      if (saved) {
        const value = googleAnalysisEnvelopeSchema.parse(saved.payload);
        if (saved.businessId !== businessId || saved.provider !== "ga4" || value.businessId !== businessId ||
          value.data && (value.data.propertyId !== asset || value.data.hostname !== hostname)) this.storageFailure();
        old = value;
        const expiresAt = new Date(Math.min(Date.parse(saved.expiresAt), Date.parse(this.expires(value)))).toISOString();
        if (Date.parse(expiresAt) > Date.now()) return this.view(value, true, expiresAt);
      }
    } catch { this.storageFailure(); }
    let pending = this.active.get(key);
    const shared = !!pending;
    if (!pending) {
      pending = this.collect(businessId, asset, hostname, key, old, policy);
      this.active.set(key, pending);
    }
    try {
      const value = await pending;
      return this.view(value, shared, this.expires(value));
    } finally { if (this.active.get(key) === pending) this.active.delete(key); }
  }
  private expires(value: GoogleAnalysisEnvelope) {
    const failed = !!value.errorCode || value.data?.conversion.reason === "query_failed";
    const ttl = Number(this.config.get(failed ? "GOOGLE_ERROR_CACHE_TTL_SECONDS" : "GOOGLE_CACHE_TTL_SECONDS") ?? (failed ? 60 : 900));
    return new Date(Date.parse(value.lastAttemptAt) + ttl * 1000).toISOString();
  }
  private async collect(businessId: string, asset: string, hostname: string, key: string, old: GoogleAnalysisEnvelope | null, policy: Ga4LeadPolicy | null) {
    let value: GoogleAnalysisEnvelope;
    try {
      const data = googleAnalysisDataSchema.parse(await this.client.analysis(asset, hostname, policy));
      if (data.propertyId !== asset || data.hostname !== hostname) throw new GoogleApiError("GOOGLE_INVALID_RESPONSE", "Analytics binding mismatch.");
      value = googleAnalysisEnvelopeSchema.parse({ schemaVersion: "seo-spy.google-analysis.v2", businessId, provider: "ga4", data,
        availability: data.totals.users === 0 && data.totals.sessions === 0 ? "empty" : "available",
        lastAttemptAt: new Date().toISOString(), errorCode: null });
    } catch (error) { value = this.failure(businessId, error, old); }
    try { this.cache.write({ key, businessId, provider: "ga4", expiresAt: this.expires(value), payload: value }); }
    catch { this.storageFailure(); }
    return value;
  }
}
