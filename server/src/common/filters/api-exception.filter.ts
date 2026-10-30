import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

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
    const code =
      status >= 500
        ? (defaults[status] ?? "INTERNAL_ERROR")
        : typeof details.code === "string"
          ? details.code
          : (defaults[status] ?? "REQUEST_FAILED");
    const message =
      status >= 500
        ? "The request could not be completed. Please try again."
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
