import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuditsService, auditSummary } from './audits.service.js';
import { CreateAuditDto } from './dto/create-audit.dto.js';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiConflictResponse, ApiInternalServerErrorResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto, AuditSummaryDto, CreatedAuditDto, FindingsResponseDto, RecommendationsResponseDto } from '../../contracts/responses.dto.js';

@Controller()
@ApiTags('Audits')
@ApiBadRequestResponse({ description: 'Invalid input or audit UUID.', type: ApiErrorDto })
@ApiNotFoundResponse({ description: 'Business or audit not found.', type: ApiErrorDto })
@ApiInternalServerErrorResponse({ type: ApiErrorDto })
export class AuditsController {
  constructor(private readonly audits: AuditsService) {}

  @Post('businesses/:businessId/audits')
  @HttpCode(202)
  @ApiOperation({ summary: 'Start a demo or real homepage investigation', description: 'Homepage scope fetches the registered business website. Only one audit may be queued/running per business.' })
  @ApiParam({ name: 'businessId', example: 'demo-guzman' })
  @ApiAcceptedResponse({ type: CreatedAuditDto })
  @ApiConflictResponse({ description: 'An audit is already active.', type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ description: 'The server is stopping.', type: ApiErrorDto })
  create(@Param('businessId') businessId: string, @Body() body: CreateAuditDto): Promise<CreatedAuditDto> {
    return this.audits.create(businessId, body.scope);
  }

  @Get('audits/:auditId')
  @ApiOperation({ summary: 'Get investigation progress and summary' })
  @ApiParam({ name: 'auditId', format: 'uuid', description: 'UUID v4 returned by creation or the dashboard.' })
  @ApiOkResponse({ type: AuditSummaryDto })
  async get(@Param('auditId', new ParseUUIDPipe({ version: '4' })) id: string): Promise<AuditSummaryDto> {
    return auditSummary(await this.audits.get(id));
  }

  @Get('audits/:auditId/findings')
  @ApiOperation({ summary: 'List findings and their evidence', description: 'Result arrays remain empty until the investigation completes.' })
  @ApiParam({ name: 'auditId', format: 'uuid' })
  @ApiOkResponse({ type: FindingsResponseDto })
  findings(@Param('auditId', new ParseUUIDPipe({ version: '4' })) id: string): Promise<FindingsResponseDto> {
    return this.audits.findings(id);
  }

  @Get('audits/:auditId/recommendations')
  @ApiOperation({ summary: 'List investigation recommendations' })
  @ApiParam({ name: 'auditId', format: 'uuid' })
  @ApiOkResponse({ type: RecommendationsResponseDto })
  recommendations(@Param('auditId', new ParseUUIDPipe({ version: '4' })) id: string): Promise<RecommendationsResponseDto> {
    return this.audits.recommendations(id);
  }
}
