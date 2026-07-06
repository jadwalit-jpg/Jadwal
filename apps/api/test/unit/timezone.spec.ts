/**
 * isValidIanaTimezone gates Country.defaultTimezone — the field the booking
 * cancel guard + refund-window + availability past-slot logic trust. A bad value
 * silently degrades those to raw UTC (re-opening cancel-during-activity for a
 * +offset country), so this validator is a money/correctness control.
 */
import { isValidIanaTimezone } from '../../src/common/validators/timezone';

describe('isValidIanaTimezone', () => {
  it.each(['Asia/Qatar', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Amman', 'UTC', 'America/New_York', 'Asia/Qatar '])(
    'accepts valid IANA zone %j (trims whitespace)',
    (v) => { expect(isValidIanaTimezone(v)).toBe(true); },
  );

  it.each(['', '   ', 'Not/AZone', 'Asia/Qatarr', 'xyz', 'Etc/GMT+3', 'etc/gmt-2'])(
    'rejects empty / invalid / sign-inverted %j',
    (v) => { expect(isValidIanaTimezone(v)).toBe(false); },
  );

  it('rejects non-string values', () => {
    expect(isValidIanaTimezone(null)).toBe(false);
    expect(isValidIanaTimezone(undefined)).toBe(false);
    expect(isValidIanaTimezone(42 as never)).toBe(false);
    expect(isValidIanaTimezone(['Asia/Qatar'] as never)).toBe(false);
  });
});
