import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export function operatorIdentity(key: string): string { return createHash("sha256").update(key).digest("hex"); }
@Injectable()
export class WordPressOperatorGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader("Cache-Control", "no-store");
    const configured = this.config.get<string>("WORDPRESS_OPERATOR_KEY") ?? "";
    if (configured.length < 32) throw new ServiceUnavailableException("WordPress operator access is not configured.");
    const supplied = request.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
    if (!supplied || !timingSafeEqual(Buffer.from(operatorIdentity(configured), "hex"), Buffer.from(operatorIdentity(supplied), "hex"))) throw new UnauthorizedException({ code: "WORDPRESS_OPERATOR_REQUIRED", message: "WordPress operator authorization is required." });
    let host: string;
    try { host = new URL(`http://${request.get("host")}`).hostname; } catch { throw new ForbiddenException(); }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) throw new ForbiddenException({ code: "WORDPRESS_LOCAL_ONLY", message: "WordPress operator endpoints are local-only." });
    if (request.get("origin") && request.get("origin") !== (this.config.get<string>("WORDPRESS_FRONTEND_ORIGIN") ?? "http://localhost:5173")) throw new ForbiddenException({ code: "WORDPRESS_ORIGIN_REJECTED", message: "The request origin is not allowed." });
    return true;
  }
}
