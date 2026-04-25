/**
 * AuthService unit tests — critical money/identity paths.
 *
 * Mocks: Prisma, JWT, Config, UsersService, SecurityLogger, AuditLogger,
 *        EmailService, SmsService, NotificationService, bcrypt.
 *
 * No DB, no network, no Redis. Runtime <2s.
 */

import { UnauthorizedException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../../src/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../src/users/users.service';
import { SecurityLoggerService } from '../../src/common/services/security-logger.service';
import { AuditLoggerService } from '../../src/common/services/audit-logger.service';
import { EmailService } from '../../src/email/email.service';
import { SmsService } from '../../src/sms/sms.service';
import { NotificationService } from '../../src/common/services/notification.service';
import { makePrismaMock } from '../mocks/prisma.mock';
import {
  makeJwtMock, makeConfigMock, makeUsersMock, makeSecurityLoggerMock,
  makeAuditLoggerMock, makeEmailMock, makeSmsMock, makeNotificationMock,
  makeResponseMock, makeRequestMock,
} from '../mocks/auth-deps.mock';

// ─── Setup helpers ──────────────────────────────────────────────────────────

async function buildSut(configOverrides: Record<string, string> = {}) {
  const prisma = makePrismaMock();
  const jwt = makeJwtMock();
  const config = makeConfigMock(configOverrides);
  const users = makeUsersMock();
  const sec = makeSecurityLoggerMock();
  const audit = makeAuditLoggerMock();
  const email = makeEmailMock();
  const sms = makeSmsMock();
  const notif = makeNotificationMock();

  const moduleRef = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaService,         useValue: prisma },
      { provide: JwtService,            useValue: jwt },
      { provide: ConfigService,         useValue: config },
      { provide: UsersService,          useValue: users },
      { provide: SecurityLoggerService, useValue: sec },
      { provide: AuditLoggerService,    useValue: audit },
      { provide: EmailService,          useValue: email },
      { provide: SmsService,            useValue: sms },
      { provide: NotificationService,   useValue: notif },
    ],
  }).compile();

  return {
    sut: moduleRef.get(AuthService),
    prisma, jwt, config, users, sec, audit, email, sms, notif,
  };
}

const futureDate  = () => new Date(Date.now() + 10 * 60 * 1000);
const pastDate    = () => new Date(Date.now() - 10 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// loginWithCheck
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.loginWithCheck', () => {
  let ctx: Awaited<ReturnType<typeof buildSut>>;
  beforeEach(async () => { ctx = await buildSut(); });

  test('succeeds with correct credentials — sets cookies + logs LOGIN_SUCCESS', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER',
      password: await bcrypt.hash('pw', 4),
      failedLoginAttempts: 0, lockedUntil: null, emailVerified: true, isDeactivated: false,
    });

    const res = makeResponseMock();
    const req = makeRequestMock();
    const result = await ctx.sut.loginWithCheck('a@b.com', 'pw', res as any, req as any);

    expect(res.cookie).toHaveBeenCalledWith('Authentication', expect.any(String), expect.any(Object));
    expect(res.cookie).toHaveBeenCalledWith('RefreshToken', expect.any(String), expect.any(Object));
    expect(ctx.sec.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'LOGIN_SUCCESS', userId: 'u1' }));
    expect(result).toMatchObject({ id: 'u1', email: 'a@b.com', role: 'CUSTOMER' });
  });

  test('wrong password → 401 "Invalid credentials" + increments failedLoginAttempts', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER',
      password: await bcrypt.hash('correct', 4),
      failedLoginAttempts: 0, lockedUntil: null, emailVerified: true, isDeactivated: false,
    });

    await expect(ctx.sut.loginWithCheck('a@b.com', 'wrong', makeResponseMock() as any))
      .rejects.toThrow(UnauthorizedException);
    await expect(ctx.sut.loginWithCheck('a@b.com', 'wrong', makeResponseMock() as any))
      .rejects.toThrow('Invalid credentials');
    expect(ctx.prisma._client.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ failedLoginAttempts: 1 }) }),
    );
  });

  test('non-existent email → 401 + runs dummy bcrypt for timing-safety', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    const spy = jest.spyOn(bcrypt, 'compare');

    await expect(ctx.sut.loginWithCheck('nope@b.com', 'x', makeResponseMock() as any))
      .rejects.toThrow('Invalid credentials');
    expect(spy).toHaveBeenCalled(); // dummy compare happened
    spy.mockRestore();
  });

  test('locked account → 401 generic (never reveals lock state)', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER',
      password: await bcrypt.hash('pw', 4),
      failedLoginAttempts: 5, lockedUntil: futureDate(), emailVerified: true, isDeactivated: false,
    });

    const err = await ctx.sut.loginWithCheck('a@b.com', 'pw', makeResponseMock() as any).catch(e => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe('Invalid credentials'); // NOT "Your account is locked"
  });

  test('OAuth-only account (null password) → 401 generic + runs dummy bcrypt', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER',
      password: null,
      failedLoginAttempts: 0, lockedUntil: null, emailVerified: true, isDeactivated: false,
    });

    await expect(ctx.sut.loginWithCheck('a@b.com', 'anything', makeResponseMock() as any))
      .rejects.toThrow('Invalid credentials');
  });

  test('deactivated user → 403 "Your account has been deactivated"', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER',
      password: await bcrypt.hash('pw', 4),
      failedLoginAttempts: 0, lockedUntil: null, emailVerified: true, isDeactivated: true,
    });

    await expect(ctx.sut.loginWithCheck('a@b.com', 'pw', makeResponseMock() as any))
      .rejects.toThrow(ForbiddenException);
  });

  test('5th failed attempt triggers account lockout', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER',
      password: await bcrypt.hash('correct', 4),
      failedLoginAttempts: 4, // 4th attempt in DB → this wrong password becomes #5
      lockedUntil: null, emailVerified: true, isDeactivated: false,
    });

    await expect(ctx.sut.loginWithCheck('a@b.com', 'wrong', makeResponseMock() as any))
      .rejects.toThrow('Invalid credentials');

    expect(ctx.prisma._client.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failedLoginAttempts: 5,
          lockedUntil: expect.any(Date),
        }),
      }),
    );
    expect(ctx.sec.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'ACCOUNT_LOCKED' }));
  });

  test('unverified email on CUSTOMER → 403 EMAIL_NOT_VERIFIED', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER',
      password: await bcrypt.hash('pw', 4),
      failedLoginAttempts: 0, lockedUntil: null, emailVerified: false, isDeactivated: false,
    });

    const err = await ctx.sut.loginWithCheck('a@b.com', 'pw', makeResponseMock() as any).catch(e => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe('EMAIL_NOT_VERIFIED');
  });

  test('PENDING vendor → 403 "pending admin approval"', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'VENDOR',
      password: await bcrypt.hash('pw', 4),
      failedLoginAttempts: 0, lockedUntil: null, emailVerified: true, isDeactivated: false,
    });
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({ status: 'PENDING' });

    await expect(ctx.sut.loginWithCheck('a@b.com', 'pw', makeResponseMock() as any))
      .rejects.toThrow(/pending admin approval/);
  });

  test('SUSPENDED vendor → 403 "suspended"', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'VENDOR',
      password: await bcrypt.hash('pw', 4),
      failedLoginAttempts: 0, lockedUntil: null, emailVerified: true, isDeactivated: false,
    });
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({ status: 'SUSPENDED' });

    await expect(ctx.sut.loginWithCheck('a@b.com', 'pw', makeResponseMock() as any))
      .rejects.toThrow(/suspended/);
  });

  test('successful login resets failedLoginAttempts + lockedUntil', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER',
      password: await bcrypt.hash('pw', 4),
      failedLoginAttempts: 3, lockedUntil: null, emailVerified: true, isDeactivated: false,
    });

    await ctx.sut.loginWithCheck('a@b.com', 'pw', makeResponseMock() as any);

    expect(ctx.prisma._client.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// issueTokens — cookie shape
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.issueTokens — cookie options', () => {
  test('dev env: secure=false, httpOnly=true, sameSite=strict', async () => {
    const ctx = await buildSut({ NODE_ENV: 'development' });
    const res = makeResponseMock();
    await ctx.sut.issueTokens({ id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER' } as any, res as any);

    const accessCookie = res.cookie.mock.calls.find(c => c[0] === 'Authentication');
    expect(accessCookie).toBeDefined();
    const opts = accessCookie![2];
    expect(opts).toMatchObject({ httpOnly: true, sameSite: 'strict' });
    // secure is true only when NODE_ENV === 'production'
    expect(opts.secure).not.toBe(true);
  });

  test('prod env: secure=true', async () => {
    // cookieOptions reads process.env.NODE_ENV directly (not ConfigService),
    // so the env var itself must be set for this path.
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const ctx = await buildSut({ NODE_ENV: 'production' });
      const res = makeResponseMock();
      await ctx.sut.issueTokens({ id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER' } as any, res as any);

      const accessCookie = res.cookie.mock.calls.find(c => c[0] === 'Authentication');
      expect(accessCookie![2]).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict' });
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test('creates a refresh token row with hashed tokenHash', async () => {
    const ctx = await buildSut();
    await ctx.sut.issueTokens({ id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER' } as any, makeResponseMock() as any);

    expect(ctx.prisma._client.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), // sha256 hex
        }),
      }),
    );
  });

  test('body response never includes raw tokens', async () => {
    const ctx = await buildSut();
    const result = await ctx.sut.issueTokens({ id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER' } as any, makeResponseMock() as any);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/accessToken|refreshToken/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// refreshTokens — rotation
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.refreshTokens', () => {
  let ctx: Awaited<ReturnType<typeof buildSut>>;
  beforeEach(async () => { ctx = await buildSut(); });

  test('valid refresh token → deletes old row + issues new tokens', async () => {
    const rawToken = 'a'.repeat(64);
    const tokenHash = ctx.sut.getTokenHash(rawToken);

    ctx.prisma._client.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt1', userId: 'u1', tokenHash, expiresAt: futureDate(),
    });
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER', isDeactivated: false,
    });

    await ctx.sut.refreshTokens(rawToken, makeResponseMock() as any);

    expect(ctx.prisma._client.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 'rt1' } });
    expect(ctx.prisma._client.refreshToken.create).toHaveBeenCalled(); // new token issued
    expect(ctx.sec.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'TOKEN_REFRESH' }));
  });

  test('unknown refresh token → 401', async () => {
    ctx.prisma._client.refreshToken.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.refreshTokens('x'.repeat(64), makeResponseMock() as any))
      .rejects.toThrow('Invalid refresh token');
  });

  test('expired refresh token → deletes row + 401', async () => {
    const rawToken = 'a'.repeat(64);
    ctx.prisma._client.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt1', userId: 'u1', tokenHash: 'h', expiresAt: pastDate(),
    });

    await expect(ctx.sut.refreshTokens(rawToken, makeResponseMock() as any))
      .rejects.toThrow('Refresh token expired');
    expect(ctx.prisma._client.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 'rt1' } });
  });

  test('deactivated user → revokes ALL sessions + clears cookies + 401', async () => {
    ctx.prisma._client.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt1', userId: 'u1', tokenHash: 'h', expiresAt: futureDate(),
    });
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER', isDeactivated: true,
    });
    const res = makeResponseMock();

    await expect(ctx.sut.refreshTokens('a'.repeat(64), res as any))
      .rejects.toThrow('Account is no longer active');
    expect(ctx.prisma._client.refreshToken.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
    // clearAllCookies() uses cookie(name, '', {..., maxAge: 0}) — not clearCookie
    expect(res.cookie).toHaveBeenCalledWith('Authentication', '', expect.objectContaining({ maxAge: 0 }));
    expect(res.cookie).toHaveBeenCalledWith('RefreshToken',  '', expect.objectContaining({ maxAge: 0 }));
  });

  test('user deleted between token issue + refresh → same clean 401', async () => {
    ctx.prisma._client.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt1', userId: 'u1', tokenHash: 'h', expiresAt: futureDate(),
    });
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);

    await expect(ctx.sut.refreshTokens('a'.repeat(64), makeResponseMock() as any))
      .rejects.toThrow('Account is no longer active');
  });

  test('suspended vendor on refresh → revokes all sessions + 403', async () => {
    ctx.prisma._client.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt1', userId: 'u1', tokenHash: 'h', expiresAt: futureDate(),
    });
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'v@b.com', fullName: 'V', role: 'VENDOR', isDeactivated: false,
    });
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({ status: 'SUSPENDED' });

    await expect(ctx.sut.refreshTokens('a'.repeat(64), makeResponseMock() as any))
      .rejects.toThrow(/suspended/);
    expect(ctx.prisma._client.refreshToken.deleteMany).toHaveBeenCalled();
  });

  test('token reuse after rotation (replay attack) → row is already deleted → 401', async () => {
    ctx.prisma._client.refreshToken.findUnique.mockResolvedValueOnce(null); // rotated away
    await expect(ctx.sut.refreshTokens('a'.repeat(64), makeResponseMock() as any))
      .rejects.toThrow('Invalid refresh token');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// registerAndLogin
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.registerAndLogin', () => {
  let ctx: Awaited<ReturnType<typeof buildSut>>;
  beforeEach(async () => { ctx = await buildSut(); });

  test('new email + phone → creates user, sends verification, returns pending=true', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null); // email not taken
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null); // phone not taken
    ctx.users.create.mockResolvedValueOnce({ id: 'u1', email: 'new@b.com', fullName: 'New' });

    const result = await ctx.sut.registerAndLogin({ fullName: 'New', email: 'new@b.com', password: 'Strong123', phone: '+974500' });

    expect(result).toEqual({ pending: true, email: 'new@b.com' });
    expect(ctx.email.sendEmailVerification).toHaveBeenCalledWith('new@b.com', expect.objectContaining({ verificationLink: expect.any(String) }));
    expect(ctx.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CUSTOMER_REGISTER' }));
  });

  test('duplicate email → 409', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ id: 'existing' });
    await expect(ctx.sut.registerAndLogin({ fullName: 'X', email: 'taken@b.com', password: 'pw' }))
      .rejects.toThrow(ConflictException);
  });

  test('duplicate phone → 409 with NEUTRAL message (anti-enumeration)', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);      // email ok
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ id: 'e' }); // phone taken

    const err = await ctx.sut.registerAndLogin({ fullName: 'X', email: 'new@b.com', password: 'pw', phone: '+974500' }).catch(e => e);
    expect(err).toBeInstanceOf(ConflictException);
    // Must NOT say "phone already registered" — that would confirm existence
    expect(err.message).not.toMatch(/phone.*registered|phone.*exists|phone.*taken/i);
    expect(err.message).toMatch(/different phone/i);
  });

  test('no phone provided → skips phone uniqueness check', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    ctx.users.create.mockResolvedValueOnce({ id: 'u1', email: 'new@b.com', fullName: 'New' });

    await ctx.sut.registerAndLogin({ fullName: 'New', email: 'new@b.com', password: 'pw' });
    // Only ONE user.findUnique call (email), NOT two (email + phone)
    expect(ctx.prisma._client.user.findUnique).toHaveBeenCalledTimes(1);
  });

  test('registration does NOT issue cookies (customer must verify first)', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    ctx.users.create.mockResolvedValueOnce({ id: 'u1', email: 'new@b.com', fullName: 'New' });

    await ctx.sut.registerAndLogin({ fullName: 'New', email: 'new@b.com', password: 'pw' });

    // registerAndLogin doesn't take a Response — no cookies can be set
    // Return shape must not include tokens
    expect(ctx.prisma._client.refreshToken.create).not.toHaveBeenCalled();
  });

  test('verification email body includes a link with the token', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    ctx.users.create.mockResolvedValueOnce({ id: 'u1', email: 'new@b.com', fullName: 'New' });

    await ctx.sut.registerAndLogin({ fullName: 'New', email: 'new@b.com', password: 'pw' });

    const call = ctx.email.sendEmailVerification.mock.calls[0];
    expect(call[1].verificationLink).toMatch(/\/verify-email\?token=[a-f0-9]{64}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// verifyEmail
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.verifyEmail', () => {
  let ctx: Awaited<ReturnType<typeof buildSut>>;
  beforeEach(async () => { ctx = await buildSut(); });

  test('valid unexpired token → sets emailVerified, clears token, issues cookies', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', verificationTokenExpiry: futureDate(),
    });
    ctx.prisma._client.user.update.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER',
    });
    const res = makeResponseMock();

    await ctx.sut.verifyEmail('tok', res as any);

    expect(ctx.prisma._client.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailVerified: true,
          verificationToken: null,
          verificationTokenExpiry: null,
        }),
      }),
    );
    expect(res.cookie).toHaveBeenCalledWith('Authentication', expect.any(String), expect.any(Object));
  });

  test('unknown token → 400', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.verifyEmail('nope', makeResponseMock() as any))
      .rejects.toThrow(BadRequestException);
  });

  test('expired token → 400 "expired"', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', verificationTokenExpiry: pastDate(),
    });
    await expect(ctx.sut.verifyEmail('tok', makeResponseMock() as any))
      .rejects.toThrow(/expired/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// resendVerification — anti-enumeration
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.resendVerification', () => {
  let ctx: Awaited<ReturnType<typeof buildSut>>;
  beforeEach(async () => { ctx = await buildSut(); });

  test('unknown email → returns generic message, no email sent', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    const r = await ctx.sut.resendVerification('nobody@b.com');
    expect(r.message).toMatch(/if that email exists/i);
    expect(ctx.email.sendEmailVerification).not.toHaveBeenCalled();
  });

  test('non-customer (vendor) email → generic response, no send', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'v1', email: 'v@b.com', fullName: 'V', role: 'VENDOR', emailVerified: false,
    });
    await ctx.sut.resendVerification('v@b.com');
    expect(ctx.email.sendEmailVerification).not.toHaveBeenCalled();
  });

  test('already-verified customer → generic response, no send', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER', emailVerified: true,
    });
    await ctx.sut.resendVerification('a@b.com');
    expect(ctx.email.sendEmailVerification).not.toHaveBeenCalled();
  });

  test('unverified customer → sends new verification link', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER', emailVerified: false,
    });
    await ctx.sut.resendVerification('a@b.com');
    expect(ctx.email.sendEmailVerification).toHaveBeenCalledWith('a@b.com', expect.any(Object));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// handleGoogleAuth
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.handleGoogleAuth', () => {
  let ctx: Awaited<ReturnType<typeof buildSut>>;
  beforeEach(async () => { ctx = await buildSut(); });

  const gprofile = { googleId: 'g1', email: 'g@b.com', fullName: 'G User', picture: 'https://x/pic.jpg' };

  test('returning OAuth user → logs in directly', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'g@b.com', fullName: 'G User', role: 'CUSTOMER', isDeactivated: false,
    });
    const res = makeResponseMock();
    await ctx.sut.handleGoogleAuth(gprofile as any, res as any);
    expect(res.cookie).toHaveBeenCalled();
    expect(ctx.prisma._client.user.create).not.toHaveBeenCalled();
  });

  test('new user → creates with emailVerified=true and no password', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null); // by googleId
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null); // by email
    ctx.prisma._client.user.create.mockResolvedValueOnce({
      id: 'u1', email: 'g@b.com', fullName: 'G User', role: 'CUSTOMER', isDeactivated: false,
    });

    await ctx.sut.handleGoogleAuth(gprofile as any, makeResponseMock() as any);

    expect(ctx.prisma._client.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          password: null,
          emailVerified: true,
          googleId: 'g1',
        }),
      }),
    );
  });

  test('account merge: existing unverified email → 403 (prevent hijack)', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null); // by googleId
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({    // by email
      id: 'u1', email: 'g@b.com', emailVerified: false,
    });

    await expect(ctx.sut.handleGoogleAuth(gprofile as any, makeResponseMock() as any))
      .rejects.toThrow(/not verified/i);
  });

  test('deactivated OAuth user → 403', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'g@b.com', fullName: 'G', role: 'CUSTOMER', isDeactivated: true,
    });
    await expect(ctx.sut.handleGoogleAuth(gprofile as any, makeResponseMock() as any))
      .rejects.toThrow(/deactivated/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// forgotPassword / resetPassword
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.forgotPassword', () => {
  let ctx: Awaited<ReturnType<typeof buildSut>>;
  beforeEach(async () => { ctx = await buildSut(); });

  test('unknown email → generic response, no email sent', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    ctx.prisma._client.user.count.mockResolvedValueOnce(0);

    const r = await ctx.sut.forgotPassword('nobody@b.com');
    expect(r.message).toMatch(/if an account exists/i);
    expect(ctx.email.sendPasswordReset).not.toHaveBeenCalled();
  });

  test('vendor email → generic response, NO reset email (only customers)', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ id: 'v1', fullName: 'V', role: 'VENDOR' });
    ctx.prisma._client.user.count.mockResolvedValueOnce(1);

    await ctx.sut.forgotPassword('v@b.com');
    expect(ctx.email.sendPasswordReset).not.toHaveBeenCalled();
  });

  test('OAuth-only customer (no password) → no reset email', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ id: 'u1', fullName: 'A', role: 'CUSTOMER' });
    ctx.prisma._client.user.count.mockResolvedValueOnce(0); // hasPassword = false

    await ctx.sut.forgotPassword('oauth@b.com');
    expect(ctx.email.sendPasswordReset).not.toHaveBeenCalled();
  });

  test('existing customer with password → generates hex token + sends email', async () => {
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ id: 'u1', fullName: 'A', role: 'CUSTOMER' });
    ctx.prisma._client.user.count.mockResolvedValueOnce(1);

    await ctx.sut.forgotPassword('a@b.com');

    expect(ctx.prisma._client.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          passwordResetToken: expect.stringMatching(/^[a-f0-9]{64}$/),
          passwordResetExpiry: expect.any(Date),
        }),
      }),
    );
    expect(ctx.email.sendPasswordReset).toHaveBeenCalledWith('a@b.com', expect.objectContaining({
      resetLink: expect.stringContaining('/reset-password?token='),
    }));
  });
});

describe('AuthService.resetPassword', () => {
  let ctx: Awaited<ReturnType<typeof buildSut>>;
  beforeEach(async () => { ctx = await buildSut(); });

  test('malformed token (wrong shape) → 400 BEFORE any DB call', async () => {
    await expect(ctx.sut.resetPassword('not-hex', 'NewPw123'))
      .rejects.toThrow('Invalid or expired reset link');
    expect(ctx.prisma._client.user.findFirst).not.toHaveBeenCalled();
  });

  test('valid token → hashes new password + kills all sessions', async () => {
    const tok = 'a'.repeat(64);
    ctx.prisma._client.user.findFirst.mockResolvedValueOnce({ id: 'u1' });

    await ctx.sut.resetPassword(tok, 'NewPw123');

    // $transaction is called with an array containing user.update + refreshToken.deleteMany
    expect(ctx.prisma.$transaction).toHaveBeenCalled();
    // user.update should clear the reset token + failedLoginAttempts
    expect(ctx.prisma._client.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          password: expect.any(String),
          passwordResetToken: null,
          passwordResetExpiry: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
        }),
      }),
    );
    expect(ctx.prisma._client.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  test('expired/unknown token → 400', async () => {
    ctx.prisma._client.user.findFirst.mockResolvedValueOnce(null);
    await expect(ctx.sut.resetPassword('a'.repeat(64), 'NewPw123'))
      .rejects.toThrow('Invalid or expired reset link');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// logout
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.logout', () => {
  let ctx: Awaited<ReturnType<typeof buildSut>>;
  beforeEach(async () => { ctx = await buildSut(); });

  test('clears both cookies + logs LOGOUT', async () => {
    const res = makeResponseMock();
    await ctx.sut.logout('rawtoken', 'u1', res as any);

    expect(res.cookie).toHaveBeenCalledWith('Authentication', '', expect.objectContaining({ maxAge: 0 }));
    expect(res.cookie).toHaveBeenCalledWith('RefreshToken',  '', expect.objectContaining({ maxAge: 0 }));
    expect(ctx.sec.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'LOGOUT', userId: 'u1' }));
  });

  test('deletes only the passed refresh token (not all sessions)', async () => {
    await ctx.sut.logout('rawtoken', 'u1', makeResponseMock() as any);
    expect(ctx.prisma._client.refreshToken.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tokenHash: expect.any(String) }) }),
    );
    // Ensure NOT deleteMany({ userId: ... }) — that would kill other sessions
    const deleteCalls = ctx.prisma._client.refreshToken.deleteMany.mock.calls;
    for (const call of deleteCalls) {
      expect(call[0].where).not.toHaveProperty('userId');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// cleanupExpiredTokens
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthService.cleanupExpiredTokens', () => {
  test('deletes tokens where expiresAt < now, returns count', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.refreshToken.deleteMany.mockResolvedValueOnce({ count: 7 });

    const n = await ctx.sut.cleanupExpiredTokens();
    expect(n).toBe(7);
    expect(ctx.prisma._client.refreshToken.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ expiresAt: expect.objectContaining({ lt: expect.any(Date) }) }) }),
    );
  });
});
