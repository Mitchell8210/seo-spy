import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength } from "class-validator";
import type { OverallInvestigation, OverallInvestigationStatus } from "./overall-investigation.service.js";
import { AuditFailureDto, AuditCountsDto } from "../../contracts/responses.dto.js";

export class StartOverallInvestigationDto {
  @ApiProperty({ description: "Registered business whose latest saved Facebook report selects the Page" })
  @IsString() @Matches(/^[a-zA-Z0-9_-]+$/) @MaxLength(128) businessId!: string;
}
class OverallAuditDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() businessId!: string;
  @ApiProperty({ enum: ["lighthouse"] }) scope!: "lighthouse";
  @ApiProperty({ enum: ["mobile"] }) strategy!: "mobile";
  @ApiProperty({ enum: ["live"] }) mode!: "live";
  @ApiProperty({ enum: ["queued", "running", "completed", "partial", "failed"] }) status!: OverallInvestigation["audit"]["status"];
  @ApiProperty({ enum: ["queued", "collecting_evidence", "evaluating_checks", "running_lighthouse", "preparing_recommendations", "complete", "failed"] }) stage!: OverallInvestigation["audit"]["stage"];
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) startedAt!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) completedAt!: string | null;
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty({ type: () => AuditFailureDto, nullable: true }) failure!: OverallInvestigation["audit"]["failure"];
  @ApiProperty({ enum: ["overall-investigation-v1"] }) scoringVersion!: "overall-investigation-v1";
  @ApiProperty({ type: () => AuditCountsDto }) counts!: OverallInvestigation["audit"]["counts"];
}
export class OverallInvestigationDto implements OverallInvestigation {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() businessId!: string;
  @ApiProperty({ type: () => OverallAuditDto, description: "Overall workflow progress, not a downloadable channel audit" }) audit!: OverallAuditDto;
  @ApiProperty({ type: String, nullable: true, format: "uuid" }) websiteReportId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: "uuid" }) facebookReportId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: "uuid" }) assessmentId!: string | null;
}
export class OverallInvestigationStatusDto implements OverallInvestigationStatus {
  @ApiProperty() businessId!: string;
  @ApiProperty({ type: () => OverallInvestigationDto, nullable: true }) active!: OverallInvestigationDto | null;
  @ApiProperty({ type: () => OverallInvestigationDto, nullable: true }) latest!: OverallInvestigationDto | null;
}
