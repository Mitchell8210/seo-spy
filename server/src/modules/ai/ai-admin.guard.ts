import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export const aiAdministratorIdentity = (key: string) => createHash("sha256").update(key).digest("hex");

@Injectable()
export class AiAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    context.switchToHttp().getResponse<Response>().setHeader("Cache-Control", "no-store");
    const configured = this.config.get<string>("AI_ADMIN_KEY") ?? "";
    if (configured.length < 32) throw new ServiceUnavailableException({ code: "AI_ADMIN_NOT_CONFIGURED", message: "AI administrator authorization is not configured." });
    const supplied = request.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
    if (!supplied || !timingSafeEqual(Buffer.from(aiAdministratorIdentity(configured), "hex"), Buffer.from(aiAdministratorIdentity(supplied), "hex"))) throw new UnauthorizedException({ code: "AI_ADMIN_REQUIRED", message: "The separate AI administrator credential is required." });
    let host: string;
    try { host = new URL(`http://${request.get("host")}`).hostname; } catch { throw new ForbiddenException(); }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) throw new ForbiddenException({ code: "AI_ADMIN_LOCAL_ONLY", message: "AI administration is local-only." });
    const origin = request.get("origin");
    if (origin && origin !== (this.config.get<string>("AI_ADMIN_ORIGIN") ?? "http://localhost:5173")) throw new ForbiddenException({ code: "AI_ADMIN_ORIGIN_REJECTED", message: "The AI administrator request origin is not allowed." });
    return true;
  }
}
