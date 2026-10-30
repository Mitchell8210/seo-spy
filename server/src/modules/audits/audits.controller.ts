import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { AuditsService, auditSummary } from "./audits.service.js";
import { CreateAuditDto } from "./dto/create-audit.dto.js";
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  ApiErrorDto,
  AuditSummaryDto,
  CreatedAuditDto,
  FindingsResponseDto,
  RecommendationsResponseDto,
} from "../../contracts/responses.dto.js";
import { LighthouseResponseDto } from "../../contracts/lighthouse.dto.js";

@Controller()
@ApiTags("Audits")
@ApiBadRequestResponse({
  description: "Invalid input or audit UUID.",
  type: ApiErrorDto,
})
@ApiNotFoundResponse({
  description: "Business or audit not found.",
  type: ApiErrorDto,
})
@ApiInternalServerErrorResponse({ type: ApiErrorDto })
export class AuditsController {
  constructor(private readonly audits: AuditsService) {}

  @Post("businesses/:businessId/audits")
  @HttpCode(202)
  @ApiOperation({
    summary: "Start a demo, homepage, or Lighthouse investigation",
    description:
      "Homepage collects HTML. Lighthouse adds Google PageSpeed Insights lab measurements, defaulting to mobile. Both target the registered business website. Only one audit may be queued/running per business.",
  })
  @ApiParam({ name: "businessId", example: "demo-guzman" })
  @ApiAcceptedResponse({ type: CreatedAuditDto })
  @ApiConflictResponse({
    description: "An audit is already active.",
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: "The server is stopping.",
    type: ApiErrorDto,
  })
  create(
    @Param("businessId") businessId: string,
    @Body() body: CreateAuditDto,
  ): Promise<CreatedAuditDto> {
    return this.audits.create(businessId, body.scope, body.strategy);
  }

  @Get("audits/:auditId")
  @ApiOperation({ summary: "Get investigation progress and summary" })
  @ApiParam({
    name: "auditId",
    format: "uuid",
    description: "UUID v4 returned by creation or the dashboard.",
  })
  @ApiOkResponse({ type: AuditSummaryDto })
  async get(
    @Param("auditId", new ParseUUIDPipe({ version: "4" })) id: string,
  ): Promise<AuditSummaryDto> {
    return auditSummary(await this.audits.get(id));
  }

  @Get("audits/:auditId/findings")
  @ApiOperation({
    summary: "List findings and their evidence",
    description:
      "HTML findings may be available while Lighthouse is running. Poll audit status; partial completion preserves usable results.",
  })
  @ApiParam({ name: "auditId", format: "uuid" })
  @ApiOkResponse({ type: FindingsResponseDto })
  findings(
    @Param("auditId", new ParseUUIDPipe({ version: "4" })) id: string,
  ): Promise<FindingsResponseDto> {
    return this.audits.findings(id);
  }

  @Get("audits/:auditId/recommendations")
  @ApiOperation({ summary: "List investigation recommendations" })
  @ApiParam({ name: "auditId", format: "uuid" })
  @ApiOkResponse({ type: RecommendationsResponseDto })
  recommendations(
    @Param("auditId", new ParseUUIDPipe({ version: "4" })) id: string,
  ): Promise<RecommendationsResponseDto> {
    return this.audits.recommendations(id);
  }

  @Get("audits/:auditId/lighthouse")
  @ApiOperation({
    summary: "Get Lighthouse lab scores, metrics, and checks",
    description:
      "The report is null for demo/homepage scopes, pending measurements, or provider failures. Check audit status, failure, and warnings. Partial audits retain HTML findings.",
  })
  @ApiParam({ name: "auditId", format: "uuid" })
  @ApiOkResponse({ type: LighthouseResponseDto })
  lighthouse(
    @Param("auditId", new ParseUUIDPipe({ version: "4" })) id: string,
  ): Promise<LighthouseResponseDto> {
    return this.audits.lighthouse(id);
  }
}
