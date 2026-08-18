/**
 * Reserved-slug validator (KAN-4). A vendor must not be able to register a URL
 * slug that collides with a system path (admin, login, api, …). Functional lock
 * so a silent removal/weakening of the denylist fails a unit test.
 */
import { IsNotReservedSlugConstraint, RESERVED_SLUGS } from '../../src/common/validators/reserved-slug';

describe('reserved-slug validator (KAN-4)', () => {
  const c = new IsNotReservedSlugConstraint();

  test('rejects the required reserved system slugs', () => {
    for (const s of ['admin', 'login', 'register', 'api', 'dashboard', 'profile', 'settings', 'checkout', 'vendor', 'users']) {
      expect(c.validate(s)).toBe(false);
    }
  });

  test('is case-insensitive and trims whitespace', () => {
    expect(c.validate('ADMIN')).toBe(false);
    expect(c.validate('  Admin  ')).toBe(false);
    expect(c.validate('Api')).toBe(false);
  });

  test('allows a normal vendor slug', () => {
    expect(c.validate('desert-safari-co')).toBe(true);
    expect(c.validate('my-shop-123')).toBe(true);
    expect(c.validate('al-bahar-tours')).toBe(true);
  });

  test('non-string input is rejected (defensive)', () => {
    expect(c.validate(undefined)).toBe(false);
    expect(c.validate(42)).toBe(false);
  });

  test('RESERVED_SLUGS is the single source of truth and covers the required set', () => {
    for (const s of ['admin', 'login', 'register', 'api', 'dashboard', 'profile', 'settings', 'checkout', 'vendor', 'users']) {
      expect(RESERVED_SLUGS.has(s)).toBe(true);
    }
  });
});
