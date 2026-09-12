/**
 * Unit — calendar-date edge cases in `isValidDate`.
 *
 * `addMonthsClamped` (month-length clamping) and `computeSlots` (hourly slot
 * generation) already have their own suites. The gap this fills is the date
 * PARSER itself, which is the first gate every booking passes through:
 *
 *   isValidDate('2026-02-30')  must be false, not "2 March"
 *
 * It works by round-tripping through Date.UTC and checking the components come
 * back unchanged, which is the right technique — JavaScript silently rolls an
 * impossible date forward instead of rejecting it, so a naive `new Date(str)`
 * would accept 30 February and quietly book someone for the 2nd of March.
 *
 * Leap years matter here in both directions: 29 February is a REAL date in a
 * leap year and must be accepted, and an invalid one otherwise.
 */

import { isValidDate } from '../../src/bookings/bookings.service';

describe('isValidDate — leap years', () => {
  test.each([
    ['2028-02-29', true, 'leap year (divisible by 4)'],
    ['2024-02-29', true, 'leap year'],
    ['2027-02-29', false, 'not a leap year — JS would roll this to 1 March'],
    ['2026-02-29', false, 'not a leap year'],
    ['2000-02-29', true, 'century divisible by 400 IS a leap year'],
    ['2100-02-29', false, 'century NOT divisible by 400 is not a leap year'],
  ])('%s -> %s (%s)', (input, expected) => {
    expect(isValidDate(input)).toBe(expected);
  });
});

describe('isValidDate — days that do not exist', () => {
  test.each([
    ['2026-02-30', 'February never has 30 days'],
    ['2026-04-31', 'April has 30'],
    ['2026-06-31', 'June has 30'],
    ['2026-09-31', 'September has 30'],
    ['2026-11-31', 'November has 30'],
    ['2026-01-32', 'no month has 32 days'],
    ['2026-01-00', 'day zero'],
  ])('rejects %s (%s)', (input) => {
    expect(isValidDate(input)).toBe(false);
  });

  test.each([
    ['2026-01-31'], ['2026-03-31'], ['2026-05-31'], ['2026-07-31'],
    ['2026-08-31'], ['2026-10-31'], ['2026-12-31'],
  ])('accepts %s — a real 31st', (input) => {
    expect(isValidDate(input)).toBe(true);
  });
});

describe('isValidDate — months that do not exist', () => {
  test.each([
    ['2026-13-01', 'month 13'],
    ['2026-00-01', 'month zero'],
  ])('rejects %s (%s)', (input) => {
    expect(isValidDate(input)).toBe(false);
  });
});

describe('isValidDate — year boundaries', () => {
  test('31 December and 1 January are both real dates', () => {
    expect(isValidDate('2026-12-31')).toBe(true);
    expect(isValidDate('2027-01-01')).toBe(true);
  });
});
