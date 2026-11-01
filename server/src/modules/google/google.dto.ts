import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional } from "class-validator";

export class SearchConsoleQueryDto {
  @ApiPropertyOptional({ enum: [7, 30], default: 30 }) @IsOptional() @Type(() => Number) @IsIn([7, 30]) days: 7 | 30 = 30;
  @ApiPropertyOptional({ enum: ["summary", "queries"], default: "summary", description: "Summary is a site-wide aggregate; queries are a bounded top-query sample and never substituted for site totals." }) @IsOptional() @IsIn(["summary", "queries"]) view: "summary" | "queries" = "summary";
}
export class GoogleReportingResponseDto {
  @ApiProperty({ enum: ["seo-spy.google-reporting.v1"] }) schemaVersion!: string;
  @ApiProperty() businessId!: string;
  @ApiProperty({ enum: ["ga4", "search-console"] }) provider!: string;
  @ApiProperty({ enum: ["service_account"] }) authentication!: string;
  @ApiProperty() asset!: string;
  @ApiProperty({ enum: ["available", "empty", "unavailable"], description: "Current provider availability. Unavailable may retain prior data explicitly marked stale; no zero is invented for an error." }) availability!: string;
  @ApiProperty({ type: "object", nullable: true, additionalProperties: true, description: "seo-spy.google-ga4.v1 (7/30-day metrics) or seo-spy.google-search-console.v1 (site summary or top queries). Contains original collection dates, exact metric provenance and coverage limitations; never credentials." }) data!: object | null;
  @ApiProperty({ type: "string", nullable: true, format: "date-time" }) fetchedAt!: string | null;
  @ApiProperty({ type: "string", format: "date-time" }) lastAttemptAt!: string;
  @ApiProperty({ type: "object", nullable: true, additionalProperties: true, description: "Sanitized code/message/httpStatus/reason only. Google error bodies, account identities and private keys are never returned." }) error!: object | null;
  @ApiProperty({ type: "object", additionalProperties: true, description: "hit, stale, expiresAt. Cache hits make no Google request. Failures are negatively cached with no automatic retry." }) cache!: object;
  @ApiProperty({ type: [String] }) limitations!: string[];
}
