'use client';

/**
 * Per-date special-price manager — mirrors ActivityBlocksManager. Reusable across
 * actors via the `apiBase` prop ('/vendor' = own activity, '/admin' = any). The
 * vendor/admin clicks a calendar day, enters a price, and saves; days with an
 * override show their price as a badge. The applied price is frozen onto bookings
 * server-side, so editing/removing an override never changes existing bookings.
 */

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Tag, Trash2, Loader2, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { getApiError } from '@/lib/api-error';
import { useToast } from '@/components/toast';

const BRAND = '#1d4f35';
const MAX_PRICE = 1_000_000;
const MAX_MONTHS_AHEAD = 12;

interface SpecialPrice {
  id: string;
  date: string;
  price: string | number;
}

interface Props {
  activityId: string;
  currency?: string;
  // '/vendor' (default, own activity) or '/admin' (any activity).
  apiBase?: string;
  // When true, collapses behind an Open/Close toggle (same as the blocks manager).
  collapsible?: boolean;
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function prettyDate(s: string): string {
  return new Date(`${s}T00:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

export default function ActivitySpecialPricesManager({
  activityId,
  currency = 'QAR',
  apiBase = '/vendor',
  collapsible = false,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const now = useMemo(() => new Date(), []);
  const [open, setOpen] = useState(!collapsible);
  const [cursor, setCursor] = useState({ y: now.getUTCFullYear(), m: now.getUTCMonth() });
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [priceInput, setPriceInput] = useState('');

  const todayStr = ymd(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const maxMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + MAX_MONTHS_AHEAD, 1));

  const queryKey = [apiBase === '/admin' ? 'admin-special-prices' : 'vendor-special-prices', activityId];
  const { data: prices = [], isLoading } = useQuery<SpecialPrice[]>({
    queryKey,
    queryFn: () => api.get(`${apiBase}/activities/${activityId}/special-prices`).then((r) => r.data),
  });

  // date (YYYY-MM-DD) → { id, price } for fast calendar lookup + the list.
  const byDate = useMemo(() => {
    const map = new Map<string, { id: string; price: number }>();
    for (const p of prices) map.set(String(p.date).slice(0, 10), { id: p.id, price: Number(p.price) });
    return map;
  }, [prices]);

  const sortedList = useMemo(
    () => [...prices].map((p) => ({ id: p.id, date: String(p.date).slice(0, 10), price: Number(p.price) })).sort((a, b) => a.date.localeCompare(b.date)),
    [prices],
  );

  const saveMut = useMutation({
    mutationFn: (body: { date: string; price: number }) =>
      api.post(`${apiBase}/activities/${activityId}/special-prices`, body).then((r) => r.data),
    onSuccess: () => {
      toast(t('vendor.activities.wizard.specialPrice.saved', 'Special price saved'), 'success');
      qc.invalidateQueries({ queryKey });
      setSelectedDate('');
      setPriceInput('');
    },
    onError: (e) => toast(getApiError(e, t('vendor.activities.wizard.specialPrice.saveFailed', 'Could not save special price')), 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`${apiBase}/activities/${activityId}/special-prices/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast(t('vendor.activities.wizard.specialPrice.removed', 'Special price removed'), 'success');
      qc.invalidateQueries({ queryKey });
      setSelectedDate('');
      setPriceInput('');
    },
    onError: (e) => toast(getApiError(e, t('vendor.activities.wizard.specialPrice.removeFailed', 'Could not remove special price')), 'error'),
  });

  const selectDay = (dateStr: string) => {
    setSelectedDate(dateStr);
    const ex = byDate.get(dateStr);
    setPriceInput(ex ? String(ex.price) : '');
  };

  const priceNum = Number(priceInput);
  const priceValid = priceInput.trim() !== '' && Number.isFinite(priceNum) && priceNum > 0 && priceNum <= MAX_PRICE;
  const selectedExisting = selectedDate ? byDate.get(selectedDate) : undefined;

  const save = () => {
    if (selectedDate && priceValid) saveMut.mutate({ date: selectedDate, price: Math.round(priceNum * 100) / 100 });
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
  const monthLabel = new Date(Date.UTC(cursor.y, cursor.m, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const weekdayShort = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const shift = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.y, c.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });

  return (
    <div className="mt-8 pt-6 border-t border-gray-200 dark:border-slate-800">
      <div className="flex items-center gap-2 mb-1">
        <Tag className="h-4 w-4 shrink-0" style={{ color: BRAND }} />
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
              <div className="h-72 jadwal-skeleton rounded-xl" />
            ) : (
              <div className="rounded-2xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
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

                {/* Weekday header */}
                <div className="grid grid-cols-7 gap-1 mb-1 text-center text-[11px] font-medium text-gray-400 dark:text-slate-500">
                  {weekdayShort.map((w, i) => <div key={i}>{w}</div>)}
                </div>

                {/* Day grid */}
                <div className="grid grid-cols-7 gap-1">
                  {cells.map((dateStr, i) => {
                    if (!dateStr) return <div key={`b${i}`} />;
                    const day = Number(dateStr.slice(-2));
                    const isPast = dateStr < todayStr;
                    const ov = byDate.get(dateStr);
                    const isSel = selectedDate === dateStr;
                    return (
                      <button
                        key={dateStr}
                        type="button"
                        disabled={isPast}
                        onClick={() => selectDay(dateStr)}
                        aria-pressed={isSel}
                        className={cn(
                          'relative aspect-square rounded-lg flex flex-col items-center justify-center text-xs transition-all',
                          isPast
                            ? 'text-gray-300 dark:text-slate-700 cursor-not-allowed'
                            : isSel
                              ? 'border-2 text-white'
                              : ov
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                                : 'text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-slate-800',
                        )}
                        style={isSel && !isPast ? { backgroundColor: BRAND, borderColor: BRAND } : undefined}
                      >
                        <span className="font-semibold tabular-nums leading-none">{day}</span>
                        {ov && (
                          <span className={cn('mt-0.5 text-[8px] font-bold leading-none tabular-nums', isSel ? 'text-white/90' : 'text-emerald-600 dark:text-emerald-400')}>
                            {ov.price}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <p className="text-xs text-gray-400 dark:text-slate-500 mt-2 text-start">
                  {t('vendor.activities.wizard.specialPrice.help', 'Tap a date to set its special price. Green dates already have one.')}
                </p>

                {/* Inline price form for the selected date */}
                {selectedDate && (
                  <div className="mt-3 rounded-xl bg-stone-50 dark:bg-slate-800/50 p-4 border border-stone-200 dark:border-slate-700">
                    <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1.5 text-start">
                      {t('vendor.activities.wizard.specialPrice.priceForDate', 'Special price for')} · {prettyDate(selectedDate)}
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
                      <button type="button" disabled={!priceValid || saveMut.isPending} onClick={save}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: BRAND }}>
                        {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
                        {selectedExisting ? t('vendor.activities.wizard.specialPrice.update', 'Update') : t('vendor.activities.wizard.specialPrice.save', 'Save')}
                      </button>
                      {selectedExisting && (
                        <button type="button" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate(selectedExisting.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                          <Trash2 className="h-4 w-4" />
                          {t('vendor.activities.wizard.specialPrice.remove', 'Remove')}
                        </button>
                      )}
                      <button type="button" onClick={() => { setSelectedDate(''); setPriceInput(''); }}
                        className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-300" aria-label={t('vendor.activities.wizard.specialPrice.cancel', 'Cancel')}>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {priceInput.trim() !== '' && !priceValid && (
                      <p className="text-xs text-red-500 mt-1.5 text-start">{t('vendor.activities.wizard.specialPrice.invalid', 'Enter a price greater than 0.')}</p>
                    )}
                  </div>
                )}

                {/* List of all overrides */}
                {sortedList.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-gray-500 dark:text-slate-400 text-start">
                      {t('vendor.activities.wizard.specialPrice.listHeading', 'Special prices set')} ({sortedList.length})
                    </p>
                    {sortedList.map((p) => (
                      <div key={p.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2">
                        <button type="button" onClick={() => { setCursor({ y: Number(p.date.slice(0, 4)), m: Number(p.date.slice(5, 7)) - 1 }); selectDay(p.date); }}
                          className="min-w-0 text-start flex-1">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{prettyDate(p.date)}</p>
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">{p.price} {currency}</p>
                        </button>
                        <button type="button" onClick={() => deleteMut.mutate(p.id)} disabled={deleteMut.isPending}
                          className="shrink-0 p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                          aria-label={t('vendor.activities.wizard.specialPrice.remove', 'Remove')}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
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
