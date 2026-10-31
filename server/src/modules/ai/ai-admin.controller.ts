import { Body, ConflictException, Controller, Get, HttpException, Param, ParseUUIDPipe, Post, Req, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AiUsageStore } from "../../integrations/ai/ai-usage.store.js";
import { AiUsageError } from "../../integrations/ai/ai-usage.types.js";
import { AiAdminGuard, aiAdministratorIdentity } from "./ai-admin.guard.js";
import { ApproveAiIntentDto, AuthorizeAiDemoDto } from "./ai-admin.dto.js";

@Controller("ai/admin")
@ApiTags("AI cost administration (local only)")
@ApiBearerAuth()
@UseGuards(AiAdminGuard)
export class AiAdminController {
  constructor(private readonly usage: AiUsageStore, private readonly config: ConfigService) {}
  private actor(request: Request) { return aiAdministratorIdentity(request.get("authorization")!.slice(7)); }
  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof AiUsageError) {
        const status = error.code.includes("STORAGE") ? 503 : error.code.includes("NOT_FOUND") ? 404 : error.code.includes("INVALID") ? 400 : 409;
        throw new HttpException({ code: error.code, message: error.message }, status);
      }
      throw new ServiceUnavailableException({ code: "AI_BUDGET_STORAGE_ERROR", message: "AI usage authorization could not be verified safely." });
    }
  }
  @Get("status")
  @ApiOperation({ summary: "Inspect persistent AI usage, reservations and effective mode without a model call" })
  @ApiOkResponse({ schema: { type: "object", description: "Effective mock/poc/demo mode, separately gated real calls, and SQLite ledger: cumulative/UTC-daily charged+reserved microdollars, lifetime counts, active/unknown attempts, demo authorization and safe attempt metadata. Never queries provider billing or resets counters." } })
  status() {
    return this.safe(async () => ({
      effectiveMode: this.config.get("MOCK_AI") !== false || this.config.get("AI_MODE") === "mock" ? "mock" : this.config.get("AI_MODE"),
      realModeConfigured: this.config.get("AI_ENABLED") === true && this.config.get("MOCK_AI") === false && ["poc", "demo"].includes(this.config.get<string>("AI_MODE") ?? "mock"),
      everyRealCallRequiresAdministratorApproval: true,
      configuredDevelopmentLimits: { budgetMicros: this.config.get("AI_DEV_BUDGET_MICROS") ?? 2000000, dailyMicros: this.config.get("AI_DEV_DAILY_MICROS") ?? 500000, maxCalls: this.config.get("AI_DEV_MAX_CALLS") ?? 10 },
      providerBillingBalanceVerified: false,
      usage: await this.usage.status(),
    }));
  }
  @Get("intents/:intentId")
  @ApiOperation({ summary: "Review the immutable target, necessity reason and maximum reserved cost before administrator approval" })
  @ApiOkResponse({ schema: { type: "object", description: "Intent ID, actor/scope, exact request hash, model/mode, input/output bounds, frozen price version, reserveMicros, reason, expiry, approval/consumption timestamps. No prompt or credential." } })
  intent(@Param("intentId", new ParseUUIDPipe({ version: "4" })) intentId: string) { return this.safe(() => this.usage.readIntent(intentId)); }
  @Post("intents/:intentId/approve")
  @ApiOperation({ summary: "Approve one exact estimated real request; this does not dispatch it", description: "Requires the separate AI_ADMIN_KEY, explicit confirmation and exact hash/reservation from the reviewed intent. Single-use approval expires with its intent. A normal analysis confirmed:true flag cannot substitute for this approval." })
  @ApiCreatedResponse({ schema: { type: "object", description: "The persisted approved intent; no provider call or budget reset." } })
  approve(@Param("intentId", new ParseUUIDPipe({ version: "4" })) intentId: string, @Req() request: Request, @Body() body: ApproveAiIntentDto) {
    return this.safe(async () => {
      const intent = await this.usage.readIntent(intentId);
      if (intent.requestHash !== body.requestHash || intent.reserveMicros !== body.reserveMicros) throw new ConflictException({ code: "AI_APPROVAL_MISMATCH", message: "Approval must match the exact reviewed request and maximum cost." });
      return this.usage.approve(intentId, this.actor(request));
    });
  }
  @Post("demo-authorizations")
  @ApiOperation({ summary: "Explicitly authorize separate demo limits; never enables generation or resets development usage", description: "Final-testing-only authorization. Individual real calls still need their own reviewed intent approval. Changing AI_MODE alone grants no demo access." })
  @ApiCreatedResponse({ schema: { type: "object", description: "Persisted administrator-authorized demo limits. Cumulative historical charges/calls remain authoritative." } })
  authorizeDemo(@Req() request: Request, @Body() body: AuthorizeAiDemoDto) {
    return this.safe(() => this.usage.authorizeDemo(this.actor(request), { budgetMicros: body.budgetMicros, dailyMicros: body.dailyMicros, maxCalls: body.maxCalls }, body.reason));
  }
}
