import { BadRequestException, Body, Controller, Get, HttpCode, Module, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { WordPressModule } from "../wordpress/wordpress.module.js";
import { WordPressFixSessionGuard, WordPressFixSessions, WordPressLocalFixReadGuard } from "../wordpress/wordpress-fix-session.js";
import { FacebookModule } from "../facebook/facebook.module.js";
import { FacebookReportsService } from "../facebook/facebook-reports.service.js";
import { OverallInvestigationService } from "../facebook/overall-investigation.service.js";
import { AuditsModule } from "../audits/audits.module.js";
import { AuditsService } from "../audits/audits.service.js";
import { PersistenceModule } from "../../persistence/persistence.module.js";
import { ReportsModule } from "../../reports/reports.module.js";
import { FileReportStore } from "../../reports/file-report.store.js";
import { InvestigationInterpretationStore } from "../../reporting/investigation-interpretation.store.js";
import { interpretationHash } from "../../reporting/investigation-interpretation.js";

@Controller("wordpress/businesses/:businessId/investigations")
@UseGuards(WordPressFixSessionGuard)
@ApiTags("Authenticated investigations with AI interpretation")
export class InvestigationStartController {
  constructor(private readonly sessions: WordPressFixSessions, private readonly audits: AuditsService,
    private readonly facebook: FacebookReportsService, private readonly overall: OverallInvestigationService) {}
  @Post(":kind") @HttpCode(202)
  @ApiOperation({ summary: "Explicitly collect a report and interpret its saved evidence with Muse", description: "Requires the existing scoped local browser session and CSRF proof. AI uses the shared cumulative allowance once per exact source set. No automatic model retries or external writes." })
  async start(@Param("businessId") businessId: string, @Param("kind") kind: string, @Req() req: Request, @Body() input: unknown) {
    const parsed = z.object({ confirmed: z.literal(true), pageId: z.string().regex(/^\d{1,40}$/).optional() }).strict().safeParse(input);
    if (!parsed.success || !["website", "social", "overall"].includes(kind) || kind === "social" && !parsed.data.pageId) throw new BadRequestException("Choose an explicit valid report target.");
    const grant = await this.sessions.authorize(req);
    if (grant.businessId !== businessId) throw new BadRequestException("The browser session belongs to another business.");
    const context = { actor: grant.actor, businessId, siteUrl: grant.siteUrl };
    const facebookCookie = (req.get("cookie") ?? "").split(";").map(value => value.trim()).find(value => value.startsWith("seo_spy_facebook_test="))?.slice("seo_spy_facebook_test=".length);
    if (kind === "website") return this.audits.create(businessId, "lighthouse", "mobile", context);
    if (kind === "social") return this.facebook.create(facebookCookie, businessId, parsed.data.pageId!, context);
    return this.overall.start(facebookCookie, businessId, context);
  }
}
@Controller("wordpress/local/businesses/:businessId/investigation-interpretation")
@UseGuards(WordPressLocalFixReadGuard)
export class InvestigationInterpretationController {
  constructor(private readonly store: InvestigationInterpretationStore, private readonly reports: FileReportStore) {}
  @Get()
  @ApiOperation({ summary: "Read saved AI interpretation for the displayed reports; never calls a model or collects evidence" })
  async read(@Param("businessId") businessId: string, @Query("reportIds") ids: string) {
    const parsed = z.array(z.string().uuid()).min(1).max(2).safeParse(typeof ids === "string" ? ids.split(",") : []);
    if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) throw new BadRequestException("Choose the exact displayed report IDs.");
    let record = this.store.saved(businessId, parsed.data, parsed.data.length === 2);
    if (!record && parsed.data.length === 2) {
      record = parsed.data.map(id => this.store.saved(businessId, [id], true)).filter(value => value !== null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    }
    if (record) for (const source of record.sources) {
      const report = await this.reports.read(source.reportId);
      if (!report || report.business.id !== businessId || interpretationHash(report) !== source.hash ||
        parsed.data.length === 2 && !parsed.data.includes(source.reportId)) throw new BadRequestException("The saved AI interpretation does not match the displayed reports.");
    }
    return { businessId, interpretation: record };
  }
}
@Module({ imports: [WordPressModule, FacebookModule, AuditsModule, PersistenceModule, ReportsModule], controllers: [InvestigationStartController, InvestigationInterpretationController], providers: [WordPressFixSessionGuard, WordPressLocalFixReadGuard] })
export class InvestigationStartModule {}
