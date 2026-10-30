import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import helmet from "helmet";
import { FacebookService } from "./facebook.service.js";
import { FacebookReportsService } from "./facebook-reports.service.js";
import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength } from "class-validator";
import { ReportFileReferenceDto } from "../../reports/report-reference.dto.js";
import { AuditFailureDto } from "../../contracts/responses.dto.js";

class CreateFacebookReportDto {
  @ApiProperty({
    description: "Registered local business ID",
    example: "demo-guzman",
  })
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  @MaxLength(128)
  businessId!: string;
  @ApiProperty({ description: "Authorized Facebook Page ID" })
  @IsString()
  @Matches(/^\d+$/)
  @MaxLength(40)
  pageId!: string;
}
class FacebookBrowserReportDto extends ReportFileReferenceDto {
  @ApiProperty({ enum: ["completed", "partial", "failed"] }) status!:
    "completed" | "partial" | "failed";
  @ApiProperty({ type: () => AuditFailureDto, nullable: true })
  failure!: AuditFailureDto | null;
}
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

const COOKIE = "seo_spy_facebook_test";
const loginCsp = helmet.contentSecurityPolicy({
  directives: {
    formAction: ["'self'", "https://www.facebook.com"],
    upgradeInsecureRequests: null,
  },
});
@Controller("facebook")
@ApiTags("Facebook local testing")
export class FacebookController {
  constructor(
    private readonly facebook: FacebookService,
    private readonly reports: FacebookReportsService,
  ) {}
  private guard(req: Request, res: Response, mutation = false) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const expected = new URL(this.facebook.settings().redirectUri).origin;
    if (`http://${req.get("host")}` !== expected)
      throw new BadRequestException(
        `Open ${expected}/api/facebook directly, using the configured hostname and port.`,
      );
    if (mutation && req.get("origin") !== expected)
      throw new BadRequestException(
        `Reload ${expected}/api/facebook and submit its form. The request must originate from that page.`,
      );
  }
  private session(req: Request) {
    const value = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
  }
  private cookie(res: Response, id: string, persistent = false) {
    res.cookie(COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/api/facebook",
      maxAge: persistent ? 30 * 86400000 : 3600000,
    });
  }
  @Get()
  @ApiOkResponse({
    description: "Local HTML test page",
    content: { "text/html": { schema: { type: "string" } } },
  })
  @ApiOperation({ summary: "Open the local Facebook connection test page" })
  async home(@Req() req: Request, @Res() res: Response) {
    this.guard(req, res);
    // Preserve Origin on same-origin form POSTs; no-referrer can produce Origin: null.
    // Keep the callback's no-referrer policy so its authorization code is not forwarded.
    res.setHeader("Referrer-Policy", "same-origin");
    // Browsers can apply form-action to the redirect after the local form POST.
    loginCsp(req, res, () => undefined);
    let selection =
      "<p>Connect Facebook to select a Page and generate a report.</p>";
    if (this.session(req)) {
      try {
        const connection = await this.facebook.listPages(this.session(req));
        selection = connection.pages.length
          ? `<form method="post" action="/api/facebook/reports"><label>Business ID <input name="businessId" required maxlength="128" placeholder="demo-guzman"></label><label>Facebook Page <select name="pageId">${connection.pages.map((page) => `<option value="${page.id}">${escapeHtml(page.name)}</option>`).join("")}</select></label><button>Generate and save Facebook report</button></form><p>${connection.truncated ? "Page listing is limited; additional Pages may exist." : ""} Connection expiry: ${connection.expiresAt ? escapeHtml(new Date(connection.expiresAt).toISOString()) : "not scheduled by Meta"}.</p>`
          : "<p>No authorized Pages were returned. Reconnect and select a Page you manage.</p>";
      } catch {
        selection =
          "<p>The connection needs attention. Reconnect Facebook or inspect permission diagnostics.</p>";
      }
    }
    res
      .type("html")
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><title>Facebook reports</title><body><h1>Facebook reports</h1><p>Local developer workflow. Reports collect read-only evidence. OAuth credentials are encrypted on the server; this browser connection lasts at most 30 days and may require earlier reconnection.</p><p><a href="/api/facebook/status">Check configuration</a></p><form method="post" action="/api/facebook/connect"><button>Connect / reconnect Facebook</button></form>${selection}<p><a href="/api/facebook/connection">Read connection and permission diagnostics</a></p><form method="post" action="/api/facebook/disconnect"><button>Disconnect and forget saved credentials</button></form></body></html>`,
      );
  }
  @Get("status")
  @ApiOkResponse({
    description:
      "Configuration presence flags, requiredPermissions, redirectUri, graphVersion, mode and writesEnabled. Never includes credential values.",
    schema: {
      type: "object",
      properties: {
        appIdConfigured: { type: "boolean" },
        appSecretConfigured: { type: "boolean" },
        configIdConfigured: { type: "boolean" },
        tokenEncryptionConfigured: { type: "boolean" },
        accessTokenConfigured: { type: "boolean" },
        redirectUri: { type: "string" },
        graphVersion: { type: "string" },
        requiredPermissions: { type: "array", items: { type: "string" } },
        mode: { type: "string" },
        writesEnabled: { type: "boolean" },
      },
    },
  })
  @ApiOperation({ summary: "Get configuration presence without credentials" })
  status(@Req() req: Request, @Res() res: Response) {
    this.guard(req, res);
    res.json(this.facebook.settings());
  }
  @Post("connect")
  @ApiResponse({
    status: 303,
    description: "Sets HttpOnly session cookie and redirects to Meta consent.",
  })
  @ApiOperation({ summary: "Start cookie-bound Facebook Login for Business" })
  async connect(@Req() req: Request, @Res() res: Response) {
    this.guard(req, res, true);
    loginCsp(req, res, () => undefined);
    const result = this.facebook.start();
    await this.facebook.markReconnect(this.session(req));
    this.cookie(res, result.id);
    res.redirect(303, result.url);
  }
  @Post("test-token")
  @ApiResponse({
    status: 303,
    description: "Sets HttpOnly session cookie and redirects to diagnostics.",
  })
  @ApiOperation({
    summary:
      "Create a local diagnostic session using the server-configured user token",
  })
  testToken(@Req() req: Request, @Res() res: Response) {
    this.guard(req, res, true);
    const id = this.facebook.useConfiguredToken();
    this.facebook.forget(this.session(req));
    this.cookie(res, id);
    res.redirect(303, "/api/facebook/connection");
  }
  @Get("callback")
  @ApiResponse({
    status: 303,
    description: "Rotates session cookie and redirects to the local test page.",
  })
  @ApiOperation({
    summary: "Complete Facebook authorization; never returns credentials",
  })
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query("state") state: unknown,
    @Query("code") code: unknown,
    @Query("error") error: unknown,
  ) {
    this.guard(req, res);
    const id = await this.facebook.callback(
      this.session(req),
      state,
      code,
      error !== undefined,
    );
    this.cookie(res, id, true);
    res.redirect(303, "/api/facebook");
  }
  @Get("connection")
  @ApiOkResponse({
    description:
      "Read-only live diagnostics. Each Page probe has available/unavailable status; unavailable is not zero. No access tokens or paging URLs.",
    schema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["live"] },
        checkedAt: { type: "string", format: "date-time" },
        requiredPermissionsGranted: { type: "boolean" },
        permissions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              permission: { type: "string" },
              required: { type: "boolean" },
              status: { type: "string" },
            },
          },
        },
        pages: {
          type: "array",
          items: { type: "object", additionalProperties: true },
        },
        pageListFailure: { type: "string", nullable: true },
        truncated: { type: "boolean" },
        writesEnabled: { type: "boolean" },
        notice: { type: "string" },
      },
    },
  })
  @ApiOperation({
    summary:
      "Probe granted permissions, Page access, posts and a sample insight without writes",
  })
  async connection(@Req() req: Request, @Res() res: Response) {
    this.guard(req, res);
    res.json(await this.facebook.diagnose(this.session(req)));
  }
  @Post("disconnect")
  @ApiResponse({
    status: 303,
    description:
      "Clears local session cookie and redirects to the test page; does not revoke Meta access.",
  })
  @ApiOperation({
    summary: "Forget the local session without revoking Meta authorization",
  })
  async disconnect(@Req() req: Request, @Res() res: Response) {
    this.guard(req, res, true);
    await this.facebook.markReconnect(this.session(req));
    res.clearCookie(COOKIE, {
      path: "/api/facebook",
      httpOnly: true,
      sameSite: "lax",
    });
    res.redirect(303, "/api/facebook");
  }
  @Post("reports")
  @ApiOperation({
    summary:
      "Collect and archive a Facebook report using the browser OAuth connection",
    description:
      "Local operator workflow; explicitly select a registered business and an authorized Page. No Facebook changes. Returns after bounded collection and durable archive write.",
  })
  @ApiConsumes("application/json", "application/x-www-form-urlencoded")
  @ApiCreatedResponse({
    type: FacebookBrowserReportDto,
    description:
      "Saved report reference and completed/partial/failed status. Browser forms receive an HTML download link.",
  })
  async createReport(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: CreateFacebookReportDto,
  ) {
    this.guard(req, res, true);
    const result = await this.reports.create(
      this.session(req),
      body.businessId,
      body.pageId,
    );
    if (req.is("application/x-www-form-urlencoded")) {
      res
        .status(201)
        .type("html")
        .send(
          `<!doctype html><html lang="en"><meta charset="utf-8"><title>Saved Facebook report</title><body><h1>Report saved</h1><p>Status: ${escapeHtml(result.status)}</p><p><a href="${escapeHtml(result.downloadUrl)}">Download report JSON</a></p><p><a href="/api/facebook">Back to Facebook reports</a></p></body></html>`,
        );
    } else res.status(201).json(result);
  }
}
