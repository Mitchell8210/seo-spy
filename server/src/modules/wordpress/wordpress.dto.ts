import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { Equals, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import type { RankMathStatus } from "../../integrations/wordpress/rankmath-execution.js";

const rankMathStatuses = ["success", "failed", "timeout", "unsupported", "unknown"] as const;
export class CreateWordPressMuseAnalysisDto {
  @ApiProperty({ enum: [true], description: "Explicit analysis request. Defaults to a labeled local mock; does not authorize a paid call or WordPress changes." }) @Equals(true) confirmed!: true;
  @ApiPropertyOptional({ format: "uuid", description: "Required for real generation: an unexpired, separately administrator-approved intent for this exact operator/input/settings. Not required for mocks or cached reads." }) @IsOptional() @IsUUID("4") intentId?: string;
}
export class EstimateWordPressMuseDto {
  @ApiProperty({ minLength: 10, maxLength: 1000, description: "Explain which essential proof-of-concept behavior cannot reasonably be verified with mocks. No model call is made." }) @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}
export class WordPressMuseAnalysisResponseDto {
  @ApiProperty({ enum: ["seo-spy.wordpress-muse-analysis.v1"] }) schemaVersion!: string;
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() businessId!: string;
  @ApiProperty() siteUrl!: string;
  @ApiProperty({ format: "uuid" }) reportId!: string;
  @ApiProperty() sourceHash!: string;
  @ApiProperty() model!: string;
  @ApiProperty() promptVersion!: string;
  @ApiProperty() outputSchemaVersion!: string;
  @ApiProperty({ format: "date-time" }) startedAt!: string;
  @ApiProperty({ format: "date-time" }) generatedAt!: string;
  @ApiProperty({ type: "object", additionalProperties: true, description: "inputTokens/outputTokens; no chain-of-thought or raw provider payload." }) usage!: object;
  @ApiProperty({ nullable: true }) requestId!: string | null;
  @ApiProperty({ type: "object", additionalProperties: true, description: "Strict wordpress-muse-output-v1 summary, cited observations and informational recommendations with effort/risk/verification; seoSpyScore:null. No executable patches or approval." }) output!: object;
  @ApiProperty({ type: [String] }) limitations!: string[];
  @ApiPropertyOptional({ enum: ["mock", "poc", "demo"] }) generationMode?: string;
  @ApiPropertyOptional({ enum: ["mock-fixture", "meta"] }) provider?: string;
  @ApiPropertyOptional({ description: "True means a deterministic local fixture, never actual Meta analysis. Legacy records without provenance are identified as unknown." }) isMock?: boolean;
  @ApiPropertyOptional({ description: "Hash of scoped input/model/prompt/schema/settings/mode; mock and live caches are separate." }) cacheKey?: string;
  @ApiPropertyOptional() fixtureVersion?: string;
  @ApiPropertyOptional({ format: "uuid" }) usageAttemptId?: string;
}
export class VerifyWordPressAltDto {
  @ApiProperty({ enum: ["pages", "posts"], description: "Registered WordPress content resource hosting the image, not a caller-selected URL." }) @IsIn(["pages", "posts"]) pageResource!: "pages" | "posts";
  @ApiProperty() @IsInt() @Min(1) pageId!: number;
}
export class WordPressPublicVerificationDto {
  @ApiProperty({ enum: ["wordpress-public-verification-v1"] }) version!: string;
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) proposalId!: string;
  @ApiProperty() businessId!: string;
  @ApiProperty() siteUrl!: string;
  @ApiProperty({ format: "date-time" }) completedAt!: string;
  @ApiProperty() storedFieldMatches!: boolean;
  @ApiProperty() requestedUrl!: string;
  @ApiProperty({ nullable: true }) finalUrl!: string | null;
  @ApiProperty({ nullable: true }) collectedAt!: string | null;
  @ApiProperty({ enum: ["verified", "mismatch", "inconclusive"], description: "Public source-HTML image alt result, independent from stored-field success or SEO impact." }) status!: string;
  @ApiProperty() matchedImages!: number;
  @ApiProperty({ type: "array", items: { type: "string", nullable: true } }) observedAlts!: (string | null)[];
  @ApiProperty({ type: [String] }) limitations!: string[];
}
export class CreateWordPressReportDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 20, description: "Maximum published content items per collection. No fresh audit or write is triggered." })
  @IsOptional() @IsInt() @Min(1) @Max(20) sampleSize = 20;
}
export class WordPressReportListQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}
export class WordPressReportSummaryDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["seo-spy.wordpress-evidence.v1"] }) schemaVersion!: string;
  @ApiProperty() siteUrl!: string;
  @ApiProperty({ format: "date-time" }) generatedAt!: string;
  @ApiProperty({ enum: ["available", "partial", "unavailable"] }) availability!: string;
  @ApiProperty({ minimum: 1, maximum: 20 }) sampleSize!: number;
}
export class WordPressReportResponseDto extends WordPressReportSummaryDto {
  @ApiPropertyOptional({ enum: ["published-unprotected-v1"], description: "Evidence collected under the current visibility policy. Legacy reports without this marker remain readable but cannot be sent to Muse." }) collectionPolicyVersion?: string;
  @ApiProperty() businessId!: string;
  @ApiProperty({ format: "date-time" }) startedAt!: string;
  @ApiProperty({ type: "array", items: { type: "object", additionalProperties: true }, description: "Three source sections (pages/posts/media), each with collection time, availability, bounded published items (id/title/link/modifiedAt/altText) and limitations. Titles are untrusted text." }) content!: unknown[];
  @ApiProperty({ type: "array", items: { type: "object", additionalProperties: true }, description: "Page/post Rank Math sections: nullable rank-math-evidence-v1 evidence and limitations. Scores are filtered to the published sample. Collection time is not scoring time." }) rankMath!: unknown[];
  @ApiProperty({ type: "object", additionalProperties: true, description: "seoSpyScore and policyVersion are null; storedScoreFreshness is unknown. No combined score is calculated." }) scoring!: object;
  @ApiProperty({ type: [String] }) limitations!: string[];
}
export class WordPressReportListResponseDto {
  @ApiProperty() businessId!: string;
  @ApiProperty({ type: [WordPressReportSummaryDto] }) reports!: WordPressReportSummaryDto[];
}
export class RankMathAuditOutcomeResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() businessId!: string;
  @ApiProperty({ enum: rankMathStatuses, description: "Execution outcome, independent of HTTP receipt creation. A timeout does not prove remote cancellation. Legacy receipts without diagnostic proof are unknown." }) status!: RankMathStatus;
  @ApiPropertyOptional({ type: "object", additionalProperties: true, description: "rank-math-audit-v2: status, availability, score, findings, source/collection dates and redacted per-stage diagnostics. Original legacy payload fields are retained on reads." }) result?: Record<string, unknown>;
  @ApiPropertyOptional() completedAt?: string;
  @ApiPropertyOptional() message?: string;
}
export class RankMathAuditReceiptResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() businessId!: string;
  @ApiProperty({ enum: rankMathStatuses }) status!: RankMathStatus;
  @ApiProperty({ type: RankMathAuditOutcomeResponseDto, nullable: true }) outcome!: RankMathAuditOutcomeResponseDto | null;
  @ApiProperty() limitation!: string;
}

export class ContentQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) perPage = 20;
}
export class RankMathQueryDto {
  @ApiProperty({ enum: ["pages", "posts"] }) @IsIn(["pages", "posts"]) resource!: "pages" | "posts";
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) id?: number;
}
export class ContentChangesDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50000) content?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) excerpt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9_-]{1,200}$/) slug?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) altText?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) caption?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) description?: string;
}
export class CreateWordPressProposalDto {
  @ApiProperty({ enum: ["pages", "posts", "media"] }) @IsIn(["pages", "posts", "media"]) resource!: "pages" | "posts" | "media";
  @ApiProperty() @IsInt() @Min(1) resourceId!: number;
  @ApiProperty({ type: ContentChangesDto }) @IsObject() @ValidateNested() @Type(() => ContentChangesDto) changes!: ContentChangesDto;
}
export class ApplyWordPressProposalDto {
  @ApiProperty({ description: "Hash of the exact reviewed proposal" }) @IsString() @Matches(/^[a-f0-9]{64}$/) proposalHash!: string;
  @ApiProperty({ enum: [true] }) @Equals(true) confirmed!: true;
}
export class RunRankMathAuditDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") requestId!: string;
  @ApiProperty({ enum: [true] }) @Equals(true) confirmed!: true;
}
