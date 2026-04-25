import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';

/**
 * Global catch-all exception filter.
 *
 * Defence-in-depth against leaking internal state (Prisma errors, stack traces,
 * SQL fragments, file paths) to clients.
 *
 * Rules:
 * - HttpException → pass through its status + message (already intentional)
 * - Everything else → return generic 500 to the client, log full details server-side
 * - Stack traces are NEVER in the response body in any environment
 * - Request bodies are NEVER logged (may contain passwords, tokens, PII)
 * - The logger only records: method, sanitized path, status, error class name
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // ── Known HTTP exceptions (thrown intentionally) ──────────────────────
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // Normalise to { statusCode, message } — strip any extra fields that
      // framework internals may have attached (e.g. validator metadata).
      const payload =
        typeof body === 'string'
          ? { statusCode: status, message: body }
          : {
              statusCode: status,
              message: (body as any)?.message ?? 'Request failed',
              // Preserve validation error arrays (class-validator) — they're
              // designed to be client-facing.
              ...((body as any)?.error ? { error: (body as any).error } : {}),
            };

      response.status(status).json(payload);

      // Only report 5xx HttpExceptions to Sentry. 4xx is user-caused (validation,
      // auth, not-found) and would drown the signal in noise. `captureException`
      // is a no-op if Sentry isn't initialised.
      if (status >= 500) {
        this.reportToSentry(exception, request);
      }
      return;
    }

    // ── Unknown / unexpected errors ───────────────────────────────────────
    // Never leak details to the client. Log internally with minimal context.
    const errorName =
      exception instanceof Error ? exception.constructor.name : 'UnknownError';

    // Sanitized path: strip query string (may contain tokens, emails)
    const safePath = request.path || 'unknown';

    this.logger.error(
      `${request.method} ${safePath} → 500 (${errorName})`,
      exception instanceof Error ? exception.stack : undefined,
    );

    // Unexpected errors are ALWAYS 5xx — report to Sentry. No-op without DSN.
    this.reportToSentry(exception, request);

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Internal server error',
    });
  }

  // Tag the event with requestId + minimal user context so on-call can jump
  // from a Sentry issue to the CloudWatch log for the same request. Never
  // attaches PII (email, IP) — those are scrubbed upstream by instrument.ts
  // `beforeSend`.
  private reportToSentry(
    exception: unknown,
    request: Request & { requestId?: string; user?: { id?: string; role?: string } },
  ): void {
    try {
      Sentry.withScope((scope) => {
        if (request.requestId) {
          scope.setTag('requestId', request.requestId);
        }
        if (request.user?.id) {
          scope.setUser({ id: request.user.id });
        }
        if (request.user?.role) {
          scope.setTag('role', request.user.role);
        }
        Sentry.captureException(exception);
      });
    } catch {
      // Never let error reporting break the error handler itself.
    }
  }
}
