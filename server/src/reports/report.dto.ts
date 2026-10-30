import { ApiProperty, ApiPropertyOptional, OmitType } from "@nestjs/swagger";
import {
  AuditCountsDto,
  AuditSummaryDto,
  BusinessDto,
  EvidenceDto,
  FindingDto,
  RecommendationDto,
  ScoreDto,
} from "../contracts/responses.dto.js";
import { LighthouseReportDto } from "../contracts/lighthouse.dto.js";
import type { Audit, AuditResults } from "../contracts/domain.js";
import type { AuditReportRecord, StoredReportSummary } from "./report.types.js";
import { ReportFileReferenceDto } from "./report-reference.dto.js";
import type { FacebookReport } from "../integrations/facebook/types.js";
import type { FacebookAnalysis } from "../integrations/facebook/analyze.js";
import { EvidenceSummariesDto } from "../reporting/evidence-summary.dto.js";
import { WebsiteAnalysisDto } from "../contracts/website-analysis.dto.js";

class ArchivedAuditDto extends OmitType(AuditSummaryDto, [
  "counts",
  "report",
] as const) {}

class ArchivedResultsDto implements AuditResults {
  @ApiPropertyOptional({ type: () => WebsiteAnalysisDto })
  websiteAnalysis?: WebsiteAnalysisDto;
  @ApiPropertyOptional({ type: () => EvidenceSummariesDto })
  evidenceSummaries?: EvidenceSummariesDto;
  @ApiProperty({ type: [EvidenceDto] }) evidence!: EvidenceDto[];
  @ApiProperty({ type: [FindingDto] }) findings!: FindingDto[];
  @ApiProperty({ type: [RecommendationDto] })
  recommendations!: RecommendationDto[];
  @ApiProperty({ type: [ScoreDto] }) scores!: ScoreDto[];
  @ApiPropertyOptional({ type: () => LighthouseReportDto })
  lighthouse?: LighthouseReportDto;
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description:
      "Versioned Facebook collection: Page identity, dated profile fields with availability, bounded recent posts, daily insight series and coverage. Never includes access tokens. See FACEBOOK_SETUP.md for collection limits.",
  })
  facebook?: FacebookReport;
}

export class AuditReportDto implements AuditReportRecord {
  @ApiProperty({ enum: ["seo-spy.audit-report.v1"] })
  schemaVersion!: "seo-spy.audit-report.v1";
  @ApiProperty({ format: "uuid" }) reportId!: string;
  @ApiProperty({ format: "uuid" }) auditId!: string;
  @ApiProperty({ format: "date-time" }) generatedAt!: string;
  @ApiProperty({ type: () => BusinessDto }) business!: BusinessDto;
  @ApiProperty({ type: () => ArchivedAuditDto }) audit!: ArchivedAuditDto;
  @ApiProperty({ type: () => ArchivedResultsDto, nullable: true })
  results!: ArchivedResultsDto | null;
}

export class StoredReportSummaryDto
  extends ReportFileReferenceDto
  implements StoredReportSummary
{
  @ApiProperty() businessId!: string;
  @ApiProperty({ enum: ["demo", "homepage", "lighthouse", "facebook"] })
  scope!: Audit["scope"];
  @ApiProperty({ enum: ["demo", "live"] }) mode!: Audit["mode"];
  @ApiProperty({ enum: ["completed", "partial", "failed"] })
  status!: Audit["status"];
  @ApiProperty({ type: () => AuditCountsDto }) counts!: AuditCountsDto;
}

export class ReportListDto {
  @ApiProperty() businessId!: string;
  @ApiProperty({
    type: [StoredReportSummaryDto],
    description:
      "Saved files sorted by generatedAt descending, with report ID as a deterministic tie-breaker.",
  })
  reports!: StoredReportSummaryDto[];
}

export class FacebookAnalysisDto implements FacebookAnalysis {
  @ApiProperty({ type: () => EvidenceSummariesDto, description: "Programmatic, evidence-linked descriptions for the existing report details; raw archived facts remain unchanged." })
  evidenceSummaries!: EvidenceSummariesDto;
  @ApiProperty({ enum: ["facebook-analysis-v1"] })
  version!: "facebook-analysis-v1";
  @ApiProperty({
    format: "uuid",
    description:
      "Source audit/report ID; analysis uses immutable saved evidence.",
  })
  auditId!: string;
  @ApiProperty({ type: [String] }) summaries!: string[];
  @ApiProperty({ type: [FindingDto] }) findings!: FindingDto[];
  @ApiProperty({ type: [RecommendationDto] })
  recommendations!: RecommendationDto[];
}
export class SavedFacebookReportDto {
  @ApiProperty() businessId!: string;
  @ApiProperty({
    type: () => AuditReportDto,
    nullable: true,
    description:
      "Most recent completed/partial Facebook archive with usable results, or null.",
  })
  report!: AuditReportDto | null;
  @ApiProperty({ type: () => FacebookAnalysisDto, nullable: true })
  analysis!: FacebookAnalysisDto | null;
  @ApiProperty({
    type: () => StoredReportSummaryDto,
    nullable: true,
    description: "Newest saved Facebook attempt, including failures.",
  })
  latestAttempt!: StoredReportSummaryDto | null;
}
