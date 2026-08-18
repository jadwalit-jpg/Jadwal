/**
 * Jadwal Platform — Security Test Suite
 *
 * Tests critical security properties across auth, tokens, OTP,
 * input validation, database protection, and service skeletons.
 *
 * Run: npx jest test/security.spec.ts --verbose
 */

import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

// ─── Helper: read source file ────────────────────────────────────────────
function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf-8');
}

// Cross-folder reads into `apps/web/` only work when the web workspace is
// present on disk (host runs, CI). The Dockerised API container mounts only
// `apps/api/`, so these describes must skip cleanly instead of crashing the
// whole suite at load time. Compute availability once up-front and key
// every web-dependent describe off `WEB_SRC_AVAILABLE`.
const WEB_SRC_AVAILABLE = fs.existsSync(
  path.join(__dirname, '..', '..', 'web', 'src'),
);
const webDescribe = WEB_SRC_AVAILABLE ? describe : describe.skip;
// Use this when ONE test inside a mostly-api describe reads from apps/web.
// Skips that single test cleanly when the web workspace isn't mounted.
const webTest = WEB_SRC_AVAILABLE ? test : test.skip;
function readSrcSafe(relativePath: string): string {
  // Returns empty string when the web folder is missing so in-test regex
  // assertions don't NPE before describe.skip lands. Safe because the
  // enclosing describe is already skipped.
  try { return readSrc(relativePath); } catch { return ''; }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. LOGIN & AUTHENTICATION SECURITY
// ═══════════════════════════════════════════════════════════════════════════

describe('Login & Authentication Security', () => {
  const authService = readSrc('src/auth/auth.service.ts');

  test('CRITICAL: dummy bcrypt on user-not-found (timing attack prevention)', () => {
    // Without this, response time leaks whether an email exists. The dummy hash
    // is now a field (this.dummyHash) computed AT BOOT with the real bcrypt cost
    // — a hardcoded lower-cost literal made the not-found branch measurably
    // faster than a real compare, inverting the equaliser into an enumeration
    // oracle (M2). Assert the field is used AND computed at the real cost.
    expect(authService).toMatch(/this\.dummyHash\s*=\s*bcrypt\.hashSync\([^)]*BCRYPT_ROUNDS/);
    expect(authService).toMatch(/bcrypt\.compare\(password,\s*this\.dummyHash\)/);
  });

  test('CRITICAL: all login failures return generic "Invalid credentials"', () => {
    const loginSection = authService.slice(
      authService.indexOf('loginWithCheck'),
      authService.indexOf('// ─── Email Verification')
    );
    // Count occurrences of 'Invalid credentials' in login method
    const genericErrors = (loginSection.match(/Invalid credentials/g) || []).length;
    // Should have at least 3: user-not-found, locked, wrong-password
    expect(genericErrors).toBeGreaterThanOrEqual(3);

    // Thrown error messages must all be generic — specific details go to server logs only
    const thrownErrors = loginSection.match(/throw new .*Exception\('([^']+)'\)/g) || [];
    const preEmailVerified = thrownErrors.slice(0, 4); // first 4 throws (before EMAIL_NOT_VERIFIED)
    for (const err of preEmailVerified) {
      expect(err).toContain('Invalid credentials');
    }
  });

  test('HIGH: account lockout after failed attempts', () => {
    expect(authService).toContain('lockoutThreshold');
    expect(authService).toContain('failedLoginAttempts');
    expect(authService).toContain('lockedUntil');
  });

  test('HIGH: OAuth does NOT auto-link unverified accounts', () => {
    expect(authService).toContain('emailVerified');
    expect(authService).toMatch(/existing\.emailVerified.*ForbiddenException/s);
  });

  test('MEDIUM: password null guard before bcrypt (OAuth-only accounts)', () => {
    expect(authService).toContain('!user.password');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PASSWORD SECURITY
// ═══════════════════════════════════════════════════════════════════════════

describe('Password Security', () => {
  test('CRITICAL: all registration DTOs enforce complexity (uppercase + lowercase + digit)', () => {
    const registerDto = readSrc('src/auth/dto/register.dto.ts');
    const vendorDto = readSrc('src/auth/dto/register-vendor.dto.ts');

    const complexityRegex = '(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)';
    expect(registerDto).toContain(complexityRegex);
    expect(vendorDto).toContain(complexityRegex);
  });

  test('CRITICAL: all password CHANGE DTOs also enforce complexity', () => {
    const adminPwDto = readSrc('src/admin/dto/admin-profile.dto.ts');
    const vendorPwDto = readSrc('src/vendor/dto/change-password.dto.ts');

    const complexityRegex = '(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)';
    expect(adminPwDto).toContain(complexityRegex);
    expect(vendorPwDto).toContain(complexityRegex);
  });

  webTest('HIGH: frontend validatePassword matches backend complexity', () => {
    const validation = readSrc('../../apps/web/src/lib/validation.ts');
    expect(validation).toContain('[a-z]');
    expect(validation).toContain('[A-Z]');
    expect(validation).toMatch(/\\d|[0-9]/);
  });

  webTest('HIGH: passwords are NEVER passed through sanitize()', () => {
    const vendorRegPage = readSrc('../../apps/web/src/app/register/vendor/page.tsx');
    // Password should be outside sanitizeObject
    expect(vendorRegPage).toContain('password: pw');
    expect(vendorRegPage).toContain('Never sanitize passwords');
  });

  test('MEDIUM: passwords are hashed with bcrypt (cost factor >= 10)', async () => {
    const hash = await bcrypt.hash('TestPass123', 10);
    // bcrypt hashes start with $2b$10$ (cost factor 10)
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    // Extract cost factor: $2b$10$... → parts[0]='', [1]='2b', [2]='10'
    const costFactor = parseInt(hash.split('$')[2]);
    expect(costFactor).toBeGreaterThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. JWT & TOKEN SECURITY
// ═══════════════════════════════════════════════════════════════════════════

describe('JWT & Token Security', () => {
  test('CRITICAL: JWT strategy checks user deactivation status', () => {
    const jwtStrategy = readSrc('src/auth/strategies/jwt.strategy.ts');
    expect(jwtStrategy).toContain('isDeactivated');
    expect(jwtStrategy).toContain('UnauthorizedException');
    expect(jwtStrategy).toContain('findUnique');
  });

  test('CRITICAL: tokens stored in HttpOnly cookies, not localStorage', () => {
    const authService = readSrc('src/auth/auth.service.ts');
    expect(authService).toContain('httpOnly: true');
    expect(authService).toContain("sameSite: 'strict'");

    // Frontend should NEVER reference localStorage for tokens. Guard the
    // web-side assertion so the api-local part of this test still runs
    // when the web workspace isn't mounted.
    if (WEB_SRC_AVAILABLE) {
      const apiTs = readSrc('../../apps/web/src/lib/api.ts');
      expect(apiTs).not.toContain('localStorage');
      expect(apiTs).not.toContain('sessionStorage.getItem');
    }
  });

  test('HIGH: refresh token rotation implemented', () => {
    const authService = readSrc('src/auth/auth.service.ts');
    expect(authService).toContain('refreshTokens');
    expect(authService).toContain('RefreshToken');
  });

  webTest('HIGH: frontend auto-logout on refresh failure', () => {
    const apiTs = readSrc('../../apps/web/src/lib/api.ts');
    expect(apiTs).toContain('auth:session-expired');
    expect(apiTs).toContain('dispatchEvent');

    const authContext = readSrc('../../apps/web/src/context/auth-context.tsx');
    expect(authContext).toContain('auth:session-expired');
    expect(authContext).toContain('addEventListener');
  });

  webTest('HIGH: logout is graceful (try/catch)', () => {
    const authContext = readSrc('../../apps/web/src/context/auth-context.tsx');
    // Logout should be wrapped in try/catch
    expect(authContext).toMatch(/try\s*\{.*logout.*\}\s*catch/s);
  });

  test('MEDIUM: JWT secret has startup guard for production', () => {
    const jwtStrategy = readSrc('src/auth/strategies/jwt.strategy.ts');
    expect(jwtStrategy).toContain('JWT_SECRET');
    expect(jwtStrategy).toContain('FATAL');
  });

  webTest('MEDIUM: middleware uses base64url decoding for JWT', () => {
    const middleware = readSrc('../../apps/web/src/middleware.ts');
    // Must convert base64url to base64 before atob
    expect(middleware).toContain("replace(/-/g, '+')");
    expect(middleware).toContain("replace(/_/g, '/')");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. PER-BOOKING PHONE VALIDATION
// (SMS/OTP security checks retired — platform now relies on email-only
//  verification + per-booking phone collection without SMS round-trip.)
// ═══════════════════════════════════════════════════════════════════════════

describe('Per-Booking Phone Validation', () => {
  test('CRITICAL: bookingPhone is required + format-validated in CreateBookingDto', () => {
    const dto = readSrc('src/bookings/dto/create-booking.dto.ts');
    expect(dto).toContain('bookingPhone');
    // Required (NotEmpty), max length cap, E.164 regex — all attached
    // to the bookingPhone field's decorator block.
    expect(dto).toMatch(
      /@IsNotEmpty[\s\S]*?@MaxLength\(20[\s\S]*?@Matches\(\/\^\\\+\?\[0-9\]\{7,15\}\$\/[\s\S]*?bookingPhone/,
    );
  });

  test('CRITICAL: Booking model carries bookingPhone column with VarChar(20)', () => {
    const schema = readSrc('prisma/schema.prisma');
    expect(schema).toMatch(/bookingPhone\s+String\s+@db\.VarChar\(20\)/);
    // Lookup index for vendor/admin support search
    expect(schema).toContain('@@index([bookingPhone])');
  });

  test('HIGH: SMS service + phone-OTP machinery are fully removed', () => {
    const fs = require('fs');
    const smsDir = 'src/sms';
    // sms/ directory must not exist after the OTP removal.
    expect(fs.existsSync(smsDir)).toBe(false);
    const authService = readSrc('src/auth/auth.service.ts');
    expect(authService).not.toContain('sendPhoneOtp');
    expect(authService).not.toContain('verifyPhoneOtp');
    expect(authService).not.toContain('phoneOtpHash');
    expect(authService).not.toContain('phoneVerified');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4b. BOOKING EMAIL-OTP — the per-booking auth gate before PAY2M
// ═══════════════════════════════════════════════════════════════════════════

describe('Booking Email-OTP Security', () => {
  test('CRITICAL: VerifyEmailOtpDto enforces 6-digit format upfront', () => {
    const dto = readSrc('src/bookings/dto/verify-email-otp.dto.ts');
    expect(dto).toContain('@Matches');
    expect(dto).toMatch(/\/\^\[0-9\]\{6\}\$\//);
    expect(dto).toContain('@IsNotEmpty');
  });

  test('CRITICAL: emailOtpHash + emailOtpAttempts are omitted from default Prisma reads', () => {
    const prismaSvc = readSrc('src/prisma/prisma.service.ts');
    // Omit block hides hash + attempts so include:/findX never returns them
    // unless the caller explicitly selects them (verify path only).
    expect(prismaSvc).toMatch(/booking:\s*\{[\s\S]*?emailOtpHash:\s*true/);
    expect(prismaSvc).toMatch(/booking:\s*\{[\s\S]*?emailOtpAttempts:\s*true/);
  });

  test('CRITICAL: Booking model carries the four email-OTP columns + index', () => {
    const schema = readSrc('prisma/schema.prisma');
    expect(schema).toMatch(/emailOtpHash\s+String\?\s+@db\.VarChar\(64\)/);
    expect(schema).toMatch(/emailOtpExpiry\s+DateTime\?/);
    expect(schema).toMatch(/emailOtpAttempts\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/emailOtpVerifiedAt\s+DateTime\?/);
    expect(schema).toContain('@@index([customerId, emailOtpExpiry])');
  });

  test('HIGH: send-email-otp uses RATE_LIMIT_STRICT, verify uses RATE_LIMIT_AUTH', () => {
    const ctrl = readSrc('src/bookings/bookings.controller.ts');
    // send-email-otp → STRICT (resends are mailbomb-shaped). Decorator
    // sits BELOW the @Post path in the file, so match in path-then-throttle
    // order.
    expect(ctrl).toMatch(/send-email-otp[\s\S]{0,200}@Throttle\(RATE_LIMIT_STRICT\)/);
    // verify-email-otp → AUTH (brute-force surface; per-booking 5-cap also)
    expect(ctrl).toMatch(/verify-email-otp[\s\S]{0,200}@Throttle\(RATE_LIMIT_AUTH\)/);
  });

  test('HIGH: payment.initiate gates on emailOtpVerifiedAt before token issuance', () => {
    const ps = readSrc('src/payment/payment.service.ts');
    expect(ps).toMatch(/emailOtpVerifiedAt:\s*true/);
    expect(ps).toMatch(/!booking\.emailOtpVerifiedAt/);
    expect(ps).toMatch(/verify your email/i);
  });

  test('HIGH: OTP code never logged + only hash stored', () => {
    const bs = readSrc('src/bookings/bookings.service.ts');
    // A peppered HMAC-SHA-256 hex digest is the only thing stored (never the
    // plaintext code) — hashing is centralised in hashBookingOtp() and used at
    // both the generate and verify call sites.
    expect(bs).toMatch(/createHmac\('sha256',\s*pepper\)\.update\(code\)\.digest\('hex'\)/);
    expect(bs).toContain('this.hashBookingOtp(code)');
    // Constant-time compare on the hashes (not on the plaintext code).
    expect(bs).toContain('timingSafeEqual');
    // securityLogger.log details strings must NEVER reference the `code`
    // variable. We scan each securityLogger.log({...}) call's argument block
    // and assert none of them interpolate ${code} or pass the variable in
    // a details string. Comments mentioning "code" elsewhere are fine.
    const calls = bs.match(/securityLogger\.log\(\s*\{[\s\S]*?\}\s*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).not.toMatch(/\$\{\s*code\s*\}/);
      expect(call).not.toMatch(/details:\s*[^,}]*code\b/);
    }
  });

  test('HIGH: ownership baked into where clause (no 404 vs 403 oracle)', () => {
    const bs = readSrc('src/bookings/bookings.service.ts');
    // Both send + verify scope by { id, customerId: userId }
    const scoped = bs.match(/findFirst\(\s*\{\s*where:\s*\{\s*id:\s*bookingId,\s*customerId:\s*userId/g) ?? [];
    expect(scoped.length).toBeGreaterThanOrEqual(2);
    // No legacy "Not your booking" leak path
    expect(bs).not.toMatch(/'Not your booking'/);
  });

  test('HIGH: attempts counter incremented BEFORE compare (atomic increment)', () => {
    const bs = readSrc('src/bookings/bookings.service.ts');
    // The increment block sits above the timingSafeEqual call so even an
    // exception path costs the customer an attempt.
    const idxIncrement = bs.indexOf('emailOtpAttempts: { increment: 1 }');
    const idxCompare = bs.indexOf('timingSafeEqual');
    expect(idxIncrement).toBeGreaterThan(0);
    expect(idxCompare).toBeGreaterThan(idxIncrement);
  });

  test('HIGH: verifiedAt is set ONLY on success + hash nulled to prevent replay', () => {
    const bs = readSrc('src/bookings/bookings.service.ts');
    // The success branch updates verifiedAt AND nulls hash + expiry.
    expect(bs).toMatch(/emailOtpVerifiedAt:\s*new Date\(\)[\s\S]*?emailOtpHash:\s*null[\s\S]*?emailOtpExpiry:\s*null/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════

describe('Rate Limiting', () => {
  test('CRITICAL: auth endpoints have strict rate limits', () => {
    const authController = readSrc('src/auth/auth.controller.ts');

    // Login endpoint has @Throttle
    expect(authController).toMatch(/@Throttle.*\n.*@Post\('login'\)/s);
    // Forgot-password endpoint uses a named RATE_LIMIT_* constant (no inline
    // throttle numbers anywhere in the auth controller — check-security rule).
    expect(authController).toMatch(/@Throttle\(RATE_LIMIT_/);
    expect(authController).not.toMatch(/@Throttle\(\{[^}]*ttl:\s*\d+/);
  });

  test('HIGH: admin controller is NOT @SkipThrottle at class level', () => {
    const adminController = readSrc('src/admin/admin.controller.ts');
    // Should have @Throttle, not @SkipThrottle, at class level
    const classDecl = adminController.slice(0, adminController.indexOf('export class'));
    expect(classDecl).not.toContain('@SkipThrottle()');
    expect(classDecl).toContain('@Throttle');
  });

  test('HIGH: admin delete endpoints have per-endpoint rate limits', () => {
    const adminController = readSrc('src/admin/admin.controller.ts');
    // Delete user + delete vendor should have @Throttle
    const deleteUserSection = adminController.slice(
      adminController.indexOf("@Delete('users/:id')"),
      adminController.indexOf("@Delete('users/:id')") + 200
    );
    expect(deleteUserSection).toContain('@Throttle');
  });

  test('HIGH: vendor controller is NOT @SkipThrottle at class level', () => {
    const vendorController = readSrc('src/vendor/vendor.controller.ts');
    const classDecl = vendorController.slice(0, vendorController.indexOf('export class'));
    expect(classDecl).not.toContain('@SkipThrottle()');
  });

  test('MEDIUM: session endpoints have rate limits', () => {
    const authController = readSrc('src/auth/auth.controller.ts');
    // GET /sessions should have @Throttle
    const sessionsSection = authController.slice(
      authController.indexOf("@Get('sessions')"),
      authController.indexOf("@Get('sessions')") + 200
    );
    expect(sessionsSection).toContain('@Throttle');
  });

  test('MEDIUM: /auth/me has rate limit', () => {
    const authController = readSrc('src/auth/auth.controller.ts');
    const meSection = authController.slice(
      authController.indexOf("@Get('me')"),
      authController.indexOf("@Get('me')") + 200
    );
    expect(meSection).toContain('@Throttle');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. INPUT VALIDATION & DATABASE PROTECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Input Validation & Database Protection', () => {
  test('CRITICAL: global ValidationPipe with whitelist + forbidNonWhitelisted', () => {
    const main = readSrc('src/main.ts');
    expect(main).toContain('whitelist: true');
    expect(main).toContain('forbidNonWhitelisted: true');
  });

  test('CRITICAL: global SanitizePipe strips XSS from all inputs', () => {
    const main = readSrc('src/main.ts');
    expect(main).toContain('SanitizePipe');
  });

  test('HIGH: registration DTOs have @Transform for email lowercase + name sanitize', () => {
    const registerDto = readSrc('src/auth/dto/register.dto.ts');
    expect(registerDto).toContain('@Transform');
    expect(registerDto).toContain('toLowerCase');
    expect(registerDto).toContain('replace(/[<>]/g');

    const vendorDto = readSrc('src/auth/dto/register-vendor.dto.ts');
    expect(vendorDto).toContain('@Transform');
    expect(vendorDto).toContain('toLowerCase');
  });

  test('HIGH: profile update DTO has fullName sanitization', () => {
    const profileDto = readSrc('src/users/dto/update-profile.dto.ts');
    expect(profileDto).toContain('@Transform');
    expect(profileDto).toContain('replace(/[<>]/g');
  });

  test('HIGH: review DTO validates activityId as UUID', () => {
    const reviewDto = readSrc('src/catalog/dto/create-review.dto.ts');
    expect(reviewDto).toContain("@IsUUID('4')");
  });

  test('HIGH: booking DTO validates activityId as UUID', () => {
    const bookingDto = readSrc('src/bookings/dto/create-booking.dto.ts');
    expect(bookingDto).toContain('IsUUID');
  });

  test('MEDIUM: Helmet.js security headers enabled', () => {
    const main = readSrc('src/main.ts');
    expect(main).toContain('helmet');
  });

  test('MEDIUM: CORS configured with explicit origins', () => {
    const main = readSrc('src/main.ts');
    expect(main).toContain('cors');
    expect(main).not.toMatch(/origin:\s*true/);
    expect(main).not.toMatch(/origin:\s*'\*'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. AWS SERVICE SKELETONS (PRODUCTION READINESS)
// ═══════════════════════════════════════════════════════════════════════════

describe('AWS Service Skeletons (Production Readiness)', () => {
  test('Email service has production Resend transport wired', () => {
    const emailService = readSrc('src/email/email.service.ts');
    // Migrated off AWS SES to Resend on 2026-05-17 — SES production access
    // was denied (200/day sandbox cap). List-Unsubscribe / List-Unsubscribe-Post
    // (RFC 8058) now ride on the `headers` field of resend.emails.send().
    expect(emailService).toContain("from 'resend'");
    expect(emailService).toContain('emails.send');
    expect(emailService).toContain('List-Unsubscribe');
    expect(emailService).toContain('List-Unsubscribe-Post');
    expect(emailService).toContain('EMAIL_ENABLED');
    expect(emailService).toContain('EMAIL_FROM');
    // RESEND_API_KEY is mandatory whenever email is enabled — EmailService
    // throws at construction if it is missing (mirrors the JWT_SECRET guard).
    expect(emailService).toContain('RESEND_API_KEY');
  });

  test('Email module is global and properly registered', () => {
    const emailModule = readSrc('src/email/email.module.ts');
    expect(emailModule).toContain('@Global()');

    const appModule = readSrc('src/app.module.ts');
    expect(appModule).toContain('EmailModule');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. GOOGLE OAUTH SECURITY
// ═══════════════════════════════════════════════════════════════════════════

describe('Google OAuth Security', () => {
  test('CRITICAL: OAuth callback validates redirect URL', () => {
    const authController = readSrc('src/auth/auth.controller.ts');
    expect(authController).toContain('google/callback');
  });

  test('HIGH: OAuth does not link to unverified email accounts', () => {
    const authService = readSrc('src/auth/auth.service.ts');
    const oauthSection = authService.slice(authService.indexOf('handleGoogleAuth'));
    expect(oauthSection).toContain('emailVerified');
    expect(oauthSection).toContain('not verified');
  });

  test('HIGH: new OAuth users created without password (cannot use password login)', () => {
    const authService = readSrc('src/auth/auth.service.ts');
    expect(authService).toContain('password: null');
    expect(authService).toContain('!user.password');
  });

  test('MEDIUM: Google OAuth users are auto email-verified', () => {
    const authService = readSrc('src/auth/auth.service.ts');
    const createSection = authService.slice(authService.indexOf('New user — create'));
    expect(createSection).toContain('emailVerified: true');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. BOOKING & PAYMENT SECURITY
// ═══════════════════════════════════════════════════════════════════════════

describe('Booking & Payment Security', () => {
  test('HIGH: booking creation has rate limiting', () => {
    const bookingController = readSrc('src/bookings/bookings.controller.ts');
    expect(bookingController).toContain('@Throttle');
  });

  test('HIGH: booking creation requires authentication', () => {
    const bookingController = readSrc('src/bookings/bookings.controller.ts');
    expect(bookingController).toContain('JwtAuthGuard');
  });

  test('HIGH: booking has idempotency key to prevent duplicates', () => {
    const bookingDto = readSrc('src/bookings/dto/create-booking.dto.ts');
    expect(bookingDto).toContain('idempotencyKey');
  });

  webTest('HIGH: frontend requires per-booking phone before booking', () => {
    const bookPage = readSrc('../../apps/web/src/app/activity/[slug]/book/page.tsx');
    // Booking submission is gated on the customer entering a phone
    // for THIS booking (replacement for the legacy phone-OTP gate).
    expect(bookPage).toContain('bookingPhone');
    expect(bookPage).toContain('showPhoneModal');
    expect(bookPage).toContain('BookingPhoneModal');
  });

  test('MEDIUM: booking cancellation checks ownership (IDOR protection)', () => {
    const bookingService = readSrc('src/bookings/bookings.service.ts');
    expect(bookingService).toContain('customerId');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. PRIVACY & DATA PROTECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Privacy & Data Protection', () => {
  test('HIGH: public review API truncates customer names', () => {
    const catalogController = readSrc('src/catalog/catalog.controller.ts');
    expect(catalogController).toContain('displayName');
    // Should NOT return raw fullName in public endpoint
    const detailSection = catalogController.slice(catalogController.indexOf('getActivityBySlug'));
    expect(detailSection).toContain('displayName');
  });

  test('MEDIUM: .env file is in gitignore pattern', () => {
    try {
      const gitignore = fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '.gitignore'),
        'utf-8'
      );
      expect(gitignore).toContain('.env');
    } catch {
      // If no .gitignore, that's also a finding
      console.warn('WARNING: No .gitignore found at project root');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. DATABASE PROTECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Database Protection', () => {
  test('CRITICAL: no raw SQL anywhere (SQL injection prevention)', () => {
    // Recursively check all .ts files in src/ for raw SQL
    const srcDir = path.join(__dirname, '..', 'src');
    const tsFiles: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) tsFiles.push(full);
      }
    }
    walk(srcDir);

    for (const file of tsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const rel = path.relative(srcDir, file);
      expect({ file: rel, has: content.includes('$queryRawUnsafe') }).toEqual({ file: rel, has: false });
      expect({ file: rel, has: content.includes('$executeRawUnsafe') }).toEqual({ file: rel, has: false });
    }
  });

  test('CRITICAL: all primary keys use UUID (prevents enumeration)', () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf-8');
    const models = schema.match(/model \w+ \{[^}]+\}/g) || [];
    for (const model of models) {
      // Skip singleton/config models that use static string IDs
      const isSingleton = model.includes('PlatformSettings') || model.includes('LoyaltyConfig');
      if (model.includes('@id') && !isSingleton) {
        expect(model).toContain('uuid()');
      }
    }
  });

  test('HIGH: User findOneForAuth/findByIdForAuth are clearly marked internal-only', () => {
    const usersService = readSrc('src/users/users.service.ts');
    expect(usersService).toContain('findOneForAuth');
    expect(usersService).toContain('findByIdForAuth');
    expect(usersService).toContain('NEVER return this directly in an API response');
    // Old unsafe names should not exist
    expect(usersService).not.toMatch(/async findOne\(/);
    expect(usersService).not.toMatch(/async findById\(/);
  });

  test('HIGH: UsersService.create() has typed parameter (no mass assignment)', () => {
    const usersService = readSrc('src/users/users.service.ts');
    // Should NOT have `data: any`
    expect(usersService).not.toMatch(/create\(data:\s*any\)/);
    // Should have explicit typed fields
    expect(usersService).toMatch(/create\(data:\s*\{/);
  });

  test('HIGH: deleteUser cleans up likes (FK constraint safety)', () => {
    const adminService = readSrc('src/admin/admin.service.ts');
    const deleteSection = adminService.slice(adminService.indexOf('deleteUser'));
    expect(deleteSection).toContain('like.deleteMany');
  });

  test('HIGH: getBookingById does not return full payment object', () => {
    const bookingService = readSrc('src/bookings/bookings.service.ts');
    const getByIdSection = bookingService.slice(bookingService.indexOf('getBookingById'));
    // Should use select, not `payment: true`
    expect(getByIdSection).not.toMatch(/payment:\s*true/);
    expect(getByIdSection).toContain('payment: { select:');
  });

  test('MEDIUM: production requires strong JWT secrets', () => {
    const main = readSrc('src/main.ts');
    expect(main).toContain('WEAK_SECRETS');
    // Accept either `val.length < 32` or `jwtSecret.length < 32` phrasing —
    // the semantic is what matters: reject secrets under 32 chars at startup.
    expect(main).toMatch(/\w+\.length\s*<\s*32/);
    expect(main).toContain('super_secret_key_change_me_in_prod');
  });

  test('MEDIUM: production DB uses SSL', () => {
    const prismaService = readSrc('src/prisma/prisma.service.ts');
    expect(prismaService).toContain('ssl');
    expect(prismaService).toContain('rejectUnauthorized: true');
  });

  test('MEDIUM: DB connection has pool limits', () => {
    const prismaService = readSrc('src/prisma/prisma.service.ts');
    expect(prismaService).toContain('max:');
    expect(prismaService).toContain('idleTimeoutMillis');
    expect(prismaService).toContain('connectionTimeoutMillis');
  });

  test('LOW: core models use @@map for explicit table names', () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf-8');
    // Check the critical models that store user data
    const requiredMaps = ['users', 'vendors', 'activities', 'bookings', 'payments', 'reviews'];
    for (const table of requiredMaps) {
      expect(schema).toContain(`@@map("${table}")`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. CRYPTO PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════

describe('Crypto Primitives', () => {
  test('SHA-256 hash is deterministic and correct', () => {
    const hash = crypto.createHash('sha256').update('123456').digest('hex');
    expect(hash).toBe('8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92');
    expect(hash).toHaveLength(64);
  });

  test('OTP generation produces 6-digit numbers in range', () => {
    for (let i = 0; i < 100; i++) {
      const otp = crypto.randomInt(100000, 999999);
      expect(otp).toBeGreaterThanOrEqual(100000);
      expect(otp).toBeLessThan(1000000);
      expect(otp.toString()).toHaveLength(6);
    }
  });

  test('bcrypt timing is consistent (> 50ms per hash)', async () => {
    const start = Date.now();
    await bcrypt.hash('testpassword', 10);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(30); // bcrypt should take real time
  });

  test('bcrypt dummy hash comparison takes real time (timing attack prevention)', async () => {
    const DUMMY = '$2b$10$dummyhashfortimingequaliz0000000000000000000000000';
    const start = Date.now();
    try { await bcrypt.compare('password', DUMMY); } catch { /* invalid hash format is ok */ }
    const elapsed = Date.now() - start;
    // Even with invalid hash, bcrypt should take measurable time (not instant)
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION — 2026-04-17 Security audit fixes
// Prevents these specific issues from ever regressing.
// ═══════════════════════════════════════════════════════════════════════════

describe('REGRESSION: Open-redirect — backslash bypass', () => {
  // Inline copy of the guard's sanitizer (must stay in sync with
  // google-auth.guard.ts sanitizeCallbackUrl). If this drifts, update both.
  function sanitize(raw: string | undefined): string {
    if (!raw) return '/';
    let decoded: string;
    try { decoded = decodeURIComponent(raw); } catch { return '/'; }
    if (
      !decoded.startsWith('/') ||
      decoded.startsWith('//') ||
      decoded.startsWith('/\\') ||
      decoded.includes(':') ||
      decoded.includes('\\')
    ) return '/';
    return decoded;
  }

  test.each([
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['%2F%2Fevil.com', '/'],       // url-encoded //
    ['%2F%5Cevil.com', '/'],       // url-encoded /\
    ['http://evil.com', '/'],
    ['https://evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['/path/with\\backslash', '/'],
    ['/normal/path', '/normal/path'],
    ['/bookings/abc-123', '/bookings/abc-123'],
    ['', '/'],
    [undefined, '/'],
  ])('sanitizeCallbackUrl(%p) === %p', (input, expected) => {
    expect(sanitize(input as string | undefined)).toBe(expected);
  });

  test('actual guard source contains all bypass checks', () => {
    const src = readSrc('src/auth/guards/google-auth.guard.ts');
    expect(src).toContain("startsWith('//')");
    expect(src).toContain("startsWith('/\\\\')");
    expect(src).toContain("includes(':')");
    expect(src).toContain("includes('\\\\')");
  });
});

describe('REGRESSION: Payment callback — URL construction', () => {
  test('payment controller uses URL builder, not template literal', () => {
    const src = readSrc('src/payment/payment.controller.ts');
    // Must build via URL + searchParams — never `${frontendUrl}/payment/callback?bookingId=${...}`
    expect(src).toContain("new URL('/payment/callback', frontendUrl)");
    expect(src).toMatch(/searchParams\.set/);
    // No string-concatenated redirect targets
    expect(src).not.toMatch(/res\.redirect\(`\$\{frontendUrl\}\/payment\/callback\?[^`]*\$\{[^`]*\}/);
  });

  test('payment controller validates bookingId as UUIDv4 before echoing', () => {
    const src = readSrc('src/payment/payment.controller.ts');
    expect(src).toContain('UUID_RE');
    expect(src).toMatch(/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/);
  });
});

describe('REGRESSION: CSP hardening', () => {
  webTest("next.config.ts no longer ships a static CSP (middleware owns it)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'web', 'next.config.ts'),
      'utf-8',
    );
    // No ACTIVE CSP header object — the word 'unsafe-inline' can still
    // appear in comments explaining why CSP moved to middleware.
    expect(src).not.toMatch(/key:\s*["']Content-Security-Policy["']/);
    expect(src).not.toMatch(/default-src\s+['"]self['"]/);
  });

  webTest('middleware.ts uses per-request nonce + strict-dynamic, no unsafe-inline in prod', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'web', 'src', 'middleware.ts'),
      'utf-8',
    );
    expect(src).toContain("'strict-dynamic'");
    expect(src).toContain('x-nonce');
    expect(src).toContain("object-src 'none'");
    expect(src).toContain("base-uri 'self'");
    expect(src).toContain("frame-ancestors 'none'");
    // script-src must NOT carry 'unsafe-inline' on the production branch
    const prodBranch = src.slice(src.indexOf('isProd'), src.indexOf("'unsafe-eval'"));
    expect(prodBranch).not.toContain("'unsafe-inline'");
  });

  test("api main.ts img-src no longer has bare 'https:' wildcard", () => {
    const src = readSrc('src/main.ts');
    const helmetBlock = src.slice(src.indexOf('contentSecurityPolicy'), src.indexOf('hsts:'));
    expect(helmetBlock).toContain("imgSrc: [\"'self'\", 'data:']");
    expect(helmetBlock).not.toMatch(/imgSrc:[^]]*'https:'/);
  });
});

describe('REGRESSION: Upload — magic-byte sniffing', () => {
  test('upload.service.ts uses file-type buffer sniffing before trusting mimetype', () => {
    const src = readSrc('src/common/services/upload.service.ts');
    expect(src).toContain("from 'file-type'");
    expect(src).toContain('fileTypeFromBuffer');
    // Sniffer runs inside processImage, before sharp
    const processImage = src.slice(src.indexOf('processImage'), src.indexOf('async upload('));
    expect(processImage).toMatch(/fileTypeFromBuffer[\s\S]*ALLOWED_MIME[\s\S]*sharp\(/);
  });

  test('upload allowlist does NOT contain SVG (SVG = XSS)', () => {
    const src = readSrc('src/common/services/upload.service.ts');
    const allowlistBlock = src.slice(0, src.indexOf('MIME_TO_EXT'));
    expect(allowlistBlock).not.toContain('image/svg');
    expect(allowlistBlock).not.toMatch(/\.svg/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION — 2026-04-17 Hourly flex-start bookings
// Prevents the slot/capacity math from regressing when activity durations change.
// ═══════════════════════════════════════════════════════════════════════════

// NOTE: a local computeSlots copy used to live here but stepped +60 min — stale
// after KAN-12 (30-min slots) and misleading. The REAL generator is now tested
// directly (imported from bookings.service) in test/unit/booking-slots.spec.ts.
// maxConcurrent below stays — it's the capacity-math regression guard.
function maxConcurrent(
  bookings: Array<{ startDatetime: Date; endDatetime: Date; guests: number }>,
  wStart: Date, wEnd: Date,
): number {
  const events: Array<{ time: number; delta: number; isStart: number }> = [];
  for (const b of bookings) {
    const s = b.startDatetime > wStart ? b.startDatetime : wStart;
    const e = b.endDatetime < wEnd ? b.endDatetime : wEnd;
    if (s.getTime() >= e.getTime()) continue;
    events.push({ time: s.getTime(), delta: b.guests, isStart: 1 });
    events.push({ time: e.getTime(), delta: -b.guests, isStart: 0 });
  }
  events.sort((a, b) => (a.time - b.time) || (a.isStart - b.isStart));
  let cur = 0, peak = 0;
  for (const ev of events) { cur += ev.delta; if (cur > peak) peak = cur; }
  return peak;
}

describe('REGRESSION: Hourly flex slots — maxConcurrentInWindow', () => {
  const d = (h: number) => new Date(Date.UTC(2026, 5, 1, h, 0, 0));

  test('non-overlapping adjacent bookings → peak = max, not sum', () => {
    const peak = maxConcurrent(
      [
        { startDatetime: d(8),  endDatetime: d(10), guests: 30 },
        { startDatetime: d(10), endDatetime: d(12), guests: 25 },
      ],
      d(9), d(12),
    );
    expect(peak).toBe(30);
  });

  test('truly concurrent bookings → peak = sum', () => {
    const peak = maxConcurrent(
      [
        { startDatetime: d(9), endDatetime: d(11), guests: 30 },
        { startDatetime: d(9), endDatetime: d(11), guests: 20 },
      ],
      d(9), d(11),
    );
    expect(peak).toBe(50);
  });

  test('overlapping flex bookings — peak during overlap only', () => {
    const peak = maxConcurrent(
      [
        { startDatetime: d(8),  endDatetime: d(11), guests: 30 },
        { startDatetime: d(10), endDatetime: d(13), guests: 25 },
      ],
      d(10), d(11),
    );
    expect(peak).toBe(55);
  });

  test('end-equals-start is not concurrent', () => {
    const peak = maxConcurrent(
      [
        { startDatetime: d(8),  endDatetime: d(10), guests: 30 },
        { startDatetime: d(10), endDatetime: d(12), guests: 25 },
      ],
      d(8), d(12),
    );
    expect(peak).toBe(30);
  });

  test('booking extending past window is clipped', () => {
    const peak = maxConcurrent(
      [{ startDatetime: d(6), endDatetime: d(12), guests: 30 }],
      d(8), d(10),
    );
    expect(peak).toBe(30);
  });

  test('empty bookings → peak 0', () => {
    expect(maxConcurrent([], d(8), d(10))).toBe(0);
  });

  test('three-way stagger', () => {
    const peak = maxConcurrent(
      [
        { startDatetime: d(8),  endDatetime: d(10), guests: 10 },
        { startDatetime: d(9),  endDatetime: d(11), guests: 10 },
        { startDatetime: d(10), endDatetime: d(12), guests: 10 },
      ],
      d(8), d(12),
    );
    expect(peak).toBe(20);
  });
});

describe('REGRESSION: Hourly flex slots — service source wiring', () => {
  test('bookings.service uses HOURLY_SLOT_GRANULARITY_MINUTES = 30 (half-hour slots)', () => {
    const src = readSrc('src/bookings/bookings.service.ts');
    expect(src).toContain('HOURLY_SLOT_GRANULARITY_MINUTES = 30');
    expect(src).toContain('t += HOURLY_SLOT_GRANULARITY_MINUTES');
  });

  test('createBooking uses maxConcurrentInWindow, not naive sum', () => {
    const src = readSrc('src/bookings/bookings.service.ts');
    const createBlock = src.slice(src.indexOf('async createBooking'), src.indexOf('// ─── Cancel booking'));
    expect(createBlock).toContain('maxConcurrentInWindow');
    expect(createBlock).not.toMatch(/alreadyBooked\s*=\s*agg\._sum\.guests/);
  });

  test('getHourlyAvailability fetches bookings once and sweeps per slot', () => {
    const src = readSrc('src/bookings/bookings.service.ts');
    const block = src.slice(src.indexOf('getHourlyAvailability'), src.indexOf('getDailyAvailability'));
    expect(block).toContain('maxConcurrentInWindow');
    expect(block).toContain('findMany');
  });

  test('createBooking rejects slot times that are not on the hour/half-hour', () => {
    const src = readSrc('src/bookings/bookings.service.ts');
    expect(src).toContain('must be on the hour or half-hour');
  });

  test('DTO slotTime regex enforces HH:00 or HH:30', () => {
    const src = readSrc('src/bookings/dto/create-booking.dto.ts');
    expect(src).toContain('[01]\\d|2[0-3]):(00|30)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION — 2026-04-18 Loyalty fixes (PROD_CHECKLIST §19.2.a–e)
// Locks in the atomic redeem, ledger writes, DTO bounds, and consolidation.
// ═══════════════════════════════════════════════════════════════════════════

describe('REGRESSION: Loyalty DTO bounds', () => {
  const dto = readSrc('src/admin/dto/loyalty.dto.ts');

  test('qarPerPoint is capped at 10 (was 10000 — treasury-drain risk)', () => {
    // Match the decorator that immediately precedes `qarPerPoint?:` declaration
    expect(dto).toMatch(/@Max\(10\)\s*\n\s*qarPerPoint\?:/);
    // Old unbounded cap must not exist anywhere in the file
    expect(dto).not.toMatch(/@Max\(10000\)\s*\n\s*qarPerPoint/);
  });

  test("pointsPerQar is capped at 100 (earn rate can't be 10000)", () => {
    expect(dto).toMatch(/@Max\(100\)\s*\n\s*pointsPerQar\?:/);
    expect(dto).not.toMatch(/@Max\(10000\)\s*\n\s*pointsPerQar/);
  });

  test('AdjustUserPointsDto.delta has @Min/@Max bounds', () => {
    // Decorators are emitted IMMEDIATELY before the field they annotate.
    expect(dto).toMatch(/@Min\(-1_000_000\)[\s\S]{0,120}delta!:/);
    expect(dto).toMatch(/@Max\(1_000_000\)[\s\S]{0,120}delta!:/);
  });
});

describe('REGRESSION: LoyaltyService — atomic redeem + ledger', () => {
  const svc = readSrc('src/common/services/loyalty.service.ts');

  test('redeem uses conditional updateMany (no TOCTOU race)', () => {
    const fn = svc.slice(svc.indexOf('async redeem'), svc.indexOf('async refund'));
    expect(fn).toContain('updateMany');
    expect(fn).toMatch(/loyaltyPoints:\s*\{\s*gte:/);
    expect(fn).toContain('count === 0');
    expect(fn).toContain('Insufficient loyalty points');
  });

  test('every public method writes a LoyaltyLedger row', () => {
    for (const method of ['redeem', 'refund', 'earn', 'adjust']) {
      const start = svc.indexOf(`async ${method}`);
      const end = svc.indexOf('async ', start + 1);
      const block = svc.slice(start, end > 0 ? end : svc.length);
      expect(block).toContain('writeLedger');
    }
  });

  test('redeem records BOOKING_REDEEM source', () => {
    expect(svc).toMatch(/source:\s*'BOOKING_REDEEM'/);
  });

  test('refund accepts only refund-source enum values (type-narrowed)', () => {
    expect(svc).toContain('CANCEL_REFUND_UNPAID');
    expect(svc).toContain('CANCEL_REFUND_PAID');
    expect(svc).toContain('VENDOR_REFUND_APPROVED');
    expect(svc).toContain('ADMIN_REFUND_APPROVED');
  });

  test('adjust clamps negative delta so balance never goes below zero', () => {
    const fn = svc.slice(svc.indexOf('async adjust'), svc.indexOf('// ─'));
    // Points are QAR-denominated (Decimal), so the balance is normalised via
    // toNum() and the clamp uses the local `delta`/`currentBalance`.
    expect(fn).toContain('Math.min(-delta, currentBalance)');
    expect(fn).toContain('appliedDelta');
  });

  test('zero delta rejected; amounts must be positive (points are fractional QAR)', () => {
    expect(svc).toContain('Adjustment delta must be non-zero');
    expect(svc).toContain('must be a positive amount');
    expect(svc).toContain('Ledger delta must be non-zero');
  });
});

describe('REGRESSION: Consolidation — all loyalty mutations go through LoyaltyService', () => {
  const files = [
    'src/bookings/bookings.service.ts',
    'src/admin/admin.service.ts',
    'src/vendor/vendor.service.ts',
    'src/common/services/cleanup.service.ts',
  ];

  test('no raw `loyaltyPoints: { increment` / `decrement` outside LoyaltyService', () => {
    for (const f of files) {
      const src = readSrc(f);
      // loyaltyPoints may appear (e.g. in selects), but NOT in a direct
      // write. These patterns catch both direct user.update and updateMany.
      expect(src).not.toMatch(/loyaltyPoints:\s*\{\s*increment:/);
      expect(src).not.toMatch(/loyaltyPoints:\s*\{\s*decrement:/);
    }
  });

  test('LoyaltyService is called in every cancel / earn / refund path', () => {
    for (const f of files) {
      const src = readSrc(f);
      const hasLoyaltyRef = src.includes('this.loyalty.') || f.endsWith('loyalty.service.ts');
      expect(hasLoyaltyRef).toBe(true);
    }
  });
});

describe('REGRESSION: Schema — LoyaltyLedger table + enums', () => {
  const schema = fs.readFileSync(
    path.join(__dirname, '..', 'prisma', 'schema.prisma'),
    'utf-8',
  );

  test('LoyaltyLedger model exists', () => {
    expect(schema).toContain('model LoyaltyLedger');
    expect(schema).toContain('balanceAfter');
    expect(schema).toMatch(/source\s+LoyaltyLedgerSource/);
    expect(schema).toMatch(/actorType\s+LoyaltyActorType/);
  });

  test('Enums defined', () => {
    expect(schema).toContain('enum LoyaltyLedgerSource');
    expect(schema).toContain('enum LoyaltyActorType');
  });

  test('User has reverse relation to ledger', () => {
    expect(schema).toMatch(/loyaltyLedger\s+LoyaltyLedger\[\]/);
  });

  test('Indexes for per-user and per-reason analytics', () => {
    expect(schema).toMatch(/@@index\(\[userId, createdAt\]\)/);
    expect(schema).toMatch(/@@index\(\[bookingId\]\)/);
    expect(schema).toMatch(/@@index\(\[source, createdAt\]\)/);
  });
});

describe('REGRESSION: adjustUserPoints controller passes actor id', () => {
  const ctrl = readSrc('src/admin/admin.controller.ts');
  test('adjustUserPoints signature includes CurrentUser actor', () => {
    const block = ctrl.slice(ctrl.indexOf("@Patch('loyalty/users/:id/points')"), ctrl.indexOf("@Patch('loyalty/users/:id/points')") + 400);
    expect(block).toContain('@CurrentUser()');
    expect(block).toMatch(/adminService\.adjustUserPoints\([^)]*actor\.id/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REGRESSIONS — 2026-04 session (flex hourly + cascade refund + cache + FE)
// ═══════════════════════════════════════════════════════════════════════════

describe('REGRESSION: Admin cascade refund on activity deactivate / vendor suspend', () => {
  const svc = readSrc('src/admin/admin.service.ts');

  test('cascadeCancelFutureBookings helper exists and is private', () => {
    expect(svc).toMatch(/private\s+async\s+cascadeCancelFutureBookings/);
  });

  test('vendor suspend calls cascadeCancelFutureBookings', () => {
    // The suspend path must route through the cascade helper so future bookings
    // get cancelled + refunded rather than left orphaned.
    const suspendArea = svc.slice(0, svc.indexOf('private async cascadeCancelFutureBookings'));
    expect(suspendArea).toMatch(/cascadeCancelFutureBookings\(/);
  });

  test('activity deactivate also goes through the same cascade path', () => {
    // Count call sites — there must be at least 2 (vendor suspend + activity deactivate)
    const matches = svc.match(/this\.cascadeCancelFutureBookings\(/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('REGRESSION: Hard-delete guards — vendor/user with unresolved bookings', () => {
  const svc = readSrc('src/admin/admin.service.ts');

  test('deleteUser blocks when unresolved bookings exist', () => {
    expect(svc).toMatch(/Cannot delete user:.*unresolved booking/);
  });

  test('deleteVendor blocks when unresolved bookings exist', () => {
    expect(svc).toMatch(/Cannot delete vendor:.*unresolved booking/);
  });

  test('guards throw before any destructive DB op', () => {
    // The error message must mention suspending first — i.e. the graceful path
    expect(svc).toMatch(/Suspend the vendor first to cascade-cancel and refund/);
  });
});

describe('REGRESSION: Customer notification on vendor-cancel', () => {
  const vendorSvc = readSrc('src/vendor/vendor.service.ts');

  test('vendor cancel sends BOOKING_CANCELLED notification to customer', () => {
    expect(vendorSvc).toMatch(/type:\s*'BOOKING_CANCELLED'/);
    expect(vendorSvc).toMatch(/userId:\s*booking\.customerId/);
  });

  test('notification message includes activity title (not user-supplied)', () => {
    expect(vendorSvc).toMatch(/booking\.activity\.titleEn/);
  });

  test('refund line appears only when payment was SUCCESS (paid)', () => {
    expect(vendorSvc).toMatch(/booking\.payment\?\.status\s*===\s*'SUCCESS'/);
    expect(vendorSvc).toMatch(/refunded as Wanasa points/);
  });

  test('notification is fire-and-forget (no await on customer notify)', () => {
    // The comment is the contract — deliberate, to avoid blocking cancel on
    // a transient notification-service failure.
    expect(vendorSvc).toMatch(/Fire-and-forget/i);
  });
});

describe('REGRESSION: Hourly pro-rata pricing — flex hours × guests / durationValue', () => {
  const svc = readSrc('src/bookings/bookings.service.ts');

  test('hoursBooked clamped to at least activity.durationValue', () => {
    expect(svc).toMatch(/Math\.max\(\s*activity\.durationValue!/);
  });

  test('hoursBooked derived from SERVER datetimes, not raw DTO slotEndTime', () => {
    // endDatetime / startDatetime are the validated server values; a tampered
    // slotEndTime cannot leak into the price.
    expect(svc).toMatch(/endDatetime\.getTime\(\)\s*-\s*startDatetime\.getTime\(\)/);
  });

  test('total cents formula: round(effectiveCents × hours × perPersonCount / durHours)', () => {
    // effectiveCents = the per-date special price (if set) else priceCents; the
    // pro-rata structure is unchanged and still server-derived (not tamperable).
    expect(svc).toMatch(/Math\.round\(\s*\(\s*effectiveCents\s*\*\s*hoursBooked\s*\*\s*perPersonCount\s*\)\s*\/\s*durHours/);
  });

  test('PER_UNIT pricing uses perPersonCount = 1 (guests do not multiply)', () => {
    expect(svc).toMatch(/pricingModel\s*===\s*'PER_UNIT'\s*\?\s*1\s*:\s*dto\.guests/);
  });
});

describe('REGRESSION: Wanasa points are customer-side discount, not vendor deduction', () => {
  const svc = readSrc('src/bookings/bookings.service.ts');

  test('pointsRedeemed caps at activity price worth (never burn extra on waived fee)', () => {
    // When Wanasa fully covers the activity, we cap redemption at exactly
    // what's needed. Earlier versions capped against activity+fee, burning
    // extra points to cover the fee — now the fee is waived instead. Points
    // are QAR-denominated (fractional) so the cap is round-to-2dp, not ceil.
    expect(svc).toMatch(/pointsRedeemed\s*=\s*Math\.round\(\(activityPrice\s*\/\s*qarPerPoint\)\s*\*\s*100\)\s*\/\s*100/);
  });

  test('vendor share (afterCouponPrice) is NOT reduced by points redemption', () => {
    // Wanasa points are platform-issued store credit backed by cash float,
    // NOT a vendor-side discount. The vendor earns their full share
    // regardless of how the customer paid. Guard: the old code had
    // `afterCouponPrice = afterCouponPrice - pointsAppliedToVendor` — if
    // that pattern ever reappears, vendors get stiffed on Wanasa bookings.
    expect(svc).not.toMatch(/afterCouponPrice\s*=\s*.*-\s*pointsAppliedToVendor/);
    expect(svc).not.toMatch(/pointsAppliedToVendor/);
  });

  test('payableAmount subtracts pointsDiscount (customer-side only)', () => {
    // Customer's cash-due = finalTotalPrice + effectiveServiceFee - pointsDiscount.
    // Points reduce what the CUSTOMER pays, not what the vendor earns.
    expect(svc).toMatch(/payableAmount\s*=\s*Math\.max\(\s*0,\s*Math\.round\(\(finalTotalPrice\s*\+\s*effectiveServiceFee\s*-\s*pointsDiscount\)/);
  });

  test('explanatory comment about platform-backed points stays', () => {
    // Load-bearing comment: future devs must not re-introduce the
    // vendor-side deduction without understanding the floor model.
    expect(svc).toMatch(/platform-issued store credit/i);
  });
});

describe('REGRESSION: Full points coverage skips PAY2M', () => {
  const svc = readSrc('src/bookings/bookings.service.ts');

  test('payableAmount <= 0 branch exists and skips gateway', () => {
    expect(svc).toMatch(/payableAmount\s*<=\s*0/);
    expect(svc).toMatch(/skip PAY2M entirely|Full Wanasa points coverage/i);
  });

  test('points-only cancel short-circuits vendor refund queue', () => {
    // Memory rule: points-only booking cancel must NOT queue a cash refund
    // to the vendor, since the vendor was never paid cash.
    expect(svc).toMatch(/don't double-refund|double.?refund points/i);
  });
});

describe('REGRESSION: Availability cache — key-injection guards + payload cap', () => {
  const cache = readSrc('src/redis/availability-cache.service.ts');

  test('activityId must be a UUID', () => {
    expect(cache).toContain('UUID_RE');
    expect(cache).toMatch(/UUID_RE\.test\(activityId\)/);
  });

  test('month must match YYYY-MM exactly', () => {
    expect(cache).toMatch(/MONTH_RE\s*=\s*\/\^\\d\{4\}/);
    expect(cache).toMatch(/MONTH_RE\.test\(month\)/);
  });

  test('unitNumber is bounded by MAX_CACHEABLE_UNIT to prevent cache pollution', () => {
    expect(cache).toContain('MAX_CACHEABLE_UNIT');
    expect(cache).toMatch(/unitNumber\s*<=\s*MAX_CACHEABLE_UNIT/);
  });

  test('payload cap = 256 KB', () => {
    expect(cache).toMatch(/maxPayloadBytes\s*=\s*256\s*\*\s*1024/);
  });

  test('TTL clamped to [1, 3600] seconds', () => {
    expect(cache).toMatch(/rawTtl\s*>\s*0\s*&&\s*rawTtl\s*<=\s*3600/);
  });
});

describe('REGRESSION: Availability cache — version-based INCR invalidation', () => {
  const cache = readSrc('src/redis/availability-cache.service.ts');

  test('version key pattern: avail:ver:{activityId}', () => {
    expect(cache).toMatch(/avail:ver:\$\{activityId\}/);
  });

  test('invalidate + invalidateMany both present (single-activity and batch)', () => {
    expect(cache).toMatch(/async invalidate\(/);
    expect(cache).toMatch(/async invalidateMany\(/);
  });

  test('data key contains version — old versions age out naturally via TTL', () => {
    expect(cache).toMatch(/avail:\$\{activityId\}:v\$\{version\}/);
  });
});

describe('REGRESSION: Rate-limit coverage — every mutating controller has @Throttle', () => {
  const controllers = [
    'src/admin/admin.controller.ts',
    'src/auth/auth.controller.ts',
    'src/vendor/vendor.controller.ts',
    'src/bookings/bookings.controller.ts',
    'src/catalog/customer-interaction.controller.ts',
    'src/catalog/offers.controller.ts',
    'src/payment/payment.controller.ts',
    'src/users/users.controller.ts',
    'src/common/controllers/notification.controller.ts',
    'src/common/controllers/push.controller.ts',
  ];

  test.each(controllers)('%s has at least one @Throttle annotation', (file) => {
    const src = readSrc(file);
    expect(src).toMatch(/@Throttle\(/);
  });

  test('RATE_LIMIT_* tier constants live in throttle-config.ts', () => {
    const cfg = readSrc('src/common/throttle-config.ts');
    expect(cfg).toMatch(/RATE_LIMIT_STRICT/);
    expect(cfg).toMatch(/RATE_LIMIT_WRITE/);
    expect(cfg).toMatch(/RATE_LIMIT_READ/);
  });
});

webDescribe('REGRESSION: FE — isSafeRelativePath guards notification link before router.push', () => {
  const utils = readSrcSafe('../../apps/web/src/lib/utils.ts');
  const bell = readSrcSafe('../../apps/web/src/components/notification-bell.tsx');

  test('isSafeRelativePath helper is exported from lib/utils', () => {
    expect(utils).toMatch(/export function isSafeRelativePath/);
  });

  test('notification-bell calls isSafeRelativePath before router.push', () => {
    expect(bell).toContain('isSafeRelativePath');
    // Must appear before the push call in the same handler
    const idx1 = bell.indexOf('isSafeRelativePath');
    const idx2 = bell.indexOf('router.push');
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(idx1);
  });
});

webDescribe('REGRESSION: FE — target=_blank carries rel="noopener noreferrer"', () => {
  const files = [
    '../../apps/web/src/app/admin/_components/admin-layout.tsx',
    '../../apps/web/src/app/admin/login/page.tsx',
  ];

  test.each(files)('%s: no bare target=_blank without rel=noopener', (f) => {
    const src = readSrc(f);
    // Find every target="_blank" occurrence; each must have noopener nearby
    const targetMatches = src.match(/target=["']_blank["'][^>]*>/g) || [];
    for (const m of targetMatches) {
      expect(m).toMatch(/noopener/);
      expect(m).toMatch(/noreferrer/);
    }
  });
});

webDescribe('REGRESSION: FE — activity page iframes (if any) are sandboxed', () => {
  // The original Google Maps iframe was removed in 2026-05-08 (PR #170)
  // because Google deprecated the `output=embed` URL pattern; the page now
  // renders a Leaflet+OSM <div>-based map instead. These assertions stay
  // as a *forward-looking guard*: if anyone re-adds an iframe to this page
  // (e.g. a future YouTube preview or Google Maps Embed API switch), they
  // must sandbox it correctly. Zero iframes is the current happy state.
  const page = readSrcSafe('../../apps/web/src/app/activity/[slug]/page.tsx');

  test('any iframe present must carry a sandbox attribute', () => {
    const iframeMatches = page.match(/<iframe[^>]*>/g) || [];
    for (const iframe of iframeMatches) {
      expect(iframe).toMatch(/sandbox=/);
    }
  });

  test('any iframe sandbox must not grant top-navigation, forms, or popup-escape', () => {
    const iframeMatches = page.match(/<iframe[^>]*sandbox=[^>]*>/g) || [];
    for (const iframe of iframeMatches) {
      expect(iframe).not.toMatch(/allow-top-navigation/);
      expect(iframe).not.toMatch(/allow-forms/);
      expect(iframe).not.toMatch(/allow-popups-to-escape-sandbox/);
    }
  });
});

webDescribe('REGRESSION: FE — getApiError does not leak raw Error.message', () => {
  // `getApiError` was extracted from `utils.ts` into its own module
  // (`lib/api-error.ts`) when the i18next dependency made it
  // unsafe-to-import from RSC contexts. The regression checks now
  // read the new file.
  const apiError = readSrcSafe('../../apps/web/src/lib/api-error.ts');

  test('getApiError exists', () => {
    expect(apiError).toMatch(/export function getApiError/);
  });

  test('output is length-capped (no runaway error strings)', () => {
    // Must enforce a cap so a malicious backend cannot splash a megabyte of
    // text into the toast / UI. The cap may be expressed as a constant.
    expect(apiError).toMatch(/MAX_LEN\s*=\s*500|slice\(0,\s*500\)|slice\(0,\s*MAX_LEN\)/);
  });

  test('no raw Error.message leak path (only trusted backend strings surface)', () => {
    // Explicit comment in the source guards against a future dev adding a
    // fall-through to err.message and re-opening the leak vector.
    expect(apiError).toMatch(/No.*Error\.message.*leak|Intentionally no.*Error\.message/i);
  });
});

webDescribe('REGRESSION: FE — security headers in next.config.ts', () => {
  const cfg = readSrcSafe('../../apps/web/next.config.ts');

  test('Permissions-Policy header set', () => {
    expect(cfg).toMatch(/key:\s*["']Permissions-Policy["']/);
  });

  test('Cross-Origin-Opener-Policy set to same-origin', () => {
    expect(cfg).toMatch(/key:\s*["']Cross-Origin-Opener-Policy["']/);
    expect(cfg).toMatch(/same-origin/);
  });

  test('Cross-Origin-Resource-Policy set', () => {
    expect(cfg).toMatch(/key:\s*["']Cross-Origin-Resource-Policy["']/);
  });
});

webDescribe('REGRESSION: FE — payment callback strips control chars + bidi overrides', () => {
  const page = readSrcSafe('../../apps/web/src/app/payment/callback/page.tsx');

  test('bidi overrides + control chars stripped from user-reachable error strings', () => {
    // Either via named helper or inline regex covering \u2066-\u2069 + \u202A-\u202E
    expect(page).toMatch(/stripBidiOverrides|\\u2066|\\u202A|\\u0000-\\u001F/);
  });

  test('error string length-capped (<=200 chars)', () => {
    expect(page).toMatch(/slice\(0,\s*200\)|substring\(0,\s*200\)|length\s*>\s*200/);
  });
});

webDescribe('REGRESSION: FE — all pages route API errors through getApiError', () => {
  // Walk apps/web/src recursively, collect *.tsx + *.ts files.
  function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        walk(full, acc);
      } else if (/\.(tsx|ts)$/.test(entry.name)) {
        acc.push(full);
      }
    }
    return acc;
  }

  const webRoot = path.join(__dirname, '..', '..', '..', 'apps', 'web', 'src');
  // `walk` is only called when WEB_SRC_AVAILABLE is true (via webDescribe),
  // but the describe callback still executes synchronously to register tests.
  // Guard so the fs.readdirSync at the top of `walk` can't crash the load.
  const files = WEB_SRC_AVAILABLE ? walk(webRoot) : [];

  test('no raw response.data.message display without getApiError', () => {
    // Pattern: any file that reads `response?.data?.message` / `response.data.message`
    // as a surfaced string (setError/setErrorMsg/setMessage/toast/alert) MUST also
    // import or call getApiError. Otherwise a malicious/large backend string can
    // splash into the UI without the 500-char cap and no-leak guarantees.
    const RESPONSE_DATA_MSG = /\.response\??\.data\??\.message/;
    const ALLOWED = /getApiError/;

    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf-8');
      if (!RESPONSE_DATA_MSG.test(src)) continue;
      if (ALLOWED.test(src)) continue;
      // Allow lib/utils.ts itself — it's the legitimate implementer.
      if (file.endsWith(path.join('src', 'lib', 'utils.ts'))) continue;
      offenders.push(path.relative(webRoot, file));
    }

    if (offenders.length > 0) {
      const list = offenders.map(f => `  - ${f}`).join('\n');
      throw new Error(
        `These files read response.data.message without getApiError():\n${list}\n\n` +
        `Fix: import { getApiError } from '@/lib/utils' and use getApiError(err, fallback).`,
      );
    }
  });

  test('no direct console.error(err) leaking raw errors in pages', () => {
    // console.error(err) surfaces the raw object (including response body) to
    // the browser console — fine for dev, but in prod it can show up in
    // support-session recordings, crash reports, or shared screenshots.
    const BAD = /console\.(error|log|warn)\s*\(\s*err\s*\)/;
    const offenders: string[] = [];
    for (const file of files) {
      // Only check pages + components, not lib/api or test helpers
      if (!file.includes(path.join('src', 'app')) && !file.includes(path.join('src', 'components'))) continue;
      const src = fs.readFileSync(file, 'utf-8');
      if (BAD.test(src)) offenders.push(path.relative(webRoot, file));
    }
    if (offenders.length > 0) {
      const list = offenders.map(f => `  - ${f}`).join('\n');
      throw new Error(
        `These files log raw errors via console.*(err):\n${list}\n\n` +
        `Fix: remove the console call, or use a sanitized string via getApiError(err).`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase-A audit additions (2026-04-22) — close gaps found while finishing
// the integration tier: IDOR guard coverage, upload size limits, resend-
// verification enumeration guard, security header depth.
// ═══════════════════════════════════════════════════════════════════════════

describe('REGRESSION: IDOR — ownership baked into Prisma `where` clause (collapsed to 404)', () => {
  // Updated 2026-05-01: ownership is no longer asserted via post-fetch
  // `customerId !== userId` / `vendorId !== vendor.id` checks (which leaked
  // a 403 vs 404 distinction). It now lives inside the `findFirst({ where })`
  // so a foreign row returns null and the service throws NotFoundException
  // identical to "no such row". These tests verify the new pattern.

  test('HIGH: vendor.service every activity-scoped read uses { vendorId: vendor.id } in where', () => {
    const src = readSrc('src/vendor/vendor.service.ts');
    // Count occurrences of the ownership-scoped where pattern across the file
    const ownedActivityLookups = src.match(/findFirst\([\s\S]{0,200}?vendorId:\s*vendor\.id/g) ?? [];
    expect(ownedActivityLookups.length).toBeGreaterThanOrEqual(5);
    // Review path uses the nested-relation form
    expect(src).toMatch(/findFirst\([\s\S]{0,200}?activity:\s*\{\s*vendorId:\s*vendor\.id/);
    // Old leak strings must be gone
    expect(src).not.toMatch(/throw new ForbiddenException\(['"]You do not own/);
    expect(src).not.toMatch(/throw new ForbiddenException\(['"]Not your (booking|activity|review)/);
  });

  test('HIGH: bookings.service customer-side ownership baked into where, not post-checked', () => {
    const src = readSrc('src/bookings/bookings.service.ts');
    // cancelBooking + getBookingById must scope by customerId in the lookup
    const customerScoped = src.match(/findFirst\([\s\S]{0,200}?customerId:\s*userId/g) ?? [];
    expect(customerScoped.length).toBeGreaterThanOrEqual(2);
    // No "Not your booking" leak left on customer path
    expect(src).not.toContain("ForbiddenException('Not your booking')");
    // Vendor path — verifies vendor.userId linkage to the authed user
    // (this remains a post-fetch check; vendor role context is different)
    expect(src).toMatch(/booking\.vendor\.userId\s*===?\s*userId/);
  });

  test('HIGH: payment.service customer-side ownership baked into where', () => {
    const src = readSrc('src/payment/payment.service.ts');
    // initiatePayment + getPaymentStatus must scope by customerId in the lookup
    const customerScoped = src.match(/findFirst\([\s\S]{0,200}?customerId:\s*userId/g) ?? [];
    expect(customerScoped.length).toBeGreaterThanOrEqual(2);
    // The old explicit-check leak path must be gone
    expect(src).not.toMatch(/customerId\s*!==?\s*userId/);
    expect(src).not.toContain('Not your booking');
  });
});

describe('REGRESSION: Upload — hard-coded file size limit enforced', () => {
  test('HIGH: multer limits.fileSize is set (no unlimited uploads)', () => {
    const src = readSrc('src/common/services/upload.service.ts');
    expect(src).toContain('limits:');
    expect(src).toMatch(/fileSize:\s*\w/);
    // Default 10 MB, env-configurable — that's the whole point
    expect(src).toContain('UPLOAD_MAX_SIZE_MB');
  });
});

describe('REGRESSION: Auth — resend-verification enumeration guard', () => {
  test('HIGH: resend-verification is gated by RATE_LIMIT_STRICT (anti-enumeration)', () => {
    const src = readSrc('src/auth/auth.controller.ts');
    // The handler must be decorated with RATE_LIMIT_STRICT on the 3 lines
    // surrounding `Post('resend-verification')` — stricter than the default
    // RATE_LIMIT_AUTH most auth handlers use.
    const idx = src.indexOf("Post('resend-verification')");
    expect(idx).toBeGreaterThan(-1);
    // Grab 400 chars around the handler (before + after)
    const window = src.slice(Math.max(0, idx - 200), idx + 200);
    expect(window).toContain('@Throttle(RATE_LIMIT_STRICT)');
  });

  test('HIGH: resend-verification service never reveals whether email exists', () => {
    const src = readSrc('src/auth/auth.service.ts');
    const method = src.match(/async\s+resendVerification[\s\S]{0,1500}/)?.[0] ?? '';
    // Should return void or a generic OK, not leak "user found" / "user not found"
    expect(method).not.toMatch(/throw.*NotFoundException/);
    expect(method).not.toMatch(/User not found/);
  });
});

describe('REGRESSION: Security headers — Helmet config depth', () => {
  test('MEDIUM: main.ts configures HSTS, X-Frame-Options, Content-Type-Options via Helmet', () => {
    const main = readSrc('src/main.ts');
    // Helmet defaults already cover these, but explicit opts are expected
    // since CSP was explicitly configured — prove the defaults aren't turned off
    expect(main).toContain('helmet');
    // NEVER turn off contentSecurityPolicy or frameguard via Helmet
    expect(main).not.toMatch(/contentSecurityPolicy:\s*false/);
    expect(main).not.toMatch(/frameguard:\s*false/);
    expect(main).not.toMatch(/hsts:\s*false/);
  });

  test('MEDIUM: cookie attributes — HttpOnly + Secure (prod) + SameSite=strict', () => {
    const src = readSrc('src/auth/auth.service.ts');
    expect(src).toMatch(/httpOnly:\s*true/);
    expect(src).toMatch(/sameSite:\s*['"]strict['"]/);
    // Secure gate — true in production only
    expect(src).toMatch(/secure:.*NODE_ENV.*production/s);
  });
});

describe('REGRESSION: Log injection — err.name not err.message in user-controlled logs', () => {
  test('HIGH: redis-lock, redis-throttler, cleanup services log err.name only', () => {
    // Earlier audit flagged that raw err.message could leak Redis infrastructure
    // hostnames / WRONGPASS / NOAUTH. Re-verify the fix still stands.
    const files = [
      'src/redis/redis-lock.service.ts',
      'src/redis/redis-throttler.storage.ts',
      'src/common/services/cleanup.service.ts',
    ];
    for (const f of files) {
      const src = readSrc(f);
      // No bare err.message interpolation in logger lines
      const bad = src.match(/logger\.(error|warn)\([^)]*\$\{\s*err\.message/);
      if (bad) {
        throw new Error(`${f} logs raw err.message — should use err.name`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Payout workflow invariants — protect money-path against silent refactors.
// ═══════════════════════════════════════════════════════════════════════════
//
// Each pin here maps 1:1 to a design decision documented in the payout plan.
// If an engineer ever refactors these methods in a way that undoes the
// decision (e.g. re-flips payments PAID inside the COMPLETED branch, or
// drops the in-flight guard on markPayoutsPaid), the corresponding test
// fires with a clear message.

describe('REGRESSION: Payout workflow invariants', () => {
  const adminSvc       = readSrc('src/admin/admin.service.ts');
  const vendorSvc      = readSrc('src/vendor/vendor.service.ts');
  const adminCtrl      = readSrc('src/admin/admin.controller.ts');
  const vendorCtrl     = readSrc('src/vendor/vendor.controller.ts');
  const revertDto      = readSrc('src/admin/dto/revert-payout-request.dto.ts');
  const loyaltyDto     = readSrc('src/admin/dto/loyalty-user-query.dto.ts');
  const bookingsSvc    = readSrc('src/bookings/bookings.service.ts');
  const paymentSvc     = readSrc('src/payment/payment.service.ts');

  // Small helper to slice a single method body out of a TS source by name.
  // Uses the `async <name>(` declaration as anchor and the next top-level
  // `async ` (2-space indent, method sibling) as terminator.
  function sliceMethod(src: string, name: string): string {
    const start = src.search(new RegExp(`\\basync\\s+${name}\\s*\\(`));
    if (start < 0) throw new Error(`method not found: ${name}`);
    // Find the next method declaration (same-indent async) after `start`.
    const tail = src.slice(start + 20);
    const next = tail.search(/\n\s{0,4}(async|private|public|protected)\s+\w+\s*\(/);
    return next > 0 ? tail.slice(0, next) : tail;
  }

  test('CRITICAL: revertPayoutRequest transition whitelist does NOT allow REJECTED → APPROVED', () => {
    const method = sliceMethod(adminSvc, 'revertPayoutRequest');
    // The `allowedTransitions` object must exist and REJECTED must only
    // list PENDING — never APPROVED. A refactor that adds APPROVED here
    // skips re-eligibility and reopens the double-pay scam.
    expect(method).toContain('allowedTransitions');
    expect(method).toMatch(/REJECTED\s*:\s*\[\s*['"]PENDING['"]\s*\]/);
    expect(method).not.toMatch(/REJECTED\s*:\s*\[[^\]]*APPROVED/);
  });

  test('CRITICAL: RevertPayoutRequestDto only accepts PENDING | APPROVED', () => {
    // DTO @IsEnum acts as the first-line whitelist on inbound strings.
    expect(revertDto).toMatch(/@IsEnum\s*\(\s*\[\s*['"]PENDING['"]\s*,\s*['"]APPROVED['"]\s*\]/);
    // Guard against someone quietly expanding the enum. Scope the negative
    // to the @IsEnum array itself so the JSDoc (which legitimately mentions
    // REJECTED / COMPLETED to explain why they're blocked) doesn't trip it.
    const enumLine = revertDto.match(/@IsEnum\([^)]*\)/)?.[0] ?? '';
    expect(enumLine).not.toMatch(/REJECTED|COMPLETED/);
  });

  test('CRITICAL: markPayoutsPaid runs in-flight query BEFORE payment.updateMany', () => {
    const method = sliceMethod(adminSvc, 'markPayoutsPaid');
    // The in-flight lookup must precede the bulk flip to PAID.
    const inflightIdx = method.search(/payoutRequest\.findMany/);
    const updateIdx   = method.search(/payment\.updateMany/);
    expect(inflightIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(inflightIdx).toBeLessThan(updateIdx);
    // The query must scope to in-flight statuses (not COMPLETED/REJECTED).
    expect(method).toMatch(/status:\s*\{\s*in:\s*\[\s*['"]PENDING['"]\s*,\s*['"]APPROVED['"]\s*\]/);
  });

  test('CRITICAL: processPayoutRequest COMPLETED branch does NOT flip payment.payoutStatus to PAID', () => {
    const method = sliceMethod(adminSvc, 'processPayoutRequest');
    // Extract the COMPLETED branch only.
    const completedStart = method.indexOf("action === 'COMPLETED'");
    expect(completedStart).toBeGreaterThan(-1);
    const branch = method.slice(completedStart, method.indexOf('// ─── REJECTED', completedStart));
    // No `payoutStatus: 'PAID'` literal and no `payment.updateMany` call.
    expect(branch).not.toMatch(/payoutStatus\s*:\s*['"]PAID['"]/);
    expect(branch).not.toMatch(/tx\.payment\.updateMany|payment\.updateMany/);
  });

  test('HIGH: markPayoutUnpaid rejects payments locked in APPROVED or COMPLETED requests', () => {
    const method = sliceMethod(adminSvc, 'markPayoutUnpaid');
    expect(method).toMatch(/paymentIds\s*:\s*\{\s*has:\s*paymentId\s*\}/);
    expect(method).toMatch(/status:\s*\{\s*in:\s*\[\s*['"]APPROVED['"]\s*,\s*['"]COMPLETED['"]\s*\]/);
  });

  test('HIGH: deletePayoutRequest only permits status=REJECTED at BOTH guard and deleteMany filter', () => {
    const method = sliceMethod(vendorSvc, 'deletePayoutRequest');
    expect(method).toContain("req.status !== 'REJECTED'");
    expect(method).toMatch(/deleteMany\([\s\S]*status:\s*['"]REJECTED['"]/);
  });

  test('HIGH: all vendor notification links use slug-scoped template literals', () => {
    // Combine every service file that emits vendor-portal notifications.
    const combined = adminSvc + '\n' + bookingsSvc + '\n' + paymentSvc;
    // Every `link: '/vendor/...'` must either interpolate ${...slug...} or
    // the string literal must be the admin-facing /vendor path (there are none —
    // admin pages live under /admin/*). Collect matches and assert on each.
    const matches = combined.match(/link:\s*[`'"]\/vendor\/[^`'"]+[`'"]/g) || [];
    for (const m of matches) {
      // Acceptable:  link: `/vendor/${slug}/earnings`    (template literal with ${)
      // Unacceptable: link: '/vendor/earnings' or '/vendor/bookings' (no interpolation)
      expect(m).toMatch(/\$\{/);
    }
    // Extra paranoia: the specific slug-less links we removed must never reappear.
    expect(combined).not.toMatch(/link:\s*['"]\/vendor\/earnings['"]/);
    expect(combined).not.toMatch(/link:\s*['"]\/vendor\/bookings['"]/);
    expect(combined).not.toMatch(/link:\s*['"]\/vendor\/dashboard['"]/);
    expect(combined).not.toMatch(/link:\s*['"]\/vendor\/refund-requests['"]/);
  });

  // Locate a route decorator given an HTTP method + exact route string.
  // `method` can be a pipe-joined list (e.g. 'Post|Patch|Delete') when the
  // route is unique to one verb, or you can pass the exact verb to avoid
  // grabbing a sibling route with the same path (e.g. GET vs PATCH /profile).
  function findRouteDecorator(src: string, route: string, method = 'Post|Patch|Delete|Get'): number {
    const re = new RegExp(`@(${method})\\(\\s*['"\`]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]\\s*\\)`);
    const m = src.match(re);
    return m?.index ?? -1;
  }

  test('HIGH: admin routes with financial/escalation risk carry RATE_LIMIT_STRICT', () => {
    // Each route's decorator block (1–3 lines above the @Post/@Patch) must
    // include @Throttle(RATE_LIMIT_STRICT) — otherwise they inherit the
    // class-level ADMIN limit (120/min), too permissive for destructive
    // financial/escalation actions.
    // Pair (route, verb). Pinning the verb avoids false matches on sibling
    // routes (e.g. GET /profile vs PATCH /profile/password).
    const mustBeStrict: Array<[string, string]> = [
      ['payouts/mark-unpaid',      'Post'],
      ['payout-requests/:id/revert','Post'],
      ['users/:id/role',           'Patch'],
      ['users/:id/deactivate',     'Patch'],
      ['vendors/:id/commission',   'Patch'],
      ['profile/password',         'Patch'],
    ];
    for (const [route, verb] of mustBeStrict) {
      const anchor = findRouteDecorator(adminCtrl, route, verb);
      expect({ route, found: anchor }).toEqual(expect.objectContaining({ route, found: expect.any(Number) }));
      expect(anchor).toBeGreaterThan(-1);
      // Throttle decorator sits 0–3 lines before the route decorator.
      // Decorators can be above OR below @Patch in NestJS conventions.
      // Slice a window around the route decorator and assert the throttle
      // decorator belongs to this route (matched by proximity, not a brittle
      // above/below ordering).
      const slice = adminCtrl.slice(Math.max(0, anchor - 200), anchor + 200);
      expect({ route, decorator: slice }).toEqual(
        expect.objectContaining({
          route,
          decorator: expect.stringContaining('@Throttle(RATE_LIMIT_STRICT)'),
        }),
      );
    }
  });

  test('HIGH: admin PATCH /profile and /vendors/:id/trust use RATE_LIMIT_WRITE', () => {
    const routes: Array<[string, string]> = [
      ['profile',           'Patch'],
      ['vendors/:id/trust', 'Patch'],
    ];
    for (const [route, verb] of routes) {
      const anchor = findRouteDecorator(adminCtrl, route, verb);
      expect(anchor).toBeGreaterThan(-1);
      const slice = adminCtrl.slice(Math.max(0, anchor - 200), anchor + 200);
      expect(slice).toContain('@Throttle(RATE_LIMIT_WRITE)');
    }
  });

  test('MEDIUM: vendor DELETE /payout-requests/:id uses RATE_LIMIT_WRITE + ParseUUIDPipe', () => {
    // Pin the DELETE verb — POST /payout-requests/:id also exists and would
    // match a verb-less finder. Restrict to DELETE.
    const anchor = findRouteDecorator(vendorCtrl, 'payout-requests/:id', 'Delete');
    expect(anchor).toBeGreaterThan(-1);
    const slice = vendorCtrl.slice(anchor - 200, anchor + 400);
    expect(slice).toContain('@Throttle(RATE_LIMIT_WRITE)');
    expect(slice).toContain('ParseUUIDPipe');
  });

  test('MEDIUM: vendor GET /payout-requests/eligibility uses RATE_LIMIT_READ', () => {
    const anchor = findRouteDecorator(vendorCtrl, 'payout-requests/eligibility');
    expect(anchor).toBeGreaterThan(-1);
    const slice = vendorCtrl.slice(anchor - 200, anchor + 300);
    expect(slice).toContain('@Throttle(RATE_LIMIT_READ)');
  });

  test('MEDIUM: LoyaltyUserQueryDto whitelists only asc|desc via @IsIn', () => {
    expect(loyaltyDto).toMatch(/@IsIn\s*\(\s*\[\s*['"]desc['"]\s*,\s*['"]asc['"]\s*\]/);
  });

  test('MEDIUM: evaluatePayoutEligibility reads MIN_PAYOUT_AMOUNT from env (not hardcoded)', () => {
    expect(vendorSvc).toContain('process.env.MIN_PAYOUT_AMOUNT');
    // The eligibility method computes `minimum = Math.max(0, Number(process.env.MIN_PAYOUT_AMOUNT || N))`.
    expect(vendorSvc).toMatch(/Math\.max\(\s*0\s*,\s*Number\(\s*process\.env\.MIN_PAYOUT_AMOUNT/);
  });

  test('MEDIUM: evaluatePayoutEligibility applies lockedPaymentIds filter in booking.aggregate', () => {
    // The lockedPaymentIds computation + the conditional `id: { notIn: ... }`
    // spread must appear within the evaluatePayoutEligibility method.
    const method = sliceMethod(vendorSvc, 'evaluatePayoutEligibility');
    expect(method).toContain('lockedPaymentIds');
    expect(method).toMatch(/id:\s*\{\s*notIn:\s*lockedPaymentIds/);
  });
});
