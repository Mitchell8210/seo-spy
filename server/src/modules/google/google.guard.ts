import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

const identity = (key: string) => createHash("sha256").update(key).digest();

/** Local operator access only; Google credentials are never browser credentials. */
@Injectable()
export class GoogleOperatorGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    context.switchToHttp().getResponse<Response>().setHeader("Cache-Control", "no-store");
    const configured = this.config.get<string>("GOOGLE_OPERATOR_KEY") || this.config.get<string>("WORDPRESS_OPERATOR_KEY") || "";
    if (configured.length < 32) throw new ServiceUnavailableException({ code: "GOOGLE_OPERATOR_NOT_CONFIGURED", message: "Local Google reporting access is not configured." });
    const supplied = request.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
    if (!supplied || !timingSafeEqual(identity(configured), identity(supplied))) throw new UnauthorizedException({ code: "GOOGLE_OPERATOR_REQUIRED", message: "Local operator authorization is required." });
    let host: string;
    try { host = new URL(`http://${request.get("host")}`).hostname; } catch { throw new ForbiddenException(); }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) throw new ForbiddenException({ code: "GOOGLE_LOCAL_ONLY", message: "Google reporting endpoints are local-only." });
    const origin = request.get("origin");
    if (origin && origin !== (this.config.get<string>("GOOGLE_FRONTEND_ORIGIN") ?? "http://localhost:5173")) throw new ForbiddenException({ code: "GOOGLE_ORIGIN_REJECTED", message: "The reporting request origin is not allowed." });
    return true;
  }
}
