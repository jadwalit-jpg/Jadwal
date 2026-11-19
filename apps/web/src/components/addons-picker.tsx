'use client';

/**
 * The customer's add-on controls, shared by the booking page and the listing
 * page. Every control is at least 44px tall.
 *
 *   whole group → one switch: "Upgrade to Vip cabin · +QAR 100 per person",
 *                 with "× 3 guests · +QAR 300" following the guest count
 *   per person  → a quantity picker (1..guests) with big buttons and a clear
 *                 "per person" label
 *   per booking → a checkbox row
 *
 * Arabic pages show the add-on's Arabic name (`localized`).
 */
import { useTranslation } from 'react-i18next';
import { Check, Minus, Plus } from 'lucide-react';
import { localized } from '@/lib/localize';
import { extraMode, paidExtrasOf, type ExtraService } from '@/lib/booking-extras';

const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export interface AddonsPickerProps {
  extras: readonly ExtraService[] | null | undefined;
  selected: ReadonlyMap<string, number>;
  guests: number;
  currency: string;
  onChange: (next: Map<string, number>) => void;
  /** Prefix for test ids, so two pickers on one page can be told apart. */
  idPrefix?: string;
  /** Render the "Optional Add-ons" heading (the listing page has its own section title). */
  heading?: boolean;
}

export function AddonsPicker({ extras, selected, guests, currency, onChange, idPrefix = 'addon', heading = true }: AddonsPickerProps) {
  const { t } = useTranslation();
  const paid = paidExtrasOf(extras);
  if (paid.length === 0) return null;
  const g = Math.max(1, guests);

  const set = (name: string, qty: number) => {
    const next = new Map(selected);
    if (qty <= 0) next.delete(name); else next.set(name, qty);
    onChange(next);
  };

  return (
    <div data-testid={`${idPrefix}s`}>
      {heading ? <h3 className="font-semibold text-gray-900 dark:text-white mb-3">{t('activity.optionalAddons', { defaultValue: 'Optional Add-ons' })}</h3> : null}
      <ul className="space-y-2.5">
        {paid.map((svc, i) => {
          const mode = extraMode(svc);
          const qty = selected.get(svc.name) ?? 0;
          const on = qty > 0;
          const name = localized(svc, 'name');
          const rowCls = `rounded-xl border transition-colors ${on ? 'border-sky-400 bg-sky-50 dark:bg-sky-900/10 dark:border-sky-700' : 'border-gray-200 dark:border-slate-800'}`;
          const testId = `${idPrefix}-${i}`;

          if (mode === 'wholeGroup') {
            const total = svc.price * g;
            return (
              <li key={svc.name} data-testid={testId} data-mode="wholeGroup" className={rowCls}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  data-testid={`${testId}-switch`}
                  onClick={() => set(svc.name, on ? 0 : g)}
                  className="flex w-full min-h-[56px] items-center justify-between gap-3 px-3 py-2.5 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-xl"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900 dark:text-white">
                      {t('booking.addonWholeGroup', { name, price: money(svc.price), currency, defaultValue: 'Upgrade to {{name}} · +{{currency}} {{price}} per person' })}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-slate-400">
                      {t('booking.addonWholeGroupHint', { count: g, total: money(total), currency, defaultValue: '× {{count}} guests · +{{currency}} {{total}}' })}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-sky-600' : 'bg-gray-300 dark:bg-slate-700'}`}
                  >
                    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6 rtl:-translate-x-6' : 'translate-x-1 rtl:-translate-x-1'}`} />
                  </span>
                </button>
              </li>
            );
          }

          if (mode === 'perPerson') {
            return (
              <li key={svc.name} data-testid={testId} data-mode="perPerson" className={`${rowCls} flex items-center justify-between gap-3 px-3 py-2`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{name}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    {currency} {money(svc.price)} · {t('booking.addonPerPerson', { defaultValue: 'per person' })}
                    {on ? <span className="font-medium text-gray-700 dark:text-slate-200"> · +{currency} {money(svc.price * qty)}</span> : null}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0" role="group" aria-label={name}>
                  <button
                    type="button"
                    data-testid={`${testId}-minus`}
                    onClick={() => set(svc.name, qty - 1)}
                    disabled={qty === 0}
                    aria-label={t('booking.addonLess', { name, defaultValue: 'Fewer {{name}}' })}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                  >
                    <Minus className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <span data-testid={`${testId}-qty`} className="w-8 text-center text-base font-semibold tabular-nums text-gray-900 dark:text-white" aria-live="polite">{qty}</span>
                  <button
                    type="button"
                    data-testid={`${testId}-plus`}
                    onClick={() => set(svc.name, Math.min(g, qty + 1))}
                    disabled={qty >= g}
                    aria-label={t('booking.addonMore', { name, defaultValue: 'More {{name}}' })}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                  >
                    <Plus className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          }

          return (
            <li key={svc.name} data-testid={testId} data-mode="perBooking" className={rowCls}>
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2.5">
                <span className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    data-testid={`${testId}-checkbox`}
                    checked={on}
                    onChange={() => set(svc.name, on ? 0 : 1)}
                    className="h-5 w-5 rounded border-gray-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{name}</span>
                    <span className="block text-xs text-gray-500 dark:text-slate-400">{t('booking.addonPerBooking', { defaultValue: 'per booking' })}</span>
                  </span>
                </span>
                <span className="text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                  {on ? <Check className="inline h-4 w-4 me-1 text-sky-600" aria-hidden="true" /> : null}+{currency} {money(svc.price)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
