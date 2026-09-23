/**
 * Unit — booking-calendar date selection rules.
 *
 * TWO BUGS, REPORTED 2026-09-18, BOTH PRESENT SINCE THE INITIAL COMMIT
 * -------------------------------------------------------------------
 * 1. A fully-booked date could not be chosen as a CHECK-OUT. Picking the 16th
 *    and then the 17th (booked) was refused, so a valid one-night stay on the
 *    16th was impossible. Real lost bookings.
 *
 * 2. A range could be dragged straight ACROSS a fully-booked night: 16 -> 18
 *    over a booked 17 was accepted by the picker. The server refused it, so
 *    nobody was double-booked, but the customer only found out at the end.
 *
 * ONE ROOT CAUSE
 * --------------
 * A date plays two different roles, and only one of them consumes a night:
 *
 *     as an ARRIVAL   the guest sleeps there       -> the night must be free
 *     as a DEPARTURE  the guest leaves at checkout -> the night is NOT theirs
 *
 * A stay is the half-open range [checkIn, checkOut). The calendar only ever
 * modelled the first role, so a booked night was unusable for every purpose
 * (bug 1) while the nights BETWEEN two picked dates were never examined at all
 * against bookings (bug 2) — only against vendor locks.
 *
 * The tester spotted the tell: dragging over a vendor-LOCKED date was correctly
 * refused. Only half of "unavailable" had ever been implemented.
 */

import {
  willSetCheckOut,
  computeCrossingBlockedDates,
  isDateDisabled,
  type CalendarDay,
} from '@/components/booking-calendar';

/** A day, free unless stated otherwise. */
function day(date: string, over: Partial<CalendarDay> = {}): CalendarDay {
  return {
    date,
    dayOfWeek: 'MON',
    price: 1200,
    isActiveDay: true,
    isPast: false,
    capacity: 1,
    booked: 0,
    available: 1,
    isFullyBooked: false,
    isBlocked: false,
    ...over,
  };
}

const booked = (date: string) => day(date, { isFullyBooked: true, booked: 1, available: 0 });
const locked = (date: string) => day(date, { isBlocked: true, isFullyBooked: true, available: 0 });

/** The reported scenario: Cavilam, September, the 17th taken by a guest. */
const SEPT = [
  day('2026-09-15'),
  day('2026-09-16'),
  booked('2026-09-17'),
  day('2026-09-18'),
  day('2026-09-19'),
  day('2026-09-20'),
];

// ═══════════════════════════════════════════════════════════════════════════

describe('willSetCheckOut — which role is this click playing?', () => {

  test('the first pick is an ARRIVAL, never a departure', () => {
    expect(willSetCheckOut('2026-09-17', null, null, null)).toBe(false);
  });

  test('a date after the check-in sets the DEPARTURE', () => {
    expect(willSetCheckOut('2026-09-17', '2026-09-16', null, null)).toBe(true);
  });

  test('a date on or before the check-in is an ARRIVAL re-pick', () => {
    expect(willSetCheckOut('2026-09-16', '2026-09-16', null, null)).toBe(false);
    expect(willSetCheckOut('2026-09-15', '2026-09-16', null, null)).toBe(false);
  });

  test('once BOTH ends are set, the next tap re-picks an arrival (flexible mode)', () => {
    // This is the dangerous case: if it were treated as a departure, a booked
    // date would be selectable as a new CHECK-IN and the guest would be
    // double-booked on that night.
    expect(willSetCheckOut('2026-09-19', '2026-09-16', '2026-09-18', null)).toBe(false);
  });

  test('min-night mode always extends, even with both ends set', () => {
    // handleDailyDateSelect sets the check-out for any date after check-in when
    // a minimum applies, so the rules must agree.
    expect(willSetCheckOut('2026-09-19', '2026-09-16', '2026-09-18', 2)).toBe(true);
  });
});

describe('BUG 1 — a booked night must still be a valid DEPARTURE', () => {

  // Asserted through isDateDisabled, because that is where the bug lived. The
  // range guard never rejected the 17th here; the CELL did, by treating any
  // booked night as unusable for every purpose.
  const none = new Set<string>();

  test('with the 16th picked, the booked 17th is SELECTABLE as the departure', () => {
    // The outgoing guest leaves at 12:00; the incoming one arrives at 15:00.
    // The stay [16, 17) consumes only the night of the 16th, which is free.
    expect(
      isDateDisabled(booked('2026-09-17'), {
        checkIn: '2026-09-16', checkOut: null, minNights: null, crossingBlocked: none,
      }),
    ).toBe(false);
    expect(computeCrossingBlockedDates(SEPT, [], '2026-09-16', null, null).has('2026-09-17')).toBe(false);
  });

  test('with NOTHING picked, the booked 17th is disabled — it would be an arrival', () => {
    expect(
      isDateDisabled(booked('2026-09-17'), {
        checkIn: null, checkOut: null, minNights: null, crossingBlocked: none,
      }),
    ).toBe(true);
  });

  test('once both ends are set, the booked date is disabled again (it would re-pick an arrival)', () => {
    // The dangerous case: treating this as a departure would let a booked night
    // become a new CHECK-IN, putting two guests in it.
    expect(
      isDateDisabled(booked('2026-09-19'), {
        checkIn: '2026-09-16', checkOut: '2026-09-18', minNights: null, crossingBlocked: none,
      }),
    ).toBe(true);
  });

  test('a free date is selectable in every role', () => {
    for (const opts of [
      { checkIn: null, checkOut: null },
      { checkIn: '2026-09-16', checkOut: null },
      { checkIn: '2026-09-16', checkOut: '2026-09-18' },
    ]) {
      expect(
        isDateDisabled(day('2026-09-20'), { ...opts, minNights: null, crossingBlocked: none }),
      ).toBe(false);
    }
  });

  test('past and inactive days stay inert regardless of role', () => {
    expect(
      isDateDisabled(day('2026-09-10', { isPast: true }), {
        checkIn: '2026-09-09', checkOut: null, minNights: null, crossingBlocked: none,
      }),
    ).toBe(true);
    expect(
      isDateDisabled(day('2026-09-20', { isActiveDay: false }), {
        checkIn: '2026-09-19', checkOut: null, minNights: null, crossingBlocked: none,
      }),
    ).toBe(true);
  });

  test('a crossing-blocked date stays CLICKABLE so the tap can explain itself', () => {
    // Inert cells teach the customer nothing. This one shakes and warns.
    expect(
      isDateDisabled(day('2026-09-18'), {
        checkIn: '2026-09-16', checkOut: null, minNights: null,
        crossingBlocked: new Set(['2026-09-18']),
      }),
    ).toBe(false);
  });
});

describe('BUG 2 — a range may not span an unavailable night', () => {

  test('16 -> 18 is refused because the 17th is booked', () => {
    const blocked = computeCrossingBlockedDates(SEPT, [], '2026-09-16', null, null);
    // [16, 18) consumes nights 16 AND 17. The 17th is taken.
    expect(blocked.has('2026-09-18')).toBe(true);
  });

  test('a VENDOR LOCK in the range is refused the same way', () => {
    // This half already worked, and is the contrast that exposed the bug. Pinned
    // so a future edit cannot fix one and regress the other.
    const withLock = [day('2026-09-16'), locked('2026-09-17'), day('2026-09-18')];
    const blocked = computeCrossingBlockedDates(withLock, [], '2026-09-16', null, null);
    expect(blocked.has('2026-09-18')).toBe(true);
  });

  test('a range clear of the booked night is still allowed', () => {
    // 18 -> 20 is entirely after the taken night — the guard must not overreach.
    const blocked = computeCrossingBlockedDates(SEPT, [], '2026-09-18', null, null);
    expect(blocked.has('2026-09-19')).toBe(false);
    expect(blocked.has('2026-09-20')).toBe(false);
  });

  test('a long range spanning the booked night is refused', () => {
    const blocked = computeCrossingBlockedDates(SEPT, [], '2026-09-15', null, null);
    expect(blocked.has('2026-09-19')).toBe(true);
    expect(blocked.has('2026-09-20')).toBe(true);
    // ...but a departure BEFORE the taken night is fine.
    expect(blocked.has('2026-09-17')).toBe(false);
  });
});

describe('SAFETY — the guard must not block legitimate selections', () => {

  test('nothing is blocked when every night is free', () => {
    const allFree = [day('2026-09-15'), day('2026-09-16'), day('2026-09-17')];
    expect(computeCrossingBlockedDates(allFree, [], '2026-09-15', null, null).size).toBe(0);
  });

  test('with no check-in and no minimum, no date is blocked', () => {
    // Flexible mode imposes no minimum stay, so a lone arrival pick cannot yet
    // cross anything — the overlap is judged when the departure is chosen.
    expect(computeCrossingBlockedDates(SEPT, [], null, null, null).size).toBe(0);
  });

  test('the selected check-in itself is never blocked (a tap clears it)', () => {
    const blocked = computeCrossingBlockedDates(SEPT, [], '2026-09-16', '2026-09-18', null);
    expect(blocked.has('2026-09-16')).toBe(false);
  });

  test('past and inactive days are skipped, not blocked', () => {
    const mixed = [
      day('2026-09-15', { isPast: true }),
      day('2026-09-16', { isActiveDay: false }),
      booked('2026-09-17'),
      day('2026-09-18'),
    ];
    const blocked = computeCrossingBlockedDates(mixed, [], '2026-09-14', null, null);
    expect(blocked.has('2026-09-15')).toBe(false);
    expect(blocked.has('2026-09-16')).toBe(false);
  });

  test('re-picking an arrival after both ends are set is not blocked by the OLD range', () => {
    // Once check-in AND check-out exist, the next tap starts a fresh selection.
    // Judging it against the previous stay would wrongly refuse a valid new
    // arrival that merely sits the far side of the old one.
    const blocked = computeCrossingBlockedDates(SEPT, [], '2026-09-15', '2026-09-16', null);
    expect(blocked.has('2026-09-19')).toBe(false);
    expect(blocked.has('2026-09-20')).toBe(false);
  });
});

describe('MINIMUM-NIGHTS mode', () => {

  const MIN = 2;

  test('an arrival whose minimum stay would cross the booked night is blocked', () => {
    // Arriving the 16th with a 2-night minimum means nights 16 and 17 — and the
    // 17th is taken.
    const blocked = computeCrossingBlockedDates(SEPT, [], null, null, MIN);
    expect(blocked.has('2026-09-16')).toBe(true);
    // Arriving the 18th means nights 18 and 19, both free.
    expect(blocked.has('2026-09-18')).toBe(false);
  });

  test('a too-short departure pick is judged on the SNAPPED range, not the clicked one', () => {
    // handleDailyDateSelect snaps a pick shorter than the minimum up to
    // checkIn + minNights. Checking only [checkIn, clicked) would miss the
    // nights between the click and that snapped end — so a booked night could
    // be swallowed by the snap.
    //
    // Arrive the 16th, tap the 17th: one night, below the 2-night minimum, so
    // the real check-out becomes the 18th and the stay covers nights 16 AND 17.
    // The 17th is taken, so this must be refused.
    const blocked = computeCrossingBlockedDates(SEPT, [], '2026-09-16', null, MIN);
    expect(blocked.has('2026-09-17')).toBe(true);
  });

  test('a long-enough departure pick clear of the booked night is allowed', () => {
    const laterFree = [
      day('2026-09-18'), day('2026-09-19'), day('2026-09-20'), day('2026-09-21'),
    ];
    const blocked = computeCrossingBlockedDates(laterFree, [], '2026-09-18', null, MIN);
    expect(blocked.has('2026-09-20')).toBe(false);
  });
});

describe('TWO-MONTH view — the guard spans both grids', () => {

  test('a stay crossing the month boundary sees a booked night in the next month', () => {
    const left = [day('2026-09-29'), day('2026-09-30')];
    const right = [booked('2026-10-01'), day('2026-10-02')];
    // [29 Sep, 2 Oct) covers 29, 30 and 1 Oct — the 1st is taken.
    const blocked = computeCrossingBlockedDates(left, right, '2026-09-29', null, null);
    expect(blocked.has('2026-10-02')).toBe(true);
    // Leaving on the 1st is fine: nights 29 and 30 only.
    expect(blocked.has('2026-10-01')).toBe(false);
  });
});
