import {
  LANG_COOKIE,
  LANG_STORAGE_KEY,
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  isLang,
} from '@/lib/lang-cookie';

describe('lang-cookie constants', () => {
  it('uses the jadwal_lang cookie + storage key (load-bearing — server layout reads this)', () => {
    // Changing either of these silently breaks SSR hydration because the
    // server and client would read from different keys.
    expect(LANG_COOKIE).toBe('jadwal_lang');
    expect(LANG_STORAGE_KEY).toBe('jadwal_lang');
  });

  it('supports exactly en + ar', () => {
    expect(SUPPORTED_LANGS).toEqual(['en', 'ar']);
  });

  it('defaults to en when no cookie is present', () => {
    expect(DEFAULT_LANG).toBe('en');
  });
});

describe('isLang type guard', () => {
  it('accepts the two supported languages', () => {
    expect(isLang('en')).toBe(true);
    expect(isLang('ar')).toBe(true);
  });

  it('rejects any other string (incl. close look-alikes)', () => {
    expect(isLang('EN')).toBe(false);
    expect(isLang('En')).toBe(false);
    expect(isLang('eng')).toBe(false);
    expect(isLang('arabic')).toBe(false);
    expect(isLang('')).toBe(false);
    expect(isLang('fr')).toBe(false);
  });

  it('rejects non-string input (defensive)', () => {
    expect(isLang(null)).toBe(false);
    expect(isLang(undefined)).toBe(false);
    expect(isLang(42)).toBe(false);
    expect(isLang({})).toBe(false);
    expect(isLang([])).toBe(false);
  });
});
