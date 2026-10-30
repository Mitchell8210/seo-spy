import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Audit } from "../../contracts/domain.js";
import { DEMO_NOTICE } from "../../fixtures/demo.js";
import {
  AUDIT_REPOSITORY,
  BUSINESS_REPOSITORY,
  type AuditRepository,
  type BusinessRepository,
} from "../../persistence/repositories.js";
import { HOMEPAGE_NOTICE } from "../../integrations/website/analyze.js";
import { AuditRunner } from "./audit-runner.service.js";
import {
  LIGHTHOUSE_NOTICE,
  type LighthouseStrategy,
} from "../../integrations/lighthouse/types.js";
import {
  FileReportStore,
  reportReference,
} from "../../reports/file-report.store.js";

export function auditSummary(audit: Audit) {
  const { results, ...summary } = audit;
  return {
    ...summary,
    counts: {
      findings: results?.findings.length ?? 0,
      recommendations: results?.recommendations.length ?? 0,
    },
  };
}

@Injectable()
export class AuditsService {
  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly audits: AuditRepository,
    @Inject(BUSINESS_REPOSITORY)
    private readonly businesses: BusinessRepository,
    private readonly runner: AuditRunner,
    private readonly reports: FileReportStore,
  ) {}

  async create(
    businessId: string,
    scope: Audit["scope"] = "demo",
    strategy?: LighthouseStrategy,
  ) {
    if (scope === "facebook")
      throw new BadRequestException({
        code: "FACEBOOK_LOCAL_ONLY",
        message:
          "Facebook report creation currently uses the local audit:facebook command with explicit Page selection.",
      });
    this.runner.assertAcceptingWork();
    if (scope !== "lighthouse" && strategy !== undefined)
      throw new BadRequestException({
        code: "INVALID_REQUEST",
        message: "Device strategy is only supported for lighthouse scope.",
      });
    if (!(await this.businesses.findById(businessId)))
      throw new NotFoundException({
        code: "BUSINESS_NOT_FOUND",
        message: "Business not found.",
      });
    const audit: Audit = {
      id: randomUUID(),
      businessId,
      scope,
      ...(scope === "lighthouse" ? { strategy: strategy ?? "mobile" } : {}),
      mode: scope === "demo" ? "demo" : "live",
      status: "queued",
      stage: "queued",
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      warnings: [
        scope === "demo"
          ? DEMO_NOTICE
          : scope === "lighthouse"
            ? LIGHTHOUSE_NOTICE
            : HOMEPAGE_NOTICE,
      ],
      failure: null,
      scoringVersion:
        scope === "demo"
          ? "demo-v1"
          : scope === "lighthouse"
            ? "lighthouse-v1"
            : "homepage-v1",
      results: null,
    };
    if (!(await this.audits.createIfIdle(audit)))
      throw new ConflictException({
        code: "AUDIT_ALREADY_ACTIVE",
        message:
          "An investigation is already queued or running for this business.",
      });
    this.runner.enqueue(audit.id);
    return { ...auditSummary(audit), statusUrl: `/api/audits/${audit.id}` };
  }

  async get(id: string) {
    const audit = await this.audits.findById(id);
    if (audit) return audit;
    const archived = await this.reports.read(id);
    if (archived)
      return {
        ...archived.audit,
        results: archived.results,
        report: reportReference(archived),
      };
    throw new NotFoundException({
      code: "AUDIT_NOT_FOUND",
      message: "Investigation not found.",
    });
  }

  async findings(id: string) {
    const audit = await this.get(id);
    return {
      mode: audit.mode,
      auditId: id,
      status: audit.status,
      findings: audit.results?.findings ?? [],
      evidence: audit.results?.evidence ?? [],
    };
  }

  async recommendations(id: string) {
    const audit = await this.get(id);
    return {
      mode: audit.mode,
      auditId: id,
      status: audit.status,
      recommendations: audit.results?.recommendations ?? [],
    };
  }

  async lighthouse(id: string) {
    const audit = await this.get(id);
    return {
      mode: audit.mode,
      auditId: id,
      status: audit.status,
      report: audit.results?.lighthouse ?? null,
      failure: audit.failure,
      warnings: audit.warnings,
    };
  }
}
