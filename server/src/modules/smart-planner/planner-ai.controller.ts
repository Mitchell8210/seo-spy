import { Body, Controller, Get, Optional, Param, ParseUUIDPipe, Patch, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiBadRequestResponse, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnprocessableEntityResponse } from "@nestjs/swagger";
import { ApiErrorDto } from "../../contracts/responses.dto.js";
import { PlannerResponseDto } from "./planner.dto.js";
import { AiProposalResponseDto, AiSettingsResponseDto, ApplyAiPlanDto, GenerateAiPlanDto, UpdateAiSettingsDto } from "./planner-ai.dto.js";
import { PlannerAiService } from "./planner-ai.service.js";
import { WordPressFixSessions } from "../wordpress/wordpress-fix-session.js";
@Controller("businesses/:businessId/smart-planner")
@ApiTags("Smart Planner AI proposals")
@ApiBadRequestResponse({ type: ApiErrorDto }) @ApiConflictResponse({ type: ApiErrorDto }) @ApiNotFoundResponse({ type: ApiErrorDto }) @ApiServiceUnavailableResponse({ type: ApiErrorDto }) @ApiUnprocessableEntityResponse({ type: ApiErrorDto })
export class PlannerAiController {
  constructor(private readonly plans: PlannerAiService, @Optional() private readonly sessions?: WordPressFixSessions) {}
  @Get("ai-preferences") @ApiOkResponse({ type: AiSettingsResponseDto }) @ApiOperation({ summary: "Read separate AI planning settings without generating or accessing financial records" })
  preferences(@Param("businessId") id: string) { return this.plans.preferences(id); }
  @Patch("ai-preferences") @ApiOkResponse({ type: AiSettingsResponseDto }) @ApiOperation({ summary: "Save AI planning settings with planner revision/mutation protection" })
  save(@Param("businessId") id: string, @Body() body: UpdateAiSettingsDto) { return this.plans.savePreferences(id, body); }
  @Post("ai-proposals") @ApiCreatedResponse({ type: AiProposalResponseDto }) @ApiOperation({ summary: "Explicitly generate an isolated proposal; live mode is blocked without dedicated authorization; no active task changes" })
  async generate(@Param("businessId") id: string, @Body() body: GenerateAiPlanDto, @Req() request: Request) {
    if (body.mode !== "live") return this.plans.generate(id, body);
    if (!this.sessions) throw new UnauthorizedException("Connect your authorized account before generating an AI plan.");
    const session = await this.sessions.authorize(request);
    return this.plans.generate(id, body, { actor: session.actor, businessId: session.businessId, siteUrl: session.siteUrl });
  }
  @Get("ai-proposals") @ApiOkResponse({ type: AiProposalResponseDto, description: "Latest proposal, or JSON null when absent; never triggers generation" })
  async latest(@Param("businessId") id: string, @Res() response: Response) { response.json(await this.plans.latest(id)); }
  @Get("ai-proposals/:proposalId") @ApiOkResponse({ type: AiProposalResponseDto })
  get(@Param("businessId") id: string, @Param("proposalId", ParseUUIDPipe) proposalId: string) { return this.plans.get(id, proposalId); }
  @Post("ai-proposals/:proposalId/apply") @ApiCreatedResponse({ type: PlannerResponseDto }) @ApiOperation({ summary: "Explicitly approve a validated proposal and atomically persist changes; no model call" })
  apply(@Param("businessId") id: string, @Param("proposalId", ParseUUIDPipe) proposalId: string, @Body() body: ApplyAiPlanDto) { return this.plans.apply(id, proposalId, body); }
}

/** Same persistent cookie and CSRF protection as Fix with AI; its path remains unchanged. */
@Controller("wordpress/businesses/:businessId/smart-planner")
@ApiTags("Smart Planner AI proposals")
export class PlannerAiFrontendController {
  constructor(private readonly plans: PlannerAiService, private readonly sessions: WordPressFixSessions) {}
  @Post("ai-proposals") @ApiCreatedResponse({ type: AiProposalResponseDto })
  @ApiOperation({ summary: "Explicit authenticated frontend AI planning within the shared capped allowance; no calendar changes" })
  async generate(@Param("businessId") id: string, @Body() body: GenerateAiPlanDto, @Req() request: Request) {
    const session = await this.sessions.authorize(request);
    return this.plans.generate(id, body, { actor: session.actor, businessId: session.businessId, siteUrl: session.siteUrl });
  }
}
