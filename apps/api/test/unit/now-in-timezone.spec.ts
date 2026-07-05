/**
 * nowInTimezone(tz) — returns "now" as the activity's LOCAL wall-clock tagged
 * UTC (the same frame buildDatetime stores booking datetimes in). It's the trust
 * anchor for cancelBooking's "already started" guard + the refund-window math, so
 * a wrong offset here directly re-opens the cancel-mid-activity bug.
 */
import { nowInTimezone } from '../../src/bookings/bookings.service';

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
});
