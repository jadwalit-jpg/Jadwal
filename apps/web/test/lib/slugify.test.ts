/**
 * `slugify` output becomes a permanent public URL with no manual correction
 * step (slug fields are read-only for vendors, and only admins can edit one
 * after the fact). So its contract is: whatever comes out MUST satisfy the
 * API's SLUG_PATTERN, or the vendor gets an "invalid slug" error on a field
 * they cannot fix.
 *
 * The first block pins the exact titles that produced the five broken URLs in
 * production. Each one FAILS against the old implementation, which ended at
 * `.replace(/-+/g,'-').slice(0,60)` and never trimmed the ends.
 */
import { slugify } from '@/lib/slugify';

/** Mirror of SLUG_PATTERN in apps/api/src/common/validators/slug-pattern.ts. */
const API_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe('slugify — the titles that produced the five broken URLs', () => {
  test.each([
    ['trailing space', 'Catamaran ', 'catamaran'],
    ['trailing space', 'Ghatha Resort ', 'ghatha-resort'],
    ['trailing space', 'North of Qatar Historical Tour ', 'north-of-qatar-historical-tour'],
    ['leading space', ' Desert Camp Full Day Trip 8 Hours', 'desert-camp-full-day-trip-8-hours'],
    ['both ends', ' Public Al Safliya Island Water Sports ', 'public-al-safliya-island-water-sports'],
  ])('%s: %j -> %s', (_label, title, expected) => {
    expect(slugify(title)).toBe(expected);
  });
});

describe('slugify — output always satisfies the API pattern', () => {
  // If this ever fails, the form generates a slug the API will reject on a
  // field the vendor cannot edit — a dead end, which is exactly the failure
  // this function exists to prevent.
  test.each([
    'Catamaran ',
    ' Ghatha Resort ',
    'Desert  Safari   Qatar',
    'Yacht Rental (Premium)',
    'Dhow Cruise — Doha',
    'Trip 8 Hours!!!',
    'A' + ' B'.repeat(40), // forces the 60-char truncation path
    'Sea & Sand',
    "Vendor's Boat Tour",
    '  spaced  out  ',
  ])('%j produces a valid slug', (title) => {
    const s = slugify(title);
    expect(s).toMatch(API_SLUG_PATTERN);
  });

  test('truncation cannot leave a trailing hyphen', () => {
    // 60-char cut landing on a word boundary is the classic way a trailing
    // hyphen sneaks back in, so trimming has to happen AFTER the slice.
    const title = 'a'.repeat(59) + ' tail';
    const s = slugify(title);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('-')).toBe(false);
    expect(s).toMatch(API_SLUG_PATTERN);
  });
});

describe('slugify — normal titles are unchanged in shape', () => {
  test.each([
    ['Catamaran', 'catamaran'],
    ['Stone Chalet', 'stone-chalet'],
    ['Traditional Dhow Renting', 'traditional-dhow-renting'],
    ['Q Luxury Yacht', 'q-luxury-yacht'],
    ['Speed Boat Up To 5', 'speed-boat-up-to-5'],
  ])('%s -> %s', (title, expected) => {
    expect(slugify(title)).toBe(expected);
  });
});

describe('slugify — degenerate input', () => {
  test.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['only punctuation', '!!!'],
    ['only hyphens', '---'],
  ])('%s yields an empty slug rather than a broken one', (_l, title) => {
    // Empty is fine: the forms treat it as "title not filled in yet" and their
    // own required-field validation catches it. A slug of "-" would not be.
    expect(slugify(title)).toBe('');
  });
});
