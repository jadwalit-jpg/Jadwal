/**
 * Contract — the booking page must declare which calendar it is rendering.
 *
 * WHY A TEST THAT READS SOURCE
 * ----------------------------
 * Every other test here constructs <BookingCalendar> itself and passes
 * selectionMode explicitly. That proves the component honours the prop. It says
 * nothing about whether the PAGE passes it — and the page is the only place it
 * can be got wrong.
 *
 * Measured, not assumed: deleting selectionMode="single" from the hourly call
 * site left all 47 tests green. The hourly calendar would have silently
 * returned to the broken behaviour (a booked day clickable; every day after a
 * full one dead and silent) with CI reporting success.
 *
 * This is the SECOND time the same shape of hole appeared in this work — the
 * first was minNights never reaching MonthGrid. Both are invisible to a test
 * that supplies the prop itself, because supplying it is exactly what is in
 * question.
 *
 * Rendering the whole page would be the thorough answer, but it drags in
 * react-query, i18n, routing and the API client, and it would fail for a dozen
 * reasons unrelated to this one line. Reading the source is blunt and it cannot
 * be fooled: the line is either there or it is not.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const PAGE = join(__dirname, '../../src/app/activity/[slug]/book/page.tsx');

/** Each <BookingCalendar ... /> element in the page, as raw text. */
function calendarUsages(src: string): string[] {
  const out: string[] = [];
  const open = /<BookingCalendar\b/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(src)) !== null) {
    const end = src.indexOf('/>', m.index);
    expect(end).toBeGreaterThan(-1);
    out.push(src.slice(m.index, end + 2));
  }
  return out;
}

describe('booking page — calendar selection mode is declared at the call site', () => {

  const src = readFileSync(PAGE, 'utf8');
  const usages = calendarUsages(src);

  it('renders exactly two calendars — one hourly, one daily', () => {
    // If this count changes, the assertions below no longer cover every
    // calendar on the page and must be revisited rather than quietly passing.
    expect(usages).toHaveLength(2);
  });

  it('the HOURLY calendar declares selectionMode="single"', () => {
    // Identified by its data source rather than its position, so re-ordering
    // the file cannot make this assert against the wrong element.
    const hourly = usages.filter((u) => u.includes('hourlyCal'));
    expect(hourly).toHaveLength(1);
    expect(hourly[0]).toMatch(/selectionMode=["']single["']/);
  });

  it('the DAILY calendar does NOT declare single mode', () => {
    // It may leave the prop off entirely — 'range' is the default — but it must
    // never claim to be a single-date picker, which would disable the range
    // rules this whole change exists to add.
    const daily = usages.filter((u) => !u.includes('hourlyCal'));
    expect(daily).toHaveLength(1);
    expect(daily[0]).not.toMatch(/selectionMode=["']single["']/);
  });

  it('the hourly calendar passes no checkOut, which is why the mode is needed', () => {
    // Documents the reason rather than just the rule: with checkOut={null} the
    // range logic reads every later date as a departure. If this ever changes,
    // the reasoning behind selectionMode changes with it.
    const hourly = usages.find((u) => u.includes('hourlyCal'))!;
    expect(hourly).toMatch(/checkOut=\{null\}/);
  });
});
