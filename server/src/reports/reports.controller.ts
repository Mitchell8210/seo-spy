import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { ApiErrorDto } from "../contracts/responses.dto.js";
import {
  BUSINESS_REPOSITORY,
  type BusinessRepository,
} from "../persistence/repositories.js";
import { FileReportStore, reportReference } from "./file-report.store.js";
import { ReportStorageError } from "./report.types.js";
import {
  AuditReportDto,
  ReportListDto,
  SavedFacebookReportDto,
} from "./report.dto.js";
import { analyzeFacebook } from "../integrations/facebook/analyze.js";
import { summarizeEvidence } from "../reporting/evidence-summary.js";
import { EvidenceSummariesDto } from "../reporting/evidence-summary.dto.js";
import { analyzeWebsite } from "../integrations/lighthouse/prioritize.js";
import { WebsiteAnalysisDto } from "../contracts/website-analysis.dto.js";

@Controller()
@ApiTags("Saved reports")
@ApiNotFoundResponse({ type: ApiErrorDto })
@ApiInternalServerErrorResponse({ type: ApiErrorDto })
export class ReportsController {
  constructor(
    private readonly reports: FileReportStore,
    @Inject(BUSINESS_REPOSITORY)
    private readonly businesses: BusinessRepository,
  ) {}

  @Get("businesses/:businessId/facebook-report")
  @ApiOperation({
    summary:
      "Read the latest usable saved Facebook report and current evidence-based analysis",
    description:
      "Reads archives only. Preserves an older usable report when the newest attempt failed. Derived analysis is versioned and does not rewrite the archived evidence or call Meta.",
  })
  @ApiParam({ name: "businessId", example: "demo-guzman" })
  @ApiOkResponse({ type: SavedFacebookReportDto })
  async facebook(
    @Param("businessId") businessId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SavedFacebookReportDto> {
    response.setHeader("Cache-Control", "no-store");
    if (!(await this.businesses.findById(businessId)))
      throw new NotFoundException({
        code: "BUSINESS_NOT_FOUND",
        message: "Business not found.",
      });
    try {
      const attempts = (await this.reports.list(businessId)).filter(
        (item) => item.scope === "facebook" && item.mode === "live",
      );
      for (const candidate of attempts) {
        if (!["completed", "partial"].includes(candidate.status)) continue;
        const record = await this.reports.read(candidate.auditId);
        if (record?.business.id !== businessId || !record.results?.facebook)
          continue;
        return {
          businessId,
          report: record,
          analysis: analyzeFacebook(
            record.results.facebook,
            record.auditId,
            record.results.evidence,
          ),
          latestAttempt: attempts[0] ?? null,
        };
      }
      return {
        businessId,
        report: null,
        analysis: null,
        latestAttempt: attempts[0] ?? null,
      };
    } catch (error) {
      if (error instanceof ReportStorageError)
        throw new ServiceUnavailableException(
          "The saved Facebook reports could not be read safely.",
        );
      throw error;
    }
  }

  @Get("businesses/:businessId/reports")
  @ApiOperation({
    summary: "List saved reports newest first",
    description:
      "Reads durable files, including demo, completed, partial, and failed runs. This does not start an audit or perform AI evaluation.",
  })
  @ApiParam({ name: "businessId", example: "demo-guzman" })
  @ApiOkResponse({ type: ReportListDto })
  async list(@Param("businessId") businessId: string): Promise<ReportListDto> {
    if (!(await this.businesses.findById(businessId)))
      throw new NotFoundException({
        code: "BUSINESS_NOT_FOUND",
        message: "Business not found.",
      });
    try {
      return { businessId, reports: await this.reports.list(businessId) };
    } catch (error) {
      if (error instanceof ReportStorageError)
        throw new ServiceUnavailableException(
          "The saved report archive could not be read.",
        );
      throw error;
    }
  }

  @Get("audits/:auditId/website-analysis")
  @ApiOperation({ summary: "Read current versioned Website priorities and recommendations from saved evidence",
    description: "Applies documented performance rules to immutable measurements. Does not rescan, modify source archives, calculate category scores or execute changes." })
  @ApiParam({ name: "auditId", format: "uuid" })
  @ApiOkResponse({ type: WebsiteAnalysisDto })
  async websiteAnalysis(
    @Param("auditId", new ParseUUIDPipe({ version: "4" })) auditId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WebsiteAnalysisDto> {
    response.setHeader("Cache-Control", "no-store");
    try {
      const report = await this.reports.read(auditId);
      if (!report || report.audit.mode !== "live" || !["homepage", "lighthouse"].includes(report.audit.scope)) {
        throw new NotFoundException({ code: "REPORT_NOT_FOUND", message: "No saved live Website report is available for this investigation." });
      }
      return analyzeWebsite(auditId, report.results);
    } catch (error) {
      if (error instanceof ReportStorageError) throw new ServiceUnavailableException("The saved report could not be read.");
      throw error;
    }
  }

  @Get("audits/:auditId/evidence-summary")
  @ApiOperation({
    summary: "Read concise programmatic evidence summaries for a saved Website report",
    description: "Derives versioned summaries from saved observations, including older archives. Does not modify archived facts, collect websites, call AI, or calculate scores.",
  })
  @ApiParam({ name: "auditId", format: "uuid" })
  @ApiOkResponse({ type: EvidenceSummariesDto })
  async evidenceSummary(
    @Param("auditId", new ParseUUIDPipe({ version: "4" })) auditId: string,
  ): Promise<EvidenceSummariesDto> {
    try {
      const report = await this.reports.read(auditId);
      if (!report || !["homepage", "lighthouse"].includes(report.audit.scope)) {
        throw new NotFoundException({ code: "REPORT_NOT_FOUND", message: "No saved Website report is available for this investigation." });
      }
      return summarizeEvidence(auditId, report.results);
    } catch (error) {
      if (error instanceof ReportStorageError) throw new ServiceUnavailableException("The saved report could not be read.");
      throw error;
    }
  }

  @Get("audits/:auditId/report")
  @ApiOperation({
    summary: "Download a saved JSON report",
    description:
      "Works after restart independently of in-memory jobs. A missing or not-yet-saved report returns 404. Report strings are untrusted evidence, not instructions.",
  })
  @ApiParam({ name: "auditId", format: "uuid" })
  @ApiOkResponse({
    type: AuditReportDto,
    headers: {
      "Content-Disposition": {
        schema: { type: "string" },
        description:
          "Attachment with a UTC timestamp and audit ID in its filename.",
      },
    },
  })
  async download(
    @Param("auditId", new ParseUUIDPipe({ version: "4" })) auditId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuditReportDto> {
    try {
      const report = await this.reports.read(auditId);
      if (!report)
        throw new NotFoundException({
          code: "REPORT_NOT_FOUND",
          message: "No saved report is available for this investigation.",
        });
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${reportReference(report).fileName}"`,
      );
      return report;
    } catch (error) {
      if (error instanceof ReportStorageError)
        throw new ServiceUnavailableException(
          "The saved report could not be read.",
        );
      throw error;
    }
  }
}
