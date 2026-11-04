import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, OnModuleDestroy, Optional, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { AuditStatus, AuditStage } from "../../contracts/domain.js";
import { BUSINESS_REPOSITORY, type BusinessRepository } from "../../persistence/repositories.js";
import { FileReportStore } from "../../reports/file-report.store.js";
import { AssessmentService } from "../assessments/assessment.service.js";
import { AuditsService } from "../audits/audits.service.js";
import { FacebookReportsService } from "./facebook-reports.service.js";
import { FacebookService } from "./facebook.service.js";
import { InvestigationAiService } from "../investigation-ai/investigation-ai.service.js";
import type { InterpretationContext } from "../../reporting/investigation-interpretation.js";

export interface OverallInvestigation {
  id: string; businessId: string;
  audit: {
    id: string; businessId: string; scope: "lighthouse"; strategy: "mobile"; mode: "live";
    status: AuditStatus; stage: AuditStage; createdAt: string; startedAt: string | null; completedAt: string | null;
    warnings: string[]; failure: { code: string; message: string } | null; scoringVersion: "overall-investigation-v1";
    counts: { findings: number; recommendations: number };
  };
  websiteReportId: string | null; facebookReportId: string | null; assessmentId: string | null;
}
export interface OverallInvestigationStatus { businessId: string; active: OverallInvestigation | null; latest: OverallInvestigation | null }
type Entry = { sessionId: string; value: OverallInvestigation; at: number; interpretation?: InterpretationContext };

/** Only an explicit browser-authorized POST starts collection. Status never calls a provider. */
@Injectable()
export class OverallInvestigationService implements OnModuleDestroy {
  private readonly active = new Map<string, Entry>();
  private readonly latest = new Map<string, Entry>();
  private readonly jobs = new Set<Promise<void>>();
  private readonly abort = new AbortController();
  private closing = false;
  constructor(private readonly facebook: FacebookService, private readonly facebookReports: FacebookReportsService,
    private readonly audits: AuditsService, private readonly reports: FileReportStore, private readonly assessments: AssessmentService,
    @Inject(BUSINESS_REPOSITORY) private readonly businesses: BusinessRepository, @Optional() private readonly interpretation?: InvestigationAiService) {}

  private async authorize(sessionId: string | undefined, businessId: string): Promise<string> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(businessId)) throw new BadRequestException({ code: "INVALID_BUSINESS", message: "Select a registered business." });
    await this.facebook.credential(sessionId);
    if (!sessionId) throw new BadRequestException({ code: "FACEBOOK_SESSION_REQUIRED", message: "Reconnect Facebook before running the overall investigation." });
    if (!await this.businesses.findById(businessId)) throw new NotFoundException({ code: "BUSINESS_NOT_FOUND", message: "Business not found." });
    return sessionId;
  }
  private prune() {
    for (const [key, entry] of this.latest) if (Date.now() - entry.at > 3600000) this.latest.delete(key);
    while (this.latest.size > 256) this.latest.delete(this.latest.keys().next().value!);
  }
  async status(sessionId: string | undefined, businessId: string): Promise<OverallInvestigationStatus> {
    const owner = await this.authorize(sessionId, businessId);
    this.prune();
    const active = this.active.get(businessId);
    return structuredClone({ businessId, active: active?.sessionId === owner ? active.value : null,
      latest: this.latest.get(`${owner}:${businessId}`)?.value ?? null });
  }
  async start(sessionId: string | undefined, businessId: string, interpretation?: InterpretationContext): Promise<OverallInvestigation> {
    if (this.closing) throw new ServiceUnavailableException({ code: "SERVER_STOPPING", message: "The server is stopping. No investigation was started." });
    const owner = await this.authorize(sessionId, businessId);
    if (this.active.has(businessId)) throw new ConflictException({ code: "AUDIT_ALREADY_ACTIVE", message: "An overall investigation is already running for this business." });
    const now = new Date().toISOString(), id = randomUUID();
    const value: OverallInvestigation = { id, businessId, websiteReportId: null, facebookReportId: null, assessmentId: null,
      audit: { id, businessId, scope: "lighthouse", strategy: "mobile", mode: "live", status: "queued", stage: "queued", createdAt: now,
        startedAt: null, completedAt: null, warnings: [], failure: null, scoringVersion: "overall-investigation-v1", counts: { findings: 0, recommendations: 0 } } };
    const entry: Entry = { sessionId: owner, value, at: Date.now(), interpretation };
    // Reserve synchronously before saved target lookup or any provider work.
    this.active.set(businessId, entry);
    this.latest.delete(`${owner}:${businessId}`);
    const job = Promise.resolve().then(() => this.run(entry));
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job));
    return structuredClone(value);
  }
  private async run(entry: Entry): Promise<void> {
    const { value, sessionId } = entry, audit = value.audit;
    try {
      this.abort.signal.throwIfAborted();
      audit.status = "running"; audit.stage = "collecting_evidence"; audit.startedAt = new Date().toISOString();
      const candidates = await this.reports.list(value.businessId);
      const selected = candidates.find(item => item.scope === "facebook" && item.mode === "live" && ["completed", "partial"].includes(item.status));
      const previous = selected ? await this.reports.read(selected.auditId) : null;
      const pageId = previous?.results?.facebook?.pageId;
      if (!pageId || previous?.business.id !== value.businessId || previous.audit.businessId !== value.businessId) throw new BadRequestException({ code: "FACEBOOK_TARGET_REQUIRED", message: "Generate a Facebook report for this business first to select its authorized Page." });
      // Reuses the browser credential, required grants, authorized Page selection and bounded collector.
      const facebook = await this.facebookReports.create(sessionId, value.businessId, pageId);
      value.facebookReportId = facebook.auditId;
      if (!["completed", "partial"].includes(facebook.status)) throw new BadRequestException({ code: facebook.failure?.code ?? "FACEBOOK_COLLECTION_FAILED", message: "The fresh Facebook report failed. The overall investigation did not use an older report." });
      this.abort.signal.throwIfAborted();
      audit.stage = "running_lighthouse";
      const website = await this.audits.create(value.businessId, "lighthouse", "mobile");
      value.websiteReportId = website.id;
      const deadline = AbortSignal.any([this.abort.signal, AbortSignal.timeout(300000)]);
      let saved = await this.audits.get(website.id);
      while (["queued", "running"].includes(saved.status)) {
        await delay(250, undefined, { signal: deadline });
        saved = await this.audits.get(website.id);
      }
      if (!["completed", "partial"].includes(saved.status)) throw new BadRequestException({ code: saved.failure?.code ?? "WEBSITE_COLLECTION_FAILED", message: "The fresh website report failed. Previous reports remain saved." });
      this.abort.signal.throwIfAborted();
      audit.stage = "preparing_recommendations";
      const assessment = await this.assessments.create(value.businessId, { websiteReportId: website.id, facebookReportId: facebook.auditId, profile: "baseline-mobile-v1" });
      value.assessmentId = assessment.id;
      const unavailable = Object.entries(assessment.snapshot.scores).filter(([, score]) => score.availability !== "available").map(([name]) => name);
      audit.counts = { findings: saved.results?.findings.length ?? 0, recommendations: saved.results?.recommendations.length ?? 0 };
      let terminalStatus: AuditStatus = unavailable.length || saved.status === "partial" || facebook.status === "partial" ? "partial" : "completed";
      if (unavailable.length) {
        audit.failure = { code: "ASSESSMENT_INCOMPLETE", message: `Fresh reports were saved, but ${unavailable.join(", ")} scores require complete eligible evidence or a current business review.` };
        audit.warnings.push(audit.failure.message);
      }
      if (entry.interpretation) {
        try { const ai = await this.interpretation?.interpret(entry.interpretation, [website.id, facebook.auditId]); if (ai?.status !== "completed") throw new Error(); }
        catch {
          terminalStatus = "partial";
          audit.failure ??= { code: "AI_INTERPRETATION_FAILED", message: "Fresh reports and scores were saved, but AI interpretation did not complete. No automatic model retry was started." };
          audit.warnings.push("AI interpretation did not complete. No automatic model retry was started.");
        }
      }
      audit.status = terminalStatus;
      audit.stage = "complete";
    } catch (error) {
      const response = error instanceof HttpException ? error.getResponse() : null;
      const detail = response && typeof response === "object" ? response as Record<string, unknown> : null;
      audit.status = "failed"; audit.stage = "failed";
      const timedOut = !!error && typeof error === "object" && "name" in error && error.name === "AbortError" && !this.abort.signal.aborted;
      audit.failure = { code: this.abort.signal.aborted ? "SERVER_STOPPING" : timedOut ? "OVERALL_INVESTIGATION_TIMEOUT" : typeof detail?.code === "string" ? detail.code : "OVERALL_INVESTIGATION_FAILED",
        message: this.abort.signal.aborted ? "The investigation was interrupted by server shutdown. Saved channel reports remain available; no collection will replay automatically."
          : timedOut ? "The website investigation did not finish within the overall reporting deadline. Saved reports remain available. Check its existing audit status; no automatic retry was started."
            : typeof detail?.message === "string" ? detail.message : "The overall investigation could not complete. Saved reports remain available; no automatic retry was started." };
    } finally {
      audit.completedAt = new Date().toISOString(); entry.at = Date.now();
      this.active.delete(value.businessId);
      this.latest.set(`${sessionId}:${value.businessId}`, entry);
      this.prune();
    }
  }
  async onModuleDestroy() { this.closing = true; this.abort.abort(); await Promise.allSettled(this.jobs); }
}
