import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

/**
 * Global filter for Prisma known-request errors.
 *
 * Maps common Prisma error codes to proper HTTP status codes so clients
 * never see a raw 500 for recoverable issues like unique collisions,
 * missing records, or foreign key violations.
 *
 * Rules:
 * - Never leak field names, constraint names, or stack traces to clients
 * - Always log the full error server-side with request context
 * - Services that want specific messages ("Email already registered")
 *   still do their own pre-checks and throw ConflictException manually —
 *   this filter is the safety net for everything else
 *
 * Services that want to handle a specific code inline can still do so
 * (e.g. bookings.service.ts catches P2034 inside $transaction) — those
 * handlers throw HttpException subclasses which bypass this filter via
 * Nest's HttpException filter.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('PrismaExceptionFilter');

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Log full details server-side with sanitized path (strips query string
    // which may contain tokens/emails). Client never sees the Prisma code,
    // meta, or stack — just the generic message from mapError().
    const safePath = request.path || 'unknown';
    this.logger.error(
      `${request.method} ${safePath} → Prisma ${exception.code}`,
      exception.stack,
    );

    const { status, message } = this.mapError(exception.code);

    response.status(status).json({
      statusCode: status,
      message,
    });
  }

  private mapError(code: string): { status: number; message: string } {
    switch (code) {
      // ─── Uniqueness / conflicts ────────────────────────────────────────
      case 'P2002': // Unique constraint failed on {constraint}
        return {
          status: HttpStatus.CONFLICT,
          message: 'A record with one of the provided values already exists',
        };
      case 'P2034': // Transaction conflict / write conflict / deadlock
        return {
          status: HttpStatus.CONFLICT,
          message: 'The resource is busy, please try again',
        };

      // ─── Record not found ──────────────────────────────────────────────
      case 'P2025': // Record required but not found (update/delete/*OrThrow)
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'The requested record does not exist',
        };

      // ─── Foreign key violations ────────────────────────────────────────
      case 'P2003': // Foreign key constraint failed
      case 'P2014': // Relation violation
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Invalid reference to a related record',
        };

      // ─── Data validation ───────────────────────────────────────────────
      case 'P2000': // Value too long for column
      case 'P2004': // Constraint failed on the database
      case 'P2006': // Provided value for field is invalid
      case 'P2011': // Null constraint violation
      case 'P2012': // Missing required value
      case 'P2013': // Missing required argument
      case 'P2019': // Input error
      case 'P2020': // Value out of range
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'The provided data is invalid',
        };

      // ─── Unknown Prisma codes → generic 500 (still no leakage) ─────────
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        };
    }
  }
}
