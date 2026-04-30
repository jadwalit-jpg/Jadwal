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
      // BusinessException (see common/exceptions/business-exception.ts)
      // attaches `errorCode` + optional `params` so the client can render
      // a localised string instead of falling back to the English message.
      let payload =
        typeof body === 'string'
          ? { statusCode: status, message: body }
          : {
              statusCode: status,
              message: (body as any)?.message ?? 'Request failed',
              // Preserve validation error arrays (class-validator) — they're
              // designed to be client-facing.
              ...((body as any)?.error ? { error: (body as any).error } : {}),
              ...((body as any)?.errorCode ? { errorCode: (body as any).errorCode } : {}),
              ...((body as any)?.params ? { params: (body as any).params } : {}),
            };

      // Fallback for body-parser JSON syntax errors that get wrapped into
      // a BadRequestException before our @Catch(SyntaxError) filter sees
      // them. Detect the parser-identifying message pattern and replace
      // with a generic one so we don't leak which JSON parser we use.
      // Caught patterns:
      //   "Unexpected token 'x', \"...\" is not valid JSON"   (modern Node)
      //   "Unexpected end of JSON input"
      //   "Unexpected number / string / character in JSON"
      if (
        status === 400 &&
        typeof (payload as any).message === 'string' &&
        /(unexpected (token|number|string|character|end)\b|is not valid json|in json\b)/i.test(
          (payload as any).message,
        )
      ) {
        payload = {
          statusCode: 400,
          message: 'Invalid request body',
          error: 'Bad Request',
        };
      }

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
    // Never leak details to the client. Log internally with full context so
    // CloudWatch ERROR-grep finds the actual cause, not just the class name.
    const errorName =
      exception instanceof Error ? exception.constructor.name : 'UnknownError';
    const errorMessage =
      exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    // Sanitized path: strip query string (may contain tokens, emails)
    const safePath = request.path || 'unknown';

    // Put the error MESSAGE on the main log line so a single-line CloudWatch
    // search like `ERROR /api/admin/profile/password` returns something
    // actionable. The stack trace follows as the trace argument; the default
    // NestJS ConsoleLogger prints it on a subsequent line.
    this.logger.error(
      `${request.method} ${safePath} → 500 (${errorName}: ${errorMessage})`,
      stack,
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
