import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * M5/M6 — session-family access-token denylist.
 *
 * A stateless JWT cannot be revoked before it expires. To make logout,
 * stolen-token-reuse detection, password rotation, and admin deactivation take
 * effect on the ACCESS token immediately (not ≤JWT_EXPIRATION later), we tie
 * every access token to its refresh-token *family* (`sid` claim) and, on any
 * revocation event, put that family id on a short-lived Redis denylist.
 * `JwtStrategy.validate()` rejects any still-unexpired access token whose `sid`
 * is denylisted.
 *
 * Single source of truth for the key format + TTL so the many call sites
 * (AuthService, AdminService, VendorService, the session-management endpoints,
 * and the JwtStrategy read side) can never drift apart.
 *
 * FAIL-OPEN / FAIL-SAFE: every method swallows Redis/DB errors. A denylist
 * write that fails must never break logout — the refresh token is still deleted
 * by the caller, so the session cannot renew; only the ≤JWT_EXPIRATION access-
 * token window is affected. A read that fails must never lock users out.
 */
@Injectable()
export class SessionDenylistService {
  private readonly logger = new Logger(SessionDenylistService.name);
  /** Denylist TTL in ms = access-token lifetime + a small skew buffer. After
   *  this the access token is dead anyway, so the marker can expire. */
  private readonly ttlMs: number;
  /** Hard ceiling on the isDenied() read — this runs on EVERY authenticated
   *  request (global JwtAuthGuard). If Redis is slow/down we must fail OPEN
   *  FAST rather than let ioredis retries stall the whole auth path. */
  private readonly readTimeoutMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {
    const accessExpiry = Number(this.config.get('JWT_EXPIRATION', '900'));
    this.ttlMs = (accessExpiry + 60) * 1000;
    this.readTimeoutMs = Number(this.config.get('DENYLIST_READ_TIMEOUT_MS', '200'));
  }

  /** Redis key for the access-token denylist, keyed on a session family id. */
  private key(familyId: string): string {
    return `denylist:sess:${familyId}`;
  }

  /** Put ONE session family on the denylist. No-op on empty id; fail-safe. */
  async denylistSession(familyId: string | null | undefined): Promise<void> {
    if (!familyId) return;
    try {
      await this.redis.getClient().set(this.key(familyId), '1', 'PX', this.ttlMs);
    } catch {
      this.logger.warn(
        `Session denylist write failed (fam ${familyId.slice(0, 8)}) — access token relies on natural expiry`,
      );
    }
  }

  /**
   * Denylist EVERY active session family of a user — for "kill all sessions"
   * events (logout-everywhere, password reset, deactivation, delete, role
   * change). The caller MUST invoke this BEFORE deleting the token rows (the
   * families are read from them). Distinct on familyId so each is written once.
   */
  async denylistAllUserSessions(userId: string): Promise<void> {
    await this.denylistUserSessions(userId, null);
  }

  /**
   * Denylist every active family of a user EXCEPT one (e.g. keep the current
   * device alive on an authenticated password change). Pass `keepFamilyId=null`
   * to denylist all.
   */
  async denylistUserSessionsExcept(userId: string, keepFamilyId: string | null): Promise<void> {
    await this.denylistUserSessions(userId, keepFamilyId);
  }

  private async denylistUserSessions(userId: string, keepFamilyId: string | null): Promise<void> {
    try {
      const fams = await this.prisma.client.refreshToken.findMany({
        where: {
          userId,
          rotatedAt: null,
          ...(keepFamilyId ? { familyId: { not: keepFamilyId } } : {}),
        },
        select: { familyId: true },
        distinct: ['familyId'],
      });
      await Promise.all(fams.map((f) => this.denylistSession(f.familyId)));
    } catch {
      this.logger.warn(
        `Denylist-all-sessions failed for user ${userId.slice(0, 8)} — access tokens rely on natural expiry`,
      );
    }
  }

  /**
   * Whether a session family is currently denylisted. Runs on EVERY
   * authenticated request (global JwtAuthGuard → JwtStrategy.validate), so it is
   * deliberately hardened for the hot path:
   *   - FAIL-OPEN: a timeout, a rejected read, or a client error all resolve to
   *     `false` (allow) — availability over the short denylist window; the
   *     ≤JWT_EXPIRATION natural expiry still bounds exposure.
   *   - BOUNDED: the read is capped at `readTimeoutMs` (default 200ms) so a slow
   *     or down Redis can't stall auth behind ioredis retries/backoff.
   *   - SILENT: no per-request logging here — a Redis outage would otherwise
   *     flood the logs, and ioredis error messages can embed the connection URI
   *     (credentials). RedisService's connection-level handler logs the outage
   *     once; we never log the raw error object on this path.
   */
  async isDenied(familyId: string | null | undefined): Promise<boolean> {
    if (!familyId) return false;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (denied: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(denied);
      };
      const timer = setTimeout(() => finish(false), this.readTimeoutMs);
      try {
        this.redis
          .getClient()
          .get(this.key(familyId))
          .then((hit) => finish(hit !== null), () => finish(false));
      } catch {
        // getClient() threw synchronously (misconfiguration) — fail open.
        finish(false);
      }
    });
  }
}
