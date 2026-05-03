/**
 * @IsNotDisposableEmail() — class-validator decorator that rejects email
 * addresses on known disposable / temporary-mail domains (mailinator,
 * tempmail, 10minutemail, guerrillamail, etc.).
 *
 * Why we need it (signup spam defence):
 *
 *   The per-IP @Throttle(STRICT) on /auth/register caps a single IP at
 *   3 signups/min. EmailQuotaService caps verification emails per
 *   recipient and per IP. But a determined attacker can still pump
 *   3 signups/min × ~thousand disposable inboxes — pollution lands in
 *   the User table (orphan unverified rows), and even if the verification
 *   email is quota-capped, the row still exists and can skew metrics.
 *
 *   This decorator stops the cheap-attack version (anyone using a free
 *   tempmail UI) at DTO validation. Sophisticated attackers can still
 *   hand-roll an MX-receiving inbox; that's an order of magnitude harder
 *   and a smaller threat surface.
 *
 * Library:
 *
 *   `disposable-email-domains` — data-only npm package, MIT licensed,
 *   ~3K domains, weekly community updates. Loaded once at module init
 *   and held as a Set<string> for O(1) lookup. No runtime deps, no
 *   network calls.
 *
 * Where it's applied:
 *
 *   ONLY on the email field of RegisterDto and RegisterVendorDto. Do NOT
 *   apply on /auth/forgot-password or /auth/resend-verification — those
 *   endpoints accept any email shape so the response stays identical for
 *   known/unknown addresses (anti-enumeration). A disposable check here
 *   would side-channel "this domain shape is acceptable, just not
 *   registered" to an attacker.
 *
 * False positives + escape hatch:
 *
 *   The list catches some addresses real users care about (Fastmail
 *   aliases, SimpleLogin, etc.). The `EMAIL_DOMAIN_ALLOWLIST` env var
 *   (comma-separated) overrides the blocklist for support escalations
 *   without redeploying the validator.
 */
import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import disposableDomains from 'disposable-email-domains';

const blocklist = new Set<string>(disposableDomains as string[]);

function loadAllowlistFromEnv(): Set<string> {
  const raw = process.env.EMAIL_DOMAIN_ALLOWLIST;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

// Cache the allowlist at first read; re-read once per process lifetime is fine
// because env vars don't change at runtime under ECS.
let allowlistCache: Set<string> | null = null;
function getAllowlist(): Set<string> {
  if (allowlistCache === null) allowlistCache = loadAllowlistFromEnv();
  return allowlistCache;
}

@ValidatorConstraint({ name: 'isNotDisposableEmail', async: false })
export class IsNotDisposableEmailConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const at = value.lastIndexOf('@');
    if (at < 0 || at === value.length - 1) return false;
    const domain = value.slice(at + 1).trim().toLowerCase();
    if (domain.length === 0) return false;

    // Allowlist always wins — operator override for legit Fastmail/SimpleLogin
    // edge cases without needing a code change.
    if (getAllowlist().has(domain)) return true;

    return !blocklist.has(domain);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'Please use a permanent email address';
  }
}

export function IsNotDisposableEmail(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsNotDisposableEmailConstraint,
    });
  };
}
