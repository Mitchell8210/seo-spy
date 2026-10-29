import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LighthouseReportDto } from './lighthouse.dto.js';
import type { Audit, Business, Connection, Evidence, Finding, Recommendation, Score } from './domain.js';

export class BusinessDto implements Business {
  @ApiProperty({ example: 'demo-guzman' }) id!: string;
  @ApiProperty({ example: 'Guzman Tax Accounting' }) name!: string;
  @ApiProperty({ example: 'https://guzmantaxaccounting.com', format: 'uri' }) website!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ConnectionDto implements Connection {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'demo-guzman' }) businessId!: string;
  @ApiProperty({ enum: ['website', 'facebook'] }) platform!: Connection['platform'];
  @ApiProperty() identity!: string;
  @ApiProperty({ enum: ['connected', 'disconnected', 'authorization_required', 'checking', 'error'] }) status!: Connection['status'];
  @ApiProperty({ enum: ['demo', 'live'] }) mode!: 'demo' | 'live';
}

export class EvidenceDto implements Evidence {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) auditId!: string;
  @ApiProperty({ example: 'image-alt' }) checkId!: string;
  @ApiProperty({ format: 'uri' }) sourceUrl!: string;
  @ApiProperty({ format: 'date-time' }) collectedAt!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, example: { image: '/sample-services.jpg', alt: 'missing' } }) observed!: Record<string, string>;
  @ApiProperty({ enum: ['demo', 'live'] }) mode!: 'demo' | 'live';
}

export class FindingDto implements Finding {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) auditId!: string;
  @ApiProperty({ example: 'image-alt' }) checkId!: string;
  @ApiProperty({ type: [String] }) evidenceIds!: string[];
  @ApiProperty({ enum: ['critical', 'medium', 'low'] }) severity!: Finding['severity'];
  @ApiProperty({ enum: ['website', 'website_and_facebook'] }) source!: Finding['source'];
  @ApiProperty({ example: 'Missing image alt text' }) title!: string;
  @ApiProperty() explanation!: string;
  @ApiProperty({ enum: ['needs_review'] }) status!: 'needs_review';
}

export class RecommendationDto implements Recommendation {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) auditId!: string;
  @ApiProperty({ format: 'uuid' }) findingId!: string;
  @ApiProperty({ example: 'Add helpful image descriptions' }) title!: string;
  @ApiProperty() explanation!: string;
  @ApiProperty() recommendedChange!: string;
  @ApiProperty() purpose!: string;
  @ApiProperty({ enum: ['needs_review'] }) status!: 'needs_review';
}

export class ScoreDto implements Score {
  @ApiProperty({ enum: ['website', 'social', 'consistency', 'overall'] }) category!: Score['category'];
  @ApiProperty({ type: Number, nullable: true, example: 78, description: 'Illustrative demo value; null when unavailable.' }) value!: number | null;
  @ApiProperty({ example: 100 }) maximum!: number;
  @ApiProperty({ enum: ['demo', 'unavailable'] }) availability!: Score['availability'];
  @ApiProperty({ enum: ['demo-v1', 'homepage-v1'] }) scoringVersion!: 'demo-v1' | 'homepage-v1';
}

export class AuditFailureDto {
  @ApiProperty({ example: 'AUDIT_FAILED' }) code!: string;
  @ApiProperty() message!: string;
}

export class AuditCountsDto {
  @ApiProperty({ example: 3 }) findings!: number;
  @ApiProperty({ example: 3 }) recommendations!: number;
}

export class AuditSummaryDto implements Omit<Audit, 'results'> {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'demo-guzman' }) businessId!: string;
  @ApiProperty({ enum: ['demo', 'homepage', 'lighthouse'] }) scope!: Audit['scope'];
  @ApiPropertyOptional({ enum: ['mobile', 'desktop'], description: 'Present for Lighthouse audits.' }) strategy?: Audit['strategy'];
  @ApiProperty({ enum: ['demo', 'live'] }) mode!: 'demo' | 'live';
  @ApiProperty({ enum: ['queued', 'running', 'completed', 'partial', 'failed'] }) status!: Audit['status'];
  @ApiProperty({ enum: ['queued', 'collecting_evidence', 'evaluating_checks', 'running_lighthouse', 'preparing_recommendations', 'complete', 'failed'] }) stage!: Audit['stage'];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) completedAt!: string | null;
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty({ type: () => AuditFailureDto, nullable: true }) failure!: AuditFailureDto | null;
  @ApiProperty({ enum: ['demo-v1', 'homepage-v1', 'lighthouse-v1'] }) scoringVersion!: Audit['scoringVersion'];
  @ApiProperty({ type: () => AuditCountsDto }) counts!: AuditCountsDto;
}

export class CreatedAuditDto extends AuditSummaryDto {
  @ApiProperty({ example: '/api/audits/00000000-0000-4000-8000-000000000000', description: 'Poll this relative URL for progress.' }) statusUrl!: string;
}

export class FindingsResponseDto {
  @ApiProperty({ enum: ['demo', 'live'] }) mode!: 'demo' | 'live';
  @ApiProperty({ format: 'uuid' }) auditId!: string;
  @ApiProperty({ enum: ['queued', 'running', 'completed', 'partial', 'failed'] }) status!: Audit['status'];
  @ApiProperty({ type: [FindingDto] }) findings!: FindingDto[];
  @ApiProperty({ type: [EvidenceDto] }) evidence!: EvidenceDto[];
}

export class RecommendationsResponseDto {
  @ApiProperty({ enum: ['demo', 'live'] }) mode!: 'demo' | 'live';
  @ApiProperty({ format: 'uuid' }) auditId!: string;
  @ApiProperty({ enum: ['queued', 'running', 'completed', 'partial', 'failed'] }) status!: Audit['status'];
  @ApiProperty({ type: [RecommendationDto] }) recommendations!: RecommendationDto[];
}

export class DashboardDto {
  @ApiProperty({ type: () => LighthouseReportDto, nullable: true, description: 'Latest completed/partial audit Lighthouse measurements. Null when unavailable.' }) lighthouse!: LighthouseReportDto | null;
  @ApiProperty({ enum: ['demo', 'live'] }) mode!: 'demo' | 'live';
  @ApiProperty({ description: 'Coverage disclaimer for the latest completed audit.' }) notice!: string;
  @ApiProperty({ type: () => BusinessDto }) business!: BusinessDto;
  @ApiProperty({ type: [ConnectionDto] }) connections!: ConnectionDto[];
  @ApiProperty({ type: () => AuditSummaryDto, nullable: true }) latestAudit!: AuditSummaryDto | null;
  @ApiProperty({ type: () => AuditSummaryDto, nullable: true }) activeAudit!: AuditSummaryDto | null;
  @ApiProperty({ type: [ScoreDto] }) scores!: ScoreDto[];
  @ApiProperty({ type: [FindingDto] }) findings!: FindingDto[];
  @ApiProperty({ type: [RecommendationDto] }) recommendations!: RecommendationDto[];
  @ApiProperty({ example: 3 }) priorityOpportunities!: number;
}

export class HealthDto {
  @ApiProperty({ enum: ['ok'] }) status!: 'ok';
  @ApiProperty({ example: 'seo-spy-server' }) service!: string;
  @ApiProperty({ enum: ['demo', 'live'] }) mode!: 'demo' | 'live';
}

export class ApiErrorDetailDto {
  @ApiProperty({ example: 'INVALID_REQUEST' }) code!: string;
  @ApiProperty({ example: 'The request contains missing or invalid fields.' }) message!: string;
  @ApiProperty({ format: 'uuid', description: 'Also returned in the x-request-id response header.' }) requestId!: string;
}

export class ApiErrorDto {
  @ApiProperty({ type: () => ApiErrorDetailDto }) error!: ApiErrorDetailDto;
}
