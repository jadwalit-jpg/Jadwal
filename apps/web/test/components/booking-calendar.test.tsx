/**
 * Component — BookingCalendar renders the selection rules it is given.
 *
 * WHY THIS EXISTS, SEPARATELY FROM booking-calendar-selection.test.ts
 * ------------------------------------------------------------------
 * That file proves the RULES are right. It cannot prove the COMPONENT obeys
 * them. Those are different failures, and the second one is the easier to ship:
 * forget to thread `minNights` down to MonthGrid and every one of those 24 unit
 * tests still passes, while the real calendar silently reverts to the old
 * behaviour for exactly the activities that have a minimum stay.
 *
 * So these tests drive the actual DOM — find the cell, read `disabled`, click
 * it, and assert on what the parent is told. They are the wiring check.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, def?: any) => (typeof def === 'string' ? def : def?.defaultValue ?? key),
    i18n: { language: 'en' },
  }),
}));

import BookingCalendar, { type CalendarDay } from '@/components/booking-calendar';

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

/** Sept 2026 with the 17th taken by a guest — the reported Cavilam scenario. */
const SEPT: CalendarDay[] = [
  day('2026-09-15'),
  day('2026-09-16'),
  booked('2026-09-17'),
  day('2026-09-18'),
  day('2026-09-19'),
  day('2026-09-20'),
];

/**
 * The grid renders bare day numbers, and 15..20 are unambiguous within one
 * month, so the visible text is enough to find a cell. Scoped to the left month
 * because the component renders two grids.
 */
function cell(dayNumber: number): HTMLButtonElement {
  const found = screen
    .getAllByRole('button')
    .filter((b) => b.textContent?.trim().startsWith(String(dayNumber)));
  expect(found.length).toBeGreaterThan(0);
  return found[0] as HTMLButtonElement;
}

function renderCalendar(props: Partial<React.ComponentProps<typeof BookingCalendar>> = {}) {
  const onDateSelect = jest.fn();
  const onBlockedAttempt = jest.fn();
  render(
    <BookingCalendar
      month="2026-09"
      daysLeft={SEPT}
      daysRight={[]}
      onMonthChange={() => {}}
      checkIn={null}
      checkOut={null}
      onDateSelect={onDateSelect}
      onBlockedAttempt={onBlockedAttempt}
      currency="QAR"
      {...props}
    />,
  );
  return { onDateSelect, onBlockedAttempt };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('BUG 1 in the DOM — the booked night is a clickable check-out', () => {

  it('with the 16th picked, the booked 17th is ENABLED and reports the date', () => {
    // The bug: this cell rendered `disabled`, so a one-night stay on the 16th
    // could not be completed at all.
    const { onDateSelect } = renderCalendar({ checkIn: '2026-09-16' });

    const seventeenth = cell(17);
    expect(seventeenth).not.toBeDisabled();

    fireEvent.click(seventeenth);
    expect(onDateSelect).toHaveBeenCalledWith('2026-09-17');
  });

  it('with NOTHING picked, the booked 17th is disabled — it would be an arrival', () => {
    const { onDateSelect } = renderCalendar();

    expect(cell(17)).toBeDisabled();
    fireEvent.click(cell(17));
    expect(onDateSelect).not.toHaveBeenCalled();
  });

  it('once both ends are set, the booked date is inert again', () => {
    // Guards the double-booking path the fix could have opened: the next tap
    // re-picks a CHECK-IN, and a taken night must never become one.
    renderCalendar({ checkIn: '2026-09-15', checkOut: '2026-09-16' });
    expect(cell(17)).toBeDisabled();
  });
});

describe('VENDOR-CLOSED vs BOOKED in the DOM — same look, opposite answer', () => {

  // Raised by the user before merge. A vendor block covers the day from 00:00,
  // a guest's booking only from 14:00, and a stay leaves at 11:00 — so a
  // check-out clears the guest but not the block. The server refuses the
  // second one, so the calendar must not offer it.
  const mixed: CalendarDay[] = [
    day('2026-09-17'),
    day('2026-09-18', { isBlocked: true, isFullyBooked: true, available: 0 }), // closed
    day('2026-09-19'),
    booked('2026-09-20'),                                                      // taken
  ];

  it('the vendor-closed day is inert as a check-out', () => {
    const onDateSelect = jest.fn();
    render(
      <BookingCalendar
        month="2026-09" daysLeft={mixed} daysRight={[]} onMonthChange={() => {}}
        checkIn="2026-09-17" checkOut={null}
        onDateSelect={onDateSelect} currency="QAR"
      />,
    );
    expect(cell(18)).toBeDisabled();
    fireEvent.click(cell(18));
    expect(onDateSelect).not.toHaveBeenCalled();
  });

  it('the guest-booked day IS offered as a check-out', () => {
    const onDateSelect = jest.fn();
    render(
      <BookingCalendar
        month="2026-09" daysLeft={mixed} daysRight={[]} onMonthChange={() => {}}
        checkIn="2026-09-19" checkOut={null}
        onDateSelect={onDateSelect} currency="QAR"
      />,
    );
    expect(cell(20)).not.toBeDisabled();
    fireEvent.click(cell(20));
    expect(onDateSelect).toHaveBeenCalledWith('2026-09-20');
  });
});

describe('BUG 2 in the DOM — a span across the booked night shakes instead of selecting', () => {

  it('16 -> 18 does NOT select, and asks the parent to warn', () => {
    // [16, 18) consumes nights 16 AND 17; the 17th is taken. Before the fix this
    // selected happily and the customer only found out at submission.
    const { onDateSelect, onBlockedAttempt } = renderCalendar({ checkIn: '2026-09-16' });

    const eighteenth = cell(18);
    // Deliberately NOT disabled — an inert cell explains nothing. It stays
    // clickable so the tap can shake and surface the toast.
    expect(eighteenth).not.toBeDisabled();

    fireEvent.click(eighteenth);
    expect(onDateSelect).not.toHaveBeenCalled();
    expect(onBlockedAttempt).toHaveBeenCalledTimes(1);
  });

  it('a departure clear of the booked night selects normally', () => {
    // The guard must not overreach: [18, 20) touches nothing taken.
    const { onDateSelect, onBlockedAttempt } = renderCalendar({ checkIn: '2026-09-18' });

    fireEvent.click(cell(20));
    expect(onDateSelect).toHaveBeenCalledWith('2026-09-20');
    expect(onBlockedAttempt).not.toHaveBeenCalled();
  });
});

describe('WIRING — minNights actually reaches the CELLS, not just the guard', () => {

  /**
   * The parent computes the crossing-blocked set itself and hands it down, so
   * almost everything keeps working even if `minNights` never reaches MonthGrid.
   * I removed the prop from both call sites to check, and every other test here
   * stayed green — so none of them was actually testing the wiring.
   *
   * The prop changes exactly one thing: whether a click EXTENDS the stay when a
   * check-out is already set. Flexible mode starts over; min-night mode extends.
   * Get that wrong and a booked date is wrongly inert in the one mode where the
   * parent would have accepted it. That is the state below, and it is the only
   * state that discriminates.
   */
  it('min-night mode: with BOTH ends set, a later booked date is still a valid check-out', () => {
    const laterBooked: CalendarDay[] = [
      day('2026-09-15'), day('2026-09-16'), day('2026-09-17'),
      day('2026-09-18'), booked('2026-09-19'), day('2026-09-20'),
    ];
    const onDateSelect = jest.fn();
    render(
      <BookingCalendar
        month="2026-09"
        daysLeft={laterBooked}
        daysRight={[]}
        onMonthChange={() => {}}
        checkIn="2026-09-15"
        checkOut="2026-09-17"
        onDateSelect={onDateSelect}
        currency="QAR"
        minNights={2}
      />,
    );

    // [15, 19) consumes nights 15-18, all free; the 19th is only the departure.
    // handleDailyDateSelect would extend the stay to it, so the cell must allow
    // the click. Without the prop it reads as a fresh arrival and goes inert.
    const nineteenth = cell(19);
    expect(nineteenth).not.toBeDisabled();

    fireEvent.click(nineteenth);
    expect(onDateSelect).toHaveBeenCalledWith('2026-09-19');
  });

  it('a 2-night minimum blocks the 16th as an ARRIVAL (nights 16 + 17, 17 taken)', () => {
    const { onDateSelect, onBlockedAttempt } = renderCalendar({ minNights: 2 });

    fireEvent.click(cell(16));
    expect(onDateSelect).not.toHaveBeenCalled();
    expect(onBlockedAttempt).toHaveBeenCalledTimes(1);
  });

  it('with the same minimum, arriving the 18th is fine (nights 18 + 19, both free)', () => {
    const { onDateSelect, onBlockedAttempt } = renderCalendar({ minNights: 2 });

    fireEvent.click(cell(18));
    expect(onDateSelect).toHaveBeenCalledWith('2026-09-18');
    expect(onBlockedAttempt).not.toHaveBeenCalled();
  });

  it('min-night mode judges a too-short departure on the SNAPPED range', () => {
    // Arrive the 16th, tap the 17th: one night, under the 2-night minimum, so
    // the parent snaps check-out to the 18th and the stay covers 16 AND 17.
    // Checking the clicked range alone would let the snap swallow a taken night.
    const { onDateSelect, onBlockedAttempt } = renderCalendar({
      checkIn: '2026-09-16', minNights: 2,
    });

    fireEvent.click(cell(17));
    expect(onDateSelect).not.toHaveBeenCalled();
    expect(onBlockedAttempt).toHaveBeenCalledTimes(1);
  });
});

/**
 * The same component renders the HOURLY calendar, where the customer picks one
 * day and then a time slot. That flow reuses `checkIn` to carry "the selected
 * day" and passes no checkOut, no minNights and — critically — no
 * onBlockedAttempt.
 *
 * My first version of this fix broke it in two ways, and neither test above
 * noticed, because every one of them renders the daily calendar. CodeRabbit
 * caught it on the PR.
 */
describe('HOURLY (single-date mode) — the range rules must not apply', () => {

  function renderHourly(selectedDate: string | null, days: CalendarDay[] = SEPT) {
    const onDateSelect = jest.fn();
    render(
      <BookingCalendar
        month="2026-09"
        daysLeft={days}
        daysRight={[]}
        onMonthChange={() => {}}
        checkIn={selectedDate}
        checkOut={null}
        onDateSelect={onDateSelect}
        currency="QAR"
        showPrices={false}
        selectionMode="single"
      />,
    );
    return { onDateSelect };
  }

  it('a fully-booked day stays inert after another day is picked', () => {
    // REGRESSION 1. In range mode, any date after check-in reads as a departure
    // and a booked one is offered. Here the 17th has no free slots left, and
    // handleHourlyDateSelect has no isFullyBooked guard of its own — it trusts
    // the calendar. Offering it lands the customer on a day with nothing to book.
    const { onDateSelect } = renderHourly('2026-09-16');

    expect(cell(17)).toBeDisabled();
    fireEvent.click(cell(17));
    expect(onDateSelect).not.toHaveBeenCalled();
  });

  it('a free day BEYOND a booked one is still selectable', () => {
    // REGRESSION 2, and the worse of the two. The crossing guard would see
    // [16, 18) covering the booked 17th and block the 18th — along with every
    // later date in the view. The hourly flow passes no onBlockedAttempt, so
    // those clicks would have died silently, with the customer unable to move
    // forward at all. That loses the very bookings this PR is about.
    const { onDateSelect } = renderHourly('2026-09-16');

    const eighteenth = cell(18);
    expect(eighteenth).not.toBeDisabled();
    fireEvent.click(eighteenth);
    expect(onDateSelect).toHaveBeenCalledWith('2026-09-18');
  });

  it('a free day beyond a PARTIALLY BLOCKED one is selectable — a bug that predates this PR', () => {
    // A vendor lock on part of a day sets isBlocked WITHOUT isFullyBooked, and
    // `main` already fed that into the crossing guard for hourly: isExtend was
    // true for every date after the picked one, because `!checkOut` holds when
    // the hourly flow passes checkOut={null}.
    //
    // So on main, picking the 16th made the 18th — and everything after it —
    // shake and die silently. Nobody reported it because it needs a partial
    // time block, which is rarer than a full day. selectionMode fixes it as a
    // side effect; pinning it so it stays fixed.
    const partialBlock: CalendarDay[] = [
      day('2026-09-16'),
      day('2026-09-17', { isBlocked: true }),
      day('2026-09-18'),
    ];
    const { onDateSelect } = renderHourly('2026-09-16', partialBlock);

    const eighteenth = cell(18);
    expect(eighteenth).not.toBeDisabled();
    fireEvent.click(eighteenth);
    expect(onDateSelect).toHaveBeenCalledWith('2026-09-18');
  });

  it('with nothing picked yet, a booked day is inert and a free one is not', () => {
    const { onDateSelect } = renderHourly(null);

    expect(cell(17)).toBeDisabled();
    fireEvent.click(cell(15));
    expect(onDateSelect).toHaveBeenCalledWith('2026-09-15');
  });

  it('re-picking an EARLIER day works, so the customer is never trapped', () => {
    const { onDateSelect } = renderHourly('2026-09-20');

    fireEvent.click(cell(15));
    expect(onDateSelect).toHaveBeenCalledWith('2026-09-15');
  });
});

describe('UNCHANGED — the ordinary paths still work', () => {

  it('a free date is selectable as a first pick', () => {
    const { onDateSelect } = renderCalendar();
    fireEvent.click(cell(15));
    expect(onDateSelect).toHaveBeenCalledWith('2026-09-15');
  });

  it('past and inactive days stay inert', () => {
    render(
      <BookingCalendar
        month="2026-09"
        daysLeft={[day('2026-09-15', { isPast: true }), day('2026-09-16', { isActiveDay: false })]}
        daysRight={[]}
        onMonthChange={() => {}}
        checkIn={null}
        checkOut={null}
        onDateSelect={jest.fn()}
        currency="QAR"
      />,
    );
    expect(cell(15)).toBeDisabled();
    expect(cell(16)).toBeDisabled();
  });

  it('a booked night still shows its strike-through marker when offered as a check-out', () => {
    // It is genuinely booked as a NIGHT — the marker is honest, and removing it
    // would hide that from the customer. Pinned so it is not "tidied" away.
    const { container } = render(
      <BookingCalendar
        month="2026-09"
        daysLeft={SEPT}
        daysRight={[]}
        onMonthChange={() => {}}
        checkIn="2026-09-16"
        checkOut={null}
        onDateSelect={jest.fn()}
        currency="QAR"
      />,
    );
    expect(container.querySelectorAll('.-rotate-12').length).toBeGreaterThan(0);
  });
});
