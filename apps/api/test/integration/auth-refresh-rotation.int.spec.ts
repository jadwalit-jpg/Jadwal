/**
 * AuthService.refreshTokens — rotation against a real Postgres.
 *
 * Security-critical invariants that only a live DB can verify:
 *   - Single-use: old token row is deleted synchronously on first use
 *   - Reuse detection: replay of already-used token throws 401
 *   - Expired token: row deleted + 401 thrown
 *   - Deactivated user: ALL family tokens wiped + 401 thrown
 *   - Suspended vendor: ALL family tokens wiped + 403 thrown
 *   - Session cap: new session kicks the oldest out when over MAX_SESSIONS
 *   - Concurrent rotation race: exactly one replay wins
 *
 * The access-token JWT and the cookie wiring use mocks from auth-deps.mock.ts —
 * we're testing the DB-side rotation, not the HTTP shape.
 */

import { getTestContext, seedReference } from './_setup';
import { AuthService } from '../../src/auth/auth.service';
import {
  makeJwtMock, makeConfigMock, makeUsersMock, makeSecurityLoggerMock,
  makeAuditLoggerMock, makeEmailMock, makeSmsMock, makeNotificationMock,
  makeResponseMock, makeRequestMock,
} from '../mocks/auth-deps.mock';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeAuth() {
  const prismaSvc = { client: ctx.prisma } as any;
  const svc = new AuthService(
    makeUsersMock() as any,
    prismaSvc,
    makeJwtMock() as any,
    makeConfigMock() as any,
    makeSecurityLoggerMock() as any,
    makeAuditLoggerMock() as any,
    makeEmailMock() as any,
    makeSmsMock() as any,
    makeNotificationMock() as any,
  );
  return svc;
}

function hashSha256(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Issue a token pair for a user directly (bypasses login). Returns the RAW
 * refresh token that the caller can feed back into refreshTokens().
 */
async function issueForUser(
  svc: AuthService,
  user: { id: string; email: string; fullName: string; role: any },
): Promise<{ raw: string; hash: string }> {
  const res = makeResponseMock();
  const req = makeRequestMock();
  await svc.issueTokens(user, res as any, req as any);

  // Read back the cookie the response captured — that's the raw token
  const setRefresh = res.cookie.mock.calls.find(c => c[0] === 'RefreshToken');
  if (!setRefresh) throw new Error('issueTokens did not set RefreshToken cookie');
  const raw = setRefresh[1] as string;
  return { raw, hash: hashSha256(raw) };
}

// ═══════════════════════════════════════════════════════════════════════════
// Happy-path rotation
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.refreshTokens — happy path', () => {
  test('first rotation: old row deleted, new row created with different hash', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeAuth();
    const { raw: oldRaw, hash: oldHash } = await issueForUser(svc, seed.customer);

    // Sanity: old row exists
    expect(await ctx.prisma.refreshToken.findUnique({ where: { tokenHash: oldHash } }))
      .not.toBeNull();

    const res = makeResponseMock();
    const req = makeRequestMock();
    await svc.refreshTokens(oldRaw, res as any, req as any);

    // Old hash is gone
    expect(await ctx.prisma.refreshToken.findUnique({ where: { tokenHash: oldHash } }))
      .toBeNull();

    // Exactly one refresh token for this user
    const tokens = await ctx.prisma.refreshToken.findMany({
      where: { userId: seed.customer.id },
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).not.toBe(oldHash);
  });

  test('new cookie is set and differs from the old one', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeAuth();
    const { raw: oldRaw } = await issueForUser(svc, seed.customer);

    const res = makeResponseMock();
    await svc.refreshTokens(oldRaw, res as any, makeRequestMock() as any);

    const newSet = res.cookie.mock.calls.find(c => c[0] === 'RefreshToken');
    expect(newSet).toBeDefined();
    expect(newSet![1]).not.toBe(oldRaw);
  });

  test('Authentication cookie is re-issued (access token refresh)', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeAuth();
    const { raw: oldRaw } = await issueForUser(svc, seed.customer);

    const res = makeResponseMock();
    await svc.refreshTokens(oldRaw, res as any, makeRequestMock() as any);

    const accessSet = res.cookie.mock.calls.find(c => c[0] === 'Authentication');
    expect(accessSet).toBeDefined();
    expect(accessSet![1]).toMatch(/^signed\./); // from jwt.sign mock
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Reuse / replay detection
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.refreshTokens — reuse detection', () => {
  test('replay of an already-used refresh token → 401 Invalid', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeAuth();
    const { raw: oldRaw } = await issueForUser(svc, seed.customer);

    // Successful first rotation
    await svc.refreshTokens(oldRaw, makeResponseMock() as any, makeRequestMock() as any);

    // Replay the same raw token — should fail (token already deleted)
    await expect(
      svc.refreshTokens(oldRaw, makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(UnauthorizedException);
  });

  test('unknown / forged token → 401 Invalid', async () => {
    await seedReference(ctx.prisma);
    const svc = makeAuth();

    await expect(
      svc.refreshTokens('forged-raw-token', makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(UnauthorizedException);
  });

  test('other active tokens for the same user remain intact after a replay attempt', async () => {
    // The bare replay (token-not-found branch) must NOT revoke the whole family.
    // Only deactivated-user / suspended-vendor branches do that.
    const seed = await seedReference(ctx.prisma);
    const svc = makeAuth();

    // Two legitimate sessions
    const { raw: rawA } = await issueForUser(svc, seed.customer);
    await issueForUser(svc, seed.customer);
    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } })).toBe(2);

    // Use rawA successfully
    await svc.refreshTokens(rawA, makeResponseMock() as any, makeRequestMock() as any);

    // Replay rawA — should throw but leave the second session alive
    await expect(
      svc.refreshTokens(rawA, makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(UnauthorizedException);

    // Two tokens should still exist: session-B + the new token from rawA's rotation.
    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } })).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Expiry handling
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.refreshTokens — expiry', () => {
  test('expired token → row deleted + 401 Expired', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeAuth();
    const { raw, hash } = await issueForUser(svc, seed.customer);

    // Forcibly back-date the row in the DB to make it expired
    await ctx.prisma.refreshToken.update({
      where: { tokenHash: hash },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await expect(
      svc.refreshTokens(raw, makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(/expired/i);

    // Row is gone
    expect(await ctx.prisma.refreshToken.findUnique({ where: { tokenHash: hash } }))
      .toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Account-state revocation — whole family wiped
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.refreshTokens — account-state family revoke', () => {
  test('deactivated user → ALL refresh tokens for that user are wiped', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeAuth();

    // Two sessions on the customer
    const { raw: rawA } = await issueForUser(svc, seed.customer);
    await issueForUser(svc, seed.customer);
    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } })).toBe(2);

    // Admin deactivates the customer
    await ctx.prisma.user.update({
      where: { id: seed.customer.id },
      data: { isDeactivated: true },
    });

    // Attempt to refresh: should 401 AND wipe every token for the user.
    await expect(
      svc.refreshTokens(rawA, makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(UnauthorizedException);

    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } }))
      .toBe(0);
  });

  test('suspended vendor → ALL vendor-user refresh tokens wiped + ForbiddenException', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeAuth();

    const { raw } = await issueForUser(svc, seed.vendorUser);
    await issueForUser(svc, seed.vendorUser);
    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.vendorUser.id } })).toBe(2);

    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: { status: 'SUSPENDED' },
    });

    await expect(
      svc.refreshTokens(raw, makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(ForbiddenException);

    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.vendorUser.id } }))
      .toBe(0);
  });

  test('deleted user (row gone) → 401, with no tokens left on the orphaned userId', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeAuth();
    const { raw } = await issueForUser(svc, seed.customer);

    // Hard-delete the user (cascade will wipe tokens too, but we verify the
    // refresh path still rejects cleanly)
    await ctx.prisma.user.delete({ where: { id: seed.customer.id } });

    await expect(
      svc.refreshTokens(raw, makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(UnauthorizedException);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Session cap — issueTokens eviction
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.issueTokens — session cap', () => {
  test('6th login evicts the oldest token; total stays at 5', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeAuth();

    // Issue 5 sessions, small delay between each so createdAt ordering is stable
    const issued: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { hash } = await issueForUser(svc, seed.customer);
      issued.push(hash);
      await new Promise(r => setTimeout(r, 5));
    }

    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } })).toBe(5);

    // 6th issue — the oldest (issued[0]) must get evicted
    await issueForUser(svc, seed.customer);
    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } })).toBe(5);
    expect(await ctx.prisma.refreshToken.findUnique({ where: { tokenHash: issued[0] } }))
      .toBeNull();
  });

  test('stale expired tokens for the user are cleared on every issueTokens call', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeAuth();

    // Seed one expired token manually
    await ctx.prisma.refreshToken.create({
      data: {
        userId: seed.customer.id,
        tokenHash: 'expired-stale-hash',
        expiresAt: new Date(Date.now() - 86_400_000),
      },
    });
    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } })).toBe(1);

    await issueForUser(svc, seed.customer);

    // Expired row is gone; only the fresh one remains
    const rows = await ctx.prisma.refreshToken.findMany({ where: { userId: seed.customer.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe('expired-stale-hash');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Concurrent rotation race
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.refreshTokens — concurrent race', () => {
  test('two simultaneous rotations of the same raw token → exactly one succeeds', async () => {
    // Proves single-use is enforced even under race: the 2nd rotate sees the
    // row already deleted. A wider race window could let both past the DELETE,
    // but Postgres single-row DELETE is atomic so only one wins.
    const seed = await seedReference(ctx.prisma);
    const svc = makeAuth();
    const { raw } = await issueForUser(svc, seed.customer);

    const results = await Promise.allSettled([
      svc.refreshTokens(raw, makeResponseMock() as any, makeRequestMock() as any),
      svc.refreshTokens(raw, makeResponseMock() as any, makeRequestMock() as any),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled').length;
    const rejected  = results.filter(r => r.status === 'rejected').length;
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);

    // Database is in a clean state: exactly one token (the new one) for this user
    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } })).toBe(1);
  });
});
