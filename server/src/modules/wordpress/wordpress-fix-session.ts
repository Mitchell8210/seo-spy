import { CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Post, Req, Res, Body, UseGuards, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { WordPressOperatorGuard, operatorIdentity } from "./wordpress.guard.js";
import { WordPressService } from "./wordpress.service.js";
interface BrowserGrant { actor: string; businessId: string; siteUrl: string; expires: number; csrf: string }
const cookieName = "seo_spy_wordpress";
@Injectable()
export class WordPressFixSessions {
  private readonly tickets = new Map<string, BrowserGrant>();
  private readonly sessions = new Map<string, BrowserGrant>();
  constructor(private readonly config: ConfigService, private readonly wordpress: WordPressService) {}
  private prune(map: Map<string, BrowserGrant>) { for (const [key, value] of map) if (value.expires <= Date.now()) map.delete(key); }
  private frontend() {
    const origin = this.config.get<string>("WORDPRESS_FRONTEND_ORIGIN") ?? "http://localhost:5173";
    const url = new URL(origin);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.origin !== origin) throw new ForbiddenException("Only the configured local frontend can establish an operator session.");
    return url;
  }
  browser(request: Request, mutation = request.method !== "GET") {
    const frontend = this.frontend();
    const hosts = [frontend.host, `localhost:${this.config.get("PORT") ?? 3001}`, `127.0.0.1:${this.config.get("PORT") ?? 3001}`];
    if (!hosts.includes(request.get("host") ?? "") || request.get("x-forwarded-host") || request.get("x-forwarded-proto")
      || request.get("sec-fetch-site") === "cross-site" || mutation && request.get("origin") !== frontend.origin
      || request.get("origin") && request.get("origin") !== frontend.origin) throw new ForbiddenException("WordPress browser origin/host rejected.");
  }
  async issue(request: Request, businessId: string) {
    this.prune(this.tickets); this.prune(this.sessions);
    if (this.tickets.size >= 32 || this.sessions.size >= 64) throw new ForbiddenException("Operator session capacity reached.");
    const siteUrl = await this.wordpress.reportSite(businessId);
    const code = randomBytes(32).toString("base64url");
    this.tickets.set(operatorIdentity(code), { actor: operatorIdentity(request.get("authorization")!.slice(7)), businessId, siteUrl, expires: Date.now() + 60000, csrf: "" });
    return { url: `${this.frontend().origin}/dashboard#wordpress-session=${code}`, expiresInSeconds: 60, scope: "One local browser, one business, alt-text fix workflow only. No AI or write authorization." };
  }
  async redeem(request: Request, response: Response, code: string) {
    this.browser(request, true); this.prune(this.tickets); this.prune(this.sessions);
    const key = operatorIdentity(code), ticket = this.tickets.get(key); this.tickets.delete(key);
    if (!ticket || ticket.actor !== operatorIdentity(this.config.get<string>("WORDPRESS_OPERATOR_KEY") ?? "") || ticket.siteUrl !== await this.wordpress.reportSite(ticket.businessId)) throw new UnauthorizedException("The one-use operator link is expired or invalid.");
    const session = randomBytes(32).toString("base64url"), grant = { ...ticket, expires: Date.now() + 20 * 60000, csrf: randomBytes(32).toString("base64url") };
    this.sessions.set(operatorIdentity(session), grant);
    response.cookie(cookieName, session, { httpOnly: true, sameSite: "strict", secure: false, path: "/api/wordpress", maxAge: 20 * 60000 });
    response.setHeader("Cache-Control", "no-store");
    return { connected: true, businessId: grant.businessId, csrf: grant.csrf, expiresAt: new Date(grant.expires).toISOString() };
  }
  async authorize(request: Request) {
    this.browser(request); this.prune(this.sessions);
    const cookies = (request.get("cookie") ?? "").split(";").map(row => row.trim()).filter(row => row.startsWith(`${cookieName}=`));
    const key = cookies.length === 1 ? cookies[0].slice(cookieName.length + 1) : "";
    const session = this.sessions.get(operatorIdentity(key));
    if (!session || session.actor !== operatorIdentity(this.config.get<string>("WORDPRESS_OPERATOR_KEY") ?? "") || session.siteUrl !== await this.wordpress.reportSite(session.businessId)
      || request.params.businessId && request.params.businessId !== session.businessId) throw new UnauthorizedException({ code: "WORDPRESS_BROWSER_SESSION_REQUIRED", message: "Open a fresh one-use link from the trusted local operator to connect this browser." });
    if (request.method !== "GET") {
      const supplied = request.get("x-wordpress-csrf") ?? "";
      if (supplied.length !== session.csrf.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrf))) throw new ForbiddenException("Exact browser CSRF proof required.");
    }
    return session;
  }
}
@Injectable()
export class WordPressFixSessionGuard implements CanActivate {
  constructor(private readonly sessions: WordPressFixSessions) {}
  async canActivate(context: ExecutionContext) { context.switchToHttp().getResponse<Response>().setHeader("Cache-Control", "no-store"); await this.sessions.authorize(context.switchToHttp().getRequest<Request>()); return true; }
}
@Controller("wordpress")
export class WordPressFixSessionController {
  constructor(private readonly sessions: WordPressFixSessions) {}
  @Post("browser-tickets") @UseGuards(WordPressOperatorGuard)
  issue(@Req() req: Request, @Body() body: unknown) { return this.sessions.issue(req, z.object({ businessId: z.string().min(1).max(128) }).strict().parse(body).businessId); }
  @Post("browser-session")
  redeem(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) { return this.sessions.redeem(req, res, z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().parse(body).code); }
  @Get("browser-session") @UseGuards(WordPressFixSessionGuard)
  async status(@Req() req: Request) { const grant = await this.sessions.authorize(req); return { connected: true, businessId: grant.businessId, csrf: grant.csrf, expiresAt: new Date(grant.expires).toISOString() }; }
}
