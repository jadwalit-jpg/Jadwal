'use client';

import { useMemo, useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonthsClampedLocal } from '@/lib/date-window';

/* ─── Types ───────────────────────────────────────────────── */

export interface CalendarDay {
  date: string;       // YYYY-MM-DD
  dayOfWeek: string;  // MON, TUE, ...
  price: number;
  isSpecialPrice?: boolean;  // true when a per-date special-price override applies
  isActiveDay: boolean;
  isPast: boolean;
  capacity: number | null;
  booked: number;
  available: number | null;
  isFullyBooked: boolean;
  /** A vendor availability lock touches this date (whole- or part-day). */
  isBlocked?: boolean;
}

interface BookingCalendarProps {
  /** Current left-month in "YYYY-MM" format */
  month: string;
  /** Per-day data for the left month */
  daysLeft: CalendarDay[];
  /** Per-day data for the right month (next month) */
  daysRight: CalendarDay[];
  /** Navigate months: -1 or +1 */
  onMonthChange: (direction: -1 | 1) => void;
  /** Currently selected check-in date (YYYY-MM-DD) */
  checkIn: string | null;
  /** Currently selected check-out date (YYYY-MM-DD) */
  checkOut: string | null;
  /** Called when user clicks a date */
  onDateSelect: (date: string) => void;
  /** Called when the user taps a date whose min-night stay would cross a lock —
   *  drives the "can't book over off-days" toast in the parent. */
  onBlockedAttempt?: () => void;
  /** Currency code for price display */
  currency: string;
  /** Whether to show prices on each day */
  showPrices?: boolean;
  /** Minimum stay (nights) — selection logic lives in the parent; informational here */
  minNights?: number | null;
  /** Loading state */
  isLoading?: boolean;
  /** Max months in advance the customer may navigate/book (default 6) */
  maxAdvanceMonths?: number;
}

/* ─── Helpers ─────────────────────────────────────────────── */

// Localised month/weekday names. Arabic uses Latin numerals (`-u-nu-latn`) so
// the header year stays consistent with the Western day numbers in the cells.
function dateLocale(lang: string | undefined): string {
  return lang?.toLowerCase().startsWith('ar') ? 'ar-u-nu-latn' : 'en-US';
}
const WEEKDAY_REF = Date.UTC(2023, 0, 1); // 2023-01-01 is a Sunday
function localizedWeekdays(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(WEEKDAY_REF + i * 86_400_000)));
}

function parseMonth(month: string): { year: number; mon: number } {
  const [year, mon] = month.split('-').map(Number);
  return { year, mon };
}

function nextMonth(month: string): string {
  const { year, mon } = parseMonth(month);
  const next = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
  return next;
}

function monthLabel(month: string, locale: string): string {
  const { year, mon } = parseMonth(month);
  const date = new Date(year, mon - 1, 1);
  return date.toLocaleString(locale, { month: 'long', year: 'numeric' });
}

function formatPrice(price: number): string {
  if (price >= 1000) return `${(price / 1000).toFixed(1)}k`;
  return price.toFixed(0);
}

// YYYY-MM-DD + n days (UTC, date-only) — used for the min-nights lock lookahead.
function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole nights between two YYYY-MM-DD dates. */
function nightsBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00.000Z`).getTime();
  const b = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Will clicking `date` set the CHECK-OUT of the current selection?
 *
 * This matters because a date plays TWO roles, and only one consumes a night:
 *
 *   as an ARRIVAL   the guest sleeps there       -> the night must be free
 *   as a DEPARTURE  the guest leaves at checkout -> the night is NOT theirs
 *
 * A stay is the half-open range [checkIn, checkOut): the departure date is
 * excluded. So a fully-booked night can still be a perfectly valid DEPARTURE —
 * the outgoing guest leaves at 12:00, the incoming one arrives at 15:00, and
 * the two never meet. Treating a booked date as unusable for every purpose is
 * what was refusing valid one-night stays (reported 2026-09-18).
 *
 * Mirrors handleDailyDateSelect in the booking page exactly. Defined ONCE and
 * used by both the range guard and the per-cell disabled state — two copies of
 * this rule drifting apart is how the original bug survived since April.
 */
export function willSetCheckOut(
  date: string,
  checkIn: string | null,
  checkOut: string | null,
  minNights?: number | null,
): boolean {
  if (!checkIn || date <= checkIn) return false;
  // Min-night mode always extends. Flexible mode extends only while no check-out
  // is set yet — once both ends exist the next tap re-picks a fresh check-in,
  // which is an ARRIVAL and must obey the normal rules.
  return (minNights ?? 0) >= 1 || !checkOut;
}

/**
 * Dates whose selection would produce a stay crossing an UNAVAILABLE night.
 * Returns the set that must SHAKE + warn rather than select.
 *
 * Exported and pure so it can be tested directly. It used to live inside a
 * useMemo, so the only way to exercise it was to render the calendar — which is
 * why the fully-booked half of "unavailable" went unnoticed for five months.
 */
export function computeCrossingBlockedDates(
  daysLeft: CalendarDay[],
  daysRight: CalendarDay[],
  checkIn: string | null,
  checkOut: string | null,
  minNights?: number | null,
): Set<string> {
  const set = new Set<string>();
  const all = [...daysLeft, ...daysRight];
  // A night is UNAVAILABLE whether the vendor LOCKED it or a guest BOOKED it.
  // Only `isBlocked` was considered before, so a range could be dragged across
  // a booked night: 16 -> 18 over a booked 17 was accepted by the picker and
  // only refused later by the server. The tester spotted the tell — the same
  // drag over a vendor-locked date WAS refused, because only that half of
  // "unavailable" had ever been implemented.
  const unavailable = new Set(
    all.filter((d) => d.isBlocked || d.isFullyBooked).map((d) => d.date),
  );
  if (unavailable.size === 0) return set;
  const nights = minNights ?? 0;
  const isMinNight = nights >= 1;
  // Half-open [from, to): exactly the nights the stay consumes. `to` is the
  // DEPARTURE day and is deliberately excluded — see willSetCheckOut.
  const rangeHitsUnavailable = (from: string, to: string) => {
    for (let n = from; n < to; n = addDaysStr(n, 1)) if (unavailable.has(n)) return true;
    return false;
  };
  for (const d of all) {
    if (d.isPast || !d.isActiveDay) continue;
    if (d.date === checkIn) continue; // the selected check-in — a tap clears it
    if (willSetCheckOut(d.date, checkIn, checkOut, minNights)) {
      // Validate the range that will ACTUALLY result. Min-night mode SNAPS a
      // too-short pick up to the minimum check-out, so checking [checkIn, d)
      // alone would miss the nights between d and that snapped end.
      const end =
        isMinNight && nightsBetween(checkIn as string, d.date) < nights
          ? addDaysStr(checkIn as string, nights)
          : d.date;
      if (rangeHitsUnavailable(checkIn as string, end)) set.add(d.date);
    } else if (isMinNight) {
      // Check-IN candidate: the minimum stay [d, d+minNights) must not cross an
      // unavailable night. Flexible mode has no minimum, so a lone arrival is
      // never blocked — the overlap is judged when the departure is picked.
      if (rangeHitsUnavailable(d.date, addDaysStr(d.date, nights))) set.add(d.date);
    }
  }
  return set;
}

/**
 * Is this date unselectable?
 *
 *   past / inactive             -> inert, always
 *   would cross an unavailable  -> CLICKABLE, so the tap can shake + explain
 *   booked, and not a departure -> inert (it would be an arrival on a taken night)
 *   otherwise                   -> selectable
 */
export function isDateDisabled(
  day: CalendarDay,
  opts: {
    checkIn: string | null;
    checkOut: string | null;
    minNights?: number | null;
    crossingBlocked: Set<string>;
  },
): boolean {
  if (day.isPast || !day.isActiveDay) return true;
  // Kept clickable on purpose — the tap shakes and explains, which is far less
  // confusing than an inert cell.
  if (crossingShakes(day, opts.crossingBlocked)) return false;
  if (!day.isFullyBooked) return false;
  // A booked night is still a valid DEPARTURE.
  return !willSetCheckOut(day.date, opts.checkIn, opts.checkOut, opts.minNights);
}

/** Does tapping this date shake-and-warn instead of selecting? */
export function crossingShakes(day: CalendarDay, crossingBlocked: Set<string>): boolean {
  return !day.isPast && day.isActiveDay && crossingBlocked.has(day.date);
}

/* ─── Month Grid ──────────────────────────────────────────── */

function MonthGrid({
  month,
  days,
  checkIn,
  checkOut,
  onDateSelect,
  onBlockedAttempt,
  lockBlockedStarts,
  currency,
  showPrices,
  minNights,
}: {
  month: string;
  days: CalendarDay[];
  checkIn: string | null;
  checkOut: string | null;
  onDateSelect: (date: string) => void;
  onBlockedAttempt?: () => void;
  lockBlockedStarts: Set<string>;
  currency: string;
  showPrices?: boolean;
  /** Needed so a cell can tell an ARRIVAL pick from a DEPARTURE pick. */
  minNights?: number | null;
}) {
  const { t, i18n } = useTranslation();
  const [shakeDate, setShakeDate] = useState<string | null>(null);
  const locale = dateLocale(i18n.language);
  const weekdays = useMemo(() => localizedWeekdays(locale), [locale]);
  const { year, mon } = parseMonth(month);
  const firstDayOfWeek = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay(); // 0=Sun

  // Build a lookup for day data
  const dayMap = useMemo(() => {
    const map = new Map<number, CalendarDay>();
    for (const d of days) {
      const dayNum = parseInt(d.date.split('-')[2], 10);
      map.set(dayNum, d);
    }
    return map;
  }, [days]);

  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();

  // Build grid cells: leading empties + day cells
  const cells: (CalendarDay | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(dayMap.get(d) ?? null);
  }

  const isInRange = useCallback(
    (dateStr: string) => {
      if (!checkIn || !checkOut) return false;
      return dateStr > checkIn && dateStr < checkOut;
    },
    [checkIn, checkOut],
  );

  return (
    <div className="flex-1 min-w-0">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white text-center mb-3">
        {monthLabel(month, locale)}
      </h3>

      {/* Weekday headers — min-w-0 + truncate so a wide localized name (Arabic)
          can never overflow its grid track into the neighbouring column. */}
      <div className="grid grid-cols-7 gap-0 mb-1">
        {weekdays.map((wd, i) => (
          <div key={i} className="min-w-0 truncate text-center text-[10px] sm:text-[11px] font-medium text-gray-400 dark:text-slate-500 py-1">
            {wd}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0">
        {cells.map((day, idx) => {
          if (!day) {
            return <div key={`empty-${idx}`} className="h-14" />;
          }

          const dateNum = parseInt(day.date.split('-')[2], 10);
          // A min-night stay starting here would cross a host lock — stays
          // clickable so the tap can shake + warn (vs. a genuinely full / past
          // day, which is inert).
          const isLockShake = crossingShakes(day, lockBlockedStarts);
          const isDisabled = isDateDisabled(day, {
            checkIn, checkOut, minNights, crossingBlocked: lockBlockedStarts,
          });
          const isCheckIn = checkIn === day.date;
          const isCheckOut = checkOut === day.date;
          const isSelected = isCheckIn || isCheckOut;
          const inRange = isInRange(day.date);

          return (
            <motion.button
              key={day.date}
              type="button"
              disabled={isDisabled}
              animate={shakeDate === day.date ? { x: [0, -5, 5, -4, 4, -2, 2, 0] } : { x: 0 }}
              transition={{ duration: 0.45 }}
              onClick={() => {
                if (isLockShake) {
                  setShakeDate(day.date);
                  onBlockedAttempt?.();
                  window.setTimeout(() => setShakeDate((c) => (c === day.date ? null : c)), 500);
                  return;
                }
                onDateSelect(day.date);
              }}
              className={`
                relative h-14 flex flex-col items-center justify-center text-sm transition-all
                ${isDisabled
                  ? 'text-gray-300 dark:text-slate-700 cursor-not-allowed'
                  : 'hover:bg-sky-50 dark:hover:bg-sky-900/20 cursor-pointer'
                }
                ${isSelected
                  ? 'bg-sky-600 text-white rounded-lg z-10'
                  : ''
                }
                ${inRange
                  ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                  : ''
                }
                ${isCheckIn && checkOut ? 'rounded-s-lg rounded-e-none' : ''}
                ${isCheckOut ? 'rounded-e-lg rounded-s-none' : ''}
              `}
            >
              <span className={`font-medium ${isSelected ? 'text-white' : ''}`}>
                {dateNum}
              </span>
              {!isDisabled && (day.isSpecialPrice || showPrices) && (
                <span
                  title={day.isSpecialPrice ? t('booking.specialPriceDay', 'Special price') : undefined}
                  className={`text-[10px] leading-none mt-0.5 ${
                    day.isSpecialPrice
                      ? `font-bold ${isSelected ? 'text-amber-200' : 'text-emerald-600 dark:text-emerald-400'}`
                      : isSelected
                        ? 'text-sky-100'
                        : day.isFullyBooked
                          ? 'text-gray-300 dark:text-slate-700'
                          : 'text-gray-400 dark:text-slate-500'
                  }`}>
                  {formatPrice(day.price)}
                </span>
              )}
              {day.isFullyBooked && !day.isPast && (
                <span className="absolute inset-x-2 top-1/2 h-px bg-gray-300 dark:bg-slate-600 -rotate-12" />
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main Calendar ───────────────────────────────────────── */

export default function BookingCalendar({
  month,
  daysLeft,
  daysRight,
  onMonthChange,
  checkIn,
  checkOut,
  onDateSelect,
  onBlockedAttempt,
  currency,
  showPrices = true,
  minNights,
  isLoading = false,
  maxAdvanceMonths = 6,
}: BookingCalendarProps) {
  const { t } = useTranslation();
  const rightMonth = nextMonth(month);

  // Dates that would create a stay crossing a host lock — the picker shakes +
  // warns instead of selecting them. SELECTION-AWARE:
  //   • picking a check-OUT (check-in set, check-out not): block any date whose
  //     stay [checkIn, date) contains a locked night — so you can't book ACROSS
  //     a lock (e.g. 9→12 over locked 10,11).
  //   • picking a check-IN: block dates whose minimum stay [date, date+minNights)
  //     already contains a lock.
  // Hourly date-locks are whole-day → surface as fully-booked, so this stays
  // empty there. Lookahead spans both visible months; the server is the backstop.
  const lockBlockedStarts = useMemo(
    () => computeCrossingBlockedDates(daysLeft, daysRight, checkIn, checkOut, minNights),
    [daysLeft, daysRight, minNights, checkIn, checkOut],
  );

  // Can't go before current month
  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const canGoBack = month > currentMonth;

  // Can't go beyond the max advance window (customer-facing: 6 months)
  const maxDate = addMonthsClampedLocal(new Date(), maxAdvanceMonths);
  const maxMonth = `${maxDate.getFullYear()}-${String(maxDate.getMonth() + 1).padStart(2, '0')}`;
  const canGoForward = rightMonth < maxMonth;

  if (isLoading) {
    return (
      <div className="p-6 rounded-2xl border border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900/50">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-gray-200 dark:bg-slate-800 rounded w-48 mx-auto" />
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 dark:bg-slate-800/60 rounded" />
              ))}
            </div>
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 dark:bg-slate-800/60 rounded" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 rounded-2xl border border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900/50">
      {/* Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => onMonthChange(-1)}
          disabled={!canGoBack}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-slate-400 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMonthChange(1)}
          disabled={!canGoForward}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-slate-400 disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Two-month grid — stacked on mobile (each month full-width so the 7 weekday
          columns have room; critical for Arabic, whose day names are wider than
          the English abbreviations and overlap when two months share a narrow
          phone screen), side-by-side from sm up. */}
      <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
        <MonthGrid
          month={month}
          days={daysLeft}
          checkIn={checkIn}
          checkOut={checkOut}
          onDateSelect={onDateSelect}
          onBlockedAttempt={onBlockedAttempt}
          lockBlockedStarts={lockBlockedStarts}
          currency={currency}
          showPrices={showPrices}
          minNights={minNights}
        />
        <div className="hidden sm:block w-px bg-gray-200 dark:bg-slate-800 shrink-0" />
        <MonthGrid
          month={rightMonth}
          days={daysRight}
          checkIn={checkIn}
          checkOut={checkOut}
          onDateSelect={onDateSelect}
          onBlockedAttempt={onBlockedAttempt}
          lockBlockedStarts={lockBlockedStarts}
          currency={currency}
          showPrices={showPrices}
          minNights={minNights}
        />
      </div>

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-800/60 flex flex-wrap items-center gap-4 text-[11px] text-gray-400 dark:text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-sky-600" /> {t('calendar.selected')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-sky-100 dark:bg-sky-900/30" /> In range
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-gray-100 dark:bg-slate-800 relative">
            <span className="absolute inset-0.5 top-1/2 h-px bg-gray-300 dark:bg-slate-600 -rotate-12" />
          </span> {t('calendar.fullyBooked')}
        </span>
      </div>
    </div>
  );
}
