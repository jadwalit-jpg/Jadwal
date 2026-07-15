import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { GoogleProfile } from './strategies/google.strategy';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Response, Request } from 'express';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { User } from '@prisma/client';
import { TokenPayload } from './interfaces/token-payload.interface';
import { RegisterVendorDto } from './dto/register-vendor.dto';
import { resolveLanguageFromRequest, type EmailLanguage } from '../common/utils/locale';
import { TERMS_VERSION } from '../common/terms';
import { SecurityLoggerService } from '../common/services/security-logger.service';
import { AuditLoggerService } from '../common/services/audit-logger.service';
import { EmailService } from '../email/email.service';
import { EmailQuotaService } from '../email/email-quota.service';
import { NotificationService } from '../common/services/notification.service';
import { RedisService } from '../redis/redis.service';
import { SessionDenylistService } from '../redis/session-denylist.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessExpiry: number;
  private readonly refreshExpiry: number;
  private readonly sessionMaxDays: number;
  private readonly lockoutThreshold: number;
  private readonly lockoutDuration: number;
  private readonly globalLoginThreshold: number;
  private readonly globalLoginWindowSec: number;
  private readonly forgotPasswordCooldownSec: number;
  private readonly refreshReuseGraceMs: number;
  // Timing-equalisation hash for "user not found" / OAuth-only / locked branches.
  // MUST be computed at the SAME bcrypt cost as real passwords — a hardcoded
  // literal at a lower cost makes the not-found branch measurably faster than a
  // real bcrypt.compare, turning the timing-equaliser into an email-enumeration
  // oracle. Computed once at boot (hashSync is fine here — startup only).
  private readonly dummyHash: string;

  constructor(
    private usersService: UsersService,
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private securityLogger: SecurityLoggerService,
    private auditLogger: AuditLoggerService,
    private emailService: EmailService,
    private emailQuota: EmailQuotaService,
    private notificationService: NotificationService,
    private redisService: RedisService,
    private sessionDenylist: SessionDenylistService,
  ) {
    this.accessExpiry = Number(this.configService.get('JWT_EXPIRATION', '900'));
    this.refreshExpiry = Number(this.configService.get('REFRESH_TOKEN_EXPIRY_DAYS', '7'));
    // Absolute session lifetime cap. Default 7 days. Even if the user
    // keeps rotating their refresh token (which would otherwise extend
    // indefinitely), the session is forcibly logged out after this many
    // days from the original login. Pairs with refreshExpiry so the
    // *individual* token still has the same TTL — this just adds a
    // hard ceiling on the rotation chain.
    this.sessionMaxDays = Number(this.configService.get('SESSION_MAX_DAYS', '7'));
    this.lockoutThreshold = Number(this.configService.get('LOCKOUT_THRESHOLD', '5'));
    this.lockoutDuration = Number(this.configService.get('LOCKOUT_DURATION_MINUTES', '15'));
    // Same cost as real password hashing (users.service uses BCRYPT_ROUNDS||12),
    // so bcrypt.compare against it takes the same time as against a real hash.
    this.dummyHash = bcrypt.hashSync('timing-equalizer', Number(process.env.BCRYPT_ROUNDS || 12));
    // G1 — multi-IP credential-stuffing defence. Counts ALL login attempts
    // on a given email across ALL source IPs. Above this in N seconds → 429.
    // Closes the gap where per-IP throttle (3/min) and per-account DB
    // lockout (5 fails) miss the rotation pattern (1 attempt per IP × N IPs).
    this.globalLoginThreshold = Number(this.configService.get('LOGIN_GLOBAL_THRESHOLD', '15'));
    this.globalLoginWindowSec = Number(this.configService.get('LOGIN_GLOBAL_WINDOW_SEC', '900'));
    // G6 — per-recipient cooldown on /forgot-password. A given email can
    // only receive 1 reset request per N seconds regardless of source IP.
    this.forgotPasswordCooldownSec = Number(this.configService.get('FORGOT_PASSWORD_COOLDOWN_SEC', '300'));
    // M6 — grace window for refresh-token reuse detection. A rotated token
    // re-presented WITHIN this window is treated as a benign client race (two
    // tabs / a retry), not a stolen-token replay, so we don't nuke the session.
    // Beyond it, re-presentation is a genuine reuse → revoke the whole family.
    // Guard against a misconfigured value silently disabling M6 reuse detection:
    // a non-numeric/negative env → NaN, and `sinceRotationMs > NaN` is ALWAYS
    // false, so every replayed (stolen) token would be treated as a benign
    // within-grace race and never revoke the family. Fall back to the 30s default
    // if the configured value isn't a finite, non-negative number.
    const graceRaw = Number(this.configService.get('REFRESH_REUSE_GRACE_MS', '30000'));
    this.refreshReuseGraceMs = Number.isFinite(graceRaw) && graceRaw >= 0 ? graceRaw : 30000;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private extractClientInfo(req?: Request) {
    if (!req) return { ip: undefined, userAgent: undefined };
    // Trust the proxy chain via Express (configured by TRUST_PROXY_HOPS in
    // main.ts). Don't parse X-Forwarded-For ourselves — that bypasses the
    // hop-count validation and would write a forged IP into refreshToken
    // sessions if anything upstream ever let a fake header through.
    //
    // Prefer cf-connecting-ip when present: single-valued, signed by the
    // edge, and the ALB SG locked to Cloudflare ranges makes it spoof-proof.
    // Fall back to req.ip which Express resolves correctly via trust-proxy.
    const cfIp = req.headers['cf-connecting-ip'];
    const ip = (typeof cfIp === 'string' && cfIp.trim().length > 0)
      ? cfIp.trim()
      : req.ip;
    const userAgent = req.headers['user-agent'];
    return { ip, userAgent };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Hash an email for use as a Redis key (G1 + G6). Lowercased and trimmed
   * for normalisation; truncated to 32 hex chars (128 bits — collision
   * probability is negligible at our scale and keeps Redis keys short).
   * Avoids storing plaintext PII as cache keys.
   */
  private hashEmail(email: string): string {
    return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32);
  }

  // M5/M6 session-family denylist — thin delegations to the shared
  // SessionDenylistService (single source of truth for key format + TTL, shared
  // with AdminService / VendorService / the session endpoints / JwtStrategy).
  private denylistSession(familyId: string | null | undefined): Promise<void> {
    return this.sessionDenylist.denylistSession(familyId);
  }

  private denylistAllUserSessions(userId: string): Promise<void> {
    return this.sessionDenylist.denylistAllUserSessions(userId);
  }

  /**
   * G1 — Multi-IP credential-stuffing defence.
   *
   * Increments a Redis counter keyed by email-hash on every login attempt
   * on that account, regardless of source IP or whether the password was
   * correct. If the counter exceeds the threshold within the window, throws
   * 429 before the password is even checked.
   *
   * This catches the rotation pattern that the per-IP throttler (3/min/IP)
   * and per-account DB lockout (5 fails) both miss: an attacker hitting one
   * email from N different IPs at 1 attempt per (IP, user) pair never trips
   * either defence individually.
   *
   * Fail-open on Redis errors — the per-IP throttler and DB lockout remain
   * as primary defences. CloudWatch alarms (G2) page operators when Redis
   * is unhealthy so the silent fail-open window is short.
   */
  private async checkGlobalLoginRate(
    email: string,
    ip: string | undefined,
    userAgent: string | undefined,
  ): Promise<void> {
    const key = `login:global:${this.hashEmail(email)}`;
    let count: number;
    try {
      const redis = this.redisService.getClient();
      // Atomic INCR+EXPIRE via Lua to prevent the rare race where INCR
      // returns 1 but a separate EXPIRE call fails or is delayed, leaving
      // a counter without TTL — that would let an attacker permanently
      // lock a legitimate user out by hitting threshold once and never
      // letting the counter roll over. Lua scripts execute atomically on
      // the Redis server, so EXPIRE is guaranteed to follow INCR=1.
      const luaScript = [
        `local current = redis.call('INCR', KEYS[1])`,
        `if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end`,
        `return current`,
      ].join('\n');
      count = (await redis.eval(
        luaScript,
        1,
        key,
        String(this.globalLoginWindowSec),
      )) as number;
    } catch {
      return;
    }

    if (count > this.globalLoginThreshold) {
      await this.securityLogger.log({
        event: 'LOGIN_GLOBAL_RATE_EXCEEDED',
        email,
        ip,
        userAgent,
        details: `${count} attempts on this account in ${Math.round(this.globalLoginWindowSec / 60)}min (any IP)`,
      });
      throw new HttpException(
        'Too many login attempts on this account. Please wait a few minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Reset the G1 global counter on successful login — a verified-correct
   * password is strong evidence the legit user is the one logging in, so
   * stale failed attempts shouldn't continue to count against them.
   */
  private async resetGlobalLoginRate(email: string): Promise<void> {
    try {
      await this.redisService.getClient().del(`login:global:${this.hashEmail(email)}`);
    } catch {
      // Silent — not critical; counter expires naturally.
    }
  }

  /** Public accessor for controllers that need to identify the current session */
  getTokenHash(rawToken: string): string {
    return this.hashToken(rawToken);
  }

  private generateRefreshToken(): string {
    return crypto.randomBytes(48).toString('base64url');
  }

  /**
   * Auth-cookie attribute set. Audit (2026-04-27):
   *   - httpOnly       : JS in the page can't read the cookie. Stops
   *                      stored-XSS from exfiltrating the access token.
   *   - secure         : only sent over HTTPS. Gated on production so
   *                      the local dev server over HTTP still works.
   *                      Localhost is browser-special-cased to accept
   *                      Secure cookies in dev anyway.
   *   - sameSite=strict: cookie is NEVER sent on cross-site navigation.
   *                      Hard-blocks CSRF without needing a CSRF token.
   *   - path=/         : cookie scoped to the whole origin.
   *   - no Domain attr : implicitly host-only. Subdomains can't read.
   *
   * On the `__Host-` cookie-name prefix:
   *   The `__Host-` prefix is a browser guarantee that the cookie was
   *   set with Secure + Path=/ + no Domain (which we already do). It
   *   would add NO real security beyond what we have today. The cost
   *   of renaming the cookie ('Authentication' -> '__Host-
   *   Authentication') is a forced-logout of every active session and
   *   coordinated changes in middleware.ts (which reads
   *   `request.cookies.get('Authentication')`). For a live prod app
   *   the cost outweighs the marginal gain — the audit conclusion is
   *   that the existing attributes already satisfy the security
   *   intent of the `__Host-` prefix.
   */
  private cookieOptions(maxAgeMs: number) {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path: '/',
      maxAge: maxAgeMs,
    };
  }

  // ─── Login with all checks (lockout, deactivation, vendor status) ──────────

  async loginWithCheck(email: string, password: string, response: Response, req?: Request) {
    const { ip, userAgent } = this.extractClientInfo(req);

    // G1 — Multi-IP credential-stuffing defence. Throws 429 BEFORE we
    // touch the DB, so a botnet hammering one email from many IPs can't
    // even cost us user-table reads after the threshold trips.
    await this.checkGlobalLoginRate(email, ip, userAgent);

    const db = this.prisma.client;

    // 1. Find user — only select fields needed for auth flow
    const user = await db.user.findUnique({
      where: { email },
      select: {
        id: true, email: true, fullName: true, role: true, password: true,
        failedLoginAttempts: true, lockedUntil: true, emailVerified: true, isDeactivated: true,
      },
    });
    if (!user) {
      await bcrypt.compare(password, this.dummyHash); // equalize timing (same cost as a real hash)
      await this.securityLogger.log({ event: 'LOGIN_FAILED', email, ip, userAgent, details: 'User not found' });
      throw new UnauthorizedException('Invalid credentials');
    }

    // 2. Check lockout — return generic message to prevent account enumeration
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await bcrypt.compare(password, user.password || this.dummyHash); // equalize timing
      await this.securityLogger.log({ event: 'LOGIN_FAILED', userId: user.id, email, ip, userAgent, details: 'Account locked' });
      throw new UnauthorizedException('Invalid credentials');
    }

    // 2b. Lock has EXPIRED (lockedUntil is set but not in the future, per the
    // check above). Reset the attempt budget to zero so the account gets a fresh
    // N attempts this cycle. Without this, failedLoginAttempts still holds
    // ≥threshold, so the very next wrong password re-locks immediately — letting
    // an attacker keep a victim permanently locked out with one attempt every
    // lock-duration (well under any rate limit). One-time write per lock cycle.
    if (user.lockedUntil) {
      await db.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
    }

    // 3. Verify password (null password = OAuth-only account)
    if (!user.password) {
      await bcrypt.compare(password, this.dummyHash); // equalize timing
      throw new UnauthorizedException('Invalid credentials');
    }
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      // Atomic increment — two concurrent wrong-password attempts each
      // advance the counter. Reading `failedLoginAttempts` then writing
      // `value + 1` would let both reads see the same number and write the
      // same +1, so lockout could lag by one attempt per collision.
      const updated = await db.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      const attempts = updated.failedLoginAttempts;

      if (attempts >= this.lockoutThreshold) {
        // Stamp the lock with the threshold re-asserted in the where. A
        // concurrent successful login resets failedLoginAttempts to 0 — the
        // `gte` guard makes this a no-op in that race, so we never lock a
        // user who has just authenticated cleanly. count > 0 means the lock
        // actually applied → only then log ACCOUNT_LOCKED.
        const locked = await db.user.updateMany({
          where: { id: user.id, failedLoginAttempts: { gte: this.lockoutThreshold } },
          data: { lockedUntil: new Date(Date.now() + this.lockoutDuration * 60000) },
        });
        if (locked.count > 0) {
          await this.securityLogger.log({ event: 'ACCOUNT_LOCKED', userId: user.id, email, ip, userAgent, details: `Locked after ${attempts} failed attempts` });
        }
      }

      await this.securityLogger.log({ event: 'LOGIN_FAILED', userId: user.id, email, ip, userAgent, details: `Bad password, attempt ${attempts}` });
      throw new UnauthorizedException('Invalid credentials');
    }

    // 4. Check email verified (customers only — vendors/admins are created by admin and skip this)
    if (user.role === 'CUSTOMER' && !user.emailVerified) {
      await this.securityLogger.log({ event: 'LOGIN_FAILED', userId: user.id, email, ip, userAgent, details: 'Email not verified' });
      throw new ForbiddenException('EMAIL_NOT_VERIFIED');
    }

    // 5. Check deactivation
    if (user.isDeactivated) {
      await this.securityLogger.log({ event: 'DEACTIVATED_ACCESS', userId: user.id, email, ip, userAgent });
      throw new ForbiddenException('Your account has been deactivated');
    }

    // 6. Check vendor status
    if (user.role === 'VENDOR') {
      const vendor = await db.vendor.findUnique({ where: { userId: user.id }, select: { status: true } });
      if (!vendor) throw new ForbiddenException('Vendor profile not found');
      if (vendor.status === 'PENDING') {
        await this.securityLogger.log({ event: 'SUSPENDED_VENDOR_ACCESS', userId: user.id, email, ip, userAgent, details: 'PENDING vendor' });
        throw new ForbiddenException('Your vendor account is pending admin approval');
      }
      if (vendor.status === 'SUSPENDED') {
        await this.securityLogger.log({ event: 'SUSPENDED_VENDOR_ACCESS', userId: user.id, email, ip, userAgent, details: 'SUSPENDED vendor' });
        throw new ForbiddenException('Your vendor account has been suspended');
      }
    }

    // 6. Reset failed attempts
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await db.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    }

    // G1 — clear the global counter on successful auth.
    await this.resetGlobalLoginRate(email);

    // 7. Issue tokens
    await this.securityLogger.log({ event: 'LOGIN_SUCCESS', userId: user.id, email, ip, userAgent });
    return this.issueTokens(user, response, req);
  }

  // ─── Issue access + refresh tokens ──────────────────────────────────────────

  private readonly maxActiveTokens = Number(process.env.MAX_SESSIONS_PER_USER || 5);

  async issueTokens(
    user: Pick<User, 'id' | 'email' | 'fullName' | 'role'>,
    response: Response,
    req?: Request,
    // Pass-through for refresh-token rotation: when we ROTATE a token,
    // the new RefreshToken row needs to inherit the original session's
    // start time so the absolute max-age cap (sessionMaxDays) is
    // measured from when the user first logged in, not from the latest
    // rotation. Fresh logins omit this and get `new Date()` below.
    sessionStartedAt?: Date,
    // Session-family id, carried across rotations like sessionStartedAt. A fresh
    // login omits it → a new family is minted below; rotation passes the existing
    // one so the whole session shares one family (for logout/reuse revocation).
    familyId?: string,
  ) {
    const db = this.prisma.client;
    const { ip, userAgent } = this.extractClientInfo(req);
    // One family per session, stable across every rotation (M5/M6).
    const family = familyId ?? crypto.randomUUID();

    const payload: TokenPayload = { email: user.email, sub: user.id, role: user.role, sid: family };
    const accessToken = this.jwtService.sign(payload);

    // Set access token cookie
    response.cookie('Authentication', accessToken, this.cookieOptions(this.accessExpiry * 1000));

    // Cleanup: delete expired tokens for this user
    await db.refreshToken.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    });

    // Enforce max active tokens (oldest gets evicted). Count only ACTIVE
    // (non-rotated) tokens — M6 keeps rotated tokens as reuse-detection tombstones
    // (rotatedAt set); those are historical, not live sessions, and must not count
    // toward the concurrent-session cap or be evicted here (they self-expire).
    const activeTokens = await db.refreshToken.findMany({
      where: { userId: user.id, rotatedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (activeTokens.length >= this.maxActiveTokens) {
      const tokensToDelete = activeTokens.slice(this.maxActiveTokens - 1).map(t => t.id);
      await db.refreshToken.deleteMany({ where: { id: { in: tokensToDelete } } });
    }

    // Generate and store refresh token (hashed in DB, raw in cookie)
    const rawRefreshToken = this.generateRefreshToken();
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + this.refreshExpiry * 24 * 60 * 60 * 1000);

    await db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        // Carry the original session start across rotations so the
        // absolute session lifetime cap is measured from first login.
        sessionStartedAt: sessionStartedAt ?? new Date(),
        // Stable session-family id, shared by every rotation of this session.
        familyId: family,
        userAgent: userAgent ?? null,
        ipAddress: ip ?? null,
        lastUsedAt: new Date(),
      },
    });

    response.cookie('RefreshToken', rawRefreshToken, this.cookieOptions(this.refreshExpiry * 24 * 60 * 60 * 1000));

    // Build response body (never includes tokens — they're in cookies)
    const result: any = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };

    if (user.role === 'VENDOR') {
      const vendor = await this.prisma.client.vendor.findUnique({
        where: { userId: user.id },
        select: { id: true, businessNameEn: true, businessNameAr: true, slug: true, status: true, countryId: true },
      });
      result.vendor = vendor;
    }

    return result;
  }

  // ─── Refresh token rotation ─────────────────────────────────────────────────

  async refreshTokens(refreshTokenRaw: string, response: Response, req?: Request) {
    const { ip, userAgent } = this.extractClientInfo(req);
    const db = this.prisma.client;
    const tokenHash = this.hashToken(refreshTokenRaw);

    const storedToken = await db.refreshToken.findUnique({ where: { tokenHash } });
    if (!storedToken) {
      // Unified generic message — same string returned whether the token
      // is missing, malformed, expired, or already rotated. This avoids
      // confirming any specific token-state to an attacker probing the
      // refresh endpoint with stolen / guessed tokens.
      throw new UnauthorizedException('Session expired — please log in again');
    }

    // M6 — REFRESH-TOKEN REUSE DETECTION. A token with rotatedAt set was already
    // consumed (rotation now marks instead of deleting — see below). Its
    // re-presentation is one of two things:
    //   (a) a benign client race within the grace window — two tabs / a retry
    //       both send the just-rotated token; the winner already rotated it. We
    //       do NOT nuke the session; the racing tab's next request uses the fresh
    //       cookie the winner set.
    //   (b) a genuine REUSE beyond the grace window — a stolen, already-rotated
    //       token replayed. This is a compromise signal: revoke the ENTIRE family
    //       (kills the attacker's AND the legit user's current session), denylist
    //       it so any outstanding access token dies now, log it, force re-auth.
    // Either way the presented token is spent → generic 401 (same message).
    if (storedToken.rotatedAt) {
      const sinceRotationMs = Date.now() - storedToken.rotatedAt.getTime();
      if (sinceRotationMs > this.refreshReuseGraceMs) {
        await this.denylistSession(storedToken.familyId);
        await db.refreshToken.deleteMany({ where: { familyId: storedToken.familyId } });
        this.clearAllCookies(response);
        await this.securityLogger.log({
          event: 'REFRESH_REUSE_DETECTED',
          userId: storedToken.userId,
          ip,
          userAgent,
          details: `Reused a rotated refresh token — session family ${storedToken.familyId.slice(0, 8)} revoked`,
        });
      }
      throw new UnauthorizedException('Session expired — please log in again');
    }

    if (storedToken.expiresAt < new Date()) {
      await db.refreshToken.delete({ where: { id: storedToken.id } });
      throw new UnauthorizedException('Session expired — please log in again');
    }

    // Absolute session-age cap. Even though refresh-token rotation
    // would otherwise extend the session indefinitely, we enforce a
    // hard ceiling (default 7 days) measured from the original login.
    // This bounds the blast radius of a stolen refresh token: an
    // attacker who exfiltrates one can keep rotating it, but only
    // until the cap is hit; after that the user is forced to re-auth.
    const sessionAgeMs = Date.now() - storedToken.sessionStartedAt.getTime();
    const sessionMaxMs = this.sessionMaxDays * 24 * 60 * 60 * 1000;
    if (sessionAgeMs > sessionMaxMs) {
      // Absolute-cap hit — end this session and kill its outstanding access token.
      await this.denylistSession(storedToken.familyId);
      await db.refreshToken.deleteMany({ where: { familyId: storedToken.familyId } });
      this.clearAllCookies(response);
      throw new UnauthorizedException('Session expired — please log in again');
    }

    // Rotation: atomically CONSUME the token — mark it rotated (single-use) and
    // KEEP it as a reuse-detection tombstone (M6); it self-expires at its
    // original expiresAt. The new token issued below inherits the same familyId,
    // so the whole session shares one family for logout/reuse revocation.
    //
    // CONCURRENCY GATE: the conditional `where: { rotatedAt: null }` makes this a
    // single atomic compare-and-set. Under two simultaneous refreshes of the SAME
    // token, Postgres row-locks serialise them and exactly ONE sees rotatedAt=null
    // → count 1 (winner); the other re-evaluates the predicate post-commit →
    // count 0 (loser). The loser aborts WITHOUT revoking the family — this is a
    // benign client race (two tabs / a retry), not a stolen-token reuse; the
    // winner already minted the new pair, and the loser's next call uses that
    // fresh cookie. This replaces the previous delete-throws-P2025 gate while
    // preserving strict single-use.
    const consumed = await db.refreshToken.updateMany({
      where: { id: storedToken.id, rotatedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (consumed.count === 0) {
      // Benign race loser: another concurrent request rotated this exact token
      // microseconds ago and already set the fresh cookie on ITS response. Do
      // NOT clear cookies here — that would log out a legitimate second tab;
      // let the winner's new cookie stand and the client retry. (A genuine
      // stolen-token REUSE is caught earlier by the rotatedAt tombstone branch,
      // which DOES revoke + clear.) Fail this one request with the generic 401.
      throw new UnauthorizedException('Session expired — please log in again');
    }

    // Verify user is still valid — select only what issueTokens needs
    const user = await db.user.findUnique({
      where: { id: storedToken.userId },
      select: { id: true, email: true, fullName: true, role: true, isDeactivated: true },
    });
    if (!user || user.isDeactivated) {
      await this.denylistSession(storedToken.familyId);
      await db.refreshToken.deleteMany({ where: { userId: storedToken.userId } });
      this.clearAllCookies(response);
      // Unified with the other refresh-flow exceptions to avoid leaking
      // the difference between "user gone" / "deactivated" / "expired".
      throw new UnauthorizedException('Session expired — please log in again');
    }

    // Check vendor status on each refresh (session invalidation on role change)
    if (user.role === 'VENDOR') {
      const vendor = await db.vendor.findUnique({ where: { userId: user.id }, select: { status: true } });
      if (!vendor || vendor.status === 'SUSPENDED') {
        await this.denylistAllUserSessions(user.id);
        await db.refreshToken.deleteMany({ where: { userId: user.id } });
        this.clearAllCookies(response);
        throw new ForbiddenException('Your vendor account has been suspended');
      }
    }

    await this.securityLogger.log({ event: 'TOKEN_REFRESH', userId: user.id, ip, userAgent });

    // Opportunistic cleanup: delete expired tokens in background (fire-and-forget)
    this.cleanupExpiredTokens().catch(() => {});

    // Pass the original session start time through to the new token row.
    // Without this, every rotation would reset the 7-day absolute cap and
    // we'd be back to indefinite sessions.
    // Carry BOTH the original session-start (absolute-cap) AND the family id
    // (M5/M6) into the new token, so the whole session stays one family.
    return this.issueTokens(user, response, req, storedToken.sessionStartedAt, storedToken.familyId);
  }

  // ─── Register (customer) — sends verification email, does NOT issue cookies ─

  /**
   * Anti-enumeration constant-time floor for /auth/register. The fresh-signup
   * path awaits DB writes + (previously) a network email send that the
   * already-registered path skips, so response TIME leaked whether an email
   * exists — a bigger oracle than the response body, which is already identical.
   * Padding every branch up to a fixed floor makes all outcomes return at the
   * same time. Pair this with a bcrypt equaliser (CPU cost) and a fire-and-forget
   * email send (removes the variable network delay) so the natural time of every
   * branch stays UNDER the floor. Env-tunable; default comfortably above the
   * slowest branch (~1 bcrypt + a couple of writes).
   */
  private async padRegisterConstantTime(startedAt: number): Promise<void> {
    const floorMs = Number(process.env.REGISTER_MIN_RESPONSE_MS || 600);
    const elapsed = Date.now() - startedAt;
    if (elapsed < floorMs) {
      await new Promise((r) => setTimeout(r, floorMs - elapsed));
    }
  }

  async registerAndLogin(data: { fullName: string; email: string; password: string; phone?: string; website?: string }, req?: Request) {
    const db = this.prisma.client;
    const startedAt = Date.now();

    // Honeypot trip — `website` is a hidden CSS-offscreen field (see
    // register-form.tsx). Real users never see or fill it. A non-empty
    // value here means a naive scraper auto-filled every input. Return
    // the SAME anti-enumeration response as a real registration would
    // (`{pending:true, email}`) so the bot can't tell it was caught;
    // skip user creation and email send entirely.
    if (data.website && data.website.trim().length > 0) {
      const { ip: botIp } = this.extractClientInfo(req);
      await this.securityLogger.log({
        event: 'LOGIN_FAILED',
        email: data.email,
        ip: botIp,
        details: 'Honeypot tripped on /auth/register',
      });
      await this.padRegisterConstantTime(startedAt);
      return { pending: true, email: data.email };
    }

    // M3 — ANTI-ENUMERATION on an already-registered email. Do NOT throw
    // "Email already registered" (a direct existence oracle). Return the SAME
    // generic {pending,email} response a fresh signup returns, and email the
    // OWNER "you already have an account" so a legitimate person who forgot is
    // guided back in (log in / reset) rather than left with a verification mail
    // that never comes. This mirrors the anti-enumeration already used by
    // forgot-password / resend-verification. The honeypot path above returns the
    // exact same response.
    const existingEmail = await db.user.findUnique({
      where: { email: data.email },
      select: { id: true, fullName: true, preferredLanguage: true },
    });
    if (existingEmail) {
      // Burn ~one bcrypt so this branch isn't measurably faster than the
      // fresh-signup path (which hashes the password) — closes the timing side
      // channel the response-shape match leaves open. dummyHash is cost-matched.
      await bcrypt.compare('timing-equalizer', this.dummyHash).catch(() => undefined);
      void this.emailService
        .sendAccountExistsNotification(
          data.email,
          { userName: existingEmail.fullName || '' },
          (existingEmail.preferredLanguage as EmailLanguage) || undefined,
        )
        .catch(() => undefined);
      await this.securityLogger.log({
        event: 'LOGIN_FAILED',
        email: data.email,
        details: 'Register attempt on an already-registered email',
      });
      await this.padRegisterConstantTime(startedAt);
      return { pending: true, email: data.email };
    }

    // Phone is @unique in the schema. Pre-check gives a clean 409 instead of
    // a raw Prisma P2002. Use a NEUTRAL message (not "phone already registered")
    // to avoid confirming to an attacker whether a specific phone number exists
    // in our database — same anti-enumeration reasoning as forgot-password and
    // resend-verification flows elsewhere in this service.
    if (data.phone) {
      const existingPhone = await db.user.findUnique({ where: { phone: data.phone }, select: { id: true } });
      if (existingPhone) throw new ConflictException('Please use a different phone number');
    }

    // emailVerified defaults to false in schema; usersService hashes password.
    // preferredLanguage is seeded from the Accept-Language header so the
    // verification email (and all later transactional mail) renders in the
    // language the user registered in.
    const preferredLanguage = resolveLanguageFromRequest(req);
    // The RegisterDto requires termsAccepted === true (enforced by ValidationPipe
    // before we reach here), so record the acceptance + current version now.
    const user = await this.usersService.create({
      ...data,
      preferredLanguage,
      termsAcceptedAt: new Date(),
      termsAcceptedVersion: TERMS_VERSION,
    });

    const { ip: regIp } = this.extractClientInfo(req);
    // Still awaited so the token is persisted + quota is checked before we
    // respond — but the actual network SEND inside is fire-and-forget (see
    // sendVerificationEmail), so the variable Resend round-trip no longer extends
    // the response and can't re-open the enumeration oracle by timing.
    await this.sendVerificationEmail(db, user.id, user.email, user.fullName, regIp);

    await this.securityLogger.log({ event: 'LOGIN_SUCCESS', userId: user.id, email: user.email, details: 'Customer registered, pending verification' });

    // Permanent audit trail entry for the new account. Fire-and-forget — never
    // let audit logging break the main flow (AuditLoggerService.log() already
    // swallows failures).
    await this.auditLogger.log({
      actorType: 'CUSTOMER',
      actorId: user.id,
      actorName: user.fullName || `user:${user.id.slice(0, 8)}`,
      action: 'CUSTOMER_REGISTER',
      entity: 'User',
      entityId: user.id,
      details: 'New customer account, pending email verification',
    });

    await this.padRegisterConstantTime(startedAt);
    return { pending: true, email: user.email };
  }

  // ─── Verify email token ─────────────────────────────────────────────────────

  async verifyEmail(token: string, response: Response, req?: Request) {
    const db = this.prisma.client;
    const { ip, userAgent } = this.extractClientInfo(req);

    // The DB stores SHA-256(token) — see sendVerificationEmail. The email
    // link carries the plaintext, which we hash here to match. Anti-replay
    // hardening identical to the password-reset flow: a DB dump cannot
    // be replayed against /verify-email (which would auto-issue a session
    // and effectively grant account takeover).
    const tokenHash = this.hashToken(token);

    const user = await (db.user as any).findUnique({
      where: { verificationToken: tokenHash },
      select: { id: true, email: true, verificationTokenExpiry: true },
    });
    // Unified message — both "no record" and "expired" must look identical
    // to the client to prevent token-state enumeration (an attacker probing
    // a leaked token list could otherwise distinguish "never existed" from
    // "existed but expired"). Server-side log retains the distinction.
    const VERIFY_LINK_INVALID = 'Invalid or expired verification link. Please request a new one.';
    if (!user) throw new BadRequestException(VERIFY_LINK_INVALID);

    if (!user.verificationTokenExpiry || user.verificationTokenExpiry < new Date()) {
      throw new BadRequestException(VERIFY_LINK_INVALID);
    }

    // Clear token, mark verified, and select only the fields issueTokens needs
    const verifiedUser = await db.user.update({
      where: { id: user.id },
      data: { emailVerified: true, verificationToken: null, verificationTokenExpiry: null } as any,
      select: { id: true, email: true, fullName: true, role: true },
    });

    await this.securityLogger.log({ event: 'LOGIN_SUCCESS', userId: user.id, email: user.email, ip, userAgent, details: 'Email verified' });

    return this.issueTokens(verifiedUser as any, response, req);
  }

  // ─── Resend verification email ──────────────────────────────────────────────

  async resendVerification(email: string, req?: Request) {
    const db = this.prisma.client;
    const genericResponse = { message: 'If that email exists, a new link has been sent.' };

    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, fullName: true, role: true, emailVerified: true },
    });
    // Anti-enumeration: nonexistent + already-verified emails get the
    // generic message. No cooldown info leaks for those — an attacker
    // probing arbitrary addresses can't distinguish "doesn't exist" from
    // "exists but already verified".
    if (!user || user.role !== 'CUSTOMER') return genericResponse;
    if (user.emailVerified) return genericResponse;

    // For confirmed pending-verification accounts ONLY, surface the
    // EmailQuotaService cooldown honestly. The user has already proven
    // the email exists (by registering moments before) — hiding the
    // cooldown behind a fake "sent" message creates a silent-failure UX
    // where they keep clicking and never learn why nothing arrives.
    //
    // Anti-enumeration is preserved because the early-return above
    // serves the generic response for any address NOT in pending state.
    // The 429 below only fires for the specific case "email exists +
    // unverified + cooldown active" — an attacker cannot reach this
    // path without already knowing the email is a real pending user.
    const cooldownSec = await this.emailQuota.getCooldownRemainingSec(email, 'verification');
    if (cooldownSec > 0) {
      throw new HttpException(
        {
          message: 'Too many attempts. Please wait before requesting another verification email.',
          retryAfterSec: cooldownSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const { ip: resendIp } = this.extractClientInfo(req);
    await this.sendVerificationEmail(db, user.id, user.email, user.fullName, resendIp);

    return genericResponse;
  }

  // ─── Google OAuth — upsert user, merge accounts, issue tokens ──────────────

  async handleGoogleAuth(googleUser: GoogleProfile, response: Response, req?: Request) {
    const db = this.prisma.client;
    const { ip, userAgent } = this.extractClientInfo(req);

    const oauthSelect = { id: true, email: true, fullName: true, role: true, isDeactivated: true, profilePicture: true, emailVerified: true } as const;

    // 1. Look up by googleId (returning OAuth user)
    let user = await db.user.findUnique({ where: { googleId: googleUser.googleId }, select: oauthSelect });

    if (!user) {
      // 2. Check if email already exists (account merge: link Google to existing account)
      const existing = await db.user.findUnique({ where: { email: googleUser.email }, select: oauthSelect });

      if (existing) {
        if (!existing.emailVerified) {
          throw new ForbiddenException('An account with this email exists but is not verified. Please verify your email first.');
        }
        user = await db.user.update({
          where: { id: existing.id },
          data: {
            googleId: googleUser.googleId,
            ...(existing.profilePicture ? {} : { profilePicture: googleUser.picture }),
          },
          select: oauthSelect,
        });
      } else {
        // 3. New user — create with no password (OAuth-only)
        user = await db.user.create({
          data: {
            fullName: googleUser.fullName,
            email: googleUser.email,
            password: null,
            googleId: googleUser.googleId,
            emailVerified: true,
            role: 'CUSTOMER',
            profilePicture: googleUser.picture,
          },
          select: oauthSelect,
        });
      }
    }

    // 4. Block deactivated accounts
    if (user.isDeactivated) {
      await this.securityLogger.log({ event: 'DEACTIVATED_ACCESS', userId: user.id, email: user.email, ip, userAgent, details: 'Google OAuth attempt' });
      throw new ForbiddenException('Your account has been deactivated');
    }

    // 5. Block suspended vendors
    if (user.role === 'VENDOR') {
      const vendor = await db.vendor.findUnique({ where: { userId: user.id }, select: { status: true } });
      if (vendor?.status === 'SUSPENDED') {
        await this.securityLogger.log({ event: 'SUSPENDED_VENDOR_ACCESS', userId: user.id, email: user.email, ip, userAgent, details: 'Google OAuth' });
        throw new ForbiddenException('Your vendor account has been suspended');
      }
    }

    await this.securityLogger.log({ event: 'LOGIN_SUCCESS', userId: user.id, email: user.email, ip, userAgent, details: 'Google OAuth' });

    return this.issueTokens(user, response, req);
  }

  // ─── Internal: generate + save + send verification email ───────────────────

  private async sendVerificationEmail(db: any, userId: string, email: string, fullName: string, ip?: string) {
    // Plaintext token goes in the email URL; only its SHA-256 hash is
    // persisted in the DB. This matches the password-reset hardening: a
    // DB dump leaks no actionable verification tokens.
    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(plainToken);
    const verificationExpiryHours = Number(process.env.VERIFICATION_TOKEN_EXPIRY_HOURS || 24);
    const expiry = new Date(Date.now() + verificationExpiryHours * 60 * 60 * 1000);

    await db.user.update({
      where: { id: userId },
      data: { verificationToken: tokenHash, verificationTokenExpiry: expiry },
    });

    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const verificationLink = `${frontendUrl}/verify-email?token=${plainToken}`;

    // Per-account daily cap + progressive cooldown (cost / mailbomb
    // defence). On overage we drop the send silently; the caller still
    // returns its anti-enumeration success response, so an attacker can't
    // tell when the cap kicked in. The token IS persisted regardless — if
    // the legitimate user comes back later they can hit /resend-verification
    // and once the counter rolls over the email goes through.
    const accountAllowed = await this.emailQuota.tryConsume(email, 'verification');
    if (!accountAllowed) return;

    // Per-IP daily cap — closes the "one IP cycling through many target
    // emails" attack that the per-account cap can't see (each account
    // counter starts fresh; only the IP is shared).
    const ipAllowed = await this.emailQuota.tryConsumePerIp(ip);
    if (!ipAllowed) return;

    // Fire-and-forget the network SEND: awaiting the Resend round-trip here made
    // the fresh-signup path measurably slower than the already-registered path,
    // re-opening the email-enumeration oracle by timing. The token is already
    // persisted above; a failed send is recoverable via /auth/resend-verification.
    // (The call is still INVOKED synchronously — only its result isn't awaited —
    // so callers/tests observing "was a verification email dispatched?" are
    // unaffected.)
    void this.emailService.sendEmailVerification(email, { userName: fullName, verificationLink }).catch(() => undefined);
  }

  // ─── Register vendor ───────────────────────────────────────────────────────

  /**
   * Record the current user's acceptance of the latest Terms (TERMS_VERSION).
   * Called by the post-login consent gate (Google-OAuth signups, pre-feature
   * accounts, and anyone after a version bump). Idempotent — re-accepting just
   * refreshes the timestamp + version.
   */
  async acceptTerms(userId: string) {
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { termsAcceptedAt: new Date(), termsAcceptedVersion: TERMS_VERSION },
    });
    return { accepted: true, version: TERMS_VERSION };
  }

  async registerVendor(dto: RegisterVendorDto, req?: Request) {
    const db = this.prisma.client;

    // Honeypot — see registerAndLogin for full rationale. Hidden field on
    // the vendor signup page; bots fill it, real users don't. Silent
    // fake-success to avoid telling the bot we caught them.
    if (dto.website && dto.website.trim().length > 0) {
      const { ip: botIp } = this.extractClientInfo(req);
      await this.securityLogger.log({
        event: 'LOGIN_FAILED',
        email: dto.email,
        ip: botIp,
        details: 'Honeypot tripped on /auth/register/vendor',
      });
      return { message: 'Vendor application submitted', email: dto.email };
    }

    const existingUser = await db.user.findUnique({ where: { email: dto.email }, select: { id: true } });
    if (existingUser) throw new ConflictException('Email already registered');

    const existingBusiness = await db.vendor.findUnique({ where: { businessId: dto.businessId } });
    if (existingBusiness) throw new ConflictException('Business ID already registered');

    // The slug is auto-derived from the business name on the client and is
    // READ-ONLY, so a collision (two vendors with the same business name) can't
    // be fixed by the user. Auto-resolve to the next free variant (base, base-2,
    // base-3, …) so vendor registration never dead-ends. The vendor.slug unique
    // index is the final integrity backstop — a rare concurrent-registration
    // race surfaces as the standard duplicate error and the vendor just retries.
    let resolvedSlug = dto.slug;
    for (let n = 2; n <= 1000; n++) {
      const taken = await db.vendor.findUnique({ where: { slug: resolvedSlug }, select: { id: true } });
      if (!taken) break;
      resolvedSlug = `${dto.slug}-${n}`;
    }

    if (dto.phone) {
      // Neutral anti-enumeration message — must match the customer-register
      // flow (see registerAndLogin). "Phone number already registered" would
      // confirm to an attacker that a specific phone number is in our DB.
      const existingPhone = await db.user.findUnique({ where: { phone: dto.phone }, select: { id: true } });
      if (existingPhone) throw new ConflictException('Please use a different phone number');
    }

    const country = await db.country.findUnique({ where: { id: dto.countryId } });
    if (!country || country.status !== 'ACTIVE') {
      throw new ConflictException('Invalid or inactive country');
    }

    const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
    const hashedPassword = await bcrypt.hash(dto.password, bcryptRounds);

    const preferredLanguage = resolveLanguageFromRequest(req);
    const result = await db.$transaction(async (tx: any) => {
      const user = await tx.user.create({
        data: {
          fullName: dto.fullName,
          email: dto.email,
          password: hashedPassword,
          phone: dto.phone ?? null,
          role: 'VENDOR',
          preferredLanguage,
          // RegisterVendorDto requires termsAccepted === true → record consent.
          termsAcceptedAt: new Date(),
          termsAcceptedVersion: TERMS_VERSION,
        },
      });

      await tx.vendor.create({
        data: {
          userId: user.id,
          businessNameEn: dto.businessNameEn,
          businessNameAr: dto.businessNameAr,
          businessId: dto.businessId,
          slug: resolvedSlug,
          phone: dto.phone ?? null,
          countryId: dto.countryId,
          status: 'PENDING',
        },
      });

      return user;
    });

    // Notify all admins: new vendor pending approval
    this.notificationService.notifyAdmins({
      type: 'SYSTEM',
      title: 'New Vendor Registration',
      message: `${dto.businessNameEn} has registered and is pending approval`,
      link: '/admin/vendors',
    });

    return {
      message: 'Vendor registration submitted successfully. Your account is pending admin approval.',
      email: result.email,
    };
  }

  // ─── Logout ─────────────────────────────────────────────────────────────────

  // ─── Password Reset ──────────────────────────────────────────────────────

  async forgotPassword(email: string, req?: Request) {
    // G6 — Per-recipient cooldown. Without this, an attacker rotating
    // source IPs (defeating per-IP 3/min throttle) can demand reset
    // emails for a victim every few seconds — flooding their inbox and
    // damaging AL Jadwal's sender reputation. SET NX is atomic: returns
    // 'OK' on first set, null when key already exists. Email is
    // sha256-hashed (no plaintext PII in cache keys).
    //
    // On cooldown hit we return the SAME success message as the normal
    // path — preserves anti-enumeration (no signal that "yes, this email
    // was already requested recently"). The previous reset email's link
    // is still valid until its DB token expires, so the user can complete
    // the reset they actually want without us sending duplicate emails.
    const cooldownKey = `forgot:cooldown:${this.hashEmail(email)}`;
    try {
      const set = await this.redisService.getClient().set(
        cooldownKey,
        '1',
        'EX',
        this.forgotPasswordCooldownSec,
        'NX',
      );
      if (set !== 'OK') {
        return { message: 'If an account exists with this email, a password reset link has been sent.' };
      }
    } catch {
      // Redis down — fall through. Per-IP throttle (3/min) and per-account
      // / per-IP email quotas (already inside the path below) still cap
      // damage. CloudWatch alarms (G2) page operators on Redis outage.
    }

    const db = this.prisma.client;

    // Always return success — never reveal if email exists (anti-enumeration)
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, fullName: true, role: true },
    });

    // Check if user has a password (not OAuth-only) without selecting the hash
    const hasPassword = user
      ? await db.user.count({ where: { id: user.id, password: { not: null } } }) > 0
      : false;

    // Allow reset for password-bearing CUSTOMER and VENDOR accounts. Admins
    // are deliberately excluded — admin password recovery requires manual
    // out-of-band procedure (re-run the seed-admin task) for stronger
    // defense-in-depth on the highest-privilege role.
    if (user && hasPassword && (user.role === 'CUSTOMER' || user.role === 'VENDOR')) {
      // Generate a high-entropy plaintext token (256 bits) — this goes in
      // the email URL. We store ONLY its SHA-256 hash so a DB dump cannot
      // be replayed against /reset-password.
      const plainToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = this.hashToken(plainToken);
      const resetExpiryHours = Number(process.env.PASSWORD_RESET_EXPIRY_HOURS || 1);
      const expiry = new Date(Date.now() + resetExpiryHours * 60 * 60 * 1000);

      await db.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: tokenHash,
          passwordResetExpiry: expiry,
        },
      });

      const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
      const resetLink = `${frontendUrl}/reset-password?token=${plainToken}`;

      // Per-account daily cap + progressive cooldown (cost / mailbomb
      // defence). The reset token is already persisted — if quota is
      // exhausted we just drop the outbound email; the link in any
      // unexpired prior email still works. Per-IP cap on top closes the
      // "one IP cycling many emails" attack vector (per-account caps can't
      // see across different recipients).
      const { ip: forgotIp } = this.extractClientInfo(req);
      const accountAllowed = await this.emailQuota.tryConsume(email, 'reset');
      const ipAllowed = accountAllowed ? await this.emailQuota.tryConsumePerIp(forgotIp) : false;
      if (accountAllowed && ipAllowed) {
        this.emailService.sendPasswordReset(email, {
          userName: user.fullName,
          resetLink,
          expiresInHours: resetExpiryHours,
        });

        this.securityLogger.log({
          event: 'PASSWORD_RESET_REQUESTED',
          userId: user.id,
          details: `Reset email sent (role=${user.role})`,
        });
      } else {
        this.securityLogger.log({
          event: 'PASSWORD_RESET_REQUESTED',
          userId: user.id,
          details: 'Reset email DROPPED — daily quota exceeded',
        });
      }
    }

    // Always return same response regardless of whether email exists
    return { message: 'If an account exists with this email, a password reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const db = this.prisma.client;

    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos
    // Bounded literal character class with a fixed `{64}` quantifier — no
    // alternation, no nested quantifiers, no catastrophic-backtracking risk.
    if (!/^[a-f0-9]{64}$/.test(token)) {
      // Audit failed attempts so an attacker probing reset URLs leaves a
      // trace beyond rate-limit denials. Brute-force against a 256-bit
      // token is computationally infeasible, but targeted reconnaissance
      // (e.g. malformed token in a known-victim's email link) is detectable.
      this.securityLogger.log({
        event: 'PASSWORD_RESET_FAILED',
        details: 'Token format invalid (not 64 hex chars)',
      });
      throw new BadRequestException('Invalid or expired reset link');
    }

    // Look up by the hash of the supplied token — DB stores only the hash
    // (anti-replay if the DB is compromised).
    const tokenHash = this.hashToken(token);

    const user = await db.user.findFirst({
      where: {
        passwordResetToken: tokenHash,
        passwordResetExpiry: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!user) {
      this.securityLogger.log({
        event: 'PASSWORD_RESET_FAILED',
        details: 'Token not found in DB or expired',
      });
      throw new BadRequestException('Invalid or expired reset link');
    }

    const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
    const hash = await bcrypt.hash(newPassword, bcryptRounds);

    // Snapshot every live session family BEFORE the tx so we can denylist them
    // AFTER it commits: reading here still sees the rows, and deferring the
    // denylist to post-commit means a tx ROLLBACK leaves NO stranded markers
    // (which would otherwise self-lock the reused family id for the TTL).
    const liveFamilies = await db.refreshToken.findMany({
      where: { userId: user.id, rotatedAt: null },
      select: { familyId: true },
      distinct: ['familyId'],
    });

    // Interactive transaction (function form) — preferred over the array
    // form with Prisma 7 driver adapters.
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          password: hash,
          passwordResetToken: null,
          passwordResetExpiry: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      // Invalidate all sessions — forces re-login everywhere.
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });
    });

    // Password reset committed — kill every session's outstanding ACCESS token
    // too (M5), not just the refresh tokens. Post-commit + snapshot = no
    // stranded markers on rollback.
    await Promise.all(liveFamilies.map((f) => this.denylistSession(f.familyId)));

    this.securityLogger.log({
      event: 'PASSWORD_RESET_COMPLETED',
      userId: user.id,
      details: 'Password changed via reset link',
    });

    return { message: 'Password has been reset successfully. You can now log in with your new password.' };
  }

  // ─── Change Password (authenticated, in-session) ──────────────────────────
  // Differs from resetPassword: caller is already logged in and proves
  // ownership via the current password, not via an email token. The current
  // session refresh token is preserved (no mid-task logout); every OTHER
  // refresh token for this user is revoked, so any leaked/stolen session on
  // another device dies the moment the password rotates.
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentRefreshTokenRaw: string | undefined,
    req?: Request,
  ) {
    const db = this.prisma.client;
    const { ip, userAgent } = this.extractClientInfo(req);

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, password: true },
    });
    // Defensive: JwtAuthGuard should have rejected before reaching here, so
    // a missing user means the row was deleted between auth and this call.
    if (!user) {
      throw new UnauthorizedException('Session no longer valid');
    }

    // OAuth-only accounts (no local password set yet) cannot change a
    // password they never had. Direct them at the reset-password flow.
    if (!user.password) {
      throw new BadRequestException(
        'This account was created via Google. Use "Forgot password" to set a local password first.',
      );
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      this.securityLogger.log({
        event: 'PASSWORD_CHANGE_FAILED',
        userId: user.id,
        email: user.email,
        ip,
        userAgent,
        details: 'Incorrect current password',
      });
      // Generic message — don't disclose whether the account exists or what
      // specifically failed. Caller is already authed so existence is given,
      // but we still avoid mirroring the failure shape used elsewhere.
      throw new BadRequestException('Current password is incorrect');
    }

    // Block trivial password churn — re-using the existing password just to
    // appease a "you must rotate" prompt undermines the whole rotation.
    const sameAsCurrent = await bcrypt.compare(newPassword, user.password);
    if (sameAsCurrent) {
      throw new BadRequestException('New password must differ from your current password');
    }

    const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
    const hash = await bcrypt.hash(newPassword, bcryptRounds);

    // Identify the current session's refresh token so we can keep it alive
    // while killing every other session. If the RefreshToken cookie is missing
    // (rare — JwtAuthGuard only proves an access token was present, and the
    // refresh cookie can have expired independently), currentFamilyId stays null
    // below, so we revoke EVERYTHING including this device: all families are
    // denylisted + all rows deleted. The caller is fully logged out and must log
    // in again — fail-SAFE (never leaves a session alive), and acceptable UX
    // right after a password change. The controller does NOT re-issue a pair.
    const currentTokenHash = currentRefreshTokenRaw
      ? this.hashToken(currentRefreshTokenRaw)
      : null;

    // Identify the CURRENT session's family so we don't denylist it (this device
    // stays logged in), then snapshot every OTHER live family BEFORE the tx —
    // once the tx deletes those rows we could no longer discover them. We
    // denylist them AFTER the tx commits so a rollback doesn't log anyone out.
    const currentFamilyId = currentTokenHash
      ? (
          await db.refreshToken.findUnique({
            where: { tokenHash: currentTokenHash },
            select: { familyId: true },
          })
        )?.familyId ?? null
      : null;
    const otherFamilies = await db.refreshToken.findMany({
      where: {
        userId: user.id,
        rotatedAt: null,
        ...(currentFamilyId ? { familyId: { not: currentFamilyId } } : {}),
      },
      select: { familyId: true },
      distinct: ['familyId'],
    });

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          password: hash,
          // Reset lockout state — a successful credentialed change is
          // proof of legitimate access, prior failed-login counters are stale.
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      // Revoke OTHER sessions. Keep the caller's current refresh token so
      // they don't get logged out mid-task on this device.
      await tx.refreshToken.deleteMany({
        where: currentTokenHash
          ? { userId: user.id, tokenHash: { not: currentTokenHash } }
          : { userId: user.id },
      });
    });

    // Password rotated — kill the outstanding ACCESS tokens of every OTHER
    // session too (M5). The current device's family is deliberately excluded.
    await Promise.all(otherFamilies.map((f) => this.denylistSession(f.familyId)));

    this.securityLogger.log({
      event: 'PASSWORD_CHANGE_COMPLETED',
      userId: user.id,
      email: user.email,
      ip,
      userAgent,
      details: 'Password changed via authenticated /auth/change-password',
    });

    // Best-effort security notification — don't block the response on it.
    // The email serves as out-of-band confirmation, so if an attacker who
    // owns the session changes the password, the legitimate user still
    // sees it and can act (reset + revoke).
    //
    // Quota-gated: a legitimate user can only change their password a
    // small number of times per day, so the cap is generous (3/day) and
    // primarily defends against a session-hijacker spinning up many
    // password rotations to mailbomb the inbox.
    this.emailQuota
      .tryConsume(user.email, 'change-notification')
      .then((allowed) => {
        if (allowed) {
          return this.emailService.sendPasswordChangedNotification(user.email, {
            customerName: user.fullName,
          });
        }
        return undefined;
      })
      .catch(() => undefined);

    return { message: 'Password changed successfully. Other sessions have been signed out.' };
  }

  // ─── Logout ─────────────────────────────────────────────────────────────────

  async logout(refreshTokenRaw: string | undefined, userId: string | undefined, response: Response, req?: Request) {
    const { ip, userAgent } = this.extractClientInfo(req);

    if (refreshTokenRaw) {
      const tokenHash = this.hashToken(refreshTokenRaw);
      // Look up the family (a rotated token is kept as a tombstone, so this still
      // resolves after a rotation), denylist it so this device's outstanding
      // ACCESS token stops working immediately (M5 — was the ≤15-min gap), then
      // delete the whole family (active token + tombstones). Single-device only:
      // logging out one device leaves the user's other sessions untouched.
      const tok = await this.prisma.client.refreshToken.findUnique({
        where: { tokenHash },
        select: { familyId: true },
      });
      if (tok) {
        await this.denylistSession(tok.familyId);
        await this.prisma.client.refreshToken.deleteMany({ where: { familyId: tok.familyId } });
      }
    }

    this.clearAllCookies(response);

    if (userId) {
      await this.securityLogger.log({ event: 'LOGOUT', userId, ip, userAgent });
    }
  }

  // ─── W.127 Self-service account management (PDPL §14 / GDPR Art.17 + 20) ──

  /**
   * Export every piece of data AL Jadwal stores about the calling user.
   *
   * Returns a single JSON bundle that includes the user's profile,
   * bookings (with payment summaries), reviews, likes, claimed coupons,
   * loyalty ledger entries, notifications, and active session metadata.
   * Sensitive auth state (password hash, refresh tokens, verification
   * tokens, password-reset tokens, phone OTP hash) is deliberately
   * excluded — those are auth secrets, not user-owned data.
   *
   * Rate-limited at the controller level (RATE_LIMIT_STRICT, 3/min/IP)
   * AND with a per-user Redis cooldown (1 export per 24 h) so the export
   * endpoint can't be turned into a data-egress or DoS amplifier.
   */
  async exportAccountData(userId: string, req?: Request): Promise<Record<string, unknown>> {
    const { ip, userAgent } = this.extractClientInfo(req);
    const db = this.prisma.client;

    // Per-user 24h cooldown. The Redis fail-open pattern matches the rest
    // of the auth flow (G1 / G6) — if Redis is down, the per-IP throttler
    // and the underlying anonymisation transaction still bound abuse.
    try {
      const redis = this.redisService.getClient();
      const key = `account:export:${userId}`;
      const setOk = await redis.set(key, '1', 'EX', 86400, 'NX');
      if (setOk === null) {
        throw new HttpException(
          'You can request an account-data export once every 24 hours.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Silent fail-open on Redis errors — controller throttle remains.
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      // Whitelisted select — never spread a User row, that would leak
      // password hash / verification tokens / phone OTP fields.
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        profilePicture: true,
        role: true,
        emailVerified: true,
        loyaltyPoints: true,
        preferredCountryId: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Account not found');
    }

    const [bookings, reviews, likes, claimedCoupons, loyaltyLedger, notifications, sessions] =
      await Promise.all([
        db.booking.findMany({
          where: { customerId: userId },
          select: {
            id: true,
            ref: true,
            activityId: true,
            startDatetime: true,
            endDatetime: true,
            guests: true,
            status: true,
            totalPrice: true,
            currencyCode: true,
            createdAt: true,
            cancelledAt: true,
            payment: {
              select: {
                id: true,
                status: true,
                amount: true,
                currency: true,
                method: true,
                createdAt: true,
              },
            },
          },
        }),
        db.review.findMany({
          where: { customerId: userId },
          select: {
            id: true,
            activityId: true,
            rating: true,
            text: true,
            vendorReply: true,
            createdAt: true,
          },
        }),
        db.like.findMany({
          where: { userId },
          select: { activityId: true, createdAt: true },
        }),
        db.claimedCoupon.findMany({
          where: { userId },
          select: { couponId: true, claimedAt: true, used: true },
        }),
        db.loyaltyLedger.findMany({
          where: { userId },
          select: {
            id: true,
            delta: true,
            balanceAfter: true,
            source: true,
            reason: true,
            bookingId: true,
            createdAt: true,
          },
        }),
        db.notification.findMany({
          where: { userId },
          select: {
            id: true,
            type: true,
            title: true,
            message: true,
            link: true,
            read: true,
            createdAt: true,
          },
        }),
        db.refreshToken.findMany({
          where: { userId },
          // tokenHash deliberately excluded — auth secret, not user data.
          select: {
            id: true,
            createdAt: true,
            expiresAt: true,
            sessionStartedAt: true,
            ipAddress: true,
            userAgent: true,
          },
        }),
      ]);

    await this.securityLogger.log({
      event: 'ACCOUNT_EXPORT_REQUESTED',
      userId,
      ip,
      userAgent,
    });

    return {
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      // loyaltyPoints + ledger delta/balanceAfter became Decimal columns in the
      // QAR redenomination; Number() them so the export keeps emitting them as
      // JSON numbers (as it did when they were Int), not Decimal strings.
      user: { ...user, loyaltyPoints: Number(user.loyaltyPoints) },
      bookings,
      reviews,
      likes,
      claimedCoupons,
      loyaltyLedger: loyaltyLedger.map((r) => ({
        ...r,
        delta: Number(r.delta),
        balanceAfter: Number(r.balanceAfter),
      })),
      notifications,
      sessions,
    };
  }

  /**
   * Self-service account deletion (PDPL §14 / GDPR Art.17 "right to
   * erasure"). Anonymises PII on the User row, revokes every active
   * session, and clears all derived state (notifications, push subs,
   * likes, claimed coupons). Booking / Payment / Review / LoyaltyLedger
   * rows are PRESERVED with a now-anonymised user reference because
   * those are financial / accounting records that have their own
   * mandatory retention periods.
   *
   * Confirmation: caller must send the literal phrase "DELETE"
   * (case-insensitive, trimmed). Same UX pattern as GitHub /
   * AWS / Vercel destructive actions — forces a deliberate action
   * and stops accidental double-click destruction.
   *
   * Security trade-off vs the earlier password-confirmation design
   * is documented in `dto/delete-account.dto.ts`. Compensating
   * controls: 3/min/IP throttle on the endpoint, ACCOUNT_SELF_DELETED
   * audit captures IP + UA, soft-delete is admin-recoverable for the
   * 30-day retention window.
   *
   * The anonymisation pattern mirrors AdminService.deleteUser — same
   * transaction shape, same `<userId>@deleted.local` sentinel, same
   * field nulling. Kept as a parallel method (rather than calling
   * AdminService) because the customer path has different preconditions
   * and no cross-vendor side effects.
   */
  async deleteOwnAccount(
    userId: string,
    confirmation: string,
    response: Response,
    req?: Request,
  ): Promise<void> {
    const { ip, userAgent } = this.extractClientInfo(req);
    const db = this.prisma.client;

    // Confirmation phrase check — strict literal match against "DELETE"
    // after trim + uppercase. Anything else (typos, accidental clicks,
    // empty body that bypassed DTO validation somehow) triggers a 400
    // and gets logged, not a destructive transaction.
    if (confirmation.trim().toUpperCase() !== 'DELETE') {
      await this.securityLogger.log({
        event: 'ACCOUNT_DELETE_FAILED',
        userId,
        ip,
        userAgent,
        details: 'wrong confirmation phrase',
      });
      throw new BadRequestException('Type "DELETE" to confirm.');
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        deletedAt: true,
        vendorProfile: { select: { id: true } },
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Account not found');
    }

    // Vendor accounts have additional teardown (deactivating activities,
    // cancelling pending bookings, payout reconciliation). Block the
    // self-service path for vendors and route them to support so we
    // don't accidentally orphan customer bookings on their activities.
    if (user.role === 'VENDOR' || user.vendorProfile) {
      throw new ForbiddenException(
        'Vendor accounts cannot be self-deleted. Contact support to close your vendor account.',
      );
    }

    // Snapshot live session families BEFORE the tx so we can denylist them AFTER
    // it commits: reading here still sees the rows, and deferring the denylist to
    // post-commit means a tx ROLLBACK strands no markers (which would otherwise
    // self-lock the reused family id for the TTL). Mirrors resetPassword.
    const liveFamilies = await db.refreshToken.findMany({
      where: { userId, rotatedAt: null },
      select: { familyId: true },
      distinct: ['familyId'],
    });

    // Anonymise + revoke in a single transaction. Pattern mirrors
    // AdminService.deleteUser:455-483 — keep them in sync if you change
    // either side.
    await db.$transaction(async (tx) => {
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.pushSubscription.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.claimedCoupon.deleteMany({ where: { userId } });
      await tx.like.deleteMany({ where: { userId } });

      await tx.user.update({
        where: { id: userId },
        data: {
          email: `${userId}@deleted.local`,
          fullName: 'Deleted User',
          phone: null,
          profilePicture: null,
          password: null,
          googleId: null,
          verificationToken: null,
          verificationTokenExpiry: null,
          passwordResetToken: null,
          passwordResetExpiry: null,
          isDeactivated: true,
          emailVerified: false,
          deletedAt: new Date(),
        },
      });
    });

    // Account torn down — kill every session's outstanding ACCESS token too (M5),
    // AFTER the tx commits (rollback then leaves no stranded denylist markers).
    await Promise.all(liveFamilies.map((f) => this.denylistSession(f.familyId)));

    this.clearAllCookies(response);

    await this.securityLogger.log({
      event: 'ACCOUNT_SELF_DELETED',
      userId,
      ip,
      userAgent,
    });
  }

  // ─── Expired token cleanup ─────────────────────────────────────────────────

  /**
   * Delete all expired refresh tokens from the database.
   * Called opportunistically on each token refresh (batched, non-blocking)
   * and can be triggered via admin endpoint or cron job.
   */
  async cleanupExpiredTokens(): Promise<number> {
    const { count } = await this.prisma.client.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  }

  // ─── Clear all auth cookies ─────────────────────────────────────────────────

  private clearAllCookies(response: Response) {
    const clearOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path: '/',
    };
    response.cookie('Authentication', '', { ...clearOpts, maxAge: 0 });
    response.cookie('RefreshToken', '', { ...clearOpts, maxAge: 0 });
  }

}
