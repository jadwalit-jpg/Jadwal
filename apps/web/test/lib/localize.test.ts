import { localized, isRtl } from '@/lib/localize';

// The helper reads i18n.language at call time, so each test mutates the
// shared singleton inside @/lib/i18n. Isolate by toggling the language via
// the same API the app uses (changeLanguage).
jest.mock('@/lib/i18n', () => {
  let current: 'en' | 'ar' = 'en';
  return {
    __esModule: true,
    default: {
      get language() { return current; },
      changeLanguage: (next: 'en' | 'ar') => {
        current = next;
        return Promise.resolve();
      },
      on: () => {},
      off: () => {},
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const i18n = require('@/lib/i18n').default;

afterEach(() => {
  i18n.changeLanguage('en');
});

describe('localized', () => {
  const activity = {
    titleEn: 'Desert Safari',
    titleAr: 'سفاري الصحراء',
    descriptionEn: 'A 6-hour tour.',
    descriptionAr: 'جولة لمدة ٦ ساعات.',
  };

  it('returns the EN field when language is en', () => {
    expect(localized(activity, 'title')).toBe('Desert Safari');
  });

  it('returns the AR field when language is ar', async () => {
    await i18n.changeLanguage('ar');
    expect(localized(activity, 'title')).toBe('سفاري الصحراء');
  });

  it('falls back to EN when the AR field is empty string', async () => {
    await i18n.changeLanguage('ar');
    expect(localized({ titleEn: 'Only EN', titleAr: '' }, 'title')).toBe('Only EN');
  });

  it('falls back to EN when the AR field is missing entirely', async () => {
    await i18n.changeLanguage('ar');
    expect(localized({ titleEn: 'Only EN' } as any, 'title')).toBe('Only EN');
  });

  it('falls back to EN when the AR field is only whitespace', async () => {
    await i18n.changeLanguage('ar');
    expect(localized({ titleEn: 'Only EN', titleAr: '   ' }, 'title')).toBe('Only EN');
  });

  it('works for arbitrary base field names (name, description, etc.)', () => {
    const category = { nameEn: 'Food', nameAr: 'طعام' };
    expect(localized(category, 'name')).toBe('Food');
  });

  it('returns empty string for null / undefined object (never throws)', () => {
    expect(localized(null, 'title')).toBe('');
    expect(localized(undefined, 'title')).toBe('');
  });

  it('returns empty string when the EN field is not a string (malformed upstream)', () => {
    expect(localized({ titleEn: 42 as any }, 'title')).toBe('');
  });

  it('does not mutate the input object', () => {
    const obj = { titleEn: 'x', titleAr: 'ص' };
    const snapshot = JSON.stringify(obj);
    localized(obj, 'title');
    expect(JSON.stringify(obj)).toBe(snapshot);
  });
});

describe('isRtl', () => {
  it('returns false when language is en', () => {
    expect(isRtl()).toBe(false);
  });

  it('returns true when language is ar', async () => {
    await i18n.changeLanguage('ar');
    expect(isRtl()).toBe(true);
  });
});
