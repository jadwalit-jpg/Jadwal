/**
 * @IsNotReservedSlug() — class-validator decorator that rejects vendor URL
 * slugs colliding with a reserved system path (admin, login, api, …).
 *
 * Why we need it:
 *
 *   The vendor `slug` is the public URL name (e.g. /vendor/<slug>). Without
 *   this check an untaken word like `admin` passes the format regex and the
 *   auto-suffix collision resolver in auth.service.registerVendor (which only
 *   dedupes against *existing* vendors), letting a vendor squat a name that
 *   looks like — or could later shadow — a first-party route.
 *
 * Where it's applied:
 *
 *   ONLY on the slug field of RegisterVendorDto. Returns a normal 400
 *   validation error alongside the format/length checks — never a 500.
 *
 * Maintenance:
 *
 *   RESERVED_SLUGS is the single source of truth. Add a word here when a new
 *   top-level route (see apps/web/src/app) or system path is introduced.
 *   Matching is case-insensitive and trimmed.
 */
import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

/**
 * Reserved words a vendor slug may not equal. Covers the required system
 * paths plus the current top-level Next.js app-router segments and common
 * auth/infra aliases. Kept lowercase; the constraint lower-cases + trims
 * input before comparing.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // Explicitly required
  'admin', 'login', 'register', 'api', 'dashboard', 'profile', 'settings',
  'checkout', 'vendor', 'users',
  // Current top-level app-router routes (apps/web/src/app)
  'about', 'account', 'activity', 'blog', 'bookings', 'contact', 'explore',
  'forgot-password', 'health', 'likes', 'maintenance', 'notifications',
  'offers', 'payment', 'privacy', 'redsea', 'reset-password', 'terms',
  'verify-email',
  // Common auth / infra aliases and reserved system names
  'auth', 'signin', 'signup', 'logout', 'user', 'home', 'index', 'root',
  'static', 'assets', 'public', 'sitemap', 'robots', 'www',
]);

@ValidatorConstraint({ name: 'isNotReservedSlug', async: false })
export class IsNotReservedSlugConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return !RESERVED_SLUGS.has(value.trim().toLowerCase());
  }

  defaultMessage(): string {
    return 'This URL name is reserved, please choose another';
  }
}

export function IsNotReservedSlug(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsNotReservedSlugConstraint,
    });
  };
}
