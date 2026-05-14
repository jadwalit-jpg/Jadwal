import {
  sanitize,
  sanitizeObject,
  validateEmail,
  validatePassword,
  validateFullName,
  validatePhone,
  validateSlug,
  validateLoginForm,
} from '@/lib/validation';

describe('sanitize', () => {
  it('strips angle brackets', () => {
    expect(sanitize('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
  });

  it('strips the javascript: protocol marker regardless of case', () => {
    expect(sanitize('javascript:void(0)')).toBe('void(0)');
    expect(sanitize('JAVASCRIPT:alert(1)')).toBe('alert(1)');
  });

  it('strips inline event handler fragments', () => {
    expect(sanitize('onclick=foo onload = bar')).toBe('foo  bar');
  });

  it('strips `data:text/html` data-URI marker', () => {
    expect(sanitize('data:text/html,<h1>x</h1>')).toBe(',h1x/h1');
  });

  it('strips bidi override characters that can mask URLs', () => {
    const tricky = 'hello‮badlink.com‪';
    expect(sanitize(tricky)).toBe('hellobadlink.com');
  });

  it('trims leading/trailing whitespace', () => {
    expect(sanitize('   hello   ')).toBe('hello');
  });

  it('leaves innocuous text untouched', () => {
    expect(sanitize('Naji Khalil')).toBe('Naji Khalil');
  });
});

describe('sanitizeObject', () => {
  it('sanitizes string values', () => {
    expect(sanitizeObject({ name: '<b>x</b>', count: 5 })).toEqual({ name: 'bx/b', count: 5 });
  });

  it('sanitizes every string element in an array value', () => {
    expect(sanitizeObject({ tags: ['<a>', 'ok'] })).toEqual({ tags: ['a', 'ok'] });
  });

  it('passes non-string, non-array values through untouched', () => {
    const d = new Date();
    expect(sanitizeObject({ when: d, n: 1, b: true, nil: null })).toEqual({
      when: d, n: 1, b: true, nil: null,
    });
  });

  it('does not mutate the input object', () => {
    const input = { name: '<x>' };
    sanitizeObject(input);
    expect(input.name).toBe('<x>');
  });
});

describe('validateEmail', () => {
  it.each([
    'a@b.co',
    'naji.khalil+tag@jadwal.app',
    'user_name-dot@sub.domain.io',
  ])('accepts %s', (email) => {
    expect(validateEmail(email)).toEqual({ valid: true });
  });

  it('rejects empty/blank email with a clear message', () => {
    expect(validateEmail('')).toEqual({ valid: false, error: 'Email is required' });
    expect(validateEmail('   ')).toEqual({ valid: false, error: 'Email is required' });
  });

  it.each([
    'not-an-email',
    '@no-local.com',
    'nobody@',
    'spaces @in.com',
    'double@@at.com',
    'trailing.dot.',
    'short-tld@a.b',
  ])('rejects malformed %s', (bad) => {
    const r = validateEmail(bad);
    expect(r.valid).toBe(false);
  });

  it('rejects overly long email addresses (>254 chars)', () => {
    const long = 'a'.repeat(250) + '@b.co';
    expect(validateEmail(long)).toEqual({ valid: false, error: 'Email is too long' });
  });
});

describe('validatePassword', () => {
  it('accepts a strong password', () => {
    expect(validatePassword('Str0ngPass!')).toEqual({ valid: true });
  });

  it('rejects empty', () => {
    expect(validatePassword('')).toEqual({ valid: false, error: 'Password is required' });
  });

  it('rejects short passwords (< 8 chars)', () => {
    const r = validatePassword('Ab1');
    expect(r).toEqual({ valid: false, error: 'Password must be at least 8 characters' });
  });

  it('rejects overly long passwords (> 128 chars)', () => {
    const r = validatePassword('A1' + 'a'.repeat(200));
    expect(r).toEqual({ valid: false, error: 'Password is too long' });
  });

  it('requires lowercase', () => {
    expect(validatePassword('ABCDEFG1')).toEqual({
      valid: false, error: 'Password must contain at least one lowercase letter',
    });
  });

  it('requires uppercase', () => {
    expect(validatePassword('abcdefg1')).toEqual({
      valid: false, error: 'Password must contain at least one uppercase letter',
    });
  });

  it('requires a digit', () => {
    expect(validatePassword('Abcdefgh')).toEqual({
      valid: false, error: 'Password must contain at least one number',
    });
  });
});

describe('validateFullName', () => {
  it('accepts typical names', () => {
    expect(validateFullName('Naji Khalil')).toEqual({ valid: true });
    expect(validateFullName('لمى العبدالله')).toEqual({ valid: true });
  });

  it('rejects empty / too short', () => {
    expect(validateFullName('')).toEqual({ valid: false, error: 'Full name is required' });
    expect(validateFullName('A')).toEqual({ valid: false, error: 'Name is too short' });
  });

  it('rejects names > 100 chars', () => {
    expect(validateFullName('x'.repeat(101))).toEqual({ valid: false, error: 'Name is too long' });
  });

  it('rejects names containing unsafe characters', () => {
    for (const ch of ['<', '>', '{', '}', '(', ')', '[', ']', '\\', '/', ';']) {
      const r = validateFullName(`Naji${ch}Khalil`);
      expect(r).toEqual({ valid: false, error: 'Name contains invalid characters' });
    }
  });

  it('rejects names containing ASCII digits', () => {
    for (const sample of ['John 1', 'Naji9', '5lice', 'Mary 23 Smith']) {
      const r = validateFullName(sample);
      expect(r).toEqual({ valid: false, error: 'Name cannot contain numbers' });
    }
  });

  it('rejects names containing Arabic-Indic digits', () => {
    // Arabic-Indic digits ٠١٢٣٤٥٦٧٨٩ — same logical zero-through-nine
    // as ASCII; reject these the same way to avoid an unicode bypass.
    for (const sample of ['لمى٥', 'محمد ١', 'سارة٢٣']) {
      const r = validateFullName(sample);
      expect(r).toEqual({ valid: false, error: 'Name cannot contain numbers' });
    }
  });
});

describe('validatePhone', () => {
  it('returns valid for empty phone (optional field)', () => {
    expect(validatePhone('')).toEqual({ valid: true });
  });

  describe('GCC-specific (QA)', () => {
    it('accepts +974 + 8 digits', () => {
      expect(validatePhone('+97433123456', 'QA')).toEqual({ valid: true });
    });

    it('accepts the local leading-0 form (09 then 7 digits = 8 digits total after strip)', () => {
      expect(validatePhone('055123456', 'QA')).toEqual({ valid: true });
    });

    it('tolerates spaces and hyphens', () => {
      expect(validatePhone('+974 3312 3456', 'QA')).toEqual({ valid: true });
      expect(validatePhone('+974-3312-3456', 'QA')).toEqual({ valid: true });
    });

    it('rejects wrong digit count', () => {
      const r = validatePhone('+974123', 'QA');
      expect(r.valid).toBe(false);
      expect((r as any).error).toMatch(/8 digits/);
    });

    it('rejects non-numeric input', () => {
      expect(validatePhone('+974abcdefgh', 'QA')).toEqual({
        valid: false,
        error: 'Phone number must contain only digits',
      });
    });
  });

  it('falls back to generic validation when country is unknown', () => {
    expect(validatePhone('+14155551234')).toEqual({ valid: true });
    expect(validatePhone('abc')).toEqual({ valid: false, error: 'Invalid phone number' });
  });
});

describe('validateSlug', () => {
  it('accepts lowercase-hyphens-only slugs', () => {
    expect(validateSlug('sample-tour-1')).toEqual({ valid: true });
  });

  it('rejects empty / uppercase / underscores / spaces', () => {
    expect(validateSlug('').valid).toBe(false);
    expect(validateSlug('Sample-Tour').valid).toBe(false);
    expect(validateSlug('sample_tour').valid).toBe(false);
    expect(validateSlug('sample tour').valid).toBe(false);
  });

  it('rejects slugs > 60 chars', () => {
    expect(validateSlug('a'.repeat(61))).toEqual({ valid: false, error: 'Slug is too long' });
  });
});

describe('validateLoginForm', () => {
  it('returns valid when both email + password are well-formed', () => {
    expect(validateLoginForm('naji@jadwal.app', 'Str0ngPass!')).toEqual({ valid: true });
  });

  it('short-circuits on an email error', () => {
    const r = validateLoginForm('bad-email', 'Str0ngPass!');
    expect(r).toEqual({ valid: false, error: 'Invalid email address' });
  });

  it('surfaces the password error when email is fine', () => {
    const r = validateLoginForm('naji@jadwal.app', 'weak');
    expect(r.valid).toBe(false);
    expect((r as any).error).toMatch(/at least 8 characters/);
  });
});
