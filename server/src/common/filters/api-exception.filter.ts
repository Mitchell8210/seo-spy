import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

// Only fixed application-authored integration errors may cross the 5xx boundary.
// Provider bodies and exception messages remain private.
const safeIntegrationErrors: Record<string, string> = {
  AI_DISABLED: "Model analysis is disabled.",
  AI_NOT_CONFIGURED: "Model analysis requires approved server configuration.",
  AI_BUDGET_DISABLED: "Model analysis requires an explicitly configured call limit.",
  AI_CALL_LIMIT: "The process model call limit has been reached.",
  AI_BUSY: "Model analysis capacity is currently in use.",
  AI_CANCELLED: "Model analysis was cancelled; remote completion may be unknown.",
  AI_TIMEOUT: "Model analysis timed out; remote completion is unknown.",
  AI_INVALID_INPUT: "The model input could not be prepared safely.",
  AI_INPUT_TOO_LARGE: "The model input exceeded its configured size limit.",
  AI_RESPONSE_TOO_LARGE: "The model response exceeded its size limit.",
  AI_REDIRECT_REJECTED: "The model provider returned an unsupported redirect.",
  AI_AUTH_FAILED: "The model provider rejected authorization.",
  AI_QUOTA_EXCEEDED: "The model provider reported unavailable quota.",
  AI_RATE_LIMITED: "The model provider rate limit was reached.",
  AI_PROVIDER_FAILED: "The model provider could not complete the request.",
  AI_NETWORK_ERROR: "The model connection failed; remote completion may be unknown.",
  AI_REFUSED: "The model declined the requested analysis.",
  AI_TRUNCATED: "The model returned an incomplete analysis; no analysis was accepted.",
  AI_INVALID_OUTPUT: "The model returned an incompatible analysis; no analysis was accepted.",
  WORDPRESS_MUSE_OUTPUT_INVALID: "Muse returned incompatible analysis or evidence references; no analysis was published.",
  WORDPRESS_MUSE_STORAGE_ERROR: "The saved Muse analysis could not be accessed safely.",
  WORDPRESS_REPORT_STORAGE_ERROR: "The WordPress evidence archive could not be accessed safely.",
  WORDPRESS_VERIFICATION_STORAGE_ERROR: "The public verification receipt could not be accessed safely.",
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload =
      exception instanceof HttpException ? exception.getResponse() : null;
    const details =
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>)
        : {};
    const defaults: Record<number, string> = {
      400: "INVALID_REQUEST",
      404: "NOT_FOUND",
      409: "CONFLICT",
      413: "PAYLOAD_TOO_LARGE",
      503: "SERVICE_UNAVAILABLE",
    };
    const safeCode = typeof details.code === "string" && Object.hasOwn(safeIntegrationErrors, details.code) ? details.code : null;
    const code =
      status >= 500
        ? (safeCode ?? defaults[status] ?? "INTERNAL_ERROR")
        : typeof details.code === "string"
          ? details.code
          : (defaults[status] ?? "REQUEST_FAILED");
    const message =
      status >= 500
        ? (safeCode ? safeIntegrationErrors[safeCode] : "The request could not be completed. Please try again.")
        : typeof details.message === "string"
          ? details.message
          : status === 400
            ? "The request contains missing or invalid fields."
            : "The request could not be completed.";
    if (status >= 500)
      this.logger.error(
        exception instanceof Error ? exception.stack : "Unknown server error",
      );
    response
      .status(status)
      .json({ error: { code, message, requestId: String(request.id) } });
  }
}
