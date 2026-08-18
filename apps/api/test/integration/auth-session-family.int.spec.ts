/**
 * M5/M6 — session-family denylist + refresh-token reuse detection.
 *
 * These are the NEW auth-critical invariants added alongside the `familyId` /
 * `rotatedAt` columns. Unlike auth-refresh-rotation.int.spec.ts (which tests the
 * DB-side rotation), this file wires a REAL SessionDenylistService + a REAL
 * JwtStrategy on top of a live Postgres + an in-memory Redis, so the full chain
 * is exercised:
 *
 *   M5 (full logout / immediate access-token revocation):
 *     - logout denylists the session family → JwtStrategy.validate() rejects any
 *       still-unexpired access token carrying that `sid`.
 *     - fail-OPEN: if Redis is unreachable, validate() does NOT lock users out.
 *
 *   M6 (stolen refresh-token reuse detection, RFC 9700):
 *     - rotation keeps the used token as a tombstone (rotatedAt set) under the
 *       SAME family as the new token (session-family continuity).
 *     - replaying a rotated token BEYOND the grace window revokes the whole
 *       family + denylists it + logs REFRESH_REUSE_DETECTED.
 *     - replaying WITHIN the grace window is treated as a benign client race —
 *       the family is NOT revoked.
 */

import { getTestContext, seedReference } from './_setup';
import { AuthService } from '../../src/auth/auth.service';
import { JwtStrategy } from '../../src/auth/strategies/jwt.strategy';
import { SessionDenylistService } from '../../src/redis/session-denylist.service';
import {
  makeJwtMock, makeConfigMock, makeUsersMock, makeSecurityLoggerMock,
  makeAuditLoggerMock, makeEmailMock, makeEmailQuotaMock,
  makeNotificationMock, makeRedisMock, makeResponseMock, makeRequestMock,
} from '../mocks/auth-deps.mock';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

const JWT_SECRET = 'a'.repeat(40); // ≥32 chars so JwtStrategy's constructor is happy

// Build AuthService + JwtStrategy sharing ONE SessionDenylistService and ONE
// Redis, so a denylist write on one side is visible to the read on the other.
function makeStack(configOverrides: Record<string, string> = {}) {
  const prismaSvc = { client: ctx.prisma } as any;
  const redis = makeRedisMock();
  const config = makeConfigMock({ JWT_SECRET, ...configOverrides });
  const denylist = new SessionDenylistService(config as any, redis as any, prismaSvc);
  const security = makeSecurityLoggerMock();
  const auth = new AuthService(
    makeUsersMock() as any,
    prismaSvc,
    makeJwtMock() as any,
    config as any,
    security as any,
    makeAuditLoggerMock() as any,
    makeEmailMock() as any,
    makeEmailQuotaMock() as any,
    makeNotificationMock() as any,
    redis as any,
    denylist,
  );
  const jwt = new JwtStrategy(config as any, prismaSvc, denylist);
  return { auth, jwt, denylist, redis, prismaSvc, security };
}

function hashSha256(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueForUser(
  auth: AuthService,
  user: { id: string; email: string; fullName: string; role: any },
): Promise<{ raw: string; hash: string; familyId: string }> {
  const res = makeResponseMock();
  await auth.issueTokens(user, res as any, makeRequestMock() as any);
  const setRefresh = res.cookie.mock.calls.find((c) => c[0] === 'RefreshToken');
  if (!setRefresh) throw new Error('issueTokens did not set RefreshToken cookie');
  const raw = setRefresh[1] as string;
  const hash = hashSha256(raw);
  const row = await ctx.prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hash } });
  return { raw, hash, familyId: row.familyId };
}

// ═══════════════════════════════════════════════════════════════════════════
// M6 — session-family continuity + tombstone
// ═══════════════════════════════════════════════════════════════════════════

describe('M6 — rotation keeps family + tombstone', () => {
  test('rotation reuses the SAME familyId and keeps the old token as a rotated tombstone', async () => {
    const seed = await seedReference(ctx.prisma);
    const { auth } = makeStack();
    const { raw, hash, familyId } = await issueForUser(auth, seed.customer);

    await auth.refreshTokens(raw, makeResponseMock() as any, makeRequestMock() as any);

    // Old row is now a tombstone: still present, rotatedAt set, same family.
    const oldRow = await ctx.prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hash } });
    expect(oldRow.rotatedAt).not.toBeNull();
    expect(oldRow.familyId).toBe(familyId);

    // Exactly one ACTIVE token remains, and it inherits the same family.
    const active = await ctx.prisma.refreshToken.findMany({
      where: { userId: seed.customer.id, rotatedAt: null },
    });
    expect(active).toHaveLength(1);
    expect(active[0].familyId).toBe(familyId);
    expect(active[0].tokenHash).not.toBe(hash);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M6 — reuse detection
// ═══════════════════════════════════════════════════════════════════════════

describe('M6 — reuse detection', () => {
  test('replay BEYOND grace → whole family revoked + denylisted + REFRESH_REUSE_DETECTED logged', async () => {
    const seed = await seedReference(ctx.prisma);
    const { auth, denylist, security } = makeStack({ REFRESH_REUSE_GRACE_MS: '0' });
    const { raw, familyId } = await issueForUser(auth, seed.customer);

    // First rotation consumes `raw` (now a tombstone).
    await auth.refreshTokens(raw, makeResponseMock() as any, makeRequestMock() as any);
    // Ensure a non-zero gap so the 0ms grace is exceeded.
    await new Promise((r) => setTimeout(r, 5));

    // Replay the consumed token → reuse.
    await expect(
      auth.refreshTokens(raw, makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(UnauthorizedException);

    // Whole family wiped (tombstone + the new active token both gone).
    expect(await ctx.prisma.refreshToken.count({ where: { familyId } })).toBe(0);
    // Family denylisted so any outstanding access token dies immediately.
    expect(await denylist.isDenied(familyId)).toBe(true);
    // Security event recorded.
    expect(security.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'REFRESH_REUSE_DETECTED', userId: seed.customer.id }),
    );
  });

  test('replay WITHIN grace → benign, family NOT revoked', async () => {
    const seed = await seedReference(ctx.prisma);
    const { auth, denylist } = makeStack({ REFRESH_REUSE_GRACE_MS: '60000' });
    const { raw, familyId } = await issueForUser(auth, seed.customer);

    await auth.refreshTokens(raw, makeResponseMock() as any, makeRequestMock() as any);

    // Immediate replay (well within 60s) → 401 but NO family revocation.
    await expect(
      auth.refreshTokens(raw, makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(UnauthorizedException);

    // The active token from the first rotation survives; family not denylisted.
    expect(await ctx.prisma.refreshToken.count({ where: { familyId, rotatedAt: null } })).toBe(1);
    expect(await denylist.isDenied(familyId)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M5 — logout denylists the family; JwtStrategy rejects the access token
// ═══════════════════════════════════════════════════════════════════════════

describe('M5 — logout revokes the access token via the denylist', () => {
  test('before logout the access token validates; after logout JwtStrategy rejects it', async () => {
    const seed = await seedReference(ctx.prisma);
    const { auth, jwt } = makeStack();
    const { raw, familyId } = await issueForUser(auth, seed.customer);

    const payload = {
      sub: seed.customer.id,
      email: seed.customer.email,
      role: seed.customer.role,
      sid: familyId,
    };

    // Access token is accepted while the session is live.
    await expect(jwt.validate(payload as any)).resolves.toMatchObject({ id: seed.customer.id });

    // Logout denylists the family.
    await auth.logout(raw, seed.customer.id, makeResponseMock() as any, makeRequestMock() as any);

    // The SAME still-unexpired access token is now rejected (M5 — the gap the
    // stateless JWT used to leave open for ≤JWT_EXPIRATION).
    await expect(jwt.validate(payload as any)).rejects.toThrow(UnauthorizedException);
  });

  test('a token with NO sid (pre-rollout) skips the denylist check (backward-compatible)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { jwt, denylist } = makeStack();
    // Denylist SOMETHING so we know the check would fire if it ran.
    await denylist.denylistSession('some-other-family');

    // No sid on the payload → check skipped → validates on user existence alone.
    await expect(
      jwt.validate({ sub: seed.customer.id, email: seed.customer.email, role: seed.customer.role } as any),
    ).resolves.toMatchObject({ id: seed.customer.id });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// M5 — fail-open when Redis is unreachable
// ═══════════════════════════════════════════════════════════════════════════

describe('M5 — denylist read fails open', () => {
  test('Redis down during validate() → user is NOT locked out', async () => {
    const seed = await seedReference(ctx.prisma);
    const prismaSvc = { client: ctx.prisma } as any;
    const config = makeConfigMock({ JWT_SECRET });
    // A Redis whose GET always throws (server down / connection closed).
    const brokenRedis = {
      getClient: () => ({
        get: jest.fn().mockRejectedValue(new Error('Connection is closed')),
        set: jest.fn().mockResolvedValue('OK'),
      }),
    } as any;
    const denylist = new SessionDenylistService(config as any, brokenRedis, prismaSvc);
    const jwt = new JwtStrategy(config as any, prismaSvc, denylist);

    // Even with a sid present, a Redis failure must fail OPEN (availability) —
    // the ≤JWT_EXPIRATION natural expiry still bounds exposure.
    await expect(
      jwt.validate({
        sub: seed.customer.id,
        email: seed.customer.email,
        role: seed.customer.role,
        sid: 'any-family',
      } as any),
    ).resolves.toMatchObject({ id: seed.customer.id });
  });
});
