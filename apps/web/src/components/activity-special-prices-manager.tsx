'use client';

/**
 * Per-date special-price manager — mirrors ActivityBlocksManager. Reusable across
 * actors via the `apiBase` prop ('/vendor' = own activity, '/admin' = any). The
 * vendor/admin selects one or more calendar days (Shift-click for a range), enters
 * a price, and saves; days with an override show their price as a badge. The
 * applied price is frozen onto bookings server-side, so editing/removing an
 * override never changes existing bookings.
 *
 * Multi-date is sent in ONE bulk request (`/special-prices/bulk`) so pricing many
 * dates no longer fires one request per date (which tripped the rate limit).
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Tag, Trash2, Loader2, ChevronDown, ChevronLeft, ChevronRight, X, Lock, LayoutGrid, Rows3 } from 'lucide-react';
import api from '@/lib/api';
import { type Block } from '@/lib/activity-blocks';
import { cn } from '@/lib/utils';
import { getApiError } from '@/lib/api-error';
import { useToast } from '@/components/toast';

const MAX_PRICE = 1_000_000;
// Match the booking advance window + the block (lock) calendar — 6 months ahead.
const MAX_MONTHS_AHEAD = 6;
// Matches the backend bulk cap (BulkSpecialPriceDto @ArrayMaxSize / span cap).
const MAX_BULK_DATES = 200;

interface SpecialPrice {
  id: string;
  date: string;
  price: string | number;
}

interface Props {
  activityId?: string;
  currency?: string;
  // '/vendor' (default, own activity) or '/admin' (any activity).
  apiBase?: string;
  // When true, collapses behind an Open/Close toggle (same as the blocks manager).
  collapsible?: boolean;
  // ── DRAFT MODE (create wizard) ── no activity exists yet, so we don't hit the
  // API: the calendar collects {date, price} into `value` and bubbles changes via
  // `onChange`. The wizard holds the list and sends it with the create. Same UI +
  // same per-date "set the price for this day" logic as the live (edit) mode.
  draft?: boolean;
  value?: Array<{ date: string; price: number }>;
  onChange?: (items: Array<{ date: string; price: number }>) => void;
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// Arabic uses Latin numerals (`-u-nu-latn`) so dates stay consistent with the
// Western day numbers rendered in the calendar cells.
function dateLocale(lang: string | undefined): string {
  return lang?.toLowerCase().startsWith('ar') ? 'ar-u-nu-latn' : 'en-US';
}
function prettyDate(s: string, locale: string): string {
  return new Date(`${s}T00:00:00.000Z`).toLocaleDateString(locale, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}
// Inclusive list of YYYY-MM-DD between two dates (for Shift-click range select).
function datesBetween(lo: string, hi: string): string[] {
  const out: string[] = [];
  let cur = new Date(`${lo}T00:00:00.000Z`);
  const end = new Date(`${hi}T00:00:00.000Z`);
  let guard = 0;
  while (cur <= end && guard <= MAX_BULK_DATES + 1) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86_400_000);
    guard++;
  }
  return out;
}

export default function ActivitySpecialPricesManager({
  activityId,
  currency = 'QAR',
  apiBase = '/vendor',
  collapsible = false,
  draft = false,
  value,
  onChange,
}: Props) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const now = useMemo(() => new Date(), []);
  const [open, setOpen] = useState(!collapsible);
  // Selector layout — default 'horizontal' preserves the original 7-col week grid;
  // 'vertical' stacks the same date cells into a single full-width column.
  const [layout, setLayout] = useState<'horizontal' | 'vertical'>('horizontal');
  const [cursor, setCursor] = useState({ y: now.getUTCFullYear(), m: now.getUTCMonth() });
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState('');

  const todayStr = ymd(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const maxMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + MAX_MONTHS_AHEAD, 1));

  const queryKey = [apiBase === '/admin' ? 'admin-special-prices' : 'vendor-special-prices', activityId];
  const { data: fetched = [], isLoading: loadingPrices } = useQuery<SpecialPrice[]>({
    queryKey,
    queryFn: () => api.get(`${apiBase}/activities/${activityId}/special-prices`).then((r) => r.data),
    enabled: !draft && !!activityId,
  });
  // In draft mode the list comes from the wizard's local state (synthetic ids
  // keyed by date); live mode uses the fetched rows.
  const prices: SpecialPrice[] = draft
    ? (value ?? []).map((p) => ({ id: `draft-${p.date}`, date: p.date, price: p.price }))
    : fetched;
  const isLoading = draft ? false : loadingPrices;

  // date (YYYY-MM-DD) → { id, price } for fast calendar lookup + the list.
  const byDate = useMemo(() => {
    const map = new Map<string, { id: string; price: number }>();
    for (const p of prices) map.set(String(p.date).slice(0, 10), { id: p.id, price: Number(p.price) });
    return map;
  }, [prices]);

  // Blocked/locked dates — same endpoint + cache key as ActivityBlocksManager so
  // the two stay in sync. A date is "locked" when a whole-day block fully covers
  // it: it can't be booked, so we surface it (and disable pricing it) here.
  const { data: blocks = [] } = useQuery<Block[]>({
    queryKey: [apiBase === '/admin' ? 'admin-activity-blocks' : 'vendor-activity-blocks', activityId],
    queryFn: () => api.get(`${apiBase}/activities/${activityId}/blocks`).then((r) => r.data),
    enabled: !draft && !!activityId,
  });
  const isLocked = useCallback(
    (dateStr: string): boolean => {
      const dStart = Date.parse(`${dateStr}T00:00:00.000Z`);
      const dEnd = dStart + 86400000;
      return blocks.some((b) => Date.parse(b.blockStart) <= dStart && Date.parse(b.blockEnd) >= dEnd);
    },
    [blocks],
  );

  const clearSelection = () => { setSelectedDates(new Set()); setLastClicked(null); setPriceInput(''); };

  const bulkSaveMut = useMutation({
    mutationFn: (body: { dates: string[]; price: number }) =>
      api.post(`${apiBase}/activities/${activityId}/special-prices/bulk`, body).then((r) => r.data),
    onSuccess: (res: { count?: number }) => {
      toast(t('vendor.activities.wizard.specialPrice.savedN', { defaultValue: 'Saved {{count}} special price(s)', count: res?.count ?? 0 }), 'success');
      qc.invalidateQueries({ queryKey });
      clearSelection();
    },
    onError: (e) => toast(getApiError(e, t('vendor.activities.wizard.specialPrice.saveFailed', 'Could not save special price')), 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`${apiBase}/activities/${activityId}/special-prices/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast(t('vendor.activities.wizard.specialPrice.removed', 'Special price removed'), 'success');
      qc.invalidateQueries({ queryKey });
      clearSelection();
    },
    onError: (e) => toast(getApiError(e, t('vendor.activities.wizard.specialPrice.removeFailed', 'Could not remove special price')), 'error'),
  });

  // Toggle a day in/out of the selection; Shift-click extends an inclusive range
  // from the last clicked day (skipping past + locked days).
  const toggleDay = (dateStr: string, shiftKey: boolean) => {
    const next = new Set(selectedDates);
    if (shiftKey && lastClicked) {
      const lo = lastClicked < dateStr ? lastClicked : dateStr;
      const hi = lastClicked < dateStr ? dateStr : lastClicked;
      for (const d of datesBetween(lo, hi)) {
        if (d >= todayStr && !isLocked(d)) next.add(d);
      }
    } else if (next.has(dateStr)) {
      next.delete(dateStr);
    } else {
      next.add(dateStr);
    }
    if (next.size > MAX_BULK_DATES) {
      toast(t('vendor.activities.wizard.specialPrice.maxDates', { defaultValue: 'You can price up to {{max}} dates at once.', max: MAX_BULK_DATES }), 'error');
      return;
    }
    setSelectedDates(next);
    setLastClicked(dateStr);
    // Prefill the price when the result is a single existing-priced date (edit UX);
    // keep the typed value when selecting multiple.
    if (next.size === 1) {
      const ex = byDate.get([...next][0]);
      setPriceInput(ex ? String(ex.price) : '');
    } else if (next.size === 0) {
      setPriceInput('');
    }
  };

  const priceNum = Number(priceInput);
  const priceValid = priceInput.trim() !== '' && Number.isFinite(priceNum) && priceNum > 0 && priceNum <= MAX_PRICE;
  const selectedCount = selectedDates.size;
  const onlyDate = selectedCount === 1 ? [...selectedDates][0] : null;
  const selectedExisting = onlyDate ? byDate.get(onlyDate) : undefined;

  const save = () => {
    if (selectedCount === 0 || !priceValid) return;
    const price = Math.round(priceNum * 100) / 100;
    const dates = [...selectedDates];
    if (draft) {
      // Upsert each selected date into the wizard's local list (one override per date).
      const kept = (value ?? []).filter((v) => !selectedDates.has(v.date));
      onChange?.([...kept, ...dates.map((date) => ({ date, price }))]);
      clearSelection();
    } else {
      bulkSaveMut.mutate({ dates, price });
    }
  };

  const removeSingle = () => {
    if (!onlyDate) return;
    if (draft) {
      onChange?.((value ?? []).filter((v) => v.date !== onlyDate));
      clearSelection();
    } else {
      const ex = byDate.get(onlyDate);
      if (ex) deleteMut.mutate(ex.id);
    }
  };

  // Calendar grid (leading blanks + days) for the cursor month.
  const cells = useMemo(() => {
    const startWd = new Date(Date.UTC(cursor.y, cursor.m, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
    const out: (string | null)[] = [];
    for (let i = 0; i < startWd; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(ymd(cursor.y, cursor.m, d));
    return out;
  }, [cursor]);

  const canPrev = cursor.y > now.getUTCFullYear() || (cursor.y === now.getUTCFullYear() && cursor.m > now.getUTCMonth());
  const canNext = new Date(Date.UTC(cursor.y, cursor.m, 1)) < maxMonth;
  const locale = dateLocale(i18n.language);
  const monthLabel = new Date(Date.UTC(cursor.y, cursor.m, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
  const weekdayShort = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(new Date(Date.UTC(2023, 0, 1 + i))));

  const shift = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.y, c.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

  return (
    <div className="mt-8 pt-6 border-t border-gray-200 dark:border-slate-800">
      <div className="flex items-center gap-2 mb-1">
        <Tag className="h-4 w-4 shrink-0 text-[#1d4f35]" />
        <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate text-start">
          {t('vendor.activities.wizard.specialPrice.title', 'Special prices by date')}
        </h3>
      </div>

      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5 text-start">
          {t('vendor.activities.wizard.specialPrice.hint', 'Override the price on specific dates (e.g. weekends or holidays). Customers booking those dates pay the special price; all other dates use the base price.')}
        </p>
        {collapsible && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
            <ChevronDown className={cn('h-4 w-4 transition-transform duration-300', open && 'rotate-180')} />
            {open ? t('vendor.activities.wizard.specialPrice.close', 'Close') : t('vendor.activities.wizard.specialPrice.open', 'Open')}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {(!collapsible || open) && (
          <motion.div
            key="special-prices-body"
            initial={collapsible ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            {isLoading ? (
              <div className="h-72 jadwal-skeleton rounded-xl max-w-sm" />
            ) : (
              <div className="max-w-sm rounded-2xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
                {/* Month nav */}
                <div className="flex items-center justify-between mb-3">
                  <button type="button" onClick={() => shift(-1)} disabled={!canPrev} aria-label={t('vendor.activities.wizard.specialPrice.previous', 'Previous')}
                    className="p-1.5 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" />
                  </button>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">{monthLabel}</span>
                  <button type="button" onClick={() => shift(1)} disabled={!canNext} aria-label={t('vendor.activities.wizard.specialPrice.next', 'Next')}
                    className="p-1.5 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
                  </button>
                </div>

                {/* Layout toggle — switches the day grid below between the horizontal
                    (7-col week) view and a vertical (single-column, full-width) list. */}
                <div className="flex items-center justify-end gap-1 mb-2">
                  <button
                    type="button"
                    onClick={() => setLayout('horizontal')}
                    aria-pressed={layout === 'horizontal'}
                    title={t('vendor.activities.wizard.specialPrice.layoutHorizontal', 'Horizontal grid')}
                    className={cn(
                      'p-1.5 rounded-md border transition-colors',
                      layout === 'horizontal'
                        ? 'bg-[#1d4f35] border-[#1d4f35] text-white'
                        : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800',
                    )}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLayout('vertical')}
                    aria-pressed={layout === 'vertical'}
                    title={t('vendor.activities.wizard.specialPrice.layoutVertical', 'Vertical list')}
                    className={cn(
                      'p-1.5 rounded-md border transition-colors',
                      layout === 'vertical'
                        ? 'bg-[#1d4f35] border-[#1d4f35] text-white'
                        : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800',
                    )}
                  >
                    <Rows3 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Weekday header — only meaningful for the 7-col week grid. */}
                {layout === 'horizontal' && (
                  <div className="grid grid-cols-7 gap-1 mb-1 text-center text-[11px] font-medium text-gray-400 dark:text-slate-500">
                    {weekdayShort.map((w, i) => <div key={i}>{w}</div>)}
                  </div>
                )}

                {/* Day grid */}
                <div className={cn('grid gap-1', layout === 'horizontal' ? 'grid-cols-7' : 'grid-cols-1')}>
                  {(layout === 'horizontal' ? cells : cells.filter((c): c is string => c !== null)).map((dateStr, i) => {
                    if (!dateStr) return <div key={`b${i}`} />;
                    const day = Number(dateStr.slice(-2));
                    const isPast = dateStr < todayStr;
                    const locked = !isPast && isLocked(dateStr);
                    const ov = byDate.get(dateStr);
                    const isSel = selectedDates.has(dateStr);
                    return (
                      <button
                        key={dateStr}
                        type="button"
                        disabled={isPast || locked}
                        onClick={(e) => toggleDay(dateStr, e.shiftKey)}
                        aria-pressed={isSel}
                        title={locked ? t('vendor.activities.wizard.specialPrice.lockedTitle', 'This date is locked (blocked) and cannot be booked') : undefined}
                        className={cn(
                          'relative rounded-lg text-xs transition-all',
                          layout === 'horizontal'
                            ? 'aspect-square flex flex-col items-center justify-center'
                            : 'w-full flex flex-row items-center justify-between ps-3 pe-3 py-2',
                          isPast
                            ? 'text-gray-300 dark:text-slate-700 cursor-not-allowed'
                            : locked
                              ? 'bg-rose-500/10 text-rose-400 dark:text-rose-400/80 cursor-not-allowed'
                              : isSel
                                ? 'border-2 border-[#1d4f35] bg-[#1d4f35] text-white'
                                : ov
                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                                  : 'text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-slate-800',
                        )}
                      >
                        <span className={cn('font-semibold tabular-nums leading-none', locked && 'line-through')}>{day}</span>
                        {locked ? (
                          <Lock className={cn('h-2.5 w-2.5 shrink-0', layout === 'horizontal' && 'mt-0.5')} />
                        ) : ov ? (
                          <span className={cn('text-[8px] font-bold leading-none tabular-nums', layout === 'horizontal' && 'mt-0.5', isSel ? 'text-white/90' : 'text-emerald-600 dark:text-emerald-400')}>
                            {ov.price}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-400 dark:text-slate-500 mt-2">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-emerald-500/40" />{t('vendor.activities.wizard.specialPrice.legendPriced', 'Has price')}</span>
                  <span className="inline-flex items-center gap-1.5"><Lock className="h-2.5 w-2.5 text-rose-400" />{t('vendor.activities.wizard.specialPrice.legendLocked', 'Locked')}</span>
                </div>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-1.5 text-start">
                  {t('vendor.activities.wizard.specialPrice.helpMulti', 'Tap dates to select them — Shift-click to pick a whole range. One price applies to all selected dates. Locked (blocked) dates can’t be priced.')}
                </p>

                {/* Inline price form for the selected date(s) */}
                {selectedCount > 0 && (
                  <div className="mt-3 rounded-xl bg-stone-50 dark:bg-slate-800/50 p-4 border border-stone-200 dark:border-slate-700">
                    <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1.5 text-start">
                      {onlyDate
                        ? `${t('vendor.activities.wizard.specialPrice.priceForDate', 'Special price for')} · ${prettyDate(onlyDate, locale)}`
                        : t('vendor.activities.wizard.specialPrice.priceForN', { defaultValue: 'Special price for {{count}} selected dates', count: selectedCount })}
                    </label>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="relative">
                        <input
                          type="number" min="0" step="0.01" inputMode="decimal"
                          value={priceInput}
                          onChange={(e) => setPriceInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                          placeholder="0.00"
                          className="w-36 ps-3 pe-12 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-[#1d4f35]/30 focus:border-[#1d4f35]"
                        />
                        <span className="absolute inset-y-0 end-3 flex items-center text-xs text-gray-400 dark:text-slate-500">{currency}</span>
                      </div>
                      <button type="button" disabled={!priceValid || (!draft && bulkSaveMut.isPending)} onClick={save}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1d4f35] text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                        {!draft && bulkSaveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
                        {selectedExisting
                          ? t('vendor.activities.wizard.specialPrice.update', 'Update')
                          : onlyDate
                            ? t('vendor.activities.wizard.specialPrice.save', 'Save')
                            : t('vendor.activities.wizard.specialPrice.saveN', { defaultValue: 'Save {{count}} dates', count: selectedCount })}
                      </button>
                      {selectedExisting && (
                        <button type="button" disabled={!draft && deleteMut.isPending} onClick={removeSingle}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                          <Trash2 className="h-4 w-4" />
                          {t('vendor.activities.wizard.specialPrice.remove', 'Remove')}
                        </button>
                      )}
                      <button type="button" onClick={clearSelection}
                        className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-300" aria-label={t('vendor.activities.wizard.specialPrice.cancel', 'Cancel')}>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {priceInput.trim() !== '' && !priceValid && (
                      <p className="text-xs text-red-500 mt-1.5 text-start">{t('vendor.activities.wizard.specialPrice.invalid', 'Enter a price greater than 0.')}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
