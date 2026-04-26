import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Stable, locale-independent error codes.
 *
 * The frontend looks these up in `errors.<CODE>` of its i18n bundle to
 * render the localised string. The English `message` argument stays in
 * the response as a fallback for unmigrated clients, server logs, and
 * automated tests that assert on text.
 *
 * Codes follow `<DOMAIN>.<REASON>` and never carry user-controlled
 * input — interpolation goes through `params` so the translation layer
 * can format it per-locale (digits in Arabic, currency symbols, etc.).
 */
export type ErrorCode = string;

/**
 * Throw one of these subclasses when the failure has a known meaning we
 * want to localise. Each extends the matching NestJS HttpException so
 * existing `instanceof NotFoundException` / `instanceof ConflictException`
 * checks keep passing — only the response payload gains the extra
 * `errorCode` + `params` fields, which `AllExceptionsFilter` preserves.
 *
 *   throw new BusinessConflictException(
 *     'BOOKING.SLOT_BUSY',
 *     'This slot is currently being booked. Please try again in a moment.',
 *   );
 *
 * For generic 4xx without a dedicated code, keep using the standard
 * Nest HttpException subclasses — the filter passes them through and
 * the frontend falls back to `message`.
 */
function buildPayload(
  errorCode: ErrorCode,
  message: string,
  status: number,
  params?: Record<string, string | number>,
) {
  return {
    statusCode: status,
    message,
    errorCode,
    ...(params ? { params } : {}),
  };
}

export class BusinessBadRequestException extends BadRequestException {
  constructor(public readonly errorCode: ErrorCode, message: string, params?: Record<string, string | number>) {
    super(buildPayload(errorCode, message, 400, params));
  }
}

export class BusinessUnauthorizedException extends UnauthorizedException {
  constructor(public readonly errorCode: ErrorCode, message: string, params?: Record<string, string | number>) {
    super(buildPayload(errorCode, message, 401, params));
  }
}

export class BusinessForbiddenException extends ForbiddenException {
  constructor(public readonly errorCode: ErrorCode, message: string, params?: Record<string, string | number>) {
    super(buildPayload(errorCode, message, 403, params));
  }
}

export class BusinessNotFoundException extends NotFoundException {
  constructor(public readonly errorCode: ErrorCode, message: string, params?: Record<string, string | number>) {
    super(buildPayload(errorCode, message, 404, params));
  }
}

export class BusinessConflictException extends ConflictException {
  constructor(public readonly errorCode: ErrorCode, message: string, params?: Record<string, string | number>) {
    super(buildPayload(errorCode, message, 409, params));
  }
}

export class BusinessUnprocessableException extends UnprocessableEntityException {
  constructor(public readonly errorCode: ErrorCode, message: string, params?: Record<string, string | number>) {
    super(buildPayload(errorCode, message, 422, params));
  }
}
