import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { GoogleReportingResponseDto, SearchConsoleQueryDto } from "./google.dto.js";
import { GoogleOperatorGuard } from "./google.guard.js";
import { GoogleReportingService } from "./google.service.js";
import { GoogleFacebookVisitsService } from "./facebook-visits.service.js";

@Controller("businesses/:businessId/google")
@ApiTags("Google reporting (local operator)")
@ApiBearerAuth()
@UseGuards(GoogleOperatorGuard)
export class GoogleReportingController {
  constructor(private readonly reports: GoogleReportingService, private readonly facebookVisits: GoogleFacebookVisitsService) {}
  @Get("facebook-visits")
  @ApiOperation({ summary: "Explicitly collect/cache GA4 Facebook-attributed website sessions for 30 completed Pacific days", description: "Operator-only read. Exact dates and hostname/session-source filters; no Facebook/model requests, writes or retries. Saved Social Media reads never invoke collection." })
  @ApiOkResponse({ description: "Business/date-scoped Google sessions, collection time and attribution limitations; never link clicks or credentials." })
  facebook(@Param("businessId") businessId: string, @Query("since") since: string, @Query("until") until: string) {
    return this.facebookVisits.collect(businessId, since, until);
  }
  @Get("ga4")
  @ApiOperation({ summary: "Read cached GA4 sessions, active users and page views for 7 and 30 days", description: "A cold/expired cache makes one read-only GA4 batch request. Missing access/errors remain explicit unavailable responses. No model, WordPress, or automatic retry. Targets come from trusted business configuration." })
  @ApiOkResponse({ type: GoogleReportingResponseDto })
  ga4(@Param("businessId") businessId: string) { return this.reports.ga4(businessId); }
  @Get("search-console")
  @ApiOperation({ summary: "Read cached Search Console site totals or top search queries", description: "view=summary gives site-wide clicks/impressions/CTR/position; view=queries gives a bounded top-query sample with its own metrics, never a substitute for site totals. One read-only query per cache miss. No model calls or automatic retries." })
  @ApiOkResponse({ type: GoogleReportingResponseDto })
  searchConsole(@Param("businessId") businessId: string, @Query() query: SearchConsoleQueryDto) { return this.reports.searchConsole(businessId, query.days, query.view); }
}
