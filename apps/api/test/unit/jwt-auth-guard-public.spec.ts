import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../../src/auth/decorators/public.decorator';

/**
 * Unit tests for the new @Public() escape hatch on the globally-registered
 * JwtAuthGuard. The guard is registered as APP_GUARD in app.module.ts so
 * every request runs through it by default; @Public() opts out for routes
 * that must remain unauthenticated (auth, catalog browsing, webhooks,
 * health probes, etc.).
 *
 * These tests pin the metadata-reading logic. The deeper Passport JWT
 * behavior (super.canActivate) is delegated to passport-jwt and exercised
 * by the existing auth + booking integration tests against real cookies.
 */
function makeContext(handlerMeta: unknown, classMeta: unknown): ExecutionContext {
  const handler = () => undefined;
  const cls = class {};
  Reflect.defineMetadata(IS_PUBLIC_KEY, handlerMeta, handler);
  Reflect.defineMetadata(IS_PUBLIC_KEY, classMeta, cls);
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, cookies: {} }),
      getResponse: () => ({}),
    }),
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard — @Public() opt-out', () => {
  let reflector: Reflector;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  test('method-level @Public() short-circuits and returns true (no JWT check)', () => {
    const ctx = makeContext(true, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  test('class-level @Public() also short-circuits (covers every method in the class)', () => {
    const ctx = makeContext(undefined, true);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  test('method-level @Public(true) wins even if class has no metadata', () => {
    const ctx = makeContext(true, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  // NOTE: the "no metadata → delegates to super.canActivate" path is
  // exercised by every authenticated integration test in the suite — they
  // all hit endpoints without @Public() and rely on the JWT cookie. If
  // the delegation broke, the integration suite would go red.

  test('metadata key is the literal string "isPublic" (regression guard)', () => {
    // If anyone renames IS_PUBLIC_KEY in the decorator without updating
    // the guard, this test breaks. Catches the silent skew.
    expect(IS_PUBLIC_KEY).toBe('isPublic');
  });
});
