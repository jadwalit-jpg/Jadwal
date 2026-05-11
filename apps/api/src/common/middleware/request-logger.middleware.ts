import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Global HTTP request logger.
 *
 * Emits ONE structured log line per completed request — useful for log
 * aggregators (CloudWatch Insights, Datadog, Grafana Loki) that want to
 * parse by field. Drops nothing unless the runtime can't serialise it.
 *
 * Correlation ID:
 *   - Accept inbound `x-request-id` header unchanged (pass-through).
 *   - Otherwise generate a fresh UUID v4.
 *   - Attach to `req.requestId` so downstream handlers can reference it
 *     (e.g. Sentry tags, error messages).
 *   - Echo back via `x-request-id` response header.
 *
 * What we deliberately DO NOT log:
 *   - Request body (may contain passwords, OTPs, tokens, PII).
 *   - Query string (may contain tokens in email-verify / password-reset flows).
 *   - Request headers (Authorization, Cookie).
 *
 * PII handling:
 *   - `ip` is `null` in production (GDPR — store only if legally required).
 *   - `userAgent` truncated to 200 chars to cap unbounded growth.
 *   - `userId` only when the request has an authenticated principal.
 *
 * Log level maps to status:
 *   - 2xx / 3xx → `log` (info)
 *   - 4xx       → `warn`
 *   - 5xx       → `error`
 * This lets CloudWatch filter by `@message LIKE %"level":"error"%`.
 */
/**
 * Comma-separated path prefixes whose 2xx/3xx responses are NOT logged.
 * Errors (4xx/5xx) are always logged regardless. Default is empty (log
 * everything). Ops can silence known high-volume polling endpoints
 * (`/api/notifications/unread-count`, `/api/geo/detect`) via env at any
 * time without a redeploy — shaves ~90% of log volume if polling ramps up.
 *
 * Example: ACCESS_LOG_SKIP_PATHS=/api/notifications/unread-count,/api/geo/detect
 */
const SKIP_PATH_PREFIXES = (process.env.ACCESS_LOG_SKIP_PATHS ?? '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request & { requestId?: string; user?: { id?: string } }, res: Response, next: NextFunction) {
    const inboundId = req.header('x-request-id');
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos
    // Bounded character class with a fixed `{1,128}` upper bound — input
    // length is capped, no alternation/nesting, no backtracking risk.
    const requestId = inboundId && /^[A-Za-z0-9._-]{1,128}$/.test(inboundId)
      ? inboundId
      : randomUUID();

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const startedAt = process.hrtime.bigint();
    const { method } = req;
    // Use baseUrl + route path when available to avoid logging raw query strings.
    // req.originalUrl includes the query; strip it.
    const path = req.originalUrl.split('?')[0];

    res.on('finish', () => {
      const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
      const status = res.statusCode;

      // Skip successful responses for configured high-volume polling paths.
      // Errors (4xx/5xx) always log so operational signal never goes dark.
      if (status < 400 && SKIP_PATH_PREFIXES.some((p) => path.startsWith(p))) {
        return;
      }

      const userId = req.user?.id ?? null;
      const userAgent = (req.header('user-agent') ?? '').slice(0, 200) || null;
      const ip = process.env.NODE_ENV === 'production' ? null : req.ip ?? null;

      const payload = {
        event: 'HTTP_REQUEST',
        requestId,
        method,
        path,
        status,
        durationMs,
        userId,
        ip,
        userAgent,
      };

      // Object-form (not JSON.stringify) so pino emits each field at
      // top-level for CloudWatch Logs Insights `filter status = 500` etc.
      // Stringifying here would escape the JSON inside pino's `msg` field
      // and lose the queryability win that motivated the O4 migration.
      if (status >= 500) {
        this.logger.error(payload);
      } else if (status >= 400) {
        this.logger.warn(payload);
      } else {
        this.logger.log(payload);
      }
    });

    next();
  }
}
