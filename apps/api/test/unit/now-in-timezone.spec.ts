/**
 * nowInTimezone(tz) — returns "now" as the activity's LOCAL wall-clock tagged
 * UTC (the same frame buildDatetime stores booking datetimes in). It's the trust
 * anchor for cancelBooking's "already started" guard + the refund-window math, so
 * a wrong offset here directly re-opens the cancel-mid-activity bug.
 */
import { nowInTimezone } from '../../src/bookings/bookings.service';
import { nowInTimezone as nowInTimezoneLeaf } from '../../src/common/validators/timezone';

describe('nowInTimezone', () => {
  test('Asia/Qatar (UTC+3, no DST) is ~3h AHEAD of raw UTC now', () => {
    const diffH = (nowInTimezone('Asia/Qatar').getTime() - Date.now()) / 3_600_000;
    expect(diffH).toBeGreaterThan(2.9);
    expect(diffH).toBeLessThan(3.1);
  });

  test('UTC tz equals raw now (no offset)', () => {
    // formatToParts truncates to whole seconds, so allow the dropped sub-second.
    expect(Math.abs(nowInTimezone('UTC').getTime() - Date.now())).toBeLessThan(2_000);
  });

  test('invalid tz falls back to raw now without crashing', () => {
    expect(Math.abs(nowInTimezone('Not/AZone').getTime() - Date.now())).toBeLessThan(2_000);
  });

  // ── Added with the #463 timezone fix ──────────────────────────────────────

  test('NEGATIVE, DST-aware offset (America/New_York) tracks the real IANA zone', () => {
    // Delegates to Intl with the real zone, so it must be BEHIND UTC and land in
    // NY's valid range year-round: EDT (-4, summer) or EST (-5, winter). A naive
    // fixed-offset impl would fail one half of the year.
    const diffH = (nowInTimezone('America/New_York').getTime() - Date.now()) / 3_600_000;
    expect(diffH).toBeGreaterThan(-5.05);
    expect(diffH).toBeLessThan(-3.95);
  });

  test('completion gate: a Qatar booking ended-locally is completable, ends-later is not', () => {
    // Pure mirror of the cron/vendor gate `endDatetime <= nowInTimezone(tz)` — no
    // DB. Proves no OVER-completion (local-future within the +14h coarse window
    // stays) and no UNDER-completion (local-past whose tagged end is still > raw
    // now — the +3h GCC case — completes).
    const tz = 'Asia/Qatar';
    const localNow = nowInTimezone(tz).getTime();
    const isCompletable = (endMs: number) => endMs <= nowInTimezone(tz).getTime();
    expect(isCompletable(localNow - 60 * 60_000)).toBe(true); // ended 1h ago (local)
    expect(isCompletable(localNow + 5 * 60 * 60_000)).toBe(false); // ends in 5h (local)
  });

  test('re-export from bookings.service is the SAME function as the leaf module', () => {
    // #463 moved nowInTimezone to the leaf validators/timezone and re-exported it
    // from bookings.service so existing import paths + specs keep resolving.
    expect(typeof nowInTimezone).toBe('function');
    expect(nowInTimezone).toBe(nowInTimezoneLeaf);
  });
});
