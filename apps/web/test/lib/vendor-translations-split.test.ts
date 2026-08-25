/**
 * The `vendor.*` translations were split out of the main locale bundle to stop
 * shipping 79 KB of vendor-dashboard vocabulary to every customer.
 *
 * That split is only safe while two things hold, and both are easy to break by
 * accident later — someone adds a `vendor.*` key to a customer component, or
 * adds a key to en.vendor.json and forgets ar.vendor.json. These pin both.
 */
import en from '@/locales/en.json';
import ar from '@/locales/ar.json';
import enVendor from '@/locales/en.vendor.json';
import arVendor from '@/locales/ar.vendor.json';

type Dict = Record<string, unknown>;

function leafKeys(obj: Dict, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' && !Array.isArray(v)
      ? leafKeys(v as Dict, path)
      : [path];
  });
}

describe('vendor translations are fully removed from the main bundle', () => {
  test.each([
    ['en', en as Dict],
    ['ar', ar as Dict],
  ])('%s.json has no top-level "vendor" section', (_lang, dict) => {
    expect(Object.prototype.hasOwnProperty.call(dict, 'vendor')).toBe(false);
  });

  test.each([
    ['en', en as Dict],
    ['ar', ar as Dict],
  ])('%s.json contains no vendor.* key anywhere', (_lang, dict) => {
    expect(leafKeys(dict).filter((k) => k.startsWith('vendor.'))).toEqual([]);
  });
});

describe('the split bundles are complete and in step', () => {
  test('en and ar vendor bundles expose the SAME keys', () => {
    // A key present in one language but not the other renders as a raw key
    // string for those users — the classic half-translated regression.
    const e = leafKeys(enVendor as Dict).sort();
    const a = leafKeys(arVendor as Dict).sort();
    expect(a).toEqual(e);
  });

  test('the vendor bundles are not empty', () => {
    expect(leafKeys(enVendor as Dict).length).toBeGreaterThan(200);
  });

  test('main bundles still carry the customer sections', () => {
    // Guards against an over-eager future split that removes something the
    // customer pages DO need synchronously.
    for (const dict of [en as Dict, ar as Dict]) {
      for (const section of ['home', 'explore', 'activity', 'booking', 'auth', 'nav', 'common']) {
        expect(Object.prototype.hasOwnProperty.call(dict, section)).toBe(true);
      }
    }
  });
});
