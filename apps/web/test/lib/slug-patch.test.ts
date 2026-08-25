/**
 * Guards the rule that lets an admin edit the five activities whose slugs the
 * old generator produced badly. Without it, the form sends the loaded (invalid)
 * slug back and the whole update 400s — so changing a price would force a
 * link-breaking rename.
 */
import { slugPatch } from '@/lib/slug-patch';

describe('slugPatch — unchanged slug is omitted', () => {
  test.each([
    ['already clean', 'stone-chalet'],
    ['legacy trailing hyphen', 'catamaran-'],
    ['legacy leading hyphen', '-desert-camp-full-day-trip-8-hours'],
    ['legacy both ends', '-public-al-safliya-island-water-sports-'],
  ])('%s: %s is not sent when untouched', (_label, slug) => {
    expect(slugPatch(slug, slug)).toEqual({});
    expect('slug' in slugPatch(slug, slug)).toBe(false);
  });
});

describe('slugPatch — a real edit IS sent', () => {
  test('cleaning a legacy slug sends the new value', () => {
    expect(slugPatch('catamaran', 'catamaran-')).toEqual({ slug: 'catamaran' });
  });

  test('renaming a healthy slug sends the new value', () => {
    expect(slugPatch('stone-chalet-2', 'stone-chalet')).toEqual({ slug: 'stone-chalet-2' });
  });

  test('an admin typing an INVALID slug still sends it — the API must reject it', () => {
    // The helper must not silently swallow a bad edit; the server-side
    // validator is what says no, and the admin needs to see that error.
    expect(slugPatch('catamaran--', 'catamaran')).toEqual({ slug: 'catamaran--' });
  });

  test('clearing the field sends the empty value rather than hiding it', () => {
    expect(slugPatch('', 'catamaran')).toEqual({ slug: '' });
  });
});
