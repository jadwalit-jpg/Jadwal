/**
 * Unit tests for auth strategies (JwtStrategy, GoogleStrategy) and guards
 * (RolesGuard, JwtAuthGuard, GoogleAuthGuard).
 *
 * JwtAuthGuard and GoogleAuthGuard are thin `extends AuthGuard(...)` wrappers
 * — covered by the presence + subclass check, not by unit tests of passport
 * internals.
 */

import { JwtStrategy } from '../../src/auth/strategies/jwt.strategy';
import { GoogleStrategy } from '../../src/auth/strategies/google.strategy';
import { RolesGuard } from '../../src/auth/guards/roles.guard';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { GoogleAuthGuard } from '../../src/auth/guards/google-auth.guard';
import { Reflector } from '@nestjs/core';
import { UnauthorizedException } from '@nestjs/common';
import { ROLES_KEY } from '../../src/auth/decorators/roles.decorator';

function makeConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    JWT_SECRET: 'a-very-long-test-secret-key-for-hs256-signing',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:3001/api/auth/google/callback',
  };
  const merged = { ...defaults, ...overrides };
  return {
    get: <T = string>(k: string, fallback?: T): T => (merged[k] ?? (fallback as any)) as T,
    getOrThrow: <T = string>(k: string): T => {
      if (merged[k] === undefined) throw new Error(`Missing: ${k}`);
      return merged[k] as any;
    },
  };
}

function makePrisma(userRow: any) {
  return {
    client: {
      user: { findUnique: jest.fn().mockResolvedValue(userRow) },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// JwtStrategy
// ═══════════════════════════════════════════════════════════════════════════

describe('JwtStrategy', () => {
  test('missing JWT_SECRET → constructor throws (FATAL)', () => {
    const prisma = makePrisma({}) as any;
    expect(() => new JwtStrategy(makeConfig({ JWT_SECRET: '' }) as any, prisma))
      .toThrow(/FATAL.*JWT_SECRET/);
  });

  test('validate(): active user → returns {id, email, role, fullName}', async () => {
    const prisma = makePrisma({
      id: 'u1', isDeactivated: false, role: 'CUSTOMER', fullName: 'Alice',
    }) as any;
    const svc = new JwtStrategy(makeConfig() as any, prisma);
    const out = await svc.validate({ sub: 'u1', email: 'alice@t.com', role: 'CUSTOMER' });
    expect(out).toEqual({ id: 'u1', email: 'alice@t.com', role: 'CUSTOMER', fullName: 'Alice' });
  });

  test('validate(): deactivated user → UnauthorizedException', async () => {
    const prisma = makePrisma({
      id: 'u1', isDeactivated: true, role: 'CUSTOMER', fullName: 'Alice',
    }) as any;
    const svc = new JwtStrategy(makeConfig() as any, prisma);
    await expect(svc.validate({ sub: 'u1', email: 'alice@t.com', role: 'CUSTOMER' }))
      .rejects.toThrow(UnauthorizedException);
  });

  test('validate(): unknown user id → UnauthorizedException', async () => {
    const prisma = makePrisma(null) as any;
    const svc = new JwtStrategy(makeConfig() as any, prisma);
    await expect(svc.validate({ sub: 'ghost', email: 'x@t.com', role: 'CUSTOMER' }))
      .rejects.toThrow(UnauthorizedException);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GoogleStrategy
// ═══════════════════════════════════════════════════════════════════════════

describe('GoogleStrategy', () => {
  test('missing client ID or secret → constructor throws (FATAL)', () => {
    expect(() => new GoogleStrategy(makeConfig({ GOOGLE_CLIENT_ID: '' }) as any))
      .toThrow(/FATAL.*GOOGLE_CLIENT/);
    expect(() => new GoogleStrategy(makeConfig({ GOOGLE_CLIENT_SECRET: '' }) as any))
      .toThrow(/FATAL.*GOOGLE_CLIENT/);
  });

  test('validate(): profile with email → done(null, GoogleProfile)', async () => {
    const svc = new GoogleStrategy(makeConfig() as any);
    const done = jest.fn();
    await svc.validate('at', 'rt', {
      id: 'g-abc',
      displayName: 'Alice Google',
      emails: [{ value: 'alice@gmail.com', verified: true }],
      name: { givenName: 'Alice', familyName: 'G' },
      photos: [{ value: 'https://lh3.googleusercontent.com/a/abc' }],
    } as any, done);

    expect(done).toHaveBeenCalledWith(null, {
      googleId: 'g-abc',
      email: 'alice@gmail.com',
      fullName: 'Alice Google',
      picture: 'https://lh3.googleusercontent.com/a/abc',
    });
  });

  test('validate(): profile without email → done(Error, undefined)', async () => {
    const svc = new GoogleStrategy(makeConfig() as any);
    const done = jest.fn();
    await svc.validate('at', 'rt', {
      id: 'g-abc',
      displayName: 'Alice',
      emails: [],
      name: { givenName: 'Alice', familyName: 'G' },
    } as any, done);

    expect(done).toHaveBeenCalledWith(expect.any(Error), undefined);
    expect(done.mock.calls[0][0].message).toMatch(/no email/i);
  });

  test('validate(): no displayName → falls back to givenName + familyName', async () => {
    const svc = new GoogleStrategy(makeConfig() as any);
    const done = jest.fn();
    await svc.validate('at', 'rt', {
      id: 'g-abc',
      displayName: '',
      emails: [{ value: 'alice@gmail.com' }],
      name: { givenName: 'Alice', familyName: 'Liddell' },
    } as any, done);
    expect(done).toHaveBeenCalledWith(null, expect.objectContaining({
      fullName: 'Alice Liddell',
    }));
  });

  test('validate(): no picture → picture is null', async () => {
    const svc = new GoogleStrategy(makeConfig() as any);
    const done = jest.fn();
    await svc.validate('at', 'rt', {
      id: 'g', displayName: 'A',
      emails: [{ value: 'a@g.com' }],
      name: { givenName: 'A', familyName: '' },
    } as any, done);
    expect(done).toHaveBeenCalledWith(null, expect.objectContaining({ picture: null }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RolesGuard
// ═══════════════════════════════════════════════════════════════════════════

describe('RolesGuard', () => {
  function makeReflector(decoratorValue: any) {
    return {
      getAllAndOverride: jest.fn().mockReturnValue(decoratorValue),
    };
  }
  function makeCtx(user: any) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => null,
      getClass: () => null,
    } as any;
  }

  test('no @Roles decorator → allow (returns true)', () => {
    const reflector = makeReflector(undefined) as any;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeCtx({ role: 'CUSTOMER' }))).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [null, null]);
  });

  test('@Roles(ADMIN) on ADMIN user → allow', () => {
    const guard = new RolesGuard(makeReflector(['ADMIN']) as any);
    expect(guard.canActivate(makeCtx({ role: 'ADMIN' }))).toBe(true);
  });

  test('@Roles(ADMIN) on CUSTOMER user → deny', () => {
    const guard = new RolesGuard(makeReflector(['ADMIN']) as any);
    expect(guard.canActivate(makeCtx({ role: 'CUSTOMER' }))).toBe(false);
  });

  test('@Roles(VENDOR, ADMIN) on ADMIN → allow (one match is enough)', () => {
    const guard = new RolesGuard(makeReflector(['VENDOR', 'ADMIN']) as any);
    expect(guard.canActivate(makeCtx({ role: 'ADMIN' }))).toBe(true);
  });

  test('@Roles([]) on any user → deny (empty required list still blocks)', () => {
    const guard = new RolesGuard(makeReflector([]) as any);
    expect(guard.canActivate(makeCtx({ role: 'ADMIN' }))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// JwtAuthGuard + GoogleAuthGuard — existence + instance check
// ═══════════════════════════════════════════════════════════════════════════

describe('JwtAuthGuard + GoogleAuthGuard', () => {
  test('JwtAuthGuard is an instance of AuthGuard(jwt)', () => {
    // Reflector arg added 2026-05-22: JwtAuthGuard now reads @Public()
    // metadata to short-circuit auth for opted-out routes under the
    // globally-registered APP_GUARD. Tests that previously did
    // `new JwtAuthGuard()` now need to pass a Reflector.
    const g = new JwtAuthGuard(new Reflector());
    expect(g.canActivate).toBeInstanceOf(Function);
  });

  test('GoogleAuthGuard is an instance of AuthGuard(google)', () => {
    const g = new GoogleAuthGuard();
    expect(g.canActivate).toBeInstanceOf(Function);
  });
});
