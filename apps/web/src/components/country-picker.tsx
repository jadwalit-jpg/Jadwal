'use client';

/**
 * Country picker — used in the navbar (desktop dropdown + mobile menu row).
 *
 * The geo system has two layers:
 *   1. IP-derived geo (passive) — what /geo/detect returns. May be soft-defaulted
 *      to Qatar for unsupported countries (Germany, India, etc.) so the page
 *      always has *some* storefront to render.
 *   2. Manual pick (active) — this component. Always wins over IP geo; never
 *      auto-revalidated. The choice is cached in localStorage with source='manual'.
 *
 * Two visual variants:
 *   - `variant='desktop'` — compact pill button: globe icon + country name.
 *   - `variant='mobile'`  — full-width menu row matching the rest of the mobile
 *     hamburger menu rows.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, MapPin, Check, Globe } from 'lucide-react';
import api from '@/lib/api';
import { useGeo } from '@/context/geo-context';

interface Country {
  id: string;
  nameEn: string;
  nameAr: string;
  isoCode: string;
  currencyCode: string;
}

/**
 * Inline bilingual-name resolver. Same fallback rules as `@/lib/localize`'s
 * `localized()`, but avoids importing `@/lib/i18n` at module-load, which would
 * pull react-i18next's `initReactI18next` plugin into the navbar's test
 * graph (mocked-as-undefined in unit tests) and crash the navbar suite.
 */
function pickName(c: Country, lang: string): string {
  if (lang === 'ar' && c.nameAr?.trim()) return c.nameAr;
  return c.nameEn ?? '';
}

// NO FLAG EMOJI. Regional-indicator pairs (U+1F1E6..U+1F1FF) are the standard
// way to render a flag, and they do NOT work on Windows: Chrome and Edge there
// have no flag glyphs, so a user sees the bare letters "QA" in a box instead of
// a flag. That reads as broken, not as a country picker.
//
// Real SVG flags were the other option and were rejected: several GCC flags we
// would need (Saudi Arabia's shahada calligraphy, Oman's national emblem) cannot
// be hand-drawn accurately, and shipping a wrong national flag is worse than
// shipping none. So the picker uses the same Lucide icon set as the rest of the
// app — consistent, identical on every OS — and lets the localized country NAME
// carry the identity, which it already did.

interface Props {
  variant?: 'desktop' | 'mobile';
  isOpaque?: boolean;
  onSelect?: () => void;
}

export function CountryPicker({ variant = 'desktop', isOpaque = true, onSelect }: Props) {
  const { t, i18n } = useTranslation();
  const { country, setCountry, source } = useGeo();
  const lang = i18n.language;
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data: countries = [] } = useQuery<Country[]>({
    queryKey: ['public-countries'],
    queryFn: () => api.get('/catalog/countries').then((r) => r.data),
    staleTime: 60 * 60 * 1000,
  });

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const select = (c: Country) => {
    setCountry(c);
    setOpen(false);
    onSelect?.();
  };

  if (variant === 'mobile') {
    return (
      <div className="px-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-white transition-colors"
        >
          <span className="flex items-center gap-3">
            <MapPin aria-hidden="true" className="h-4 w-4 text-gray-400 dark:text-slate-500" />
            <span>{country ? pickName(country, lang) : t('nav.country', { defaultValue: 'Country' })}</span>
          </span>
          <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''} text-gray-400 dark:text-slate-500`} />
        </button>
        {open && (
          <div className="mt-1 max-h-72 overflow-y-auto rounded-xl border border-gray-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-900">
            {countries.map((c) => {
              const isActive = c.id === country?.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => select(c)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold'
                      : 'text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Globe aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" />
                    <span>{pickName(c, lang)}</span>
                  </span>
                  {isActive && <Check aria-hidden="true" className="h-4 w-4" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Desktop variant — pill button + absolute dropdown
  const pillCls = isOpaque
    ? 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700'
    : 'bg-white/10 border-white/20 text-white hover:bg-white/20';
  const chevronCls = isOpaque ? 'text-gray-400 dark:text-slate-500' : 'text-white/60';

  return (
    <div ref={wrapperRef} className="relative hidden lg:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('nav.country', { defaultValue: 'Country' })}
        title={source === 'unsupported-default' ? t('nav.countryFallback', { defaultValue: 'Showing Qatar — your country isn\'t available yet' }) : undefined}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${pillCls}`}
      >
        <Globe aria-hidden="true" className="h-4 w-4 shrink-0" />
        {/* Localized country name (e.g. "Qatar" / "قطر"), not the ISO code. With
            the flag gone this is the ONLY thing identifying the country, and it
            reads better than "QA" anyway. Hidden below sm to keep the bar
            uncluttered on phones (mobile users get the full row from the hamburger
            menu variant). `max-w` + `truncate` so a long localized name cannot blow
            up the navbar layout. */}
        <span className="hidden sm:inline max-w-[110px] truncate">
          {country ? pickName(country, lang) : '—'}
        </span>
        <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${chevronCls}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute inset-e-0 mt-2 w-56 max-h-80 overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-gray-200/60 dark:border-slate-700/60 shadow-xl shadow-black/10 dark:shadow-black/30 z-50 py-1.5"
        >
          {countries.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-400 dark:text-slate-500">{t('common.loading')}</div>
          ) : (
            countries.map((c) => {
              const isActive = c.id === country?.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="menuitem"
                  onClick={() => select(c)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold'
                      : 'text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Globe aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" />
                    <span>{pickName(c, lang)}</span>
                  </span>
                  {isActive && <Check aria-hidden="true" className="h-4 w-4" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
