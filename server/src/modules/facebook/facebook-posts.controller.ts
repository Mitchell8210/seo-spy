import { BadRequestException, Body, Controller, Get, Post, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { FacebookService } from "./facebook.service.js";
import { FacebookPostsService } from "./facebook-posts.service.js";

class FacebookPostDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() businessId!: string;
  @ApiProperty({ format: "uuid" }) reportId!: string;
  @ApiProperty() recommendationId!: string;
  @ApiProperty() pageId!: string;
  @ApiProperty() pageName!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ enum: ["generating", "draft", "generation_failed", "publishing", "published", "outcome_unknown", "discarded"] }) status!: string;
  @ApiProperty({ maxLength: 5000 }) text!: string;
  @ApiProperty({ type: String, nullable: true }) attemptId!: string | null;
  @ApiProperty({ type: String, nullable: true }) model!: string | null;
  @ApiProperty({ type: String, nullable: true }) approvalHash!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) expiresAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) postId!: string | null;
  @ApiProperty({ type: String, nullable: true }) permalink!: string | null;
  @ApiProperty() verified!: boolean;
  @ApiProperty({ type: String, nullable: true }) error!: string | null;
  @ApiProperty({ type: String, nullable: true, required: false, format: "date-time" }) executedAt?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false, format: "date-time" }) completedAt?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false, format: "uuid" }) previousPostId?: string | null;
  @ApiProperty({ type: String, required: false, format: "date-time" }) discardedAt?: string;
}
class FacebookPostHistoryDto {
  @ApiProperty() businessId!: string;
  @ApiProperty({ type: [FacebookPostDto] }) items!: FacebookPostDto[];
}

class BusinessDto { @IsString() @Matches(/^[a-zA-Z0-9_-]{1,128}$/) businessId!: string; }
class SourceDto extends BusinessDto {
  @IsUUID() reportId!: string;
  @IsString() @MinLength(1) @MaxLength(256) recommendationId!: string;
  @IsOptional() @IsString() @MaxLength(256) findingId?: string;
  @IsOptional() @IsUUID() previousPostId?: string;
}
class SavedDto extends BusinessDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsUUID() reportId?: string;
  @IsOptional() @IsString() @MaxLength(256) recommendationId?: string;
}
class DraftDto extends BusinessDto { @IsUUID() id!: string; }
class ProposeDto extends DraftDto {
  @IsString() @MinLength(1) @MaxLength(5000) text!: string;
}
class PublishDto extends DraftDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) approvalHash!: string;
  @IsBoolean() @IsIn([true]) confirmed!: boolean;
}

@Controller("facebook/posts")
@ApiTags("Facebook post review and publishing")
export class FacebookPostsController {
  constructor(private readonly posts: FacebookPostsService, private readonly facebook: FacebookService, private readonly config: ConfigService) {}
  private session(req: Request, res: Response, mutation = false) {
    res.setHeader("Cache-Control", "no-store");
    const backend = new URL(this.facebook.settings().redirectUri).origin;
    const frontend = this.config.get<string>("FACEBOOK_FRONTEND_ORIGIN") ?? "http://localhost:5173";
    const host = `http://${req.get("host")}`, origin = req.get("origin");
    const allowed = host === backend || host === frontend && new URL(frontend).hostname === new URL(backend).hostname;
    if (!allowed || (mutation ? origin !== host || !req.is("application/json") : !!origin && origin !== host))
      throw new BadRequestException("Use the connected local browser and same-origin JSON requests for Facebook post actions.");
    const session = req.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith("seo_spy_facebook_test="))?.slice("seo_spy_facebook_test=".length);
    if (!session || !/^[a-f0-9]{64}$/.test(session)) throw new BadRequestException("Connect or reconnect Facebook in this browser before reviewing a post.");
    return session;
  }
  @Get()
  @ApiOkResponse({ type: FacebookPostDto, description: "Saved post or null if this browser has no matching record." })
  @ApiOperation({ summary: "Read this browser's saved post without any Meta or AI request" })
  async saved(@Req() req: Request, @Res() res: Response, @Query() query: SavedDto) {
    const post = await this.posts.saved(this.session(req, res), query.businessId, query.id, query.reportId, query.recommendationId);
    // Nest sends an empty body for a returned null; clients require explicit JSON null.
    res.json(post);
  }
  @Post("draft")
  @ApiCreatedResponse({ type: FacebookPostDto })
  @ApiOperation({ summary: "Generate one accounted Meta Muse draft; an explicit previousPostId starts the next post after publication; never publish" })
  draft(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: SourceDto) {
    return this.posts.generate(this.session(req, res, true), body.businessId, body.reportId, body.recommendationId, body.findingId, body.previousPostId);
  }
  @Get("history")
  @ApiOkResponse({ type: FacebookPostHistoryDto })
  @ApiOperation({ summary: "Read this browser's saved Facebook publishing actions for a business; excludes drafts; no provider calls" })
  history(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: BusinessDto) {
    return this.posts.history(this.session(req, res), query.businessId);
  }
  @Post("proposal")
  @ApiCreatedResponse({ type: FacebookPostDto })
  @ApiOperation({ summary: "Bind the reviewed exact text and Page to an expiring approval hash; no publishing" })
  propose(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: ProposeDto) {
    if (!body.text.trim()) throw new BadRequestException("A non-empty reviewed post is required.");
    return this.posts.propose(this.session(req, res, true), body.businessId, body.id, body.text);
  }
  @Post("discard")
  @ApiCreatedResponse({ type: FacebookPostDto })
  @ApiOperation({ summary: "Discard an unpublished draft and invalidate its approval; no model or Facebook calls" })
  discard(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: DraftDto) {
    return this.posts.discard(this.session(req, res, true), body.businessId, body.id);
  }
  @Post("publish")
  @ApiCreatedResponse({ type: FacebookPostDto })
  @ApiOperation({ summary: "Publish explicitly approved text once; requires pages_manage_posts, content task and FACEBOOK_POSTS_ENABLED", description: "Durable reservation precedes the write. Unknown/interrupted writes are never retried. Successful acknowledgement and exact-message verification are separate." })
  publish(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: PublishDto) {
    return this.posts.publish(this.session(req, res, true), body.businessId, body.id, body.approvalHash);
  }
}
