import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Audit, AuditStatus } from "../../contracts/domain.js";
import { collectFacebookReport } from "../../integrations/facebook/collect.js";
import { FacebookCollectionError } from "../../integrations/facebook/types.js";
import {
  BUSINESS_REPOSITORY,
  AUDIT_REPOSITORY,
  type AuditRepository,
  type BusinessRepository,
} from "../../persistence/repositories.js";
import { FileReportStore } from "../../reports/file-report.store.js";
import type { ReportFileReference } from "../../reports/report.types.js";
import {
  FacebookError,
  FacebookGraph,
  FacebookService,
} from "./facebook.service.js";

export type FacebookBrowserReport = ReportFileReference & {
  status: AuditStatus;
  failure: Audit["failure"];
};
export interface FacebookReportProgress {
  businessId: string;
  active: { pageId: string; status: "running" } | null;
  latest: { pageId: string; result: FacebookBrowserReport | null; error: { code: string; message: string } | null } | null;
}

/** Local operator workflow; Page authorization does not establish business ownership. */
@Injectable()
export class FacebookReportsService implements OnModuleDestroy {
  private readonly jobs = new Map<string, Promise<FacebookBrowserReport>>();
  private readonly owners = new Map<string, { sessionId: string | undefined; pageId: string }>();
  private readonly outcomes = new Map<string, { at: number; value: FacebookReportProgress["latest"] }>();
  private readonly abort = new AbortController();
  private closing = false;

  constructor(
    private readonly reports: FileReportStore,
    @Inject(BUSINESS_REPOSITORY)
    private readonly businesses: BusinessRepository,
    private readonly graph: FacebookGraph,
    private readonly facebook: FacebookService,
    @Optional() @Inject(AUDIT_REPOSITORY) private readonly audits?: AuditRepository,
  ) {}

  async status(sessionId: string | undefined, businessId: string): Promise<FacebookReportProgress> {
    if (typeof businessId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(businessId))
      throw new BadRequestException({ code: "INVALID_FACEBOOK_TARGET", message: "Select a registered business." });
    await this.facebook.credential(sessionId);
    if (!(await this.businesses.findById(businessId)))
      throw new NotFoundException({ code: "BUSINESS_NOT_FOUND", message: "Business not found." });
    this.pruneOutcomes();
    const owner = this.owners.get(businessId);
    return { businessId,
      active: owner && owner.sessionId === sessionId ? { pageId: owner.pageId, status: "running" } : null,
      latest: this.outcomes.get(`${sessionId}:${businessId}`)?.value ?? null };
  }

  private pruneOutcomes() {
    for (const [key, entry] of this.outcomes) if (Date.now() - entry.at > 3600000) this.outcomes.delete(key);
    while (this.outcomes.size > 256) this.outcomes.delete(this.outcomes.keys().next().value!);
  }

  private outcome(sessionId: string | undefined, businessId: string, value: FacebookReportProgress["latest"]) {
    const key = `${sessionId}:${businessId}`;
    this.outcomes.delete(key);
    this.outcomes.set(key, { at: Date.now(), value });
    this.pruneOutcomes();
  }

  async create(
    sessionId: string | undefined,
    businessId: string,
    pageId: string,
  ): Promise<FacebookBrowserReport> {
    if (this.closing)
      throw new ServiceUnavailableException(
        "The server is stopping. Reconnect after it restarts.",
      );
    if (
      typeof businessId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(businessId) ||
      typeof pageId !== "string" ||
      !/^\d{1,40}$/.test(pageId)
    ) {
      throw new BadRequestException({
        code: "INVALID_FACEBOOK_TARGET",
        message: "Select a registered business and a numeric Facebook Page ID.",
      });
    }
    if (this.jobs.has(businessId))
      throw new ConflictException({
        code: "AUDIT_ALREADY_ACTIVE",
        message:
          "A Facebook report is already being generated for this business.",
      });
    // Schedule after reserving the business so concurrent requests cannot both enter.
    const job = Promise.resolve().then(() =>
      this.run(sessionId, businessId, pageId),
    );
    this.jobs.set(businessId, job);
    this.owners.set(businessId, { sessionId, pageId });
    this.outcomes.delete(`${sessionId}:${businessId}`);
    try {
      const result = await job;
      this.outcome(sessionId, businessId, { pageId, result, error: null });
      return result;
    } catch (error) {
      const response = error instanceof HttpException ? error.getResponse() : null;
      const detail = response && typeof response === "object" ? response as Record<string, unknown> : null;
      this.outcome(sessionId, businessId, { pageId, result: null, error: {
        code: typeof detail?.code === "string" ? detail.code : "FACEBOOK_REPORT_FAILED",
        message: typeof detail?.message === "string" ? detail.message : "The Facebook report could not be generated. Please try again.",
      } });
      throw error;
    } finally {
      this.jobs.delete(businessId);
      this.owners.delete(businessId);
    }
  }

  private async run(
    sessionId: string | undefined,
    businessId: string,
    pageId: string,
  ): Promise<FacebookBrowserReport> {
    const credential = await this.facebook.credential(sessionId);
    const business = await this.businesses.findById(businessId);
    if (!business)
      throw new NotFoundException({
        code: "BUSINESS_NOT_FOUND",
        message: "Business not found.",
      });
    this.abort.signal.throwIfAborted();
    try {
      await this.facebook.requirePermissions(credential.token);
    } catch (error) {
      if (error instanceof FacebookError && error.providerCode === 190) {
        await this.facebook.markReconnect(sessionId);
        throw new BadRequestException({
          code: "FACEBOOK_RECONNECT_REQUIRED",
          message:
            "Facebook access expired or was revoked. Reconnect Facebook.",
        });
      }
      if (error instanceof FacebookError)
        throw new BadRequestException({
          code: "FACEBOOK_PERMISSION_CHECK_FAILED",
          message: "Facebook permissions could not be checked. Try again.",
        });
      throw error;
    }
    const now = new Date().toISOString();
    const audit: Audit = {
      id: randomUUID(),
      businessId,
      scope: "facebook",
      mode: "live",
      status: "running",
      stage: "collecting_evidence",
      createdAt: now,
      startedAt: now,
      completedAt: null,
      warnings: [],
      failure: null,
      scoringVersion: "facebook-v1",
      results: null,
    };
    if (this.audits && !await this.audits.createIfIdle(audit)) throw new ConflictException({ code: "AUDIT_ALREADY_ACTIVE", message: "A Facebook report is already queued or running for this business." });
    try {
      const collected = await collectFacebookReport(
        this.graph,
        credential.token,
        pageId,
        audit.id,
        this.abort.signal,
      );
      audit.results = collected.results;
      audit.warnings = collected.warnings;
      audit.status = collected.partial ? "partial" : "completed";
      audit.stage = "complete";
    } catch (error) {
      audit.status = "failed";
      audit.stage = "failed";
      audit.failure = {
        code: this.abort.signal.aborted
          ? "SERVER_STOPPING"
          : error instanceof FacebookCollectionError
            ? error.code
            : "FACEBOOK_COLLECTION_FAILED",
        message: this.abort.signal.aborted
          ? "Facebook collection was interrupted by server shutdown."
          : "Facebook collection could not be completed. Review Page access and reconnect if required.",
      };
    }
    audit.completedAt = new Date().toISOString();
    try {
      const reference = await this.reports.write(audit, business);
      audit.report = reference;
      await this.audits?.save(audit);
      return { ...reference, status: audit.status, failure: audit.failure };
    } catch {
      audit.status = "failed";
      audit.stage = "failed";
      audit.failure = { code: "REPORT_WRITE_FAILED", message: "The Facebook report could not be saved." };
      await this.audits?.save(audit);
      throw new ServiceUnavailableException({
        code: "REPORT_WRITE_FAILED",
        message:
          "The Facebook report could not be saved. No saved report is available for this attempt.",
      });
    }
  }

  async onModuleDestroy() {
    this.closing = true;
    this.abort.abort();
    await Promise.allSettled(this.jobs.values());
  }
}
