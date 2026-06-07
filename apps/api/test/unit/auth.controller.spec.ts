/**
 * AuthController + guards — thin delegation layer.
 *
 * Controllers in NestJS hold no business logic; tests verify:
 *   - each route delegates to the right service method with the right args
 *   - input-sanity guards (e.g. verify-email rejects non-64-hex before hitting
 *     the service)
 *   - cookie-driven flows (refresh, logout) pull from req.cookies
 *   - session endpoints block CUSTOMER role
 *   - RolesGuard + GoogleAuthGuard helper behaviour
 */

import { BadRequestException, ForbiddenException, UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { RolesGuard } from '../../src/auth/guards/roles.guard';
import { Reflector } from '@nestjs/core';
import { makePrismaMock } from '../mocks/prisma.mock';
import { makeConfigMock, makeResponseMock, makeRequestMock } from '../mocks/auth-deps.mock';

function makeAuthSvcMock() {
  return {
    registerAndLogin:   jest.fn().mockResolvedValue({ pending: true, email: 'a@b.com' }),
    registerVendor:     jest.fn().mockResolvedValue({ message: 'ok', email: 'v@b.com' }),
    loginWithCheck:     jest.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com', role: 'CUSTOMER' }),
    refreshTokens:      jest.fn().mockResolvedValue({ id: 'u1' }),
    logout:             jest.fn().mockResolvedValue(undefined),
    verifyEmail:        jest.fn().mockResolvedValue({ id: 'u1' }),
    resendVerification: jest.fn().mockResolvedValue({ message: 'ok' }),
    handleGoogleAuth:   jest.fn().mockResolvedValue({ id: 'u1', role: 'CUSTOMER' }),
    forgotPassword:     jest.fn().mockResolvedValue({ message: 'ok' }),
    resetPassword:      jest.fn().mockResolvedValue({ message: 'ok' }),
    changePassword:     jest.fn().mockResolvedValue({ message: 'Password changed successfully. Other sessions have been signed out.' }),
    getTokenHash:       jest.fn((t: string) => `hash(${t})`),
  };
}

async function buildCtrl() {
  const authSvc = makeAuthSvcMock();
  const prisma  = makePrismaMock();
  const config  = makeConfigMock();
  const mod = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      { provide: AuthService,    useValue: authSvc },
      { provide: PrismaService,  useValue: prisma },
      { provide: ConfigService,  useValue: config },
    ],
  }).compile();
  return { ctrl: mod.get(AuthController), authSvc, prisma, config };
}

// ═══════════════════════════════════════════════════════════════════════════
// AuthController — route delegation
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthController — delegation', () => {
  test('POST /auth/register → registerAndLogin with exact DTO + req (for per-IP quota)', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    const dto = { fullName: 'N', email: 'n@b.com', password: 'Pw123', phone: '+974500' };
    const req = makeRequestMock();
    await ctrl.register(dto as any, req as any);
    expect(authSvc.registerAndLogin).toHaveBeenCalledWith(dto, req);
  });

  test('POST /auth/register/vendor → registerVendor with DTO + req (for honeypot IP logging)', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    const dto = { email: 'v@b.com' } as any;
    const req = makeRequestMock();
    await ctrl.registerVendor(dto, req as any);
    expect(authSvc.registerVendor).toHaveBeenCalledWith(dto, req);
  });

  test('POST /auth/login → loginWithCheck(email, pw, response, req)', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    const res = makeResponseMock();
    const req = makeRequestMock();
    await ctrl.login({ email: 'a@b.com', password: 'pw' } as any, res as any, req as any);
    expect(authSvc.loginWithCheck).toHaveBeenCalledWith('a@b.com', 'pw', res, req);
  });

  test('POST /auth/refresh → 401 when no cookie', async () => {
    const { ctrl } = await buildCtrl();
    const req = makeRequestMock() as any;
    req.cookies = {};
    await expect(ctrl.refresh(req, makeResponseMock() as any))
      .rejects.toThrow(UnauthorizedException);
  });

  test('POST /auth/refresh → passes cookie token to service when present', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    const req = makeRequestMock() as any;
    req.cookies = { RefreshToken: 'rtoken' };
    await ctrl.refresh(req, makeResponseMock() as any);
    expect(authSvc.refreshTokens).toHaveBeenCalledWith('rtoken', expect.anything(), req);
  });

  test('POST /auth/logout → passes refresh cookie + user id, returns message', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    const req = makeRequestMock() as any;
    req.cookies = { RefreshToken: 'rtoken' };
    const r = await ctrl.logout({ id: 'u1' } as any, req, makeResponseMock() as any);
    expect(authSvc.logout).toHaveBeenCalledWith('rtoken', 'u1', expect.anything(), req);
    expect(r).toEqual({ message: 'Logged out successfully' });
  });

  test('POST /auth/logout without cookie still calls service (passes undefined)', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    const req = makeRequestMock() as any;
    req.cookies = {};
    await ctrl.logout({ id: 'u1' } as any, req, makeResponseMock() as any);
    expect(authSvc.logout).toHaveBeenCalledWith(undefined, 'u1', expect.anything(), req);
  });

  test('GET /auth/verify-email → 400 on malformed (non-64-hex) token BEFORE service call', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    await expect(ctrl.verifyEmail('too-short', makeResponseMock() as any, makeRequestMock() as any))
      .rejects.toThrow(BadRequestException);
    expect(authSvc.verifyEmail).not.toHaveBeenCalled();
  });

  test('GET /auth/verify-email → 400 when token is empty string', async () => {
    const { ctrl } = await buildCtrl();
    await expect(ctrl.verifyEmail('', makeResponseMock() as any, makeRequestMock() as any))
      .rejects.toThrow(BadRequestException);
  });

  test('GET /auth/verify-email → delegates to service on valid 64-hex', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    const token = 'a'.repeat(64);
    const res = makeResponseMock();
    const req = makeRequestMock();
    await ctrl.verifyEmail(token, res as any, req as any);
    expect(authSvc.verifyEmail).toHaveBeenCalledWith(token, res, req);
  });

  test('POST /auth/resend-verification → delegates email + req (for per-IP quota)', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    const req = makeRequestMock();
    await ctrl.resendVerification({ email: 'a@b.com' } as any, req as any);
    expect(authSvc.resendVerification).toHaveBeenCalledWith('a@b.com', req);
  });

  test('POST /auth/forgot-password → delegates email + req (for per-IP quota)', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    const req = makeRequestMock();
    await ctrl.forgotPassword({ email: 'a@b.com' } as any, req as any);
    expect(authSvc.forgotPassword).toHaveBeenCalledWith('a@b.com', req);
  });

  test('POST /auth/change-password → delegates user.id + currentPw + newPw + refreshToken + req', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    const req = makeRequestMock() as any;
    req.cookies = { RefreshToken: 'rtoken' };
    await ctrl.changePassword(
      { id: 'u1' } as any,
      { currentPassword: 'OldPw1!', newPassword: 'NewPw1!' } as any,
      req,
    );
    expect(authSvc.changePassword).toHaveBeenCalledWith('u1', 'OldPw1!', 'NewPw1!', 'rtoken', req);
  });

  test('POST /auth/change-password → forwards undefined refreshToken when cookie missing', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    const req = makeRequestMock() as any;
    req.cookies = {};
    await ctrl.changePassword(
      { id: 'u1' } as any,
      { currentPassword: 'OldPw1!', newPassword: 'NewPw1!' } as any,
      req,
    );
    expect(authSvc.changePassword).toHaveBeenCalledWith('u1', 'OldPw1!', 'NewPw1!', undefined, req);
  });

  test('POST /auth/reset-password → delegates token + newPassword', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    await ctrl.resetPassword({ token: 'a'.repeat(64), newPassword: 'NewPw123' } as any);
    expect(authSvc.resetPassword).toHaveBeenCalledWith('a'.repeat(64), 'NewPw123');
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// AuthController — sessions (vendor/admin only)
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthController — sessions (vendor/admin only)', () => {
  test('GET /auth/sessions → 403 for CUSTOMER', async () => {
    const { ctrl } = await buildCtrl();
    await expect(ctrl.getSessions({ id: 'u1', role: 'CUSTOMER' } as any, makeRequestMock() as any, {}))
      .rejects.toThrow(ForbiddenException);
  });

  test('GET /auth/sessions returns list with isCurrent flag for VENDOR', async () => {
    const { ctrl, prisma, authSvc } = await buildCtrl();
    prisma._client.refreshToken.findMany.mockResolvedValueOnce([
      { id: 's1', userAgent: 'UA-1', ipAddress: '1.2.3.4', createdAt: new Date(), lastUsedAt: new Date(), expiresAt: new Date(), tokenHash: 'hash(rtoken)' },
      { id: 's2', userAgent: 'UA-2', ipAddress: '5.6.7.8', createdAt: new Date(), lastUsedAt: new Date(), expiresAt: new Date(), tokenHash: 'other-hash' },
    ]);
    const req = makeRequestMock() as any;
    req.cookies = { RefreshToken: 'rtoken' };

    const r = await ctrl.getSessions({ id: 'u1', role: 'VENDOR' } as any, req, {});

    expect(authSvc.getTokenHash).toHaveBeenCalledWith('rtoken');
    expect(r).toHaveLength(2);
    expect(r[0].isCurrent).toBe(true);
    expect(r[1].isCurrent).toBe(false);
    // Never expose raw tokenHash
    expect(r[0]).not.toHaveProperty('tokenHash');
  });

  test('DELETE /auth/sessions/:id → 403 for CUSTOMER', async () => {
    const { ctrl } = await buildCtrl();
    await expect(ctrl.revokeSession({ id: 'u1', role: 'CUSTOMER' } as any, 's1'))
      .rejects.toThrow(ForbiddenException);
  });

  test('DELETE /auth/sessions/:id → 403 when session belongs to another user (IDOR)', async () => {
    const { ctrl, prisma } = await buildCtrl();
    prisma._client.refreshToken.findUnique.mockResolvedValueOnce({ userId: 'SOMEONE_ELSE' });
    await expect(ctrl.revokeSession({ id: 'u1', role: 'VENDOR' } as any, 's1'))
      .rejects.toThrow(ForbiddenException);
    // Crucially, no delete is issued
    expect(prisma._client.refreshToken.delete).not.toHaveBeenCalled();
  });

  test('DELETE /auth/sessions/:id → deletes and returns message when owned', async () => {
    const { ctrl, prisma } = await buildCtrl();
    prisma._client.refreshToken.findUnique.mockResolvedValueOnce({ userId: 'u1' });
    const r = await ctrl.revokeSession({ id: 'u1', role: 'VENDOR' } as any, 's1');
    expect(prisma._client.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    expect(r).toEqual({ message: 'Session revoked' });
  });

  test('DELETE /auth/sessions (revoke-all-others) excludes current-session hash', async () => {
    const { ctrl, prisma } = await buildCtrl();
    prisma._client.refreshToken.deleteMany.mockResolvedValueOnce({ count: 3 });
    const req = makeRequestMock() as any;
    req.cookies = { RefreshToken: 'rtoken' };

    const r = await ctrl.revokeAllOtherSessions({ id: 'u1', role: 'VENDOR' } as any, req);

    expect(prisma._client.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', tokenHash: { not: 'hash(rtoken)' } },
    });
    expect(r.message).toContain('3 session');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AuthController — Google OAuth callback
// ═══════════════════════════════════════════════════════════════════════════

// Anti-CSRF nonce shared by the callback tests: the guard sets this in a cookie
// at initiation and echoes it in `state`; the callback rejects unless they match.
const OAUTH_NONCE = 'test-oauth-nonce';
const noncedState = (callbackUrl?: string) =>
  Buffer.from(
    JSON.stringify(callbackUrl ? { callbackUrl, nonce: OAUTH_NONCE } : { nonce: OAUTH_NONCE }),
  ).toString('base64url');

describe('AuthController — Google OAuth callback', () => {
  test('ADMIN → redirects to /admin/dashboard', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    authSvc.handleGoogleAuth.mockResolvedValueOnce({ id: 'u1', role: 'ADMIN' });
    const res = makeResponseMock();
    const req = makeRequestMock() as any;
    req.user = { googleId: 'g1' };
    req.query = { state: noncedState() };
    req.cookies = { g_oauth_state: OAUTH_NONCE };

    await ctrl.googleCallback(req, res as any);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/admin/dashboard'));
  });

  test('VENDOR → redirects to /vendor/dashboard', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    authSvc.handleGoogleAuth.mockResolvedValueOnce({ id: 'u1', role: 'VENDOR' });
    const res = makeResponseMock();
    const req = makeRequestMock() as any;
    req.user = { googleId: 'g1' };
    req.query = { state: noncedState() };
    req.cookies = { g_oauth_state: OAUTH_NONCE };

    await ctrl.googleCallback(req, res as any);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('/vendor/dashboard'));
  });

  test('CUSTOMER with valid state.callbackUrl → redirects to callbackUrl', async () => {
    const { ctrl } = await buildCtrl();
    const res = makeResponseMock();
    const state = noncedState('/likes');
    const req = makeRequestMock() as any;
    req.user = {};
    req.query = { state };
    req.cookies = { g_oauth_state: OAUTH_NONCE };

    await ctrl.googleCallback(req, res as any);
    expect(res.redirect).toHaveBeenCalledWith(expect.stringMatching(/\/likes$/));
  });

  test('CUSTOMER with OPEN-REDIRECT callbackUrl (//evil) → falls back to /', async () => {
    const { ctrl } = await buildCtrl();
    const res = makeResponseMock();
    const state = noncedState('//evil.com');
    const req = makeRequestMock() as any;
    req.user = {};
    req.query = { state };
    req.cookies = { g_oauth_state: OAUTH_NONCE };

    await ctrl.googleCallback(req, res as any);
    const redirectUrl = res.redirect.mock.calls[0][0];
    expect(redirectUrl).not.toContain('evil.com');
    // Must end with / (frontend home)
    expect(redirectUrl).toMatch(/\/$/);
  });

  // Backslash bypass guard — Chrome/Firefox normalize `\` to `/` per WHATWG URL,
  // so `/\evil.com` could read as `//evil.com` (protocol-relative). The first-pass
  // sanitizer in google-auth.guard.ts already rejects this; the callback-side
  // re-validation below must mirror that defence (HIGH-01 audit finding 2026-05-07).
  test.each([
    ['/\\evil.com',          'starts with /\\\\'],
    ['/path\\evil.com',      'embedded backslash in middle'],
    ['/legit\\..\\evil.com', 'multiple backslashes'],
  ])('CUSTOMER with backslash callbackUrl (%s) → falls back to /', async (callbackUrl) => {
    const { ctrl } = await buildCtrl();
    const res = makeResponseMock();
    const state = noncedState(callbackUrl);
    const req = makeRequestMock() as any;
    req.user = {};
    req.query = { state };
    req.cookies = { g_oauth_state: OAUTH_NONCE };

    await ctrl.googleCallback(req, res as any);
    const redirectUrl = res.redirect.mock.calls[0][0];
    expect(redirectUrl).not.toContain('evil.com');
    expect(redirectUrl).not.toContain('\\');
    expect(redirectUrl).toMatch(/\/$/);
  });

  test('authService error → redirects to /login?error=oauth_failed (no message leak)', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    authSvc.handleGoogleAuth.mockRejectedValueOnce(new Error('Some internal error with stack'));
    const res = makeResponseMock();
    const req = makeRequestMock() as any;
    req.user = {};
    req.query = { state: noncedState() };
    req.cookies = { g_oauth_state: OAUTH_NONCE };

    await ctrl.googleCallback(req, res as any);
    const url = res.redirect.mock.calls[0][0];
    expect(url).toContain('/login?error=oauth_failed');
    expect(url).not.toContain('internal error');
  });

  test('deactivated error maps to code=deactivated (not oauth_failed)', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    authSvc.handleGoogleAuth.mockRejectedValueOnce(new Error('Your account has been deactivated'));
    const res = makeResponseMock();
    const req = makeRequestMock() as any;
    req.user = {};
    req.query = { state: noncedState() };
    req.cookies = { g_oauth_state: OAUTH_NONCE };

    await ctrl.googleCallback(req, res as any);
    expect(res.redirect.mock.calls[0][0]).toContain('error=deactivated');
  });

  test('mismatched state nonce vs cookie → oauth_failed, no session minted (login-CSRF guard)', async () => {
    const { ctrl, authSvc } = await buildCtrl();
    const res = makeResponseMock();
    const req = makeRequestMock() as any;
    req.user = { googleId: 'g1' };
    // State carries the attacker's nonce; the browser cookie carries a different one.
    req.query = { state: Buffer.from(JSON.stringify({ callbackUrl: '/', nonce: 'attacker' })).toString('base64url') };
    req.cookies = { g_oauth_state: OAUTH_NONCE };

    await ctrl.googleCallback(req, res as any);
    expect(res.redirect.mock.calls[0][0]).toContain('/login?error=oauth_failed');
    expect(authSvc.handleGoogleAuth).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AuthController — profile (GET /me)
// ═══════════════════════════════════════════════════════════════════════════

describe('AuthController.getProfile', () => {
  test('401 when user disappears between token issue and /me call', async () => {
    const { ctrl, prisma } = await buildCtrl();
    prisma._client.user.findUnique.mockResolvedValueOnce(null);
    await expect(ctrl.getProfile({ id: 'u1', role: 'CUSTOMER' } as any))
      .rejects.toThrow(UnauthorizedException);
  });

  test('CUSTOMER → returns user row only (no vendor block)', async () => {
    const { ctrl, prisma } = await buildCtrl();
    prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'a@b.com', fullName: 'A', role: 'CUSTOMER', phone: '+974',
    });
    const r = await ctrl.getProfile({ id: 'u1', role: 'CUSTOMER' } as any);
    expect(r).not.toHaveProperty('vendor');
  });

  test('VENDOR → returns user row + vendor sub-object', async () => {
    const { ctrl, prisma } = await buildCtrl();
    prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', email: 'v@b.com', fullName: 'V', role: 'VENDOR', phone: '+974',
    });
    prisma._client.vendor.findUnique.mockResolvedValueOnce({
      id: 'ven1', businessNameEn: 'Biz', businessNameAr: 'بز', slug: 'biz', status: 'APPROVED', countryId: 'QA',
    });
    const r = await ctrl.getProfile({ id: 'u1', role: 'VENDOR' } as any) as any;
    expect(r.vendor?.slug).toBe('biz');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RolesGuard
// ═══════════════════════════════════════════════════════════════════════════

describe('RolesGuard', () => {
  function makeCtx(user: { role: string } | null, requiredRoles: string[] | null): ExecutionContext {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(requiredRoles as any);
    const ctx = {
      getHandler: () => ({}),
      getClass:   () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
    return { ctx, reflector } as any;
  }

  test('allows when no @Roles() metadata on handler', () => {
    const { ctx, reflector } = makeCtx({ role: 'CUSTOMER' }, null) as any;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  test('allows when user role matches one required', () => {
    const { ctx, reflector } = makeCtx({ role: 'ADMIN' }, ['ADMIN', 'VENDOR']) as any;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  test('blocks when user role is not in required list', () => {
    const { ctx, reflector } = makeCtx({ role: 'CUSTOMER' }, ['ADMIN']) as any;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(ctx)).toBe(false);
  });
});
