/**
 * Clarity records SESSION REPLAYS, so `isClarityAllowedPath` is a privacy
 * control, not a preference: every route it wrongly returns `true` for is a
 * screen whose contents get uploaded to Microsoft. The money path and anything
 * showing a signed-in customer's own data must stay out.
 *
 * These assert BOTH directions deliberately. Checking only that the blocked
 * routes are blocked would still pass if the function returned `false` for
 * everything — which would silently disable Clarity site-wide and look like it
 * was simply never installed.
 */
import { isClarityAllowedPath } from '@/lib/clarity';

describe('isClarityAllowedPath — routes Clarity must NEVER record', () => {
  test.each([
    ['checkout', '/activity/dhow-cruise/book'],
    ['checkout with trailing segment', '/activity/dhow-cruise/book/confirm'],
    ['payment callback', '/payment/callback'],
    ['payment root', '/payment'],
    ['admin dashboard', '/admin'],
    ['admin nested', '/admin/bookings/123'],
    ['vendor dashboard', '/vendor/acme/earnings'],
    ['customer profile', '/profile'],
    ['customer bookings', '/bookings/abc-123'],
    ['likes', '/likes'],
    ['login', '/login'],
    ['register', '/register'],
    ['vendor register', '/register/vendor'],
    ['forgot password', '/forgot-password'],
    ['reset password', '/reset-password'],
    ['verify email', '/verify-email'],
  ])('blocks %s', (_label, path) => {
    expect(isClarityAllowedPath(path)).toBe(false);
  });

  test('blocks a null pathname rather than defaulting to recording', () => {
    expect(isClarityAllowedPath(null)).toBe(false);
  });
});

describe('isClarityAllowedPath — public pages Clarity SHOULD record', () => {
  test.each([
    ['home', '/'],
    ['explore', '/explore'],
    ['offers', '/offers'],
    ['activity detail', '/activity/dhow-cruise'],
    ['about', '/about'],
    ['contact', '/contact'],
    ['terms', '/terms'],
    ['privacy', '/privacy'],
  ])('allows %s', (_label, path) => {
    expect(isClarityAllowedPath(path)).toBe(true);
  });
});

describe('isClarityAllowedPath — prefix matching is not over-broad', () => {
  // The blocklist is regex-based; a sloppy pattern would take unrelated routes
  // with it. `/bookings` is blocked but an activity slug merely CONTAINING the
  // word must still be recordable, or we lose analytics on real listings.
  test.each([
    ['activity slug containing "book"', '/activity/booking-a-yacht'],
    ['activity slug containing "payment"', '/activity/payment-plan-tour'],
    ['activity slug containing "login"', '/activity/login-valley-hike'],
  ])('allows %s', (_label, path) => {
    expect(isClarityAllowedPath(path)).toBe(true);
  });

  test('blocks the real /bookings list but allows an activity named similarly', () => {
    expect(isClarityAllowedPath('/bookings')).toBe(false);
    expect(isClarityAllowedPath('/activity/bookings-made-easy')).toBe(true);
  });
});
