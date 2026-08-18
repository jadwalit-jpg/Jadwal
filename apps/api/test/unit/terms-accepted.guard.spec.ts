import { ForbiddenException } from '@nestjs/common';
import { TermsAcceptedGuard } from '../../src/auth/guards/terms-accepted.guard';
import { TERMS_VERSION } from '../../src/common/terms';

/**
 * The server-side anti-bypass behind the post-login consent gate. These prove a
 * user who hasn't accepted the CURRENT Terms cannot pass the guard that fronts
 * booking-create / payment-initiate / vendor-listing-create.
 */
function ctxFor(userId: string | undefined) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: userId ? { id: userId } : undefined }) }),
  } as any;
}
function guardReturning(user: unknown) {
  const findUnique = jest.fn().mockResolvedValue(user);
  const prisma = { client: { user: { findUnique } } } as any;
  return { guard: new TermsAcceptedGuard(prisma), findUnique };
}

describe('TermsAcceptedGuard', () => {
  it('ALLOWS when the user accepted the current TERMS_VERSION', async () => {
    const { guard } = guardReturning({ termsAcceptedAt: new Date(), termsAcceptedVersion: TERMS_VERSION });
    await expect(guard.canActivate(ctxFor('u1'))).resolves.toBe(true);
  });

  it('BLOCKS (403) when the user never accepted', async () => {
    const { guard } = guardReturning({ termsAcceptedAt: null, termsAcceptedVersion: null });
    await expect(guard.canActivate(ctxFor('u1'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('BLOCKS (403) when only an OLDER version was accepted (version bump)', async () => {
    const { guard } = guardReturning({ termsAcceptedAt: new Date(), termsAcceptedVersion: '2000-01-01' });
    await expect(guard.canActivate(ctxFor('u1'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('BLOCKS (403) fail-closed when unauthenticated (no req.user) and never hits the DB', async () => {
    const { guard, findUnique } = guardReturning(null);
    await expect(guard.canActivate(ctxFor(undefined))).rejects.toBeInstanceOf(ForbiddenException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('ALLOWS an ADMIN even with no consent recorded, and never hits the DB', async () => {
    // Admins are trusted operators and form no customer contract — the guard
    // must never block them regardless of termsAcceptedAt.
    const { guard, findUnique } = guardReturning({ termsAcceptedAt: null, termsAcceptedVersion: null });
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'admin1', role: 'ADMIN' } }) }),
    } as any;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
