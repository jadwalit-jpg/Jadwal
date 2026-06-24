'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { getApiError } from '@/lib/api-error';
import { useToast } from '@/components/toast';
import BlockDateCalendar from '@/components/block-date-calendar';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Trash2, Loader2, ChevronDown } from 'lucide-react';
import { type Block, buildDisplay, weekdayLabel } from '@/lib/activity-blocks';

type DraftBlockBody = { date: string; endDate?: string; slotTimes?: string[]; repeatWeekly?: boolean };

interface Props {
  activityId?: string;
  bookingType: 'HOURLY' | 'DAILY';
  // HOURLY slot config — used to build the start-time grid the vendor locks.
  checkInTime?: string | null;
  checkOutTime?: string | null;
  durationValue?: number | null;
  // API namespace — '/vendor' (default, own activities) or '/admin' (any activity).
  apiBase?: string;
  // When true, the section collapses behind an Open/Close toggle (garage gate).
  collapsible?: boolean;
  // ── DRAFT MODE (create wizard) ── no activity yet, so we don't hit the API:
  // the same calendar + slot grid collect lock "requests" ({date, endDate?,
  // slotTimes?}) into `value`, bubbling via `onChange`. The wizard sends them
  // with the create. Recurring-weekly is hidden in draft (add it in edit) to keep
  // the 6-month expansion authoritative on the server.
  draft?: boolean;
  value?: DraftBlockBody[];
  onChange?: (items: DraftBlockBody[]) => void;
}

const BRAND = '#1d4f35';
const DAY_MS = 86400000;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function fromMin(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
/** Bookable START slots — every 60 min from check-in while a full booking still
 *  fits before close. Mirrors the backend computeSlots. */
function computeSlots(checkIn: string, checkOut: string, duration: number): string[] {
  const start = toMin(checkIn), end = toMin(checkOut), dur = duration * 60;
  if (dur <= 0) return [];
  const out: string[] = [];
  for (let tt = start; tt + dur <= end; tt += 60) out.push(fromMin(tt));
  return out;
}
function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
/** Group sorted YYYY-MM-DD dates into contiguous [start,end] runs. */
function groupRuns(dates: string[]): Array<{ start: string; end: string }> {
  const sorted = [...dates].sort();
  const runs: Array<{ start: string; end: string }> = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && d === ymd(Date.parse(`${last.end}T00:00:00.000Z`) + DAY_MS)) {
      last.end = d;
    } else {
      runs.push({ start: d, end: d });
    }
  }
  return runs;
}
function prettyDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

export default function ActivityBlocksManager({ activityId, bookingType, checkInTime, checkOutTime, durationValue, apiBase = '/vendor', collapsible = false, draft = false, value, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isHourly = bookingType === 'HOURLY';

  // Whole-day calendar selection (pending, not yet saved).
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);
  // Slot mode — the single day whose time slots are being managed.
  const [activeDate, setActiveDate] = useState<string>('');
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [wholeDay, setWholeDay] = useState(!isHourly);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  // Garage-gate collapse — starts closed when collapsible, always-open otherwise.
  const [open, setOpen] = useState(!collapsible);

  // Slot-grid mode = hourly, specific times (not whole-day, not recurring).
  const slotMode = isHourly && !wholeDay && !repeatWeekly;

  const queryKey = [apiBase === '/admin' ? 'admin-activity-blocks' : 'vendor-activity-blocks', activityId];

  const { data: fetched = [], isLoading: loadingBlocks } = useQuery<Block[]>({
    queryKey,
    queryFn: () => api.get(`${apiBase}/activities/${activityId}/blocks`).then((r) => r.data),
    enabled: !draft && !!activityId,
  });
  // In draft mode synthesize Block[] from the collected lock requests so the
  // calendar (red days) + slot grid reflect pending locks. Synthetic ids encode
  // the source request index (+ slot) so a click-to-remove maps back to `value`.
  const draftBlocks = useMemo<Block[]>(() => {
    if (!draft) return [];
    const out: Block[] = [];
    (value ?? []).forEach((b, i) => {
      if (b.slotTimes?.length) {
        for (const s of b.slotTimes) {
          const start = `${b.date}T${s}:00.000Z`;
          out.push({ id: `draft-${i}-${s}`, blockStart: start, blockEnd: new Date(Date.parse(start) + 60 * 60 * 1000).toISOString() });
        }
      } else {
        const start = `${b.date}T00:00:00.000Z`;
        const endBase = b.endDate ?? b.date;
        out.push({ id: `draft-${i}`, blockStart: start, blockEnd: new Date(Date.parse(`${endBase}T00:00:00.000Z`) + DAY_MS).toISOString() });
      }
    });
    return out;
  }, [draft, value]);
  const blocks = draft ? draftBlocks : fetched;
  const isLoading = draft ? false : loadingBlocks;

  // Weekday names spanned by the current selection — shown in the repeat-weekly note.
  const recurringWeekdays = useMemo(() => {
    const set = new Set<string>();
    for (const d of selectedDates) set.add(WD[new Date(`${d}T00:00:00.000Z`).getUTCDay()]);
    return WD.filter((n) => set.has(n));
  }, [selectedDates]);

  // All bookable start slots for this activity.
  const slots = useMemo(() => {
    if (!isHourly || !checkInTime || !checkOutTime || !durationValue) return [] as string[];
    return computeSlots(checkInTime, checkOutTime, durationValue);
  }, [isHourly, checkInTime, checkOutTime, durationValue]);

  // Slots already locked on the active date (start-match, same as the backend).
  const lockedSlots = useMemo(() => {
    const map = new Map<string, string>(); // slot → covering block id
    if (!activeDate) return map;
    for (const s of slots) {
      const startMs = Date.parse(`${activeDate}T${s}:00.000Z`);
      const b = blocks.find((bk) => startMs >= Date.parse(bk.blockStart) && startMs < Date.parse(bk.blockEnd));
      if (b) map.set(s, b.id);
    }
    return map;
  }, [activeDate, slots, blocks]);

  // The whole-day block covering a date (for unblock-on-click).
  const coveringBlockId = (dateStr: string): string | null => {
    const dStart = Date.parse(`${dateStr}T00:00:00.000Z`);
    const dEnd = dStart + DAY_MS;
    const b = blocks.find((bk) => Date.parse(bk.blockStart) <= dStart && Date.parse(bk.blockEnd) >= dEnd);
    return b?.id ?? null;
  };

  const clearSelection = () => { setSelectedDates(new Set()); setRangeAnchor(null); };

  // ── Draft-mode collectors (create wizard) — append/remove lock REQUESTS into
  // `value` instead of hitting the API. Whole-day selections group into runs
  // (one {date,endDate} per contiguous range); slots become one {date,slotTimes}.
  const draftLockWholeDays = () => {
    const bodies: DraftBlockBody[] = groupRuns([...selectedDates]).map((run) =>
      run.end !== run.start ? { date: run.start, endDate: run.end } : { date: run.start },
    );
    onChange?.([...(value ?? []), ...bodies]);
    clearSelection();
  };
  const draftLockSlots = () => {
    onChange?.([...(value ?? []), { date: activeDate, slotTimes: [...selectedSlots].sort() }]);
    setSelectedSlots(new Set());
  };
  // Synthetic id → source request: `draft-<i>` (whole-day/range) or
  // `draft-<i>-<slot>` (a single slot of request i).
  const draftRemove = (id: string) => {
    const m = id.match(/^draft-(\d+)(?:-(.+))?$/);
    if (!m) return;
    const idx = Number(m[1]);
    const slot = m[2];
    const next = [...(value ?? [])];
    const body = next[idx];
    if (!body) return;
    if (slot && body.slotTimes) {
      const remaining = body.slotTimes.filter((s) => s !== slot);
      if (remaining.length) next[idx] = { ...body, slotTimes: remaining };
      else next.splice(idx, 1);
    } else {
      next.splice(idx, 1);
    }
    onChange?.(next);
  };

  // Calendar — click a free/partial day.
  const handleDayClick = (dateStr: string, shift: boolean) => {
    if (slotMode) {
      setActiveDate(dateStr);
      setSelectedSlots(new Set());
      return;
    }
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (shift && rangeAnchor) {
        const lo = rangeAnchor < dateStr ? rangeAnchor : dateStr;
        const hi = rangeAnchor < dateStr ? dateStr : rangeAnchor;
        for (let ms = Date.parse(`${lo}T00:00:00.000Z`); ms <= Date.parse(`${hi}T00:00:00.000Z`); ms += DAY_MS) {
          const d = ymd(ms);
          if (!coveringBlockId(d)) next.add(d); // skip already-locked days
        }
      } else if (next.has(dateStr)) {
        next.delete(dateStr);
      } else {
        next.add(dateStr);
      }
      return next;
    });
    setRangeAnchor(dateStr);
  };

  // Calendar — click a red (locked whole-day) day → unblock.
  const handleUnlock = (dateStr: string) => {
    const id = coveringBlockId(dateStr);
    if (id) { draft ? draftRemove(id) : deleteMut.mutate(id); }
  };

  const toggleSlot = (s: string) => {
    const blockId = lockedSlots.get(s);
    if (blockId) { draft ? draftRemove(blockId) : deleteMut.mutate(blockId); return; } // click a locked slot → unblock it
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  // Lock the selected whole days (grouped into runs, or one series per weekday).
  const lockMut = useMutation({
    mutationFn: async () => {
      let affected = 0;
      if (repeatWeekly) {
        const byWeekday = new Map<number, string>();
        for (const d of [...selectedDates].sort()) {
          const wd = new Date(`${d}T00:00:00.000Z`).getUTCDay();
          if (!byWeekday.has(wd)) byWeekday.set(wd, d);
        }
        for (const d of byWeekday.values()) {
          const body: Record<string, unknown> = { date: d, repeatWeekly: true };
          const res = await api.post(`${apiBase}/activities/${activityId}/blocks`, body);
          affected += res.data?.affectedBookings ?? 0;
        }
      } else {
        for (const run of groupRuns([...selectedDates])) {
          const body: Record<string, unknown> = { date: run.start };
          if (run.end !== run.start) body.endDate = run.end;
          const res = await api.post(`${apiBase}/activities/${activityId}/blocks`, body);
          affected += res.data?.affectedBookings ?? 0;
        }
      }
      return { affected };
    },
    onSuccess: ({ affected }) => {
      const base = repeatWeekly
        ? t('vendor.activities.wizard.blocked.addedRecurring', 'Recurring blocks added')
        : t('vendor.activities.wizard.blocked.added', 'Dates blocked');
      toast(
        affected > 0
          ? `${base} — ${affected} ${t('vendor.activities.wizard.blocked.affectedNote', 'existing booking(s) in this period are not cancelled')}`
          : base,
        'success',
      );
      qc.invalidateQueries({ queryKey });
      clearSelection();
    },
    onError: (err) => {
      // A later create can fail after earlier ones already persisted — refetch so
      // the UI re-syncs with server state instead of showing a stale list (and
      // retries don't conflict with the blocks that did get created).
      qc.invalidateQueries({ queryKey });
      toast(getApiError(err, t('vendor.activities.wizard.blocked.addFailed', 'Could not add block')), 'error');
    },
  });

  // Lock the selected time slots on the active date.
  const lockSlotsMut = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { date: activeDate, slotTimes: [...selectedSlots].sort() };
      const res = await api.post(`${apiBase}/activities/${activityId}/blocks`, body);
      return { affected: (res.data?.affectedBookings as number) ?? 0 };
    },
    onSuccess: ({ affected }) => {
      const base = t('vendor.activities.wizard.blocked.added', 'Times blocked');
      toast(
        affected > 0
          ? `${base} — ${affected} ${t('vendor.activities.wizard.blocked.affectedNote', 'existing booking(s) in this period are not cancelled')}`
          : base,
        'success',
      );
      qc.invalidateQueries({ queryKey });
      setSelectedSlots(new Set());
    },
    onError: (err) =>
      toast(getApiError(err, t('vendor.activities.wizard.blocked.addFailed', 'Could not add block')), 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      api.delete(`${apiBase}/activities/${activityId}/blocks/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast(t('vendor.activities.wizard.blocked.removed', 'Block removed'), 'success');
      qc.invalidateQueries({ queryKey });
    },
    onError: (err) =>
      toast(getApiError(err, t('vendor.activities.wizard.blocked.removeFailed', 'Could not remove block')), 'error'),
  });

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) =>
      api.post(`${apiBase}/activities/${activityId}/blocks/bulk-delete`, { ids }).then((r) => r.data),
    onSuccess: () => {
      toast(t('vendor.activities.wizard.blocked.removed', 'Block removed'), 'success');
      qc.invalidateQueries({ queryKey });
    },
    onError: (err) =>
      toast(getApiError(err, t('vendor.activities.wizard.blocked.removeFailed', 'Could not remove block')), 'error'),
  });

  // Recurring series only — single/range whole-day blocks live on the calendar (red).
  const displayItems = useMemo(() => buildDisplay(blocks), [blocks]);
  const seriesItems = useMemo(
    () => displayItems.filter((it): it is Extract<typeof it, { kind: 'series' }> => it.kind === 'series'),
    [displayItems],
  );

  return (
    <div className="mt-8 pt-6 border-t border-gray-200 dark:border-slate-800">
      <div className="flex items-center gap-2 mb-1">
        <Lock className="h-4 w-4 shrink-0" style={{ color: BRAND }} />
        <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">
          {t('vendor.activities.wizard.blocked.title', 'Blocked dates & times')}
        </h3>
      </div>

      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
          {t(
            'vendor.activities.wizard.blocked.hint',
            'Lock specific dates or times so customers cannot book them (maintenance, private events, breaks).',
          )}
        </p>
        {collapsible && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
            <ChevronDown className={cn('h-4 w-4 transition-transform duration-300', open && 'rotate-180')} />
            {open ? t('vendor.activities.wizard.blocked.close', 'Close') : t('vendor.activities.wizard.blocked.open', 'Open')}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {(!collapsible || open) && (
          <motion.div
            key="blocks-body"
            initial={collapsible ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
      {/* Mode toggles */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3">
        {isHourly && !repeatWeekly && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={wholeDay}
              onChange={(e) => { setWholeDay(e.target.checked); setSelectedSlots(new Set()); setActiveDate(''); }}
              className="rounded border-gray-300 focus:ring-0" style={{ accentColor: BRAND }} />
            {t('vendor.activities.wizard.blocked.wholeDay', 'Block the whole day')}
          </label>
        )}
        {!draft && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={repeatWeekly}
              onChange={(e) => { setRepeatWeekly(e.target.checked); clearSelection(); setSelectedSlots(new Set()); setActiveDate(''); }}
              className="rounded border-gray-300 focus:ring-0" style={{ accentColor: BRAND }} />
            {t('vendor.activities.wizard.blocked.repeatWeekly', 'Repeat every week for 6 months (these weekdays)')}
          </label>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-slate-400 mb-2">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-rose-500" />{t('vendor.activities.wizard.blocked.legendBlocked', 'Blocked')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={{ backgroundColor: BRAND }} />{t('vendor.activities.wizard.blocked.legendSelected', 'Selected')}</span>
        {slotMode && (
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-rose-400" />{t('vendor.activities.wizard.blocked.legendPartial', 'Has time blocks')}</span>
        )}
      </div>

      {/* Always-visible calendar */}
      {isLoading ? (
        <div className="h-64 jadwal-skeleton rounded-xl" />
      ) : (
        <BlockDateCalendar
          blocks={blocks}
          selected={slotMode ? new Set(activeDate ? [activeDate] : []) : selectedDates}
          onDayClick={handleDayClick}
          onUnlock={handleUnlock}
          maxMonths={6}
        />
      )}
      <p className="text-xs text-gray-400 dark:text-slate-500 mt-2 text-start">
        {slotMode
          ? t('vendor.activities.wizard.blocked.helpSlot', 'Tap a day to manage its time slots. Red days are fully blocked — tap to unblock.')
          : t('vendor.activities.wizard.blocked.helpDay', 'Tap days to select · Shift-tap to fill a range · tap a red day to unblock.')}
      </p>

      {/* Slot-grid (HOURLY time mode) for the chosen day */}
      {slotMode && activeDate && (
        <div className="mt-3 rounded-xl bg-stone-50 dark:bg-slate-800/50 p-4 border border-stone-200 dark:border-slate-700">
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1.5 text-start">
            {t('vendor.activities.wizard.blocked.pickTimes', 'Tap the start times to lock')} · {prettyDate(activeDate)}
          </label>
          {slots.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-slate-500 text-start">
              {t('vendor.activities.wizard.blocked.noSlots', 'This activity has no bookable time slots.')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {slots.map((s) => {
                const locked = lockedSlots.has(s);
                const sel = selectedSlots.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSlot(s)}
                    aria-pressed={sel || locked}
                    title={locked ? t('vendor.activities.wizard.blocked.tapUnlock', 'Tap to unblock') : undefined}
                    className={cn(
                      'inline-flex items-center gap-1 min-w-[64px] justify-center px-2.5 py-2 rounded-lg border-2 text-xs font-semibold tabular-nums transition-all',
                      locked
                        ? 'bg-rose-500 border-rose-500 text-white hover:bg-rose-600'
                        : sel
                          ? 'border-transparent text-white'
                          : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white hover:border-[#1d4f35]/50',
                    )}
                    style={sel && !locked ? { backgroundColor: BRAND } : undefined}
                  >
                    {locked && <Lock className="h-3 w-3 shrink-0" />}
                    {formatTime12h(s)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Repeat-weekly note */}
      {!slotMode && repeatWeekly && recurringWeekdays.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-2 text-start">
          {t('vendor.activities.wizard.blocked.repeatNote', 'Blocks every')} {recurringWeekdays.join(', ')} {t('vendor.activities.wizard.blocked.repeatNote2', 'for the next 6 months (whole day).')}
        </p>
      )}

      {/* Reason + Lock action */}
      {(slotMode ? !!activeDate : true) && (
        <div className="mt-3 rounded-xl bg-stone-50 dark:bg-slate-800/50 p-4 border border-stone-200 dark:border-slate-700">
          {slotMode ? (
            <button type="button" disabled={selectedSlots.size === 0 || (!draft && lockSlotsMut.isPending)}
              onClick={() => draft ? draftLockSlots() : lockSlotsMut.mutate()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: BRAND }}>
              {!draft && lockSlotsMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {t('vendor.activities.wizard.blocked.lock', 'Lock')} {selectedSlots.size > 0 ? selectedSlots.size : ''} {t('vendor.activities.wizard.blocked.timesWord', 'time(s)')}
            </button>
          ) : (
            <button type="button" disabled={selectedDates.size === 0 || (!draft && lockMut.isPending)}
              onClick={() => draft ? draftLockWholeDays() : lockMut.mutate()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: BRAND }}>
              {!draft && lockMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {repeatWeekly
                ? `${t('vendor.activities.wizard.blocked.lockRecurring', 'Lock recurring')} (${recurringWeekdays.length} ${t('vendor.activities.wizard.blocked.weekdaysWord', 'weekday(s)')})`
                : `${t('vendor.activities.wizard.blocked.lock', 'Lock')} ${selectedDates.size > 0 ? selectedDates.size : ''} ${t('vendor.activities.wizard.blocked.datesWord', 'date(s)')}`}
            </button>
          )}
        </div>
      )}

      {/* Recurring series — managed as a unit (bulk remove) */}
      {seriesItems.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-gray-500 dark:text-slate-400 text-start">
            {t('vendor.activities.wizard.blocked.recurringHeading', 'Recurring blocks')}
          </p>
          {seriesItems.map((it) => (
            <div key={it.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white text-start">
                  {t('vendor.activities.wizard.blocked.every', 'Every')} {weekdayLabel(it.weekdayIndex, i18n.language)} · {it.first} → {it.last}
                </p>
                <p className="text-xs text-gray-400 dark:text-slate-500 truncate text-start">
                  {it.count} {t('vendor.activities.wizard.blocked.daysWord', 'days')}
                </p>
              </div>
              <button type="button" onClick={() => bulkDeleteMut.mutate(it.ids)} disabled={bulkDeleteMut.isPending}
                className="shrink-0 p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                aria-label={t('vendor.activities.wizard.blocked.remove', 'Remove')}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
