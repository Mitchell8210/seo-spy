import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { setTimeout as delay } from "node:timers/promises";
import {
  WebsiteCollector,
  CollectionError,
} from "../../integrations/website/collector.js";
import { analyzeHomepage } from "../../integrations/website/analyze.js";
import { PageSpeedService } from "../../integrations/lighthouse/pagespeed.service.js";
import { PageSpeedError } from "../../integrations/lighthouse/types.js";
import { attachLighthouse } from "../../integrations/lighthouse/evidence.js";
import type { Audit, AuditStage } from "../../contracts/domain.js";
import { FileReportStore } from "../../reports/file-report.store.js";
import { ReportStorageError } from "../../reports/report.types.js";
import { createDemoResults } from "../../fixtures/demo.js";
import {
  AUDIT_REPOSITORY,
  BUSINESS_REPOSITORY,
  type BusinessRepository,
  type AuditRepository,
} from "../../persistence/repositories.js";

@Injectable()
export class AuditRunner implements OnModuleDestroy {
  private readonly logger = new Logger(AuditRunner.name);
  private readonly abort = new AbortController();
  private readonly jobs = new Set<Promise<void>>();
  private closing = false;

  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly audits: AuditRepository,
    private readonly config: ConfigService,
    private readonly collector: WebsiteCollector,
    private readonly pagespeed: PageSpeedService,
    private readonly reports: FileReportStore,
    @Inject(BUSINESS_REPOSITORY)
    private readonly businesses: BusinessRepository,
  ) {}

  assertAcceptingWork() {
    if (this.closing)
      throw new ServiceUnavailableException({
        code: "SERVER_STOPPING",
        message: "The server is stopping. Try again after it restarts.",
      });
  }

  enqueue(id: string) {
    this.assertAcceptingWork();
    const job = this.run(id).catch((error: unknown) => {
      this.logger.error(
        error instanceof Error ? error.stack : "Audit runner failed",
      );
    });
    this.jobs.add(job);
    void job.then(() => this.jobs.delete(job));
  }

  private async run(id: string) {
    try {
      const initial = await this.audits.findById(id);
      if (initial && initial.scope !== "demo") {
        initial.startedAt = new Date().toISOString();
        initial.status = "running";
        initial.stage = "collecting_evidence";
        await this.audits.save(initial);
        const business = await this.businesses.findById(initial.businessId);
        if (!business) throw new Error("Business not found");
        const page = await this.collector.collect(
          business.website,
          this.abort.signal,
        );
        initial.stage = "evaluating_checks";
        await this.audits.save(initial);
        initial.results = analyzeHomepage(page, id);
        if (initial.scope === "lighthouse") {
          initial.stage = "running_lighthouse";
          await this.audits.save(initial);
          try {
            const report = await this.pagespeed.run(
              page.finalUrl,
              initial.strategy ?? "mobile",
              this.abort.signal,
            );
            attachLighthouse(initial.results, report, id);
            initial.warnings.push(...report.warnings);
            if (
              report.categories.some(
                (category) => category.availability === "unavailable",
              )
            ) {
              initial.failure = {
                code: "LIGHTHOUSE_INCOMPLETE",
                message: "Some Lighthouse category scores are unavailable.",
              };
            }
          } catch (error) {
            if (this.abort.signal.aborted) throw error;
            initial.failure =
              error instanceof PageSpeedError
                ? { code: error.code, message: error.message }
                : {
                    code: "PAGESPEED_UNAVAILABLE",
                    message: "Lighthouse measurements could not be collected.",
                  };
            initial.warnings.push(
              `HTML findings are available; Lighthouse measurements failed (${initial.failure.code}).`,
            );
          }
        }
        initial.stage = "preparing_recommendations";
        await this.audits.save(initial);
        this.abort.signal.throwIfAborted();
        initial.status = initial.failure ? "partial" : "completed";
        initial.stage = "complete";
        initial.completedAt = new Date().toISOString();
        await this.saveTerminal(initial);
        return;
      }
      const stages: AuditStage[] = [
        "collecting_evidence",
        "evaluating_checks",
        "preparing_recommendations",
        "complete",
      ];
      for (const stage of stages) {
        await delay(
          this.config.getOrThrow<number>("DEMO_STAGE_DELAY_MS"),
          undefined,
          { signal: this.abort.signal },
        );
        const audit = await this.audits.findById(id);
        if (!audit) throw new Error("Queued audit was not found");
        audit.startedAt ??= new Date().toISOString();
        audit.stage = stage;
        audit.status = stage === "complete" ? "completed" : "running";
        if (stage === "complete") {
          audit.completedAt = new Date().toISOString();
          audit.results = createDemoResults(id, audit.completedAt);
        }
        if (stage === "complete") await this.saveTerminal(audit);
        else await this.audits.save(audit);
      }
    } catch (error) {
      const audit = await this.audits.findById(id);
      if (audit) {
        audit.status = "failed";
        audit.stage = "failed";
        audit.completedAt = new Date().toISOString();
        audit.failure =
          error instanceof ReportStorageError
            ? {
                code: "REPORT_WRITE_FAILED",
                message: "The investigation report could not be saved to disk.",
              }
            : this.abort.signal.aborted
              ? {
                  code: "SERVER_STOPPING",
                  message: "The audit was interrupted by server shutdown.",
                }
              : error instanceof CollectionError ||
                  error instanceof PageSpeedError
                ? { code: error.code, message: error.message }
                : {
                    code: "AUDIT_FAILED",
                    message: "The audit could not be completed.",
                  };
        if (error instanceof ReportStorageError) {
          audit.warnings.push(
            "The report was not saved. Check the report archive directory and available disk space.",
          );
          await this.audits.save(audit);
        } else {
          try {
            await this.saveTerminal(audit);
          } catch {
            audit.warnings.push(
              `The investigation ended with ${audit.failure.code}, but its failure report could not be saved.`,
            );
            audit.failure = {
              code: "REPORT_WRITE_FAILED",
              message: "The investigation report could not be saved to disk.",
            };
            await this.audits.save(audit);
          }
        }
      }
      if (!this.abort.signal.aborted) throw error;
    }
  }

  private async saveTerminal(audit: Audit) {
    const business = await this.businesses.findById(audit.businessId);
    if (!business)
      throw new ReportStorageError(
        "REPORT_WRITE_FAILED",
        "The report business snapshot is unavailable.",
      );
    // Do not publish a successful terminal state until its durable snapshot exists.
    audit.report = await this.reports.write(audit, business);
    await this.audits.save(audit);
  }

  async onModuleDestroy() {
    this.closing = true;
    this.abort.abort();
    await Promise.allSettled(this.jobs);
  }
}
