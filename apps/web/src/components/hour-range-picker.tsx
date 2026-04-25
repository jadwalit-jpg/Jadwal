'use client';

import { useCallback, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export interface HourRangePickerSlot {
  slotStart: string;
  slotEnd: string;
  isPast?: boolean;
  capacity?: number | null;
  booked?: number;
  available?: number;
  totalAvailable?: number;
}

export interface HourRangePickerProps {
  slots: HourRangePickerSlot[];
  checkInTime: string;
  checkOutTime: string;
  durationValue: number;
  guests: number;
  maxSlotUnits?: number;
  start: string | null;
  end: string | null;
  onChange: (start: string | null, end: string | null) => void;
  formatTime: (hhmm: string) => string;
  labels?: {
    selectStart?: string;
    selectEnd?: string;
    clear?: string;
    hint?: string;
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function fromMinutes(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function availOf(s: HourRangePickerSlot | undefined): number | null {
  if (!s) return null;
  if (typeof s.available === 'number' && s.available !== Infinity) return s.available;
  if (typeof s.totalAvailable === 'number') return s.totalAvailable;
  return null;
}

export function HourRangePicker({
  slots,
  checkInTime,
  checkOutTime,
  durationValue,
  guests,
  maxSlotUnits = 24,
  start,
  end,
  onChange,
  formatTime,
  labels,
}: HourRangePickerProps) {
  const [hoverHour, setHoverHour] = useState<string | null>(null);

  const unitMins = durationValue * 60;
  const checkInMins = useMemo(() => toMinutes(checkInTime), [checkInTime]);
  const checkOutMins = useMemo(() => toMinutes(checkOutTime), [checkOutTime]);

  // Every hour boundary between open and close (inclusive on both ends).
  // These are the only clickable "tick" positions.
  const hours = useMemo(() => {
    const out: string[] = [];
    for (let m = checkInMins; m <= checkOutMins; m += 60) {
      out.push(fromMinutes(m));
    }
    return out;
  }, [checkInMins, checkOutMins]);

  // Fast lookup: availability of the slot whose window STARTS at this hour.
  // For a 2h activity the slot at 08:00 covers [08:00, 10:00) — its available
  // count is the lowest it ever dips to inside that window.
  const availByStart = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const s of slots) map.set(s.slotStart, availOf(s));
    return map;
  }, [slots]);

  const pastByStart = useMemo(() => {
    const set = new Set<string>();
    for (const s of slots) if (s.isPast) set.add(s.slotStart);
    return set;
  }, [slots]);

  // A tick is a valid START if the activity fits before close, the slot
  // starting here isn't in the past, and it has capacity for the guest count.
  const isValidStart = useCallback(
    (hh: string) => {
      const m = toMinutes(hh);
      if (m + unitMins > checkOutMins) return false;
      if (pastByStart.has(hh)) return false;
      const a = availByStart.get(hh);
      if (a !== null && a !== undefined && a < guests) return false;
      return true;
    },
    [unitMins, checkOutMins, pastByStart, availByStart, guests],
  );

  // A tick is a valid END from a given start iff the resulting window is
  // at least `durationValue` hours long (the minimum), at most
  // durationValue × maxSlotUnits hours long (DoS cap), lands inside the
  // closing time, and every hour inside it has capacity for the guest count.
  //
  // NO "multiple-of-duration" constraint — customers can pick any hour length
  // ≥ durationValue. Pricing is pro-rated per hour on submit, mirroring the
  // backend's `priceCents × hours / durationValue` formula.
  const isValidEnd = useCallback(
    (hh: string, fromStart: string) => {
      const startM = toMinutes(fromStart);
      const endM = toMinutes(hh);
      const span = endM - startM;
      if (span < unitMins) return false;
      if (endM > checkOutMins) return false;
      const maxMins = maxSlotUnits * unitMins;
      if (span > maxMins) return false;
      // Walk every hour boundary covered by the booking. Each hour's slot
      // window [h, h+durationValue) overlaps our booking — if the slot shows
      // insufficient capacity, the range is not bookable. Conservative: may
      // reject a range that would actually fit (because slots past the
      // end of our range also contribute), but never approves an impossible
      // one. The server's peak-concurrent sweep is authoritative at POST.
      for (let m = startM; m < endM; m += 60) {
        const slotHh = fromMinutes(m);
        if (pastByStart.has(slotHh)) return false;
        const a = availByStart.get(slotHh);
        if (a !== null && a !== undefined && a < guests) return false;
      }
      return true;
    },
    [unitMins, checkOutMins, maxSlotUnits, pastByStart, availByStart, guests],
  );

  const startM = start ? toMinutes(start) : null;
  const endM = end ? toMinutes(end) : null;
  const hoverM = hoverHour ? toMinutes(hoverHour) : null;

  // Preview range shown while hovering — "if you click here, this is the range
  // you'll get". Appears only when the hovered tick would produce a valid
  // extension (≥ minimum duration from the current start, ≤ maxHours, ≤ close).
  const previewEndM = useMemo(() => {
    if (!start || startM === null || hoverM === null) return null;
    if (hoverM <= startM) return null;
    if (!isValidEnd(hoverHour!, start)) return null;
    // Only preview when hover is different from the current end so hovering
    // the actual end doesn't double-outline it.
    if (hoverM === endM) return null;
    return hoverM;
  }, [start, startM, hoverM, hoverHour, endM, isValidEnd]);

  const handleClick = useCallback(
    (hh: string) => {
      const m = toMinutes(hh);

      // On first click, or whenever the user taps at-or-before the current
      // start, we reset to this tick as the new start AND auto-fill the end
      // to `start + durationValue` — the minimum bookable window. This means
      // from the moment the user taps 8 AM (for a 2-hour activity), the UI
      // clearly shows 8 AM → 10 AM highlighted as the baseline. They can
      // then extend by tapping a later hour.
      if (!start || startM === null || m <= startM) {
        if (!isValidStart(hh)) return;
        const autoEndM = m + unitMins;
        if (autoEndM > checkOutMins) return;
        onChange(hh, fromMinutes(autoEndM));
        return;
      }

      // Tap at-or-before the existing end but still after start: this shrinks
      // or extends the end. Clamp to ≥ minimum so clicking a tick inside the
      // baseline range is a no-op rather than producing an invalid short
      // booking.
      const span = m - startM;
      if (span < unitMins) return; // inside baseline — already in range
      if (isValidEnd(hh, start)) {
        onChange(start, hh);
      }
      // If not a valid end (capacity / past / max-hours), ignore silently.
    },
    [start, startM, isValidStart, isValidEnd, unitMins, checkOutMins, onChange],
  );

  // Single-line summary of the current selection.
  const hintLine =
    start && end
      ? `${formatTime(start)} — ${formatTime(end)}  ·  ${(toMinutes(end) - toMinutes(start)) / 60}h`
      : (labels?.selectStart ?? 'Tap an hour to start');

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs">
        <span className="text-gray-500 dark:text-slate-400">{hintLine}</span>
        {(start || end) && (
          <button
            type="button"
            onClick={() => onChange(null, null)}
            className="text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 font-medium"
          >
            {labels?.clear ?? 'Clear'}
          </button>
        )}
      </div>

      <div
        role="grid"
        aria-label="Hour range picker"
        className="flex flex-wrap gap-1.5"
        onMouseLeave={() => setHoverHour(null)}
      >
        {hours.map((hh) => {
          const m = toMinutes(hh);
          const isStart = startM === m;
          const isEnd = endM === m;
          // Strictly between start and end — part of the booked range.
          const inSelectedRange =
            startM !== null && endM !== null && m > startM && m < endM;
          // Hovering preview — cells between start and the hovered valid end.
          const inPreviewRange =
            startM !== null && endM !== null && previewEndM !== null &&
            m > startM && m < previewEndM && m !== endM;
          const isPreviewEnd = previewEndM === m && !isEnd && !isStart;

          // Enablement:
          //   - Before any selection: only cells that are valid starts
          //   - After selection: cells ≤ start (reset), and cells > start that
          //     are valid ends. Cells inside the baseline range [start+1,
          //     start+unit-1] are visually "in range" but NOT clickable —
          //     they're already part of the booking.
          let enabled: boolean;
          if (!start || startM === null) {
            enabled = isValidStart(hh);
          } else if (m <= startM) {
            // Tapping at-or-before current start → reset (if this tick is
            // itself a valid start of a minimum booking).
            enabled = isValidStart(hh);
          } else if (m - startM < unitMins) {
            // Inside the baseline — not clickable, but clearly "in range".
            enabled = false;
          } else {
            enabled = isValidEnd(hh, start);
          }

          // "Unavailable" means the cell would never be bookable (past, over
          // capacity, beyond close). Shown as a greyed-out chip. Distinct
          // from "inside range, not clickable" which uses the range color.
          const isUnreachable =
            !enabled && !inSelectedRange && !inPreviewRange && !isPreviewEnd && !isStart && !isEnd;

          return (
            <button
              key={hh}
              type="button"
              role="gridcell"
              disabled={!enabled}
              onClick={() => handleClick(hh)}
              onMouseEnter={() => setHoverHour(hh)}
              onFocus={() => setHoverHour(hh)}
              aria-label={formatTime(hh)}
              aria-pressed={isStart || isEnd}
              className={cn(
                'min-w-[62px] px-3 py-2.5 rounded-lg border-2 text-sm font-semibold tabular-nums transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
                // Selected start/end — solid blue circle look
                (isStart || isEnd) &&
                  'border-sky-500 bg-sky-500 text-white shadow-md shadow-sky-500/25',
                // Committed range — mid blue background, clearly showing the range
                inSelectedRange &&
                  'border-sky-300 bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-200',
                // Preview range (hover) — faint blue
                (inPreviewRange || isPreviewEnd) &&
                  !(isStart || isEnd || inSelectedRange) &&
                  'border-sky-200 bg-sky-50 text-sky-600 dark:bg-sky-900/20 dark:border-sky-800 dark:text-sky-300',
                // Truly unavailable (past, no capacity, beyond close) — muted
                isUnreachable &&
                  'opacity-40 cursor-not-allowed bg-gray-50 dark:bg-slate-900/30 border-gray-100 dark:border-slate-800 text-gray-400',
                // Default tappable cell
                enabled &&
                  !isStart &&
                  !isEnd &&
                  !inSelectedRange &&
                  !inPreviewRange &&
                  !isPreviewEnd &&
                  'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-sky-400 text-gray-900 dark:text-white',
              )}
            >
              {formatTime(hh)}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-gray-400 dark:text-slate-500">
        {labels?.hint ??
          `Minimum ${durationValue}h. Tap a later hour to extend. Closing time: ${formatTime(checkOutTime)}.`}
      </p>
    </div>
  );
}
