/**
 * Frontend validation utility tests (#66 in the gap list).
 *
 * We import from the web package via relative path. These are pure TS
 * functions — no DOM, no React — so they run cleanly under the API's Jest
 * config. Prevents us from needing a full jest + jsdom setup in apps/web
 * just to cover ~30 tests of sanitize/validate logic.
 *
 * The import is dynamic-guarded because the API Docker container mounts
 * only `apps/api/` — when `apps/web/` is absent the module resolver fails
 * at suite load and takes the whole file down. On host runs (where the
 * web workspace sits next to api), the resolver returns the real module.
 */

import * as fs from 'fs';
import * as path from 'path';

const WEB_VALIDATION_PATH = path.join(__dirname, '..', '..', '..', 'web', 'src', 'lib', 'validation.ts');
const WEB_AVAILABLE = fs.existsSync(WEB_VALIDATION_PATH);
// Only require when the file exists. Dynamic `require` keeps static ts-jest
// resolution happy without a top-level import that would fail at load.
const validation: any = WEB_AVAILABLE ? require('../../../web/src/lib/validation') : {};
const webDescribe = WEB_AVAILABLE ? describe : describe.skip;

const { sanitize, sanitizeObject, validateEmail, validatePassword, validateFullName, validatePhone, validateSlug, validateLoginForm } = validation as any;

// ═══════════════════════════════════════════════════════════════════════════
// sanitize
// ═══════════════════════════════════════════════════════════════════════════

webDescribe('sanitize', () => {
  test('strips < and > characters', () => {
    expect(sanitize('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
  });

  test('strips javascript: protocol', () => {
    expect(sanitize('javascript:void(0)')).toBe('void(0)');
  });

  test('case-insensitively strips JavaScript:', () => {
    expect(sanitize('JavaScript:alert(1)')).toBe('alert(1)');
  });

  test('strips event-handler attributes (onclick=, onerror=)', () => {
    const out = sanitize('onclick=alert(1) onerror=x');
    expect(out).not.toMatch(/on\w+=/i);
  });

  test('strips data:text/html', () => {
    const out = sanitize('data:text/html,<script>x</script>');
    expect(out).not.toContain('data:text/html');
  });

  test('strips RTL / LTR override characters (bidi)', () => {
    // ‮ = RIGHT-TO-LEFT OVERRIDE — used to disguise file extensions
    const input = 'photo‮gnp.exe';
    expect(sanitize(input)).toBe('photognp.exe');
  });

  test('trims whitespace', () => {
    expect(sanitize('   hello   ')).toBe('hello');
  });

  test('passes through safe text unchanged', () => {
    expect(sanitize('Hello, World!')).toBe('Hello, World!');
  });

  test('handles empty string without crashing', () => {
    expect(sanitize('')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sanitizeObject
// ═══════════════════════════════════════════════════════════════════════════

webDescribe('sanitizeObject', () => {
  test('sanitizes string values in the object', () => {
    const result = sanitizeObject({
      name: '<b>Alice</b>',
      age: 30,
      bio: 'javascript:alert(1)',
    });
    expect(result.name).toBe('bAlice/b');
    expect(result.age).toBe(30); // numbers untouched
    expect(result.bio).toBe('alert(1)');
  });

  test('sanitizes each string in a string array', () => {
    const result = sanitizeObject({
      tags: ['<script>a</script>', 'normal', 'javascript:b'],
    });
    expect(result.tags).toEqual(['scripta/script', 'normal', 'b']);
  });

  test('leaves non-string arrays untouched', () => {
    const result = sanitizeObject({ ids: [1, 2, 3] });
    expect(result.ids).toEqual([1, 2, 3]);
  });

  test('does not mutate the original object', () => {
    const input = { name: '<b>Alice</b>' };
    sanitizeObject(input);
    expect(input.name).toBe('<b>Alice</b>');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// validateEmail
// ═══════════════════════════════════════════════════════════════════════════

webDescribe('validateEmail', () => {
  test.each([
    'a@b.co', 'alice@example.com', 'alice+tag@example.co.uk',
  ])('accepts valid "%s"', (e) => {
    expect(validateEmail(e)).toEqual({ valid: true });
  });

  test.each([
    ['', 'required'],
    ['notanemail', 'Invalid'],
    ['missing@tld', 'Invalid'],
    ['@nolocal.com', 'Invalid'],
    ['spaces in@mail.com', 'Invalid'],
  ])('rejects "%s" with error containing "%s"', (e, expected) => {
    const r = validateEmail(e);
    expect(r.valid).toBe(false);
    expect((r as any).error).toContain(expected);
  });

  test('rejects overly long email (> 254 chars)', () => {
    const r = validateEmail('a'.repeat(250) + '@test.com');
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/too long/i);
  });

  test('trims whitespace before validating', () => {
    expect(validateEmail('   alice@example.com   ')).toEqual({ valid: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// validatePassword
// ═══════════════════════════════════════════════════════════════════════════

webDescribe('validatePassword', () => {
  test('accepts strong password', () => {
    expect(validatePassword('Str0ngPass!')).toEqual({ valid: true });
  });

  test('rejects empty', () => {
    expect(validatePassword('').valid).toBe(false);
  });

  test('rejects < 8 chars', () => {
    const r = validatePassword('Abc123!');
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/at least 8/);
  });

  test('rejects > 128 chars', () => {
    const r = validatePassword('A1a'.repeat(50));
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/too long/i);
  });

  test('rejects all-lowercase (no uppercase)', () => {
    const r = validatePassword('alllowercase1');
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/uppercase/);
  });

  test('rejects all-uppercase (no lowercase)', () => {
    const r = validatePassword('ALLUPPERCASE1');
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/lowercase/);
  });

  test('rejects alpha-only (no digit)', () => {
    const r = validatePassword('NoDigitsHere');
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/number/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// validateFullName
// ═══════════════════════════════════════════════════════════════════════════

webDescribe('validateFullName', () => {
  test('accepts normal name', () => {
    expect(validateFullName('Alice Liddell')).toEqual({ valid: true });
  });

  test('accepts Arabic name', () => {
    expect(validateFullName('أليس ليدل')).toEqual({ valid: true });
  });

  test('rejects empty / whitespace-only', () => {
    expect(validateFullName('').valid).toBe(false);
    expect(validateFullName('    ').valid).toBe(false);
  });

  test('rejects < 2 chars after trim', () => {
    const r = validateFullName(' A ');
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/too short/i);
  });

  test('rejects > 100 chars', () => {
    const r = validateFullName('X'.repeat(101));
    expect(r.valid).toBe(false);
  });

  test.each([
    'Alice<script>', 'Alice{x}', 'Alice[y]', 'Alice(z)',
    'Alice/slash', 'Alice\\back', 'Alice;semicolon',
  ])('rejects names with injection char "%s"', (n) => {
    expect(validateFullName(n).valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// validatePhone — GCC formats + generic
// ═══════════════════════════════════════════════════════════════════════════

webDescribe('validatePhone', () => {
  test('empty phone is valid (optional)', () => {
    expect(validatePhone('')).toEqual({ valid: true });
  });

  test.each([
    ['+97412345678', 'QA'],
    ['+966123456789', 'SA'],
    ['+971501234567', 'AE'],
    ['+96512345678', 'KW'],
    ['+97312345678', 'BH'],
    ['+96812345678', 'OM'],
  ])('accepts correct GCC format "%s" for %s', (phone, iso) => {
    expect(validatePhone(phone, iso)).toEqual({ valid: true });
  });

  test('accepts Qatar number with leading 0 (no country code)', () => {
    expect(validatePhone('012345678', 'QA')).toEqual({ valid: true });
  });

  test('rejects wrong digit count for Qatar (8 required, gave 7)', () => {
    const r = validatePhone('+9741234567', 'QA');
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/8 digits/);
  });

  test('rejects non-digit characters', () => {
    const r = validatePhone('+974abcdefgh', 'QA');
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/only digits/i);
  });

  test('strips whitespace / dashes before validating', () => {
    expect(validatePhone('+974 1234-5678', 'QA')).toEqual({ valid: true });
    // Note: parentheses strip but user must still supply + or leading 0;
    // (974)12345678 fails because "974..." has no + and doesn't start with 0,
    // so it's interpreted as 10 raw digits, not matching 8.
    expect(validatePhone('+(974) 1234-5678', 'QA')).toEqual({ valid: true });
  });

  test('generic fallback (no countryIso) accepts +15551234567', () => {
    expect(validatePhone('+15551234567')).toEqual({ valid: true });
  });

  test('generic fallback rejects letters', () => {
    expect(validatePhone('abc123').valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// validateSlug
// ═══════════════════════════════════════════════════════════════════════════

webDescribe('validateSlug', () => {
  test('accepts lowercase-hyphen-digit slug', () => {
    expect(validateSlug('desert-safari-2030')).toEqual({ valid: true });
  });

  test('rejects uppercase', () => {
    expect(validateSlug('Desert-Safari').valid).toBe(false);
  });

  test('rejects underscores', () => {
    expect(validateSlug('desert_safari').valid).toBe(false);
  });

  test('rejects empty', () => {
    expect(validateSlug('').valid).toBe(false);
  });

  test('rejects > 60 chars', () => {
    expect(validateSlug('x'.repeat(61)).valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// validateLoginForm — compound
// ═══════════════════════════════════════════════════════════════════════════

webDescribe('validateLoginForm', () => {
  test('happy path both valid → valid', () => {
    expect(validateLoginForm('a@b.co', 'GoodP@ssw0rd')).toEqual({ valid: true });
  });

  test('bad email short-circuits before password check', () => {
    const r = validateLoginForm('bademail', 'anything');
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/email/i);
  });

  test('valid email + weak password → password error', () => {
    const r = validateLoginForm('a@b.co', 'weak');
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/password/i);
  });
});
