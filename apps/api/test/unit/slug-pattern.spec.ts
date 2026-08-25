/**
 * Slugs are typed by hand and become permanent public URLs, so this pattern is
 * the only guard between a typo and a bad address in Google's index.
 *
 * The five REAL slugs that reached production under the old
 * `/^[a-z0-9-]+$/` are pinned below — they are the reason this exists.
 */
import { SLUG_PATTERN } from '../../src/common/validators/slug-pattern';

describe('SLUG_PATTERN — the slugs that actually shipped broken', () => {
  test.each([
    ['trailing hyphen', 'catamaran-'],
    ['trailing hyphen', 'ghatha-resort-'],
    ['trailing hyphen', 'north-of-qatar-historical-tour-'],
    ['leading hyphen', '-desert-camp-full-day-trip-8-hours'],
    ['both ends', '-public-al-safliya-island-water-sports-'],
  ])('rejects %s: %s', (_label, slug) => {
    expect(SLUG_PATTERN.test(slug)).toBe(false);
  });
});

describe('SLUG_PATTERN — other malformed shapes', () => {
  test.each([
    ['doubled hyphen', 'desert--safari'],
    ['only a hyphen', '-'],
    ['empty', ''],
    ['uppercase', 'Desert-Safari'],
    ['space', 'desert safari'],
    ['underscore', 'desert_safari'],
    ['trailing slash', 'desert-safari/'],
    ['arabic', 'رحلة-صحراوية'],
    ['dot', 'desert.safari'],
    ['leading and doubled', '--tour'],
  ])('rejects %s', (_label, slug) => {
    expect(SLUG_PATTERN.test(slug)).toBe(false);
  });
});

describe('SLUG_PATTERN — real slugs currently live must still pass', () => {
  // Taken from the production sitemap. A tightened pattern that rejected any
  // of these would break existing URLs on the next edit, so they are pinned.
  test.each([
    'catamaran',
    'stone-chalet',
    'traditional-dhow-renting',
    'q-luxury-yacht',
    'speedboat-fishing-trip',
    'north-of-qatar-historical-tour',
    'desert-camp-full-day-trip-8-hours',
    'al-khor-caravan-cabin-2',
    'speed-boat-up-to-5',
    'desertcamp-overnight-19-hours',
    'yacht-rental-qatar',
    'water-activities-qatar',
    'nye-dhow-cruise-doha',
  ])('accepts %s', (slug) => {
    expect(SLUG_PATTERN.test(slug)).toBe(true);
  });

  test('accepts a single alphanumeric character', () => {
    expect(SLUG_PATTERN.test('a')).toBe(true);
    expect(SLUG_PATTERN.test('7')).toBe(true);
  });
});

describe('SLUG_PATTERN — is not anchored loosely', () => {
  // A pattern missing ^ or $ would match a substring and let the whole bad
  // slug through. Newlines are the classic way that leaks.
  test.each([['leading newline', '\ntour'], ['trailing newline', 'tour\n'], ['embedded newline', 'de\nsert']])(
    'rejects %s',
    (_label, slug) => {
      expect(SLUG_PATTERN.test(slug)).toBe(false);
    },
  );
});
