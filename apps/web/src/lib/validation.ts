/**
 * Frontend validation & sanitization utilities.
 * Used across all forms to validate before sending to the API.
 */

// ── Sanitization ──

/**
 * Strip bidirectional text override characters (U+202A–U+202E, U+2066–U+2069)
 * that can be used to disguise malicious URLs or flip displayed text direction.
 */
function stripBidiOverrides(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\u202A-\u202E\u2066-\u2069\u200F\u200E]/g, '');
}

/** Strip HTML tags, JS protocols, event handlers, bidi overrides, and trim */
export function sanitize(input: string): string {
  return stripBidiOverrides(input)
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/data\s*:\s*text\/html/gi, '')
    .trim();
}

/** Sanitize all string values in an object (shallow + nested) */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const sanitized = { ...obj };
  for (const key of Object.keys(sanitized)) {
    const val = sanitized[key];
    if (typeof val === 'string') {
      (sanitized as Record<string, unknown>)[key] = sanitize(val);
    } else if (Array.isArray(val)) {
      (sanitized as Record<string, unknown>)[key] = val.map((item) =>
        typeof item === 'string' ? sanitize(item) : item,
      );
    }
  }
  return sanitized;
}

// ── Validators ──

export type ValidationResult = { valid: true } | { valid: false; error: string };

export function validateEmail(email: string): ValidationResult {
  const trimmed = email.trim();
  if (!trimmed) return { valid: false, error: 'Email is required' };
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRegex.test(trimmed)) return { valid: false, error: 'Invalid email address' };
  if (trimmed.length > 254) return { valid: false, error: 'Email is too long' };
  return { valid: true };
}

export function validatePassword(password: string): ValidationResult {
  if (!password) return { valid: false, error: 'Password is required' };
  if (password.length < 8) return { valid: false, error: 'Password must be at least 8 characters' };
  if (password.length > 128) return { valid: false, error: 'Password is too long' };
  if (!/[a-z]/.test(password)) return { valid: false, error: 'Password must contain at least one lowercase letter' };
  if (!/[A-Z]/.test(password)) return { valid: false, error: 'Password must contain at least one uppercase letter' };
  if (!/\d/.test(password)) return { valid: false, error: 'Password must contain at least one number' };
  return { valid: true };
}

export function validateFullName(name: string): ValidationResult {
  const trimmed = name.trim();
  if (!trimmed) return { valid: false, error: 'Full name is required' };
  if (trimmed.length < 2) return { valid: false, error: 'Name is too short' };
  if (trimmed.length > 100) return { valid: false, error: 'Name is too long' };
  // Positive whitelist: letters of any script (\p{L} — Arabic + accented
  // Latin), combining marks (\p{M}), spaces, hyphen, apostrophe (straight +
  // curly) and period; first char must be a letter. Rejects digits AND
  // symbols like @$#$. Mirrors the server-side @Matches on the name DTOs.
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s'’.\-]*$/u.test(trimmed))
    return { valid: false, error: 'Name may only contain letters, spaces, hyphens and apostrophes' };
  return { valid: true };
}

// ── GCC Phone Validation ──

const GCC_PHONE_FORMATS: Record<string, { code: string; digits: number; label: string }> = {
  QA: { code: '+974', digits: 8, label: 'Qatar (+974 XXXXXXXX)' },
  SA: { code: '+966', digits: 9, label: 'Saudi Arabia (+966 XXXXXXXXX)' },
  AE: { code: '+971', digits: 9, label: 'UAE (+971 XXXXXXXXX)' },
  KW: { code: '+965', digits: 8, label: 'Kuwait (+965 XXXXXXXX)' },
  BH: { code: '+973', digits: 8, label: 'Bahrain (+973 XXXXXXXX)' },
  OM: { code: '+968', digits: 8, label: 'Oman (+968 XXXXXXXX)' },
};

/**
 * Validate phone number. If countryIso is provided, enforces GCC format.
 * Otherwise falls back to generic international validation.
 */
export function validatePhone(phone: string, countryIso?: string): ValidationResult {
  if (!phone) return { valid: true }; // optional field
  const cleaned = phone.replace(/[\s\-()]/g, '');

  if (countryIso && GCC_PHONE_FORMATS[countryIso]) {
    const fmt = GCC_PHONE_FORMATS[countryIso];
    const withoutCode = cleaned.startsWith(fmt.code)
      ? cleaned.slice(fmt.code.length)
      : cleaned.startsWith('0')
        ? cleaned.slice(1)
        : cleaned;

    if (!/^[0-9]+$/.test(withoutCode)) {
      return { valid: false, error: 'Phone number must contain only digits' };
    }
    if (withoutCode.length !== fmt.digits) {
      return { valid: false, error: `Expected ${fmt.digits} digits for ${fmt.label}` };
    }
    return { valid: true };
  }

  // Generic fallback
  if (!/^\+?[0-9]{7,15}$/.test(cleaned)) {
    return { valid: false, error: 'Invalid phone number' };
  }
  return { valid: true };
}

export function validateSlug(slug: string): ValidationResult {
  const trimmed = slug.trim();
  if (!trimmed) return { valid: false, error: 'Slug is required' };
  if (!/^[a-z0-9-]+$/.test(trimmed)) return { valid: false, error: 'Slug must be lowercase letters, numbers, and hyphens only' };
  if (trimmed.length > 60) return { valid: false, error: 'Slug is too long' };
  return { valid: true };
}

// ── Compound validators ──

export function validateLoginForm(email: string, password: string): ValidationResult {
  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) return emailCheck;
  const pwCheck = validatePassword(password);
  if (!pwCheck.valid) return pwCheck;
  return { valid: true };
}
