import { parseCorsOrigins } from '../../src/common/cors-origins';

describe('parseCorsOrigins', () => {
  test('parses a single valid https origin', () => {
    expect(parseCorsOrigins('https://jadwal.qa')).toEqual(['https://jadwal.qa']);
  });

  test('parses a comma-separated list of valid origins', () => {
    expect(parseCorsOrigins('https://jadwal.qa,https://app.jadwal.qa')).toEqual([
      'https://jadwal.qa',
      'https://app.jadwal.qa',
    ]);
  });

  test('trims whitespace around each entry', () => {
    expect(parseCorsOrigins(' https://jadwal.qa ,  https://app.jadwal.qa ')).toEqual([
      'https://jadwal.qa',
      'https://app.jadwal.qa',
    ]);
  });

  test('drops empty entries from a trailing comma forgivingly', () => {
    expect(parseCorsOrigins('https://jadwal.qa,,')).toEqual(['https://jadwal.qa']);
  });

  test('allows http:// origins (dev / local docker)', () => {
    expect(parseCorsOrigins('http://localhost:3000')).toEqual(['http://localhost:3000']);
  });

  test('throws on a clearly malformed entry', () => {
    expect(() => parseCorsOrigins('https://jadwal.qa,not-a-url')).toThrow(
      /Malformed CORS_ORIGIN entry "not-a-url"/,
    );
  });

  test('throws on a typo that drops the TLD', () => {
    // `https://` alone parses to a URL with host '' — WHATWG accepts it but
    // we reject it because it has no usable origin. Use a clearer case here.
    expect(() => parseCorsOrigins('https://')).toThrow(/Malformed CORS_ORIGIN entry/);
  });

  test('throws on a non-http(s) scheme', () => {
    expect(() => parseCorsOrigins('file:///etc/passwd')).toThrow(
      /scheme must be http\/https, got "file:"/,
    );
  });

  test('throws on chrome-extension scheme', () => {
    expect(() => parseCorsOrigins('chrome-extension://abc')).toThrow(
      /scheme must be http\/https/,
    );
  });

  test('one bad entry fails the whole list (fail-fast)', () => {
    expect(() =>
      parseCorsOrigins('https://jadwal.qa,bogus,https://app.jadwal.qa'),
    ).toThrow(/Malformed CORS_ORIGIN entry "bogus"/);
  });

  test('returns an empty array for an empty input (caller decides if that is fatal)', () => {
    // Empty CORS_ORIGIN is allowed by the validator itself; main.ts requires
    // CORS_ORIGIN to be present in production via the REQUIRED_IN_PRODUCTION
    // guard, so an empty string only reaches here in dev/test.
    expect(parseCorsOrigins('')).toEqual([]);
  });
});
