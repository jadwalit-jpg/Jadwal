/**
 * Language-specific business-name validation — the "(English)" field must be
 * Latin script (Arabic there also breaks the auto-generated slug), the
 * "(Arabic)" field must contain Arabic script. Mirrors the client validators in
 * apps/web/src/lib/validation.ts.
 */
import {
  BUSINESS_NAME_EN_REGEX,
  BUSINESS_NAME_AR_REGEX,
} from '../../src/common/validators/name-allowlist';

describe('BUSINESS_NAME_EN_REGEX — Latin only, rejects Arabic', () => {
  it.each([
    'Sunset Yacht Co.',
    'Café & Co',            // accented Latin
    "Doha Adventures (2026)",
    'A.C. Desert Tours + BBQ',
  ])('accepts a valid English name: %s', (v) => {
    expect(BUSINESS_NAME_EN_REGEX.test(v)).toBe(true);
  });

  it.each([
    'شركة اليخوت',          // pure Arabic — the reported bug
    'Sunset يخت',           // mixed with Arabic
    '   ',                  // blank-looking
    '<script>',             // HTML-shaped
  ])('rejects: %s', (v) => {
    expect(BUSINESS_NAME_EN_REGEX.test(v)).toBe(false);
  });
});

describe('BUSINESS_NAME_AR_REGEX — must contain Arabic', () => {
  it.each([
    'شركة اليخوت',
    'مطعم Pizza',           // mixed brand name — allowed
    'رحلات الدوحة 2026',
  ])('accepts an Arabic name: %s', (v) => {
    expect(BUSINESS_NAME_AR_REGEX.test(v)).toBe(true);
  });

  it.each([
    'Sunset Yacht Co.',     // English only in the Arabic field
    '12345',
    '   ',
  ])('rejects: %s', (v) => {
    expect(BUSINESS_NAME_AR_REGEX.test(v)).toBe(false);
  });
});
