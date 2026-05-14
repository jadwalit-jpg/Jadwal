/**
 * Integration — handleGoogleAuth against real Postgres.
 *
 * Covered:
 *   #27 Google OAuth callback flow — DB writes + account merge + guards
 */

import { getTestContext, seedReference } from './_setup';
import { AuthService } from '../../src/auth/auth.service';
import { UsersService } from '../../src/users/users.service';
import {
  makeJwtMock, makeConfigMock, makeSecurityLoggerMock, makeAuditLoggerMock,
  makeEmailMock, makeNotificationMock,
  makeResponseMock, makeRequestMock,
} from '../mocks/auth-deps.mock';
import { ForbiddenException } from '@nestjs/common';
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

function gProfile(overrides: Partial<{ googleId: string; email: string; fullName: string; picture: string | null }> = {}) {
  return {
    googleId: `g-${crypto.randomUUID()}`,
    email: `gu-${crypto.randomUUID().slice(0, 6)}@gmail.com`,
    fullName: 'Google User',
    picture: 'https://lh3.googleusercontent.com/a/abc',
    ...overrides,
  };
}

describe('AuthService.handleGoogleAuth', () => {
  test('brand new Google user → creates row (CUSTOMER, emailVerified=true, no password)', async () => {
    await seedReference(ctx.prisma);
    const auth = makeAuth();

    const profile = gProfile();
    const res = await auth.handleGoogleAuth(profile, makeResponseMock() as any, makeRequestMock() as any);
    expect(res.email).toBe(profile.email);

    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: profile.email } });
    expect(u.role).toBe('CUSTOMER');
    expect(u.emailVerified).toBe(true); // OAuth trusts Google's verification
    expect(u.password).toBeNull();       // OAuth-only account
    expect(u.googleId).toBe(profile.googleId);
    expect(u.profilePicture).toBe(profile.picture);
  });

  test('returning Google user (same googleId) → no row created; existing row returned', async () => {
    await seedReference(ctx.prisma);
    const auth = makeAuth();

    const profile = gProfile();
    await auth.handleGoogleAuth(profile, makeResponseMock() as any, makeRequestMock() as any);
    const beforeCount = await ctx.prisma.user.count();

    await auth.handleGoogleAuth(profile, makeResponseMock() as any, makeRequestMock() as any);
    const afterCount = await ctx.prisma.user.count();
    expect(afterCount).toBe(beforeCount);
  });

  test('account merge — Google email matches verified existing password account → links googleId', async () => {
    await seedReference(ctx.prisma);
    const auth = makeAuth();

    // Pre-existing password user, verified
    const existing = await ctx.prisma.user.create({
      data: {
        fullName: 'Alice', email: 'alice@gmail.com',
        password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
      },
    });
    expect(existing.googleId).toBeNull();

    await auth.handleGoogleAuth(
      gProfile({ email: 'alice@gmail.com', fullName: 'Alice Google', picture: 'https://pic' }),
      makeResponseMock() as any,
      makeRequestMock() as any,
    );

    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after.googleId).toBeTruthy();
    // profilePicture was null → fills it; fullName is NOT overwritten (policy)
    expect(after.profilePicture).toBe('https://pic');
  });

  test('account merge refused when existing account is unverified → ForbiddenException', async () => {
    await seedReference(ctx.prisma);
    const auth = makeAuth();
    await ctx.prisma.user.create({
      data: {
        fullName: 'Unverified', email: 'unv@gmail.com',
        password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: false,
      },
    });
    await expect(
      auth.handleGoogleAuth(gProfile({ email: 'unv@gmail.com' }), makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(ForbiddenException);
    // No googleId linked
    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'unv@gmail.com' } });
    expect(after.googleId).toBeNull();
  });

  test('deactivated account → ForbiddenException, no token issued', async () => {
    await seedReference(ctx.prisma);
    const auth = makeAuth();

    const profile = gProfile();
    await auth.handleGoogleAuth(profile, makeResponseMock() as any, makeRequestMock() as any);
    await ctx.prisma.user.update({
      where: { email: profile.email }, data: { isDeactivated: true },
    });

    await expect(
      auth.handleGoogleAuth(profile, makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(/deactivated/i);
  });

  test('suspended vendor via Google → ForbiddenException', async () => {
    const seed = await seedReference(ctx.prisma);
    const auth = makeAuth();

    // Link Google to the existing vendor user
    await ctx.prisma.user.update({
      where: { id: seed.vendorUser.id },
      data: { googleId: 'g-vendor-abc' },
    });
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id }, data: { status: 'SUSPENDED' },
    });

    await expect(
      auth.handleGoogleAuth(
        gProfile({ googleId: 'g-vendor-abc', email: seed.vendorUser.email }),
        makeResponseMock() as any, makeRequestMock() as any,
      ),
    ).rejects.toThrow(/suspended/i);
  });

  test('cookies issued on success (access + refresh set)', async () => {
    await seedReference(ctx.prisma);
    const auth = makeAuth();
    const res = makeResponseMock();
    await auth.handleGoogleAuth(gProfile(), res as any, makeRequestMock() as any);
    const cookieKeys = res.cookie.mock.calls.map(c => c[0]);
    expect(cookieKeys).toContain('Authentication');
    expect(cookieKeys).toContain('RefreshToken');
  });
});
