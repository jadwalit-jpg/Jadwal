import { ExceptionFilter, Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { Response } from 'express';

/**
 * Catches raw JSON-parse errors thrown by Express body-parser before they
 * reach the controller layer.
 *
 * Why this exists:
 *   The default behaviour leaks a parser-identifying string like
 *     "Unexpected token 'x', \"...\" is not valid JSON"
 *   to clients. That's mild fingerprinting (reveals we use express + the
 *   default body-parser setup) and exposes inputs that may have been part
 *   of an attack probe. We replace it with a generic 400 instead.
 *
 * The matching status code (400) and shape mirror NestJS's
 * BadRequestException so SDKs that handle Nest's standard error format
 * keep working.
 */
@Catch(SyntaxError)
export class JsonSyntaxFilter implements ExceptionFilter {
  private readonly logger = new Logger('JsonSyntaxFilter');

  catch(exception: SyntaxError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ method: string; path: string }>();

    // Log with method + path so on-call can correlate, but never log the raw
    // body — it may contain attack payloads or PII.
    this.logger.warn(
      `${request.method} ${request.path} → 400 (JSON syntax error masked)`,
    );

    response.status(400).json({
      statusCode: 400,
      message: 'Invalid request body',
      error: 'Bad Request',
    });
  }
}
