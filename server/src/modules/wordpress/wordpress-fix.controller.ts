import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { WordPressFixService } from "./wordpress-fix.service.js";
import { WordPressPageEvidenceService, collectPageEvidenceSchema } from "./wordpress-page-evidence.service.js";
import { WordPressOperatorGuard, operatorIdentity } from "./wordpress.guard.js";
import { WordPressFixSessionGuard, WordPressFixSessions } from "./wordpress-fix-session.js";
const exact = z.object({ confirmed: z.literal(true), proposalHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const edit = z.object({ generationId: z.string().uuid(), altText: z.string().max(300) }).strict();
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => { const result = schema.safeParse(value); if (!result.success) throw new BadRequestException("Invalid scoped fix request."); return result.data; };
@Controller("wordpress/businesses/:businessId/fixes") @ApiTags("WordPress exact alt-text fixes") @UseGuards(WordPressFixSessionGuard)
export class WordPressFixController {
  constructor(private readonly fixes: WordPressFixService, private readonly sessions: WordPressFixSessions) {}
  private async actor(req: Request) { return (await this.sessions.authorize(req)).actor; }
  @Get("capability") @ApiOperation({ summary: "Read exact backend fix eligibility without WordPress or Muse calls" })
  async capability(@Param("businessId") business: string, @Req() req: Request, @Query() query: unknown) {
    const body = parse(z.object({ reportId: z.string().uuid(), findingId: z.string().min(1).max(160) }).strict(), query);
    return this.fixes.capability(business, await this.actor(req), body.reportId, body.findingId);
  }
  @Post("generations") @ApiOperation({ summary: "Generate a bounded alt proposal; mock-first, every real inference requires existing exact ledger authorization" })
  async generate(@Param("businessId") business: string, @Req() req: Request, @Body() body: unknown) {
    const { generateAltSchema } = await import("./wordpress-fix.types.js");
    return this.fixes.generate(business, await this.actor(req), parse(generateAltSchema, body));
  }
  @Get("generations/:id") @ApiOperation({ summary: "Read a saved validated mock/live alt-text generation without a model call" })
  async generation(@Param("businessId") business: string, @Param("id", new ParseUUIDPipe()) id: string, @Req() req: Request) { return this.fixes.generation(business, await this.actor(req), id); }
  @Post("proposals") @ApiOperation({ summary: "Re-read exact media and create a new immutable before/after hash, without applying" })
  async propose(@Param("businessId") business: string, @Req() req: Request, @Body() input: unknown) {
    const body = parse(edit, input); return this.fixes.propose(business, await this.actor(req), body.generationId, body.altText);
  }
  @Get("proposals/:id")
  async read(@Param("businessId") business: string, @Param("id", new ParseUUIDPipe()) id: string, @Req() req: Request) { return this.fixes.read(business, await this.actor(req), id); }
  @Post("proposals/:id/apply") @ApiOperation({ summary: "Explicit Approve & Apply; exact hash, single execution, alt_text only" })
  async apply(@Param("businessId") business: string, @Param("id", new ParseUUIDPipe()) id: string, @Req() req: Request, @Body() input: unknown) {
    const body = parse(exact, input); return this.fixes.apply(business, await this.actor(req), id, body.proposalHash);
  }
  @Post("proposals/:id/verifications")
  async verify(@Param("businessId") business: string, @Param("id", new ParseUUIDPipe()) id: string, @Req() req: Request, @Body() input: unknown) {
    parse(z.object({ confirmed: z.literal(true) }).strict(), input); return this.fixes.verify(business, await this.actor(req), id);
  }
  @Post("proposals/:id/restorations") @ApiOperation({ summary: "Prepare a separate restoration proposal; no automatic rollback or Apply" })
  async restore(@Param("businessId") business: string, @Param("id", new ParseUUIDPipe()) id: string, @Req() req: Request, @Body() input: unknown) {
    parse(z.object({ confirmed: z.literal(true) }).strict(), input); return this.fixes.restore(business, await this.actor(req), id);
  }
  @Get("proposals/:id/verifications/:verificationId") @ApiOperation({ summary: "Read an immutable verification receipt without WordPress or provider calls" })
  async verificationReceipt(@Param("businessId") business: string, @Param("id", new ParseUUIDPipe()) id: string, @Param("verificationId", new ParseUUIDPipe()) verificationId: string, @Req() req: Request) {
    return this.fixes.verificationReceipt(business, await this.actor(req), id, verificationId);
  }
}
@Controller("wordpress/businesses/:businessId/fix-operator") @ApiTags("WordPress private fix operator") @UseGuards(WordPressOperatorGuard)
export class WordPressFixOperatorController {
  constructor(private readonly fixes: WordPressFixService, private readonly pageEvidence: WordPressPageEvidenceService) {}
  private actor(req: Request) { return operatorIdentity(req.get("authorization")!.slice(7)); }
  @Post("page-evidence") @ApiOperation({ summary: "Explicitly collect ONE registered published page/media target into a separate immutable unscored report; no inference or writes" })
  collectPage(@Param("businessId") business: string, @Body() input: unknown) {
    return this.pageEvidence.collect(business, parse(collectPageEvidenceSchema, input));
  }
  @Post("evidence") @ApiOperation({ summary: "Explicitly confirm reliable image content/purpose and bind an exact saved finding to writable media" })
  async enroll(@Param("businessId") business: string, @Req() req: Request, @Body() input: unknown) {
    const { enrollAltSchema } = await import("./wordpress-fix.types.js"); return this.fixes.enroll(business, this.actor(req), parse(enrollAltSchema, input));
  }
  @Post("preview") @ApiOperation({ summary: "Pure exact Muse request/cost preparation; creates no intent or authorization" })
  preview(@Param("businessId") business: string, @Req() req: Request, @Body() input: unknown) { return this.fixes.preview(business, this.actor(req), input); }
  @Post("generations") @ApiOperation({ summary: "Explicit operator generation using the same central provider and exact approved intent; saved output is available to the scoped browser" })
  async generate(@Param("businessId") business: string, @Req() req: Request, @Body() input: unknown) {
    const { generateAltSchema } = await import("./wordpress-fix.types.js");
    const { confirmed: _confirmed, ...body } = parse(generateAltSchema.extend({ confirmed: z.literal(true) }), input); void _confirmed;
    return this.fixes.generate(business, this.actor(req), body);
  }
  @Post("estimates") @ApiOperation({ summary: "Existing central ledger estimate only; no budget change or live call" })
  estimate(@Param("businessId") business: string, @Req() req: Request, @Body() input: unknown) {
    const body = parse(z.object({ evidenceId: z.string().uuid(), instructions: z.string().max(2000).default(""), reason: z.string().min(10).max(300) }).strict(), input);
    return this.fixes.estimate(business, this.actor(req), { evidenceId: body.evidenceId, instructions: body.instructions }, body.reason);
  }
}
