import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { SCORE_POLICY_REGISTRY, SCORE_POLICY_V1_2, SCORE_POLICY_V1_2_HASH } from "../../scoring/policy.js";
import { WordPressOperatorGuard, operatorIdentity } from "../wordpress/wordpress.guard.js";
import { WordPressService } from "../wordpress/wordpress.service.js";
import { AssessmentService } from "./assessment.service.js";
import { AssessmentAnalysisService } from "./assessment-analysis.service.js";
import { AssessmentEditingService, prepareAssessmentMediaAltSchema } from "./assessment-editing.service.js";
import { AssessmentStore, assessmentHash } from "./assessment.store.js";

const confirmed = z.object({ confirmed: z.literal(true) }).strict();
const selection = confirmed.extend({ websiteReportId: z.string().uuid().optional(), facebookReportId: z.string().uuid().optional(),
  profile: z.enum(["baseline-mobile-v1", "baseline-desktop-v1"]).optional(), cutoff: z.string().datetime({ offset: true }).optional(), policyVersion: z.enum(["seo-spy-score-v1", "seo-spy-score-v1.1", "seo-spy-score-v1.2"]).optional() }).strict();
function body<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); if (!parsed.success) throw new BadRequestException({ code: "ASSESSMENT_INPUT_INVALID", message: "Supply the exact confirmed assessment request using its documented contract." }); return parsed.data; }
const actor = (request: Request) => operatorIdentity(request.get("authorization")!.slice("Bearer ".length));

@Controller()
@ApiTags("Saved assessments and scoring")
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentService, private readonly analysis: AssessmentAnalysisService) {}
  @Get("scoring-policy")
  @ApiOperation({ summary: "Read the approved deterministic score policy; no providers or persistence" })
  @ApiOkResponse({ schema: { type: "object", additionalProperties: true } })
  policy() { return { schemaVersion: "seo-spy.scoring-policy.v1", status: "approved", policy: SCORE_POLICY_V1_2, policyHash: SCORE_POLICY_V1_2_HASH, versions: SCORE_POLICY_REGISTRY }; }
  @Get("businesses/:businessId/assessments/latest")
  @ApiOperation({ summary: "Read the latest saved assessment with current freshness gates; never generates analysis or rewrites history" })
  @ApiOkResponse({ schema: { type: "object", additionalProperties: true } })
  latest(@Param("businessId") businessId: string) { return this.assessments.latest(businessId); }
  @Get("businesses/:businessId/assessments/:id")
  @ApiOkResponse({ schema: { type: "object", additionalProperties: true } })
  read(@Param("businessId") businessId: string, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) { return this.assessments.read(businessId, id); }
  @Post("businesses/:businessId/assessments") @UseGuards(WordPressOperatorGuard) @ApiBearerAuth()
  @ApiOperation({ summary: "Explicitly score pinned saved reports using the approved policy; no collection, AI or edits" })
  @ApiBody({ schema: { type: "object", additionalProperties: false, required: ["confirmed"], properties: { policyVersion: { type: "string", enum: ["seo-spy-score-v1", "seo-spy-score-v1.1", "seo-spy-score-v1.2"], default: "seo-spy-score-v1.2" }, confirmed: { type: "boolean", enum: [true] }, websiteReportId: { type: "string", format: "uuid" }, facebookReportId: { type: "string", format: "uuid" }, profile: { type: "string", enum: ["baseline-mobile-v1", "baseline-desktop-v1"], default: "baseline-mobile-v1" }, cutoff: { type: "string", format: "date-time", description: "Optional recorded historical cutoff; never future. Evidence must be eligible at this cutoff; activity uses a separate completed-UTC-day reporting cutoff." } } } })
  @ApiCreatedResponse({ schema: { type: "object", additionalProperties: true } })
  async create(@Param("businessId") businessId: string, @Body() input: unknown) { const selected = body(selection, input); await this.assessments.business(businessId, true); return this.assessments.create(businessId, selected); }
  @Get("businesses/:businessId/scoring-facts") @UseGuards(WordPressOperatorGuard) @ApiBearerAuth()
  async facts(@Param("businessId") businessId: string) { await this.assessments.business(businessId, true); return { businessId, facts: this.assessments.facts(businessId) }; }
  @Post("businesses/:businessId/scoring-facts") @UseGuards(WordPressOperatorGuard) @ApiBearerAuth()
  @ApiOperation({ summary: "Record explicitly confirmed preferred facts or a pinned source-agreement review", description: "See confirmed-facts.ts / SCORING_POLICY.md. Values are not inferred from a model or API omission. A new assessment is required after changing confirmations." })
  confirmFacts(@Param("businessId") businessId: string, @Req() request: Request, @Body() input: unknown) { return this.assessments.confirmFacts(businessId, actor(request), input); }
  @Post("businesses/:businessId/assessments/:id/muse-analyses") @UseGuards(WordPressOperatorGuard) @ApiBearerAuth()
  @ApiOperation({ summary: "Explicitly prepare and save labeled mock recommendations from pinned summarized evidence; live dispatch is blocked" })
  @ApiBody({ schema: { type: "object", additionalProperties: false, required: ["confirmed"], properties: { confirmed: { type: "boolean", enum: [true] } } } })
  @ApiCreatedResponse({ schema: { type: "object", additionalProperties: true } })
  analyze(@Param("businessId") businessId: string, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Body() input: unknown) { body(confirmed, input); return this.analysis.create(businessId, id); }
  @Get("businesses/:businessId/assessments/:id/muse-analyses/:analysisId") @UseGuards(WordPressOperatorGuard) @ApiBearerAuth()
  savedAnalysis(@Param("businessId") businessId: string, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string, @Param("analysisId", new ParseUUIDPipe({ version: "4" })) analysisId: string) { return this.analysis.read(businessId, id, analysisId); }
}

@Controller("wordpress/businesses/:businessId/media-alt-previews")
@UseGuards(WordPressOperatorGuard) @ApiBearerAuth() @ApiTags("WordPress local operator")
export class AssessmentEditingController {
  constructor(private readonly editing: AssessmentEditingService, private readonly store: AssessmentStore, private readonly wordpress: WordPressService) {}
  @Post()
  @ApiOperation({ summary: "Prepare an exact media-alt proposal from a cited saved recommendation and operator-written text; no external write" })
  @ApiBody({ schema: { type: "object", additionalProperties: false, required: ["confirmed", "reportId", "analysisId", "recommendationId", "altText"], properties: { confirmed: { type: "boolean", enum: [true] }, reportId: { type: "string", format: "uuid" }, analysisId: { type: "string", format: "uuid" }, recommendationId: { type: "string" }, altText: { type: "string", maxLength: 2000 } } } })
  @ApiCreatedResponse({ schema: { type: "object", additionalProperties: true } })
  async prepare(@Param("businessId") businessId: string, @Req() request: Request, @Body() input: unknown) {
    const { confirmed: _confirmed, ...selected } = body(prepareAssessmentMediaAltSchema.extend({ confirmed: z.literal(true) }), input);
    void _confirmed;
    const preview = await this.editing.prepareMediaAlt(businessId, actor(request), selected);
    const record = { ...preview, id: preview.proposal.id, createdAt: preview.proposal.createdAt };
    this.store.write("edit-origin", record, assessmentHash({ businessId, proposalId: preview.proposal.id, origin: preview.origin }));
    return preview;
  }
  @Get(":proposalId")
  @ApiOperation({ summary: "Read the saved recommendation origin and proposal/execution state without collecting or retrying an edit" })
  async read(@Param("businessId") businessId: string, @Param("proposalId", new ParseUUIDPipe({ version: "4" })) proposalId: string, @Req() request: Request) {
    const saved = this.store.read("edit-origin", businessId, proposalId);
    if (!saved) throw new NotFoundException({ code: "ASSESSMENT_EDIT_PREVIEW_NOT_FOUND", message: "This media-alt preview was not found for the selected business." });
    return { saved, execution: await this.wordpress.getProposal(businessId, actor(request), proposalId) };
  }
}
