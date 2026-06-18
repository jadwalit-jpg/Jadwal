'use client';

import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/* ─── Types ───────────────────────────────────────────────── */

export interface CalendarDay {
  date: string;       // YYYY-MM-DD
  dayOfWeek: string;  // MON, TUE, ...
  price: number;
  isActiveDay: boolean;
  isPast: boolean;
  capacity: number | null;
  booked: number;
  available: number | null;
  isFullyBooked: boolean;
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

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseMonth(month: string): { year: number; mon: number } {
  const [year, mon] = month.split('-').map(Number);
  return { year, mon };
}

function nextMonth(month: string): string {
  const { year, mon } = parseMonth(month);
  const next = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
  return next;
}

function monthLabel(month: string): string {
  const { year, mon } = parseMonth(month);
  const date = new Date(year, mon - 1, 1);
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function formatPrice(price: number): string {
  if (price >= 1000) return `${(price / 1000).toFixed(1)}k`;
  return price.toFixed(0);
}

/* ─── Month Grid ──────────────────────────────────────────── */

function MonthGrid({
  month,
  days,
  checkIn,
  checkOut,
  onDateSelect,
  currency,
  showPrices,
}: {
  month: string;
  days: CalendarDay[];
  checkIn: string | null;
  checkOut: string | null;
  onDateSelect: (date: string) => void;
  currency: string;
  showPrices?: boolean;
}) {
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
        {monthLabel(month)}
      </h3>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-0 mb-1">
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="text-center text-[11px] font-medium text-gray-400 dark:text-slate-500 py-1">
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
          const isDisabled = day.isPast || day.isFullyBooked || !day.isActiveDay;
          const isCheckIn = checkIn === day.date;
          const isCheckOut = checkOut === day.date;
          const isSelected = isCheckIn || isCheckOut;
          const inRange = isInRange(day.date);

          return (
            <button
              key={day.date}
              type="button"
              disabled={isDisabled}
              onClick={() => onDateSelect(day.date)}
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
              {showPrices && !isDisabled && (
                <span className={`text-[10px] leading-none mt-0.5 ${
                  isSelected
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
            </button>
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
  currency,
  showPrices = true,
  isLoading = false,
  maxAdvanceMonths = 6,
}: BookingCalendarProps) {
  const { t } = useTranslation();
  const rightMonth = nextMonth(month);

  // Can't go before current month
  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const canGoBack = month > currentMonth;

  // Can't go beyond the max advance window (customer-facing: 6 months)
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + maxAdvanceMonths);
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

      {/* Two-month grid */}
      <div className="flex gap-4 sm:gap-8">
        <MonthGrid
          month={month}
          days={daysLeft}
          checkIn={checkIn}
          checkOut={checkOut}
          onDateSelect={onDateSelect}
          currency={currency}
          showPrices={showPrices}
        />
        <div className="hidden sm:block w-px bg-gray-200 dark:bg-slate-800 shrink-0" />
        <MonthGrid
          month={rightMonth}
          days={daysRight}
          checkIn={checkIn}
          checkOut={checkOut}
          onDateSelect={onDateSelect}
          currency={currency}
          showPrices={showPrices}
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
