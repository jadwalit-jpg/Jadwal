'use client';

import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface HourRangePickerSlot {
  slotStart: string;
  slotEnd: string;
  isPast?: boolean;
  isBlocked?: boolean;
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
  // Called when the user taps a host-locked time — drives the "can't book over
  // off-hours" toast in the parent.
  onBlockedAttempt?: () => void;
  formatTime: (hhmm: string) => string;
  labels?: {
    selectStart?: string;
    selectEnd?: string;
    clear?: string;
    hint?: string;
    blocked?: string;
    blockedLegend?: string;
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
  onBlockedAttempt,
  formatTime,
  labels,
}: HourRangePickerProps) {
  const [hoverHour, setHoverHour] = useState<string | null>(null);
  // Hour currently playing the "earthquake" shake after a blocked tap.
  const [shakeHour, setShakeHour] = useState<string | null>(null);

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

  // Ticks whose slot is unavailable specifically because the vendor LOCKED it
  // (not capacity, not past, not too-close-to-closing). Shown with a distinct
  // lock treatment so customers can tell a vendor block apart from a slot that
  // simply doesn't fit before closing time.
  const blockedByStart = useMemo(() => {
    const set = new Set<string>();
    for (const s of slots) if (s.isBlocked) set.add(s.slotStart);
    return set;
  }, [slots]);

  const anyBlocked = blockedByStart.size > 0;

  // Does the half-open hour range [fromM, toM) cross any host-locked hour?
  // blockedByStart holds the raw locked hour-starts (per-hour signal from the
  // server), so a booking of ANY length is checked against every hour it covers
  // — matching the server's range rejection. Used by both start + end validity.
  const hitsLock = useCallback(
    (fromM: number, toM: number) => {
      for (let m = fromM; m < toM; m += 60) {
        if (blockedByStart.has(fromMinutes(m))) return true;
      }
      return false;
    },
    [blockedByStart],
  );

  // A tick is a valid START if the activity fits before close, the slot
  // starting here isn't in the past, its duration-long window doesn't cross a
  // lock, and it has capacity for the guest count.
  const isValidStart = useCallback(
    (hh: string) => {
      const m = toMinutes(hh);
      if (m + unitMins > checkOutMins) return false;
      if (pastByStart.has(hh)) return false;
      // Range check: the baseline booking [m, m+duration) must not cross a lock.
      if (hitsLock(m, m + unitMins)) return false;
      const a = availByStart.get(hh);
      if (a !== null && a !== undefined && a < guests) return false;
      return true;
    },
    [unitMins, checkOutMins, pastByStart, hitsLock, availByStart, guests],
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
        // A locked hour anywhere inside the range makes the whole booking invalid
        // — you can't extend the END across a host lock.
        if (blockedByStart.has(slotHh)) return false;
        const a = availByStart.get(slotHh);
        if (a !== null && a !== undefined && a < guests) return false;
      }
      return true;
    },
    [unitMins, checkOutMins, maxSlotUnits, pastByStart, blockedByStart, availByStart, guests],
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

          // Would tapping here cross a host lock — either as a NEW start (its
          // duration-long baseline) or as an END-extension of the current start?
          // Either way it's not a valid pick; show the rose+lock treatment and
          // (below) keep it clickable so the tap shakes + warns.
          const wouldHitLock =
            !start || startM === null || m <= startM
              ? hitsLock(m, m + unitMins)
              : hitsLock(startM, m);
          const isLocked =
            wouldHitLock && !enabled && !isStart && !isEnd && !inSelectedRange;
          // "Unavailable" means the cell would never be bookable (past, over
          // capacity, beyond close). Shown as a greyed-out chip. Distinct
          // from "inside range, not clickable" which uses the range color, and
          // from "locked" which gets the rose treatment below.
          const isUnreachable =
            !enabled && !isLocked && !inSelectedRange && !inPreviewRange && !isPreviewEnd && !isStart && !isEnd;

          return (
            <motion.button
              key={hh}
              type="button"
              role="gridcell"
              // Locked cells stay clickable so a tap can shake + warn; other
              // unavailable cells (past / no capacity / beyond close) are inert.
              disabled={!enabled && !isLocked}
              animate={shakeHour === hh ? { x: [0, -6, 6, -5, 5, -3, 3, 0] } : { x: 0 }}
              transition={{ duration: 0.45 }}
              onClick={() => {
                if (isLocked) {
                  setShakeHour(hh);
                  onBlockedAttempt?.();
                  window.setTimeout(() => setShakeHour((c) => (c === hh ? null : c)), 500);
                  return;
                }
                handleClick(hh);
              }}
              onMouseEnter={() => setHoverHour(hh)}
              onFocus={() => setHoverHour(hh)}
              aria-label={isLocked ? `${formatTime(hh)} — ${labels?.blocked ?? 'blocked by host'}` : formatTime(hh)}
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
                // Vendor-locked — rose tint with a lock glyph
                isLocked &&
                  'cursor-not-allowed bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/60 text-rose-400 dark:text-rose-300/70',
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
              {isLocked ? (
                <span className="inline-flex items-center justify-center gap-1">
                  <Lock className="h-3 w-3 shrink-0" />
                  {formatTime(hh)}
                </span>
              ) : (
                formatTime(hh)
              )}
            </motion.button>
          );
        })}
      </div>

      {anyBlocked && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-rose-500 dark:text-rose-300/80">
          <Lock className="h-3 w-3 shrink-0" />
          {labels?.blockedLegend ?? 'Times marked with a lock are blocked by the host.'}
        </p>
      )}

      <p className="mt-3 text-[11px] text-gray-400 dark:text-slate-500">
        {labels?.hint ??
          `Minimum ${durationValue}h. Tap a later hour to extend. Closing time: ${formatTime(checkOutTime)}.`}
      </p>
    </div>
  );
}
