import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ApplyWordPressProposalDto, ContentQueryDto, CreateWordPressProposalDto, RankMathQueryDto, RunRankMathAuditDto, RankMathAuditOutcomeResponseDto, RankMathAuditReceiptResponseDto } from "./wordpress.dto.js";
import { operatorIdentity, WordPressOperatorGuard } from "./wordpress.guard.js";
import { WordPressService } from "./wordpress.service.js";
import { WordPressReportsService } from "./wordpress-reports.service.js";
import { CreateWordPressReportDto, WordPressReportListQueryDto, WordPressReportResponseDto, WordPressReportListResponseDto } from "./wordpress.dto.js";
import { WordPressMuseService } from "./wordpress-muse.service.js";
import { WordPressVerificationService } from "./wordpress-verification.service.js";
import { CreateWordPressMuseAnalysisDto, EstimateWordPressMuseDto, WordPressMuseAnalysisResponseDto, VerifyWordPressAltDto, WordPressPublicVerificationDto } from "./wordpress.dto.js";

@Controller("wordpress/businesses/:businessId")
@ApiTags("WordPress local operator")
@ApiBearerAuth()
@UseGuards(WordPressOperatorGuard)
export class WordPressController {
  constructor(private readonly wordpress: WordPressService, private readonly reports: WordPressReportsService, private readonly muse: WordPressMuseService, private readonly verification: WordPressVerificationService) {}
  private actor(request: Request) { return operatorIdentity(request.get("authorization")!.slice("Bearer ".length)); }
  @Post("reports")
  @ApiOperation({ summary: "Collect and persist an immutable read-only WordPress evidence report", description: "Explicit collection request; bounded published samples only. Requires operator authorization, not writes enabled. No fresh audit, AI call or content update. 201 is returned only after durable publication. Collection is synchronous; interrupted processes do not resume it." })
  @ApiCreatedResponse({ type: WordPressReportResponseDto })
  createReport(@Param("businessId") id: string, @Body() body: CreateWordPressReportDto) { return this.reports.create(id, body.sampleSize); }
  @Get("reports")
  @ApiOperation({ summary: "List saved evidence reports without contacting WordPress" })
  @ApiOkResponse({ type: WordPressReportListResponseDto })
  listReports(@Param("businessId") id: string, @Query() query: WordPressReportListQueryDto) { return this.reports.list(id, query.limit); }
  @Get("reports/:reportId")
  @ApiOperation({ summary: "Read/download a saved evidence report without collection or paid calls" })
  @ApiOkResponse({ type: WordPressReportResponseDto })
  report(@Param("businessId") id: string, @Param("reportId", new ParseUUIDPipe({ version: "4" })) reportId: string) { return this.reports.read(id, reportId); }
  @Get("reports/:reportId/muse-evidence")
  @ApiOperation({ summary: "Prepare bounded Muse input from a saved report without a model call" })
  @ApiOkResponse({ schema: { type: "object", description: "seo-spy.wordpress-muse-evidence.v1; source hash, business, dates, stable evidence citations, coverage, informational capability catalog, null scoring and explicit minimization. No credentials or execution authorization." } })
  museEvidence(@Param("businessId") id: string, @Param("reportId", new ParseUUIDPipe({ version: "4" })) reportId: string) { return this.muse.prepare(id, reportId); }
  @Post("reports/:reportId/muse-analyses")
  @ApiOperation({ summary: "Request labeled mock analysis or reuse cached analysis; real requests require separate exact approval", description: "Mock-first. Real generation requires MOCK_AI=false, poc/demo mode, AI enabled and a separately administrator-approved intent with an atomic SQLite cost reservation. Maximum 1500 output tokens, no retries/tools. Never collects WordPress or applies changes. Cached identical analysis makes no model call." })
  @ApiCreatedResponse({ type: WordPressMuseAnalysisResponseDto })
  createMuseAnalysis(@Param("businessId") id: string, @Param("reportId", new ParseUUIDPipe({ version: "4" })) reportId: string, @Req() req: Request, @Body() body: CreateWordPressMuseAnalysisDto) { return this.muse.create(id, reportId, body.intentId ? { intentId: body.intentId, actor: this.actor(req) } : undefined); }
  @Post("reports/:reportId/muse-estimates")
  @ApiOperation({ summary: "Prepare an exact persisted cost estimate for essential real validation without calling Meta", description: "Explain necessity, review model/token bounds/hash and maximum reservation, then obtain separate AI administrator approval. Estimates are short-lived and grant no spending authority. Mock mode can preview a poc estimate before any real mode is enabled." })
  @ApiCreatedResponse({ schema: { type: "object", description: "Persisted intent ID, actor/scope, mode/model, exact requestHash/cacheKey, maxInputTokens/maxOutputTokens, reserveMicros, maximumEstimatedCostUsd, priceVersion, reason, expiry and approval/consumption timestamps. Money enforcement uses integer USD microdollars, never the formatted display value." } })
  async estimateMuse(@Param("businessId") id: string, @Param("reportId", new ParseUUIDPipe({ version: "4" })) reportId: string, @Req() req: Request, @Body() body: EstimateWordPressMuseDto) {
    const intent = await this.muse.estimate(id, reportId, this.actor(req), body.reason);
    return { ...intent, maximumEstimatedCostUsd: (intent.reserveMicros / 1000000).toFixed(6) };
  }
  @Get("reports/:reportId/muse-analyses/:analysisId")
  @ApiOperation({ summary: "Read a saved Muse interpretation without another model call" })
  @ApiOkResponse({ type: WordPressMuseAnalysisResponseDto })
  museAnalysis(@Param("businessId") id: string, @Param("reportId", new ParseUUIDPipe({ version: "4" })) reportId: string, @Param("analysisId", new ParseUUIDPipe({ version: "4" })) analysisId: string) { return this.muse.read(id, reportId, analysisId); }
  @Post("proposals/:id/verifications")
  @ApiOperation({ summary: "Collect and save public source-HTML verification of an applied media alt-text change", description: "Only existing published WordPress page/post IDs accepted; registered HTTPS site binding applies to redirects. No remote writes, cache purge, browser execution or automatic retry. Stored field success and public result remain separate." })
  @ApiCreatedResponse({ type: WordPressPublicVerificationDto })
  verify(@Param("businessId") business: string, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Req() req: Request, @Body() body: VerifyWordPressAltDto) { return this.verification.verify(business, this.actor(req), id, body.pageResource, body.pageId); }
  @Get("proposals/:id/verifications/:verificationId")
  @ApiOperation({ summary: "Read a saved public verification receipt without collection" })
  @ApiOkResponse({ type: WordPressPublicVerificationDto })
  verificationReceipt(@Param("businessId") business: string, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Param("verificationId", new ParseUUIDPipe({ version: "4" })) verificationId: string, @Req() req: Request) { return this.verification.read(business, this.actor(req), id, verificationId); }
  @Get("connection")
  @ApiOperation({ summary: "Verify the bound WordPress account without returning credentials" })
  @ApiOkResponse({ schema: { type: "object", description: "Business/site identity, verified account capabilities and local write-gate state." } })
  connection(@Param("businessId") id: string) { return this.wordpress.info(id); }
  @Get("content/:resource")
  @ApiOperation({ summary: "Read a bounded page, post or media collection" })
  @ApiOkResponse({ schema: { type: "object", description: "Business/resource, page/perPage, collection time and content items." } })
  list(@Param("businessId") id: string, @Param("resource") resource: string, @Query() query: ContentQueryDto) { return this.wordpress.list(id, resource, query.page, query.perPage); }
  @Get("content/:resource/:id")
  @ApiOperation({ summary: "Read editable content as untrusted text; no HTML execution" })
  @ApiOkResponse({ schema: { type: "object", description: "Business/resource, collection time and selected WordPress content fields." } })
  content(@Param("businessId") business: string, @Param("resource") resource: string, @Param("id", ParseIntPipe) id: number) { return this.wordpress.content(business, resource, id); }
  @Get("rank-math/evidence")
  @ApiOperation({ summary: "Read Rank Math versions, available abilities, stored SEO scores and metadata; never run a fresh audit" })
  @ApiOkResponse({ schema: { type: "object", description: "Versioned Rank Math evidence with source dates, availability and limitations. A stored optimization score is not a Lighthouse or combined SEO Spy score." } })
  evidence(@Param("businessId") id: string, @Query() query: RankMathQueryDto) { return this.wordpress.rankMath(id, query.resource, query.id); }
  @Post("proposals")
  @ApiOperation({ summary: "Create a 15-minute exact update proposal and before-state; no external writes" })
  @ApiCreatedResponse({ schema: { type: "object", description: "id/hash, business/operator/target binding, before/changes, timestamps and precondition." } })
  propose(@Param("businessId") id: string, @Req() req: Request, @Body() body: CreateWordPressProposalDto) { return this.wordpress.propose(id, this.actor(req), body); }
  @Get("proposals/:id")
  @ApiOperation({ summary: "Inspect a saved proposal and execution receipt; never retry a write" })
  @ApiOkResponse({ schema: { type: "object", description: "Proposal, executionStarted flag and optional outcome." } })
  proposal(@Param("businessId") business: string, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Req() req: Request) { return this.wordpress.getProposal(business, this.actor(req), id); }
  @Post("proposals/:id/apply")
  @ApiOperation({ summary: "Explicitly approve and apply the exact proposal hash once", description: "Requires local operator credentials, confirmed=true and WORDPRESS_WRITES_ENABLED. Checks before-values; no automatic retry. A reserved execution without an outcome requires reconciliation." })
  @ApiBody({ type: ApplyWordPressProposalDto })
  @ApiCreatedResponse({ schema: { type: "object", description: "Execution receipt: applied/failed/outcome_unknown and separate stored-field verification. Replays return the original receipt." } })
  apply(@Param("businessId") business: string, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Req() req: Request, @Body() body: ApplyWordPressProposalDto) { return this.wordpress.apply(business, this.actor(req), id, body.proposalHash); }
  @Post("rank-math/audits")
  @ApiOperation({ summary: "Explicitly request a Rank Math site audit using a unique request ID", description: "Requires confirmed=true, local operator credentials and writes enabled. The vendor ability can cache results/contact Rank Math even though its method is GET. Never invoked by evidence reads." })
  @ApiCreatedResponse({ type: RankMathAuditOutcomeResponseDto, description: "Persisted receipt; HTTP 201 does not imply audit success. Inspect status: success/failed/timeout/unsupported/unknown. Same requestId never repeats execution." })
  audit(@Param("businessId") id: string, @Req() req: Request, @Body() body: RunRankMathAuditDto) { return this.wordpress.audit(id, this.actor(req), body.requestId); }
  @Get("rank-math/audits/:requestId")
  @ApiOperation({ summary: "Read a saved Rank Math audit receipt without starting a scan" })
  @ApiOkResponse({ type: RankMathAuditReceiptResponseDto, description: "Read-only receipt, available with writes disabled. Legacy outcomes receive an unknown status without archive mutation." })
  auditResult(@Param("businessId") id: string, @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string, @Req() req: Request) { return this.wordpress.auditResult(id, this.actor(req), requestId); }
}
