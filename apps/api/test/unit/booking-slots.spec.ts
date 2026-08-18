/**
 * computeSlots — HOURLY flex-slot generation (KAN-12: 30-minute slots).
 *
 * Locks the half-hour granularity FUNCTIONALLY (not just via a source-string
 * check) so a silent regression back to hourly-only, or a broken loop bound,
 * fails a fast unit test instead of only surfacing in a live booking.
 */
import { computeSlots } from '../../src/bookings/bookings.service';

describe('computeSlots — 30-minute flex slots (KAN-12)', () => {
  test('generates :00 AND :30 start times (half-hour granularity)', () => {
    // duration 1h, window 10:00–13:00 → last slot must end by 13:00.
    expect(computeSlots('10:00', '13:00', 1)).toEqual([
      '10:00', '10:30', '11:00', '11:30', '12:00',
    ]);
  });

  test("the last slot's end never exceeds checkOutTime", () => {
    // 10:00–12:00, 1h duration → last start 11:00 (11:00–12:00); 11:30 would end 12:30 > close.
    const slots = computeSlots('10:00', '12:00', 1);
    expect(slots).toContain('10:30');
    expect(slots[slots.length - 1]).toBe('11:00');
  });

  test('respects a multi-hour duration at 30-min start offsets', () => {
    // 2h duration, 08:00–11:00 → starts 08:00 / 08:30 / 09:00 (09:30 would end 11:30 > close).
    expect(computeSlots('08:00', '11:00', 2)).toEqual(['08:00', '08:30', '09:00']);
  });

  test('empty when the duration cannot fit before close', () => {
    expect(computeSlots('10:00', '10:30', 1)).toEqual([]);
  });
});
