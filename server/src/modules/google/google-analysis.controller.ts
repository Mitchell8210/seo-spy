import { CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Param, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { GoogleAnalysisService } from "./google-analysis.service.js";

/** Local application read scope only. Existing Bearer-protected operator routes remain unchanged. */
@Injectable()
export class GoogleAnalysisReadGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    context.switchToHttp().getResponse<Response>().setHeader("Cache-Control", "no-store");
    const origin = this.config.get<string>("GOOGLE_FRONTEND_ORIGIN") ?? "http://localhost:5173";
    const frontend = new URL(origin), port = this.config.get<number>("PORT") ?? 3001;
    if (![frontend.host, `localhost:${port}`, `127.0.0.1:${port}`].includes(req.get("host") ?? "") ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "") ||
      ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"].some(header => req.get(header)) ||
      req.get("sec-fetch-site") === "cross-site" || req.get("origin") && req.get("origin") !== origin)
      throw new ForbiddenException({ code: "GOOGLE_LOCAL_ONLY", message: "Website analytics is restricted to the local application." });
    const key = this.config.get<string>("GOOGLE_OPERATOR_KEY") || this.config.get<string>("WORDPRESS_OPERATOR_KEY") || "";
    if (key.length < 32) throw new ServiceUnavailableException({ code: "GOOGLE_OPERATOR_NOT_CONFIGURED", message: "Local Google reporting is not configured." });
    return true;
  }
}

@Controller("businesses/:businessId/analytics")
@ApiTags("Local website analytics")
@UseGuards(GoogleAnalysisReadGuard)
export class GoogleAnalysisController {
  constructor(private readonly analysis: GoogleAnalysisService) {}
  @Get()
  @ApiOkResponse({ description: "seo-spy.google-analysis.v2: business-scoped availability, nullable dated analytics data, sanitized errorCode and cache hit/stale/expiresAt. No credentials or operator keys.", schema: { type: "object", additionalProperties: true } })
  @ApiOperation({ summary: "Read cached website-filtered 30-day GA4 analytics for the local Analysis page", description: "One five-report read-only batch on cache miss; no retries, polling, model calls or website writes. Server-held Google binding and credentials; never shared-user authorization." })
  read(@Param("businessId") businessId: string) { return this.analysis.read(businessId); }
}
