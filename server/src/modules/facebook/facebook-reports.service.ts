import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Audit, AuditStatus } from "../../contracts/domain.js";
import { collectFacebookReport } from "../../integrations/facebook/collect.js";
import { FacebookCollectionError } from "../../integrations/facebook/types.js";
import {
  BUSINESS_REPOSITORY,
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

/** Local operator workflow; Page authorization does not establish business ownership. */
@Injectable()
export class FacebookReportsService implements OnModuleDestroy {
  private readonly jobs = new Map<string, Promise<FacebookBrowserReport>>();
  private readonly abort = new AbortController();
  private closing = false;

  constructor(
    private readonly reports: FileReportStore,
    @Inject(BUSINESS_REPOSITORY)
    private readonly businesses: BusinessRepository,
    private readonly graph: FacebookGraph,
    private readonly facebook: FacebookService,
  ) {}

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
    try {
      return await job;
    } finally {
      this.jobs.delete(businessId);
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
      return { ...reference, status: audit.status, failure: audit.failure };
    } catch {
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
