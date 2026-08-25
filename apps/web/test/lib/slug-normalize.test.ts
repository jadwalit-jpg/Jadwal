/**
 * This is the safety net that makes cleaning up the five hyphen-damaged
 * activity slugs a non-breaking change. If it is wrong, old links 404 instead
 * of forwarding — so both directions are pinned: what must be rescued, and what
 * must still be allowed to 404.
 */
import { normalizeSlug, hasRedundantHyphens } from '@/lib/slug-normalize';

describe('normalizeSlug — the five real damaged slugs', () => {
  test.each([
    ['catamaran-', 'catamaran'],
    ['ghatha-resort-', 'ghatha-resort'],
    ['north-of-qatar-historical-tour-', 'north-of-qatar-historical-tour'],
    ['-desert-camp-full-day-trip-8-hours', 'desert-camp-full-day-trip-8-hours'],
    ['-public-al-safliya-island-water-sports-', 'public-al-safliya-island-water-sports'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeSlug(input)).toBe(expected);
    expect(hasRedundantHyphens(input)).toBe(true);
  });
});

describe('normalizeSlug — other hyphen noise', () => {
  test.each([
    ['doubled', 'desert--safari', 'desert-safari'],
    ['tripled', 'desert---safari', 'desert-safari'],
    ['many leading', '---tour', 'tour'],
    ['many trailing', 'tour---', 'tour'],
    ['both plus doubled', '-a--b-', 'a-b'],
  ])('%s: %s -> %s', (_l, input, expected) => {
    expect(normalizeSlug(input)).toBe(expected);
  });
});

describe('hasRedundantHyphens — when NOT to retry', () => {
  // A retry is an extra API call and a possible redirect loop, so it must only
  // fire when normalizing actually produces a DIFFERENT, non-empty slug.
  test.each([
    ['already clean', 'catamaran'],
    ['clean multi-word', 'north-of-qatar-historical-tour'],
    ['clean with digits', 'speed-boat-up-to-5'],
    ['empty', ''],
    ['only hyphens', '---'],
    ['single hyphen', '-'],
  ])('%s: %s does not trigger a retry', (_l, slug) => {
    expect(hasRedundantHyphens(slug)).toBe(false);
  });

  test('a clean slug normalizes to itself — no redirect loop is possible', () => {
    for (const s of ['catamaran', 'ghatha-resort', 'desert-camp-full-day-trip-8-hours']) {
      expect(normalizeSlug(s)).toBe(s);
      expect(hasRedundantHyphens(s)).toBe(false);
    }
  });

  test('normalizing is idempotent — normalize(normalize(x)) === normalize(x)', () => {
    for (const s of ['-a--b-', 'catamaran-', '---tour---', 'already-clean']) {
      expect(normalizeSlug(normalizeSlug(s))).toBe(normalizeSlug(s));
    }
  });
});

describe('normalizeSlug — must NOT rescue a genuinely wrong slug', () => {
  // The fallback strips hyphen noise ONLY. A misspelt or unrelated slug has to
  // keep 404-ing, or we would mask real broken links behind a redirect.
  test.each([
    ['misspelling', 'catamarenn'],
    ['different activity', 'stone-chalet'],
    ['partial', 'catamar'],
    ['underscores', 'catamaran_'],
  ])('%s stays unrescued', (_l, slug) => {
    // Either it needs no retry at all, or the normalized form is still not the
    // canonical slug — in both cases the route falls through to notFound().
    const normalized = normalizeSlug(slug);
    expect(normalized).not.toBe('catamaran');
  });
});
