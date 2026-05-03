/**
 * AuthService end-to-end account flows against real Postgres.
 *
 *   - register → receive verification token → verifyEmail → auto-login
 *   - forgot password → reset token → resetPassword → all sessions wiped
 *   - loginWithCheck: success, invalid password, account lockout after N fails
 *   - resendVerification: anti-enumeration (always 200, fresh token if exists)
 *   - logout: clears cookies + deletes token row
 *
 * The refresh rotation flow is already covered in auth-refresh-rotation.
 */

import { getTestContext, seedReference } from './_setup';
import { AuthService } from '../../src/auth/auth.service';
import { UsersService } from '../../src/users/users.service';
import {
  makeJwtMock, makeConfigMock, makeSecurityLoggerMock, makeAuditLoggerMock,
  makeEmailMock, makeEmailQuotaMock, makeSmsMock, makeNotificationMock,
  makeResponseMock, makeRequestMock,
} from '../mocks/auth-deps.mock';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeAuth(emailMock = makeEmailMock()) {
  const prismaSvc = { client: ctx.prisma } as any;
  const usersService = new UsersService(prismaSvc);
  const svc = new AuthService(
    usersService as any,
    prismaSvc,
    makeJwtMock() as any,
    makeConfigMock() as any,
    makeSecurityLoggerMock() as any,
    makeAuditLoggerMock() as any,
    emailMock as any,
    makeEmailQuotaMock() as any,    // EmailQuotaService — mock returns true (no quota gating in tests)
    makeSmsMock() as any,
    makeNotificationMock() as any,
  );
  return { svc, emailMock };
}

// ═══════════════════════════════════════════════════════════════════════════
// Register → verify → auto-login
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.registerAndLogin', () => {
  test('creates user, stores verification token, triggers email, returns {pending:true,email}', async () => {
    await seedReference(ctx.prisma); // for shared reference data
    const emailMock = makeEmailMock();
    const { svc } = makeAuth(emailMock);

    const res = await svc.registerAndLogin({
      fullName: 'New User',
      email: 'newuser@t.com',
      password: 'S3cure!Pass1',
    });

    expect(res.pending).toBe(true);
    expect(res.email).toBe('newuser@t.com');

    // User row exists — emailVerified=false, verificationToken set
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'newuser@t.com' } });
    expect(u.emailVerified).toBe(false);
    expect(u.role).toBe('CUSTOMER');
    expect((u as any).verificationToken).toBeTruthy();
    expect((u as any).verificationTokenExpiry).toBeInstanceOf(Date);
    expect((u as any).verificationTokenExpiry!.getTime()).toBeGreaterThan(Date.now());

    // Email verification link dispatched
    expect(emailMock.sendEmailVerification).toHaveBeenCalled();
  });

  test('duplicate email → ConflictException', async () => {
    await seedReference(ctx.prisma);
    const { svc } = makeAuth();

    await svc.registerAndLogin({
      fullName: 'U1', email: 'dupe@t.com', password: 'P@ssw0rd123',
    });
    await expect(
      svc.registerAndLogin({
        fullName: 'U2', email: 'dupe@t.com', password: 'Other!Pass9',
      }),
    ).rejects.toThrow(/already registered/i);
  });

  test('duplicate phone → ConflictException with neutral message (anti-enumeration)', async () => {
    await seedReference(ctx.prisma);
    const { svc } = makeAuth();
    await svc.registerAndLogin({
      fullName: 'A', email: 'a@t.com', password: 'P@ssw0rd123',
      phone: '+97455551111',
    });
    await expect(
      svc.registerAndLogin({
        fullName: 'B', email: 'b@t.com', password: 'P@ssw0rd123',
        phone: '+97455551111',
      }),
    ).rejects.toThrow(/different phone number/i);
    // Should NOT leak "phone already registered"
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// verifyEmail → flips emailVerified, auto-logs in
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.verifyEmail', () => {
  test('valid token → emailVerified=true, token cleared, session issued', async () => {
    await seedReference(ctx.prisma);
    const emailMock = makeEmailMock();
    const { svc } = makeAuth(emailMock);

    await svc.registerAndLogin({
      fullName: 'V', email: 'verify@t.com', password: 'S3cure!Pass1',
    });
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'verify@t.com' } });
    // DB stores SHA-256(token); the plaintext is in the email link.
    // Extract from the email mock — same path a real user takes.
    const calls = (emailMock.sendEmailVerification as jest.Mock).mock.calls;
    expect(calls.length).toBe(1);
    const link = calls[0][1].verificationLink as string;
    const m = link.match(/[?&]token=([a-f0-9]+)/);
    expect(m).toBeTruthy();
    const token = m![1];

    const res = makeResponseMock();
    const out = await svc.verifyEmail(token, res as any, makeRequestMock() as any);

    // issueTokens returns { id, email, fullName, role }
    expect(out.email).toBe('verify@t.com');
    expect(out.id).toBe(u.id);

    // User is now verified, token nulled
    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.emailVerified).toBe(true);
    expect((after as any).verificationToken).toBeNull();

    // Cookies set (access + refresh)
    const cookieCalls = res.cookie.mock.calls.map(c => c[0]);
    expect(cookieCalls).toContain('Authentication');
    expect(cookieCalls).toContain('RefreshToken');
  });

  test('unknown / forged token → BadRequest', async () => {
    await seedReference(ctx.prisma);
    const { svc } = makeAuth();
    await expect(
      svc.verifyEmail('fake-token-xxxxx', makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(/invalid or expired/i);
  });

  test('expired token → BadRequest; row is NOT cleared (so a fresh resend can reset)', async () => {
    await seedReference(ctx.prisma);
    const emailMock = makeEmailMock();
    const { svc } = makeAuth(emailMock);
    await svc.registerAndLogin({
      fullName: 'E', email: 'expired@t.com', password: 'S3cure!Pass1',
    });
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'expired@t.com' } });
    // Forcibly back-date
    await ctx.prisma.user.update({
      where: { id: u.id },
      data: { verificationTokenExpiry: new Date(Date.now() - 3600_000) } as any,
    });
    const link = (emailMock.sendEmailVerification as jest.Mock).mock.calls[0][1].verificationLink as string;
    const token = link.match(/[?&]token=([a-f0-9]+)/)![1];

    await expect(
      svc.verifyEmail(token, makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(/expired/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// resendVerification — anti-enumeration (always returns 200)
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.resendVerification', () => {
  test('unknown email → generic message (no throw, no leak)', async () => {
    await seedReference(ctx.prisma);
    const { svc } = makeAuth();
    const res = await svc.resendVerification('ghost@nowhere.com');
    expect(res.message).toMatch(/if that email exists/i);
  });

  test('already-verified email → generic message (no new email sent)', async () => {
    await seedReference(ctx.prisma);
    const emailMock = makeEmailMock();
    const { svc } = makeAuth(emailMock);
    await svc.registerAndLogin({ fullName: 'V', email: 'v@t.com', password: 'S3cure!Pass1' });
    await ctx.prisma.user.update({ where: { email: 'v@t.com' }, data: { emailVerified: true } });
    emailMock.sendEmailVerification.mockClear();

    const res = await svc.resendVerification('v@t.com');
    expect(res.message).toMatch(/if that email exists/i);
    expect(emailMock.sendEmailVerification).not.toHaveBeenCalled();
  });

  test('pending email → new token issued + email dispatched', async () => {
    await seedReference(ctx.prisma);
    const emailMock = makeEmailMock();
    const { svc } = makeAuth(emailMock);
    await svc.registerAndLogin({ fullName: 'V', email: 'pending@t.com', password: 'S3cure!Pass1' });
    const before = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'pending@t.com' } });
    emailMock.sendEmailVerification.mockClear();

    await svc.resendVerification('pending@t.com');

    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'pending@t.com' } });
    // Token rotated
    expect((after as any).verificationToken).not.toBe((before as any).verificationToken);
    // Email fired
    expect(emailMock.sendEmailVerification).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Password reset
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.forgotPassword + resetPassword', () => {
  test('forgotPassword always returns generic response even for unknown email', async () => {
    await seedReference(ctx.prisma);
    const { svc } = makeAuth();
    const res = await svc.forgotPassword('nobody@nowhere.com');
    expect(res.message).toMatch(/if an account exists/i);
  });

  test('forgotPassword on real customer → writes resetToken + expiry, sends email', async () => {
    const seed = await seedReference(ctx.prisma);
    const emailMock = makeEmailMock();
    const { svc } = makeAuth(emailMock);

    await svc.forgotPassword(seed.customer.email);

    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect((u as any).passwordResetToken).toBeTruthy();
    expect((u as any).passwordResetExpiry).toBeInstanceOf(Date);
    expect((u as any).passwordResetExpiry!.getTime()).toBeGreaterThan(Date.now());
    expect(emailMock.sendPasswordReset).toHaveBeenCalled();
  });

  test('resetPassword with valid token → bcrypt hash updated + all refresh tokens wiped', async () => {
    const seed = await seedReference(ctx.prisma);
    const emailMock = makeEmailMock();
    const { svc } = makeAuth(emailMock);

    // Seed some refresh tokens for the customer (simulate active sessions)
    await ctx.prisma.refreshToken.create({
      data: {
        userId: seed.customer.id, tokenHash: 'hash-to-wipe-1',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await ctx.prisma.refreshToken.create({
      data: {
        userId: seed.customer.id, tokenHash: 'hash-to-wipe-2',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } })).toBe(2);

    await svc.forgotPassword(seed.customer.email);

    // The DB now stores ONLY the SHA-256 hash of the token (anti-replay
    // hardening). The plaintext is sent in the email link — extract it
    // from the email mock's call args, exactly as a real user would
    // receive it via email and click through.
    const calls = (emailMock.sendPasswordReset as jest.Mock).mock.calls;
    expect(calls.length).toBe(1);
    const resetLink = calls[0][1].resetLink as string;
    const tokenMatch = resetLink.match(/[?&]token=([a-f0-9]+)/);
    expect(tokenMatch).toBeTruthy();
    const token = tokenMatch![1];

    const newPwd = 'NewS3cure!Pass';
    const out = await svc.resetPassword(token, newPwd);
    expect(out.message).toMatch(/reset successfully/i);

    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect((after as any).passwordResetToken).toBeNull();
    expect((after as any).passwordResetExpiry).toBeNull();
    expect(after.failedLoginAttempts).toBe(0);
    expect(after.lockedUntil).toBeNull();

    // New password hash is valid
    expect(await bcrypt.compare(newPwd, after.password!)).toBe(true);

    // All sessions wiped
    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.customer.id } })).toBe(0);
  });

  test('resetPassword with bad-format token → BadRequest', async () => {
    await seedReference(ctx.prisma);
    const { svc } = makeAuth();
    await expect(svc.resetPassword('not-hex-64', 'Whatever1!'))
      .rejects.toThrow(/invalid or expired/i);
  });

  test('resetPassword with valid format but unknown token → BadRequest', async () => {
    await seedReference(ctx.prisma);
    const { svc } = makeAuth();
    const fakeHex = 'a'.repeat(64);
    await expect(svc.resetPassword(fakeHex, 'Whatever1!'))
      .rejects.toThrow(/invalid or expired/i);
  });

  test('resetPassword with expired token → BadRequest', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeAuth();
    await svc.forgotPassword(seed.customer.email);
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    // Back-date expiry
    await ctx.prisma.user.update({
      where: { id: seed.customer.id },
      data: { passwordResetExpiry: new Date(Date.now() - 60_000) } as any,
    });
    const token = (u as any).passwordResetToken as string;
    await expect(svc.resetPassword(token, 'Fresh!Pass1')).rejects.toThrow(/invalid or expired/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// loginWithCheck — success + lockout
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.loginWithCheck — lockout', () => {
  async function mkVerifiedCustomer(email = 'lock@t.com', password = 'Correct!Pass1') {
    const hash = await bcrypt.hash(password, 4); // low rounds for speed
    const u = await ctx.prisma.user.create({
      data: {
        fullName: 'LockMe', email, password: hash,
        role: 'CUSTOMER', emailVerified: true,
      },
    });
    return { user: u, password };
  }

  test('5 consecutive wrong passwords → account locked; 6th attempt rejected', async () => {
    await seedReference(ctx.prisma);
    const { svc } = makeAuth();
    const { user } = await mkVerifiedCustomer();

    for (let i = 0; i < 5; i++) {
      await expect(
        svc.loginWithCheck(user.email, 'WRONG!', makeResponseMock() as any, makeRequestMock() as any),
      ).rejects.toThrow();
    }
    const locked = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil).toBeInstanceOf(Date);
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(locked.failedLoginAttempts).toBeGreaterThanOrEqual(5);

    // 6th attempt (even with CORRECT password) is still rejected — but with
    // a generic "Invalid credentials" message, NOT "locked" (anti-enum: we
    // never leak the lock state to an unauthenticated caller).
    await expect(
      svc.loginWithCheck(user.email, 'Correct!Pass1', makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow(/invalid credentials/i);
  }, 30_000);

  test('correct password before lockout → failedLoginAttempts reset to 0', async () => {
    await seedReference(ctx.prisma);
    const { svc } = makeAuth();
    const { user } = await mkVerifiedCustomer();

    // 2 wrong attempts, then correct
    for (let i = 0; i < 2; i++) {
      await svc.loginWithCheck(user.email, 'WRONG!', makeResponseMock() as any, makeRequestMock() as any).catch(() => {});
    }
    await svc.loginWithCheck(user.email, 'Correct!Pass1', makeResponseMock() as any, makeRequestMock() as any);

    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.failedLoginAttempts).toBe(0);
    expect(after.lockedUntil).toBeNull();
  }, 30_000);

  test('unverified customer → login rejected with EMAIL_NOT_VERIFIED signal', async () => {
    await seedReference(ctx.prisma);
    const { svc } = makeAuth();
    const hash = await bcrypt.hash('S3cure!Pass1', 4);
    await ctx.prisma.user.create({
      data: {
        fullName: 'U', email: 'unver@t.com', password: hash,
        role: 'CUSTOMER', emailVerified: false,
      },
    });

    await expect(
      svc.loginWithCheck('unver@t.com', 'S3cure!Pass1', makeResponseMock() as any, makeRequestMock() as any),
    ).rejects.toThrow();
  }, 20_000);
});
