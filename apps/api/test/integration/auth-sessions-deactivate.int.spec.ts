/**
 * Integration — session management (list / revoke one / revoke others) and
 * admin-initiated account deactivation flow.
 *
 * Covered:
 *   #28 Sessions list, revoke single, revoke all-others (admin/vendor only)
 *   #29 Admin deactivateUser + reactivate; deactivated users can't refresh;
 *       deactivated admin-accounts are forbidden
 */

import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { AuthService } from '../../src/auth/auth.service';
import { UsersService } from '../../src/users/users.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import {
  makeJwtMock, makeConfigMock, makeSecurityLoggerMock, makeAuditLoggerMock,
  makeEmailMock, makeNotificationMock,
  makeResponseMock, makeRequestMock,
} from '../mocks/auth-deps.mock';
import { UnauthorizedException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeAuth() {
  const prismaSvc = { client: ctx.prisma } as any;
  return new AuthService(
    new UsersService(prismaSvc) as any,
    prismaSvc,
    makeJwtMock() as any,
    makeConfigMock() as any,
    makeSecurityLoggerMock() as any,
    makeAuditLoggerMock() as any,
    makeEmailMock() as any,
    makeNotificationMock() as any,
  );
}

function makeAdmin() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  return new AdminService(
    prismaSvc,
    { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn(), sendToMany: jest.fn() } as any,
    loyalty,
    { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sessions — list / revoke (direct DB assertions, mirrors controller logic)
// ═══════════════════════════════════════════════════════════════════════════

describe('Auth sessions — list / revoke invariants (DB level)', () => {
  async function seedSessions(userId: string, count: number) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const rt = await ctx.prisma.refreshToken.create({
        data: {
          userId,
          tokenHash: `hash-${i}-${crypto.randomUUID()}`,
          expiresAt: new Date(Date.now() + 86_400_000),
          userAgent: `Browser ${i}`,
          ipAddress: `10.0.0.${i + 1}`,
        },
      });
      ids.push(rt.id);
      // Small delay so lastUsedAt differs (for ordering assertions)
      await new Promise(r => setTimeout(r, 5));
    }
    return ids;
  }

  test('list sessions for user returns all rows with UA + IP + timestamps', async () => {
    const seed = await seedReference(ctx.prisma);
    const ids = await seedSessions(seed.vendorUser.id, 3);

    const sessions = await ctx.prisma.refreshToken.findMany({
      where: { userId: seed.vendorUser.id },
      orderBy: { lastUsedAt: 'desc' },
    });
    expect(sessions).toHaveLength(3);
    for (const s of sessions) {
      expect(s.userAgent).toMatch(/Browser/);
      expect(s.ipAddress).toMatch(/10\.0\.0\./);
      expect(ids).toContain(s.id);
    }
  });

  test('revoke a single session deletes only that row', async () => {
    const seed = await seedReference(ctx.prisma);
    const ids = await seedSessions(seed.vendorUser.id, 3);

    await ctx.prisma.refreshToken.delete({ where: { id: ids[1] } });

    expect(await ctx.prisma.refreshToken.count({
      where: { userId: seed.vendorUser.id },
    })).toBe(2);
    expect(await ctx.prisma.refreshToken.findUnique({ where: { id: ids[1] } })).toBeNull();
  });

  test('revoke-all-others preserves the current session token', async () => {
    const seed = await seedReference(ctx.prisma);
    const ids = await seedSessions(seed.vendorUser.id, 4);

    // Simulate "current" = ids[2]. Get its hash.
    const current = await ctx.prisma.refreshToken.findUniqueOrThrow({ where: { id: ids[2] } });

    const { count } = await ctx.prisma.refreshToken.deleteMany({
      where: {
        userId: seed.vendorUser.id,
        tokenHash: { not: current.tokenHash },
      },
    });
    expect(count).toBe(3); // 3 deleted, 1 kept

    const remaining = await ctx.prisma.refreshToken.findMany({
      where: { userId: seed.vendorUser.id },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(ids[2]);
  });

  test('cross-user revoke is prevented (session.userId match gate)', async () => {
    const seed = await seedReference(ctx.prisma);
    const otherUser = await ctx.prisma.user.create({
      data: {
        fullName: 'Other', email: `o-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'VENDOR', emailVerified: true,
      },
    });
    const otherSession = await ctx.prisma.refreshToken.create({
      data: {
        userId: otherUser.id, tokenHash: 'other-hash',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    // Controller logic: check `session.userId !== user.id` → ForbiddenException.
    // Here we confirm the underlying query returns the row that the check
    // consumes, so the guard has ground truth to stand on.
    const lookedUp = await ctx.prisma.refreshToken.findUnique({
      where: { id: otherSession.id }, select: { userId: true },
    });
    expect(lookedUp?.userId).toBe(otherUser.id);
    expect(lookedUp?.userId).not.toBe(seed.vendorUser.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Admin deactivate / reactivate
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.deactivateUser → reactivate round-trip', () => {
  test('deactivate sets isDeactivated=true AND wipes all refresh tokens', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.refreshToken.create({
      data: { userId: seed.customer.id, tokenHash: 'rt-1', expiresAt: new Date(Date.now() + 86_400_000) },
    });
    await ctx.prisma.refreshToken.create({
      data: { userId: seed.customer.id, tokenHash: 'rt-2', expiresAt: new Date(Date.now() + 86_400_000) },
    });

    const admin = makeAdmin();
    await admin.deactivateUser(seed.customer.id, true);

    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(u.isDeactivated).toBe(true);

    // All refresh tokens wiped — user can't continue active sessions
    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } }))
      .toBe(0);
  });

  test('reactivate sets isDeactivated=false; refresh tokens are NOT restored', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = makeAdmin();
    await admin.deactivateUser(seed.customer.id, true);
    await admin.deactivateUser(seed.customer.id, false);

    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(u.isDeactivated).toBe(false);
    // Re-activated — but user still has to log in fresh
    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } })).toBe(0);
  });

  test('cannot deactivate an ADMIN (self-protection) → ForbiddenException', async () => {
    await seedReference(ctx.prisma);
    const adminUser = await ctx.prisma.user.create({
      data: {
        fullName: 'Admin', email: `a-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'ADMIN', emailVerified: true,
      },
    });
    const admin = makeAdmin();
    await expect(admin.deactivateUser(adminUser.id, true)).rejects.toThrow(ForbiddenException);
  });

  test('deactivate non-existent user → NotFoundException', async () => {
    await seedReference(ctx.prisma);
    const admin = makeAdmin();
    await expect(
      admin.deactivateUser('00000000-0000-4000-8000-000000000aaa', true),
    ).rejects.toThrow(NotFoundException);
  });

  test('deactivated user attempting login → rejected (generic Invalid credentials)', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = makeAdmin();
    await admin.deactivateUser(seed.customer.id, true);

    const auth = makeAuth();
    await expect(
      auth.loginWithCheck(seed.customer.email, 'anything', makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(/invalid credentials|deactivated|no longer active/i);
  });

  test('deactivated user with a valid refresh token → cannot rotate (family wipe)', async () => {
    const seed = await seedReference(ctx.prisma);
    const auth = makeAuth();

    // Issue a real session, then deactivate
    const res = makeResponseMock();
    await auth.issueTokens(seed.customer, res as any, makeRequestMock() as any);
    const cookieCall = res.cookie.mock.calls.find(c => c[0] === 'RefreshToken')!;
    const rawRefresh = cookieCall[1] as string;

    const admin = makeAdmin();
    await admin.deactivateUser(seed.customer.id, true);

    await expect(
      auth.refreshTokens(rawRefresh, makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(UnauthorizedException);

    // All tokens for this user wiped
    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } })).toBe(0);
  });
});
