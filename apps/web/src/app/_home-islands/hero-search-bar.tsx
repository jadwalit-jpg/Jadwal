'use client';

/**
 * Search bar island for the home hero. Extracted from home-client.tsx
 * (2026-04-26) so the surrounding hero markup can render as RSC and pull
 * the React Query / i18n / auth provider chain off the LCP critical path.
 *
 * The categories dropdown re-uses the same TanStack Query cache key as
 * HomeBelowFold so it's still a single network request.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import api from '@/lib/api';
import { localized } from '@/lib/localize';
import CustomSelect from '@/components/custom-select';

interface Category {
  id: string;
  nameEn: string;
  nameAr: string;
  slug: string;
}

export function HeroSearchBar() {
  const router = useRouter();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['public-categories'],
    queryFn: () => api.get('/catalog/categories').then((r) => r.data),
    staleTime: 10 * 60 * 1000,
  });

  const handleSearch = useCallback(() => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    if (selectedCategory) params.set('category', selectedCategory);
    router.push(`/explore${params.toString() ? `?${params.toString()}` : ''}`);
  }, [searchQuery, selectedCategory, router]);

  return (
    <div className="mt-10 max-w-3xl mx-auto w-full">
      {/* No `backdrop-blur-xl`: the bar is 95% opaque, so the blur contributes
          ~5% of the visible colour — imperceptible, but it still forces the GPU
          to rasterize-and-blur everything behind it. Dropped (zero visual change). */}
      <div className="flex items-center bg-white/95 dark:bg-jadwal-surface/95 border border-white/60 dark:border-jadwal-border-subtle rounded-2xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.4)] overflow-hidden">
        <div className="hidden sm:block border-e border-jadwal-border-subtle min-w-[180px]">
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
          />
        </div>
        <div className="flex-1 flex items-center gap-3 px-5">
          <Search
            className="h-5 w-5 text-jadwal-text-muted shrink-0"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder={t('home.searchPlaceholder')}
            className="w-full py-4 bg-transparent text-sm text-jadwal-text placeholder:text-jadwal-text-muted outline-none"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            aria-label={t('home.searchPlaceholder')}
          />
        </div>
        <button
          type="button"
          onClick={handleSearch}
          className="hidden sm:flex items-center gap-2 m-2 px-6 py-3 bg-jadwal-primary hover:bg-jadwal-primary-hover text-jadwal-on-primary text-sm font-semibold rounded-xl transition-colors"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          {t('home.search')}
        </button>
        <button
          type="button"
          onClick={handleSearch}
          aria-label={t('home.search')}
          className="sm:hidden inline-grid place-items-center m-2 h-10 w-10 bg-jadwal-primary hover:bg-jadwal-primary-hover text-jadwal-on-primary rounded-xl transition-colors"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
