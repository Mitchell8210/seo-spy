import { CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Post, Req, Res, Body, UseGuards, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { WordPressOperatorGuard, operatorIdentity } from "./wordpress.guard.js";
import { WordPressService } from "./wordpress.service.js";
import { AppDatabase } from "../../persistence/sqlite/app-database.js";
interface BrowserGrant { actor: string; businessId: string; siteUrl: string; expires: number; csrf: string }
const cookieName = "seo_spy_wordpress";
const lifetime = 30 * 86400000;
const savedGrant = z.object({ actor: z.string().regex(/^[a-f0-9]{64}$/), businessId: z.string().min(1).max(128), siteUrl: z.string().url(),
  origin: z.string().url(), issuedAt: z.number().int().nonnegative(), expires: z.number().int().positive() }).strict();
@Injectable()
export class WordPressFixSessions {
  private readonly tickets = new Map<string, BrowserGrant>();
  constructor(private readonly config: ConfigService, private readonly wordpress: WordPressService, private readonly database: AppDatabase) {}
  private prune(map: Map<string, BrowserGrant>) { for (const [key, value] of map) if (value.expires <= Date.now()) map.delete(key); }
  private frontend() {
    const origin = this.config.get<string>("WORDPRESS_FRONTEND_ORIGIN") ?? "http://localhost:5173";
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.origin !== origin || url.username || url.password) throw new ForbiddenException("Only the configured local frontend can establish an operator session.");
    return url;
  }
  private cookieOptions() { return { httpOnly: true, sameSite: "strict" as const, secure: this.frontend().protocol === "https:", path: "/api/wordpress" }; }
  private signature(value: string) { return createHmac("sha256", this.config.get<string>("WORDPRESS_OPERATOR_KEY") ?? "").update(value).digest("hex"); }
  private csrf(token: string) { return createHmac("sha256", this.config.get<string>("WORDPRESS_OPERATOR_KEY") ?? "").update(`csrf:${token}`).digest("base64url"); }
  private token(request: Request) {
    const cookies = (request.get("cookie") ?? "").split(";").map(row => row.trim()).filter(row => row.startsWith(`${cookieName}=`));
    return cookies.length === 1 ? cookies[0].slice(cookieName.length + 1) : "";
  }
  private stored(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const db = this.database.connection();
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wordpress_browser_sessions'").get()) return null;
    const id = operatorIdentity(token), row = db.prepare("SELECT payload,checksum FROM wordpress_browser_sessions WHERE token_hash=?").get(id);
    if (!row || typeof row.payload !== "string" || row.checksum !== this.signature(`${id}:${row.payload}`)) return null;
    const parsed = savedGrant.safeParse(JSON.parse(row.payload));
    if (!parsed.success || parsed.data.issuedAt > Date.now() + 60000 || parsed.data.expires - parsed.data.issuedAt !== lifetime) return null;
    return parsed.data;
  }
  browser(request: Request, mutation = request.method !== "GET") {
    const frontend = this.frontend();
    const hosts = [frontend.host, `localhost:${this.config.get("PORT") ?? 3001}`, `127.0.0.1:${this.config.get("PORT") ?? 3001}`];
    if (!hosts.includes(request.get("host") ?? "") || request.get("x-forwarded-host") || request.get("x-forwarded-proto")
      || request.get("sec-fetch-site") === "cross-site" || mutation && request.get("origin") !== frontend.origin
      || request.get("origin") && request.get("origin") !== frontend.origin) throw new ForbiddenException("WordPress browser origin/host rejected.");
  }
  async localReader(request: Request) {
    this.browser(request, false);
    if (request.method !== "GET" || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")
      || request.get("x-forwarded-for") || request.get("forwarded")) throw new ForbiddenException("Saved fix reads are restricted to the local application.");
    const key = this.config.get<string>("WORDPRESS_OPERATOR_KEY") ?? "";
    if (key.length < 32) throw new UnauthorizedException("The local WordPress connection is not configured.");
    await this.wordpress.reportSite(request.params.businessId as string);
    return operatorIdentity(key);
  }
  async issue(request: Request, businessId: string) {
    this.prune(this.tickets);
    if (this.tickets.size >= 32) throw new ForbiddenException("Operator session capacity reached.");
    const siteUrl = await this.wordpress.reportSite(businessId);
    const code = randomBytes(32).toString("base64url");
    this.tickets.set(operatorIdentity(code), { actor: operatorIdentity(request.get("authorization")!.slice(7)), businessId, siteUrl, expires: Date.now() + 60000, csrf: "" });
    return { url: `${this.frontend().origin}/dashboard?${new URLSearchParams({ businessId })}#wordpress-session=${code}`, expiresInSeconds: 60, scope: "One local browser, one business, alt-text fix workflow only. No AI or write authorization." };
  }
  async redeem(request: Request, response: Response, code: string) {
    this.browser(request, true); this.prune(this.tickets);
    const key = operatorIdentity(code), ticket = this.tickets.get(key); this.tickets.delete(key);
    if (!ticket || ticket.actor !== operatorIdentity(this.config.get<string>("WORDPRESS_OPERATOR_KEY") ?? "") || ticket.siteUrl !== await this.wordpress.reportSite(ticket.businessId)) throw new UnauthorizedException("The one-use operator link is expired or invalid.");
    const session = randomBytes(32).toString("base64url"), issuedAt = Date.now();
    const grant = { actor: ticket.actor, businessId: ticket.businessId, siteUrl: ticket.siteUrl, issuedAt, expires: issuedAt + lifetime, origin: this.frontend().origin };
    const db = this.database.connection();
    db.exec("CREATE TABLE IF NOT EXISTS wordpress_browser_sessions(token_hash TEXT PRIMARY KEY,payload TEXT NOT NULL,checksum TEXT NOT NULL)");
    db.prepare("DELETE FROM wordpress_browser_sessions WHERE json_extract(payload,'$.expires')<=?").run(issuedAt);
    if (Number(db.prepare("SELECT COUNT(*) AS n FROM wordpress_browser_sessions").get()?.n) >= 64) throw new ForbiddenException("Operator session capacity reached.");
    const id = operatorIdentity(session), payload = JSON.stringify(grant);
    db.prepare("INSERT INTO wordpress_browser_sessions VALUES(?,?,?)").run(id, payload, this.signature(`${id}:${payload}`));
    response.cookie(cookieName, session, { ...this.cookieOptions(), maxAge: lifetime });
    response.setHeader("Cache-Control", "no-store");
    return { connected: true, businessId: grant.businessId, csrf: this.csrf(session), expiresAt: new Date(grant.expires).toISOString() };
  }
  async authorize(request: Request) {
    this.browser(request);
    const key = this.token(request), saved = this.stored(key);
    const session = saved ? { ...saved, csrf: this.csrf(key) } : null;
    if (!session || session.expires <= Date.now() || session.origin !== this.frontend().origin || session.actor !== operatorIdentity(this.config.get<string>("WORDPRESS_OPERATOR_KEY") ?? "") || session.siteUrl !== await this.wordpress.reportSite(session.businessId)
      || request.params.businessId && request.params.businessId !== session.businessId) throw new UnauthorizedException({ code: "WORDPRESS_BROWSER_SESSION_REQUIRED", message: "Open a fresh one-use link from the trusted local operator to connect this browser." });
    if (request.method !== "GET") {
      const supplied = request.get("x-wordpress-csrf") ?? "";
      if (supplied.length !== session.csrf.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrf))) throw new ForbiddenException("Exact browser CSRF proof required.");
    }
    return session;
  }
  async revoke(request: Request, response: Response) {
    await this.authorize(request);
    this.database.connection().prepare("DELETE FROM wordpress_browser_sessions WHERE token_hash=?").run(operatorIdentity(this.token(request)));
    response.clearCookie(cookieName, this.cookieOptions()); response.setHeader("Cache-Control", "no-store");
    return { connected: false, revoked: true };
  }
}
@Injectable()
export class WordPressFixSessionGuard implements CanActivate {
  constructor(private readonly sessions: WordPressFixSessions) {}
  async canActivate(context: ExecutionContext) { context.switchToHttp().getResponse<Response>().setHeader("Cache-Control", "no-store"); await this.sessions.authorize(context.switchToHttp().getRequest<Request>()); return true; }
}
@Injectable()
export class WordPressLocalFixReadGuard implements CanActivate {
  constructor(private readonly sessions: WordPressFixSessions) {}
  async canActivate(context: ExecutionContext) { context.switchToHttp().getResponse<Response>().setHeader("Cache-Control", "no-store"); await this.sessions.localReader(context.switchToHttp().getRequest<Request>()); return true; }
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
  @Post("browser-session/revoke") @UseGuards(WordPressFixSessionGuard)
  revoke(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.sessions.revoke(req, res); }
}
