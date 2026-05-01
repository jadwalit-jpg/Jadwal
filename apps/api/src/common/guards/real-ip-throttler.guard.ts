import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Throttler guard that keys on the real client IP, not the connecting socket.
 *
 * Why this exists: behind Cloudflare → ALB → ECS, the immediate connecting
 * IP from Express's perspective is the ALB's private IP. Without this, every
 * request platform-wide gets bucketed together and per-IP rate limits become
 * effectively a single shared global counter.
 *
 * Resolution priority:
 *   1. cf-connecting-ip — set by Cloudflare with the real client IP. The
 *      ALB security group is locked to Cloudflare IP ranges, so this header
 *      cannot be forged by an attacker bypassing CF.
 *   2. req.ip — Express resolves this from x-forwarded-for when
 *      app.set('trust proxy', N) is configured (also done in main.ts for
 *      defense in depth).
 *   3. 'unknown' — last-resort key. Lumping unknowns together is fine; it
 *      means we under-throttle a connection we couldn't identify, not over-
 *      throttle real users.
 *
 * Header name is read case-insensitively; Express normalises to lowercase.
 */
@Injectable()
export class RealIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.length > 0) {
      return cfIp;
    }
    return req.ip ?? 'unknown';
  }
}
