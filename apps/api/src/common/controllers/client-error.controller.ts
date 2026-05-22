import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { ClientErrorDto } from '../dto/client-error.dto';
import { RATE_LIMIT_STRICT } from '../throttle-config';

/**
 * Bridge endpoint that turns browser-side React render errors into CloudWatch
 * log entries. The web app's `<ErrorBoundary>` calls this in
 * `componentDidCatch`; the entry written here lands in the existing
 * `/ecs/jadwal-api` log group like every other server log.
 *
 * Why the API surfaces this rather than the web app:
 * - The web ECS task only logs server-side (SSR / Next.js Node handlers);
 *   browser console output never reaches it.
 * - The API already runs the canonical Logger pipeline, has rate limiting,
 *   has the body-size cap, and gets monitored by the existing CloudWatch
 *   alarms — extending it costs nothing.
 *
 * Security posture:
 * - Unauthenticated: errors can fire on `/login`, `/register`, or before
 *   the auth context resolves. Requiring a token would silently swallow
 *   the most interesting errors. The endpoint accepts ONLY a structured
 *   DTO with capped string fields — no privilege grants, no DB writes,
 *   no side effects beyond a Logger call.
 * - Rate-limited via `RATE_LIMIT_STRICT` (3/min/IP). A single buggy client
 *   in a hot loop is bounded; multi-IP abuse hits the global throttler.
 * - URL is sanitised (query string stripped) so an OAuth callback that
 *   landed on the boundary doesn't leak tokens into CloudWatch.
 * - We never trust `userId` as an auth signal; it's a correlation hint.
 */
@Controller('log')
export class ClientErrorController {
  private readonly logger = new Logger('ClientError');

  @Public()
  @Post('client-error')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(RATE_LIMIT_STRICT)
  async logClientError(@Body() body: ClientErrorDto, @Req() req: Request): Promise<void> {
    // Resolve client IP via the same priority as the rest of the stack:
    // cf-connecting-ip (preferred — set by Cloudflare, locked SG can't spoof)
    // → req.ip (Express resolves via TRUST_PROXY_HOPS).
    const cfIp = req.headers['cf-connecting-ip'];
    const ip =
      typeof cfIp === 'string' && cfIp.trim().length > 0 ? cfIp.trim() : (req.ip ?? 'unknown');

    // Strip query strings from URL — auth callback URLs and any error that
    // fires mid-redirect can carry tokens or temporary creds in the query.
    // Hash fragments are stripped automatically (browsers don't send them).
    const url = body.url ? body.url.split('?')[0] : undefined;

    // Single structured log line — CloudWatch Insights can query top-level
    // fields. Pino emits this object with `event` at top-level, so the
    // CloudWatch metric filter `"event":"CLIENT_ERROR"` (on /ecs/jadwal-api,
    // feeding Jadwal/Web ClientErrorCount) keeps matching. DO NOT
    // re-introduce JSON.stringify here — that would escape the JSON inside
    // pino's `msg` field and silently break the metric filter.
    // Truncation happens via the DTO's @MaxLength; no further trim needed.
    this.logger.error({
      event: 'CLIENT_ERROR',
      message: body.message,
      url,
      userAgent: body.userAgent,
      userId: body.userId,
      ip,
      stack: body.stack,
      componentStack: body.componentStack,
    });
  }
}
