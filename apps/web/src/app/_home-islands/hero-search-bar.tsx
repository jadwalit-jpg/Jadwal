'use client';

/**
 * Search bar island for the home hero. Extracted from home-client.tsx
 * (2026-04-26) so the surrounding hero markup can render as RSC and pull
 * the React Query / i18n / auth provider chain off the LCP critical path.
 *
 * The categories dropdown re-uses the same TanStack Query cache key as
 * HomeBelowFold so it's still a single network request.
 *
 * Autocomplete (2026-07-11): as the user types (≥2 chars, 300ms debounce) we
 * fetch a small slice of the SAME public catalog search the /explore page uses
 * and show activity suggestions. Picking one jumps straight to the activity;
 * Enter (or the Search button) runs the full /explore search. The fetch is
 * gated + debounced + limited + react-query-cached so a keystroke burst can't
 * hammer the (heavier) listing endpoint.
 */

import { useCallback, useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, ArrowRight } from 'lucide-react';
import api from '@/lib/api';
import { localized } from '@/lib/localize';
import CustomSelect from '@/components/custom-select';

interface Category {
  id: string;
  nameEn: string;
  nameAr: string;
  slug: string;
}

interface Suggestion {
  id: string;
  titleEn: string;
  titleAr: string;
  slug: string;
  category: { nameEn: string; nameAr: string; slug: string } | null;
  city: { nameEn: string; nameAr: string } | null;
}

export function HeroSearchBar() {
  const router = useRouter();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced query for the suggestions fetch (≥300ms per performance rules).
  const [searchDebounced, setSearchDebounced] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchDebounced(searchQuery.trim()), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['public-categories'],
    queryFn: () => api.get('/catalog/categories').then((r) => r.data),
    staleTime: 10 * 60 * 1000,
  });

  // Autocomplete suggestions — same catalog search the /explore page issues
  // (contains-match on titleEn/titleAr). Only fires at ≥2 chars, with a small
  // limit, and is cached per (term, category) by react-query.
  const canSuggest = searchDebounced.length >= 2;
  const { data: suggestions = [], isFetching } = useQuery<Suggestion[]>({
    queryKey: ['activity-suggest', searchDebounced, selectedCategory],
    queryFn: () =>
      api
        .get('/catalog/activities', {
          params: {
            search: searchDebounced,
            limit: 6,
            ...(selectedCategory ? { category: selectedCategory } : {}),
          },
        })
        .then((r) => r.data.data as Suggestion[]),
    enabled: canSuggest,
    staleTime: 60 * 1000,
  });

  const open = focused && canSuggest;

  // Close the panel on an outside click.
  useEffect(() => {
    if (!focused) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [focused]);

  // Reset the highlighted row whenever the result set changes.
  useEffect(() => {
    setActiveIndex(-1);
  }, [searchDebounced, selectedCategory]);

  const runSearch = useCallback(() => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    if (selectedCategory) params.set('category', selectedCategory);
    setFocused(false);
    router.push(`/explore${params.toString() ? `?${params.toString()}` : ''}`);
  }, [searchQuery, selectedCategory, router]);

  const goToActivity = useCallback(
    (slug: string) => {
      setFocused(false);
      router.push(`/activity/${slug}`);
    },
    [router],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown' && open && suggestions.length > 0) {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp' && open && suggestions.length > 0) {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, -1));
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && suggestions[activeIndex]) goToActivity(suggestions[activeIndex].slug);
        else runSearch();
      } else if (e.key === 'Escape') {
        setFocused(false);
      }
    },
    [open, suggestions, activeIndex, goToActivity, runSearch],
  );

  return (
    <div className="mt-10 max-w-3xl mx-auto w-full relative" ref={containerRef}>
      {/* No `backdrop-blur-xl`: the bar is 95% opaque, so the blur contributes
          ~5% of the visible colour — imperceptible, but it still forces the GPU
          to rasterize-and-blur everything behind it. Dropped (zero visual change). */}
      <div className="flex flex-col sm:flex-row sm:items-center bg-white/95 dark:bg-jadwal-surface/95 border border-white/60 dark:border-jadwal-border-subtle rounded-2xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.4)] overflow-hidden">
        {/* Category filter — full-width row above the input on mobile (it used to
            be hidden below `sm`, so mobile users couldn't filter by category);
            a left segment on desktop. */}
        <div className="border-b sm:border-b-0 sm:border-e border-jadwal-border-subtle sm:min-w-[180px]">
          <CustomSelect
            options={[
              { value: '', label: t('home.allCategories') },
              ...categories.map((c) => ({
                value: c.slug,
                label: localized(c, 'name'),
              })),
            ]}
            value={selectedCategory}
            onChange={setSelectedCategory}
            placeholder={t('home.allCategories')}
            className="w-full"
            seamless
          />
        </div>
        {/* Search input + submit. Single search icon — it lives in the button
            only (the previous left-of-input icon was a duplicate). */}
        <div className="flex items-center flex-1">
          <input
            type="text"
            placeholder={t('home.searchPlaceholder')}
            className="w-full py-4 ps-5 bg-transparent text-sm text-jadwal-text placeholder:text-jadwal-text-muted outline-none"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            role="combobox"
            aria-expanded={open}
            aria-controls="hero-search-suggestions"
            aria-autocomplete="list"
            aria-label={t('home.searchPlaceholder')}
          />
          <button
            type="button"
            onClick={runSearch}
            className="hidden sm:flex items-center gap-2 m-2 px-6 py-3 shrink-0 bg-jadwal-primary hover:bg-jadwal-primary-hover text-jadwal-on-primary text-sm font-semibold rounded-xl transition-colors"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            {t('home.search')}
          </button>
          <button
            type="button"
            onClick={runSearch}
            aria-label={t('home.search')}
            className="sm:hidden inline-grid place-items-center m-2 h-10 w-10 shrink-0 bg-jadwal-primary hover:bg-jadwal-primary-hover text-jadwal-on-primary rounded-xl transition-colors"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Autocomplete panel — sibling of the (overflow-hidden) bar so it isn't
          clipped; z-50 lifts it over the hero content below. */}
      {open && (
        <div
          id="hero-search-suggestions"
          role="listbox"
          className="absolute top-full inset-x-0 mt-2 z-50 rounded-2xl border border-jadwal-border-subtle bg-white dark:bg-jadwal-surface shadow-[0_20px_60px_-20px_rgba(0,0,0,0.5)] overflow-hidden text-start"
        >
          {suggestions.length > 0 ? (
            <>
              <ul className="max-h-80 overflow-y-auto py-1.5">
                {suggestions.map((s, i) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === activeIndex}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => goToActivity(s.slug)}
                      className={`w-full flex items-center gap-3 px-5 py-2.5 text-start transition-colors ${
                        i === activeIndex
                          ? 'bg-jadwal-primary/10'
                          : 'hover:bg-black/2.5 dark:hover:bg-white/5'
                      }`}
                    >
                      <Search className="h-4 w-4 shrink-0 text-jadwal-text-muted" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-jadwal-text">
                          {localized(s, 'title')}
                        </span>
                        {(s.category || s.city) && (
                          <span className="block truncate text-xs text-jadwal-text-muted">
                            {[
                              s.category && localized(s.category, 'name'),
                              s.city && localized(s.city, 'name'),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {/* Run the full /explore search for the typed term. */}
              <button
                type="button"
                onClick={runSearch}
                className="w-full flex items-center justify-between gap-2 px-5 py-3 border-t border-jadwal-border-subtle text-sm font-medium text-jadwal-primary hover:bg-black/2.5 dark:hover:bg-white/5 transition-colors"
              >
                {t('home.viewAllResults')}
                <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
              </button>
            </>
          ) : (
            <div className="px-5 py-4 text-sm text-jadwal-text-muted">
              {isFetching ? t('home.searching') : t('home.noSuggestions')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
