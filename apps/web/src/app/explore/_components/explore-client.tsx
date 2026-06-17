'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Search, MapPin, Star, Clock, Users, ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState, useMemo, useCallback, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { localized } from '@/lib/localize';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import CustomSelect from '@/components/custom-select';
import { useGeo } from '@/context/geo-context';

/* ─── Types ───────────────────────────────────────────────── */

interface Activity {
  id: string;
  titleEn: string;
  titleAr: string;
  slug: string;
  pricePerPerson: number;
  pricingModel: string;
  capacity: number;
  hasUnits: boolean;
  unitCount: number;
  unitCapacity: number;
  locationAddress: string | null;
  gallery: string[];
  coverImage: string | null;
  bookingType: string;
  durationValue: number;
  category: { nameEn: string; nameAr: string; slug: string } | null;
  city: { nameEn: string; nameAr: string } | null;
  country: { nameEn: string; currencyCode: string } | null;
  vendor: { businessNameEn: string; slug: string } | null;
  avgRating: number | null;
  _count: { reviews: number };
}

export interface ActivitiesResponse {
  data: Activity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Category {
  id: string;
  nameEn: string;
  nameAr: string;
  slug: string;
  children: { id: string; nameEn: string; nameAr: string; slug: string }[];
}

interface Country {
  id: string;
  nameEn: string;
  nameAr: string;
  isoCode: string;
  currencyCode: string;
}

interface City {
  id: string;
  nameEn: string;
  nameAr: string;
}

/* ─── Component ───────────────────────────────────────────── */

export default function ExploreClient({
  initialActivities,
}: {
  // Default page-1 (unfiltered) activity list, fetched server-side and seeded
  // into react-query so the activity-card grid is in the crawlable SSR HTML.
  // null on an API blip → the client fetches on mount as before. Only used when
  // the visitor lands with NO filters (the canonical /explore); any ?filter
  // permutation fetches fresh (and is canonicalised to /explore anyway).
  initialActivities: ActivitiesResponse | null;
}) {
  return (
    <Suspense>
      <ExploreContent initialActivities={initialActivities} />
    </Suspense>
  );
}

function ExploreContent({
  initialActivities,
}: {
  initialActivities: ActivitiesResponse | null;
}) {
  const searchParams = useSearchParams();
  const { t } = useTranslation();

  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [searchDebounced, setSearchDebounced] = useState(search);
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);
  const { country: geoCountry, location, locationStatus, requestLocation } = useGeo();
  const [selectedCountry, setSelectedCountry] = useState(searchParams.get('countryId') ?? '');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categorySlugFromUrl] = useState(searchParams.get('category') ?? '');
  const [selectedCity, setSelectedCity] = useState(searchParams.get('cityId') ?? '');
  const [showFilters, setShowFilters] = useState(false);

  // Advanced filter state
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minPriceDebounced, setMinPriceDebounced] = useState('');
  const [maxPriceDebounced, setMaxPriceDebounced] = useState('');
  const [bookingType, setBookingType] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');

  // Auto-set country from geo detection if no URL param provided.
  // Must be in an effect — setState during render triggers a warning and can
  // re-render loop when the parent tree is hot/re-mounted.
  const [geoApplied, setGeoApplied] = useState(false);
  useEffect(() => {
    if (
      geoCountry?.id &&
      !selectedCountry &&
      !geoApplied &&
      !searchParams.get('countryId')
    ) {
      setSelectedCountry(geoCountry.id);
      setGeoApplied(true);
    }
  }, [geoCountry?.id, selectedCountry, geoApplied, searchParams]);

  // Debounce search input (300ms per performance rules)
  const debounceTimeout = useMemo(() => ({ id: null as ReturnType<typeof setTimeout> | null }), []);
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (debounceTimeout.id) clearTimeout(debounceTimeout.id);
    debounceTimeout.id = setTimeout(() => {
      setSearchDebounced(value);
      setPage(1);
    }, 300);
  }, [debounceTimeout]);

  // Debounce price inputs (300ms per performance rules)
  const priceDebounceTimeout = useMemo(() => ({ minId: null as ReturnType<typeof setTimeout> | null, maxId: null as ReturnType<typeof setTimeout> | null }), []);
  const handleMinPriceChange = useCallback((value: string) => {
    setMinPrice(value);
    if (priceDebounceTimeout.minId) clearTimeout(priceDebounceTimeout.minId);
    priceDebounceTimeout.minId = setTimeout(() => {
      setMinPriceDebounced(value);
      setPage(1);
    }, 300);
  }, [priceDebounceTimeout]);
  const handleMaxPriceChange = useCallback((value: string) => {
    setMaxPrice(value);
    if (priceDebounceTimeout.maxId) clearTimeout(priceDebounceTimeout.maxId);
    priceDebounceTimeout.maxId = setTimeout(() => {
      setMaxPriceDebounced(value);
      setPage(1);
    }, 300);
  }, [priceDebounceTimeout]);

  // Fetch reference data
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['public-categories'],
    queryFn: () => api.get('/catalog/categories').then(r => r.data),
    staleTime: 10 * 60 * 1000,
  });

  const { data: countries = [] } = useQuery<Country[]>({
    queryKey: ['public-countries'],
    queryFn: () => api.get('/catalog/countries').then(r => r.data),
    staleTime: 10 * 60 * 1000,
  });

  const { data: cities = [] } = useQuery<City[]>({
    queryKey: ['public-cities', selectedCountry],
    queryFn: () => selectedCountry
      ? api.get(`/catalog/cities/${selectedCountry}`).then(r => r.data)
      : api.get('/catalog/cities').then(r => r.data),
    staleTime: 10 * 60 * 1000,
  });

  // Grouped category options for CustomSelect
  const categoryOptions = useMemo(() => {
    const opts: { value: string; label: string; group?: string }[] = [];
    for (const cat of categories) {
      opts.push({ value: cat.id, label: localized(cat, 'name') });
      for (const sub of cat.children ?? []) {
        opts.push({ value: sub.id, label: localized(sub, 'name'), group: localized(cat, 'name') });
      }
    }
    return opts;
  }, [categories]);

  // Resolve: dropdown uses categoryId (UUID), homepage link uses category slug
  const activeCategorySlug = selectedCategory ? '' : categorySlugFromUrl;

  // The server-seeded `initialActivities` is the DEFAULT page-1 unfiltered list,
  // so it may only seed the query when the visitor landed with no filters (a
  // crawler / the canonical /explore). With any ?filter in the URL the first
  // query key differs from the default → fetch fresh, don't show stale defaults.
  // Geo (location / geo-country) is applied in a later effect, so it's absent on
  // this first render and doesn't affect the initial key.
  const isDefaultInitialView = useMemo(
    () =>
      (Number(searchParams.get('page')) || 1) === 1 &&
      !searchParams.get('search') &&
      !searchParams.get('countryId') &&
      !searchParams.get('category') &&
      !searchParams.get('cityId'),
    [searchParams],
  );

  // Fetch activities
  const { data: activitiesData, isLoading } = useQuery<ActivitiesResponse>({
    queryKey: ['public-activities', page, searchDebounced, selectedCountry, selectedCategory, activeCategorySlug, selectedCity, minPriceDebounced, maxPriceDebounced, bookingType, location?.lat, location?.lng],
    initialData: isDefaultInitialView ? (initialActivities ?? undefined) : undefined,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (searchDebounced) params.set('search', searchDebounced);
      if (selectedCountry) params.set('countryId', selectedCountry);
      if (selectedCategory) params.set('categoryId', selectedCategory);
      else if (activeCategorySlug) params.set('category', activeCategorySlug);
      if (selectedCity) params.set('cityId', selectedCity);
      if (minPriceDebounced) params.set('minPrice', minPriceDebounced);
      if (maxPriceDebounced) params.set('maxPrice', maxPriceDebounced);
      if (bookingType) params.set('bookingType', bookingType);
      if (location) {
        params.set('lat', String(location.lat));
        params.set('lng', String(location.lng));
      }
      return api.get(`/catalog/activities?${params.toString()}`).then(r => r.data);
    },
    staleTime: 2 * 60 * 1000,
  });

  // Client-side rating filter (Prisma doesn't support aggregation in WHERE)
  const rawActivities = activitiesData?.data ?? [];
  const activities = useMemo(() => {
    if (!ratingFilter) return rawActivities;
    const minReviews = parseFloat(ratingFilter);
    return rawActivities.filter(a => a._count.reviews >= minReviews);
  }, [rawActivities, ratingFilter]);
  const totalPages = activitiesData?.totalPages ?? 0;

  const clearFilters = () => {
    setSelectedCountry('');
    setSelectedCategory('');
    setSelectedCity('');
    setSearch('');
    setSearchDebounced('');
    setMinPrice('');
    setMaxPrice('');
    setMinPriceDebounced('');
    setMaxPriceDebounced('');
    setBookingType('');
    setRatingFilter('');
    setPage(1);
  };

  const hasActiveFilters = selectedCountry || selectedCategory || activeCategorySlug || selectedCity || searchDebounced || minPriceDebounced || maxPriceDebounced || bookingType || ratingFilter;

  return (
    <div className="min-h-screen bg-jadwal-bg font-outfit">
      <Navbar variant="solid" />

      {/* Hero Banner */}
      <div className="pt-20 bg-linear-to-br from-sky-600 to-blue-700 dark:from-slate-900 dark:to-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-12 md:py-16">
          <h1 className="text-3xl md:text-4xl font-bold text-white">{t('explore.title')}</h1>
          <p className="mt-2 text-sky-100 dark:text-slate-400">{t('explore.subtitle')}</p>

          {/* Search Bar */}
          <div className="mt-6 max-w-2xl">
            <div className="flex items-center bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl rounded-xl shadow-lg overflow-hidden">
              <div className="flex-1 flex items-center gap-3 px-4">
                <Search className="h-5 w-5 text-gray-400 shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder={t('explore.searchPlaceholder')}
                  className="w-full py-3.5 bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-400 outline-none"
                />
              </div>
              {/* Near Me button */}
              {locationStatus !== 'granted' && locationStatus !== 'requesting' && (
                <button
                  onClick={requestLocation}
                  aria-label={t('explore.nearMe')}
                  className="flex items-center gap-2 px-4 py-3.5 border-s border-gray-200 dark:border-slate-700 text-sm text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 transition-colors cursor-pointer"
                >
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t('explore.nearMe')}</span>
                </button>
              )}
              {locationStatus === 'granted' && (
                <span className="flex items-center gap-2 px-4 py-3.5 border-s border-gray-200 dark:border-slate-700 text-xs text-emerald-600 dark:text-emerald-400">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t('explore.nearbyActive')}</span>
                </span>
              )}
              <button
                onClick={() => setShowFilters(!showFilters)}
                aria-label={t('explore.filters')}
                aria-expanded={showFilters}
                className="flex items-center gap-2 px-4 py-3.5 border-s border-gray-200 dark:border-slate-700 text-sm text-gray-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-white transition-colors"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t('explore.filters')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Filters Panel — no JS height animation (animating `height` is the
            costliest kind; it shows/hides instantly, which is fine). */}
        {showFilters && (
          <div
            className="mb-8 p-6 rounded-2xl border border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900/50"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 dark:text-white">{t('explore.filters')}</h3>
              {hasActiveFilters && (
                <button onClick={clearFilters} className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1">
                  <X className="h-3 w-3" /> {t('explore.clearAll')}
                </button>
              )}
            </div>

            {/* Row 1: Country, Category, City */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">{t('explore.country')}</label>
                <CustomSelect
                  options={countries.map(c => ({ value: c.id, label: localized(c, 'name') }))}
                  value={selectedCountry}
                  onChange={(val) => { setSelectedCountry(val); setSelectedCity(''); setPage(1); }}
                  placeholder="All Countries"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">{t('explore.category')}</label>
                <CustomSelect
                  options={categoryOptions}
                  value={selectedCategory}
                  onChange={(val) => { setSelectedCategory(val); setPage(1); }}
                  placeholder={t('explore.allCategories')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">{t('explore.city')}</label>
                <CustomSelect
                  options={cities.map(c => ({ value: c.id, label: localized(c, 'name') }))}
                  value={selectedCity}
                  onChange={(val) => { setSelectedCity(val); setPage(1); }}
                  placeholder={t('explore.allCities')}
                />
              </div>
            </div>

            {/* Row 2: Price Range, Booking Type, Rating */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              {/* Price Range */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">{t('explore.priceRange')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    value={minPrice}
                    onChange={(e) => handleMinPriceChange(e.target.value)}
                    placeholder={t('explore.minPrice')}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all"
                  />
                  <span className="text-xs text-gray-500 dark:text-slate-400 shrink-0">-</span>
                  <input
                    type="number"
                    min="0"
                    value={maxPrice}
                    onChange={(e) => handleMaxPriceChange(e.target.value)}
                    placeholder={t('explore.maxPrice')}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all"
                  />
                </div>
              </div>

              {/* Booking Type */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">{t('explore.bookingType')}</label>
                <div className="flex items-center gap-1.5">
                  {[
                    { value: '', label: t('explore.allTypes') },
                    { value: 'HOURLY', label: t('explore.hourly') },
                    { value: 'DAILY', label: t('explore.daily') },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setBookingType(opt.value); setPage(1); }}
                      className={`flex-1 px-3 py-2 text-xs font-medium rounded-xl border transition-all ${
                        bookingType === opt.value
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rating */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">{t('explore.rating')}</label>
                <div className="flex items-center gap-1.5">
                  {[
                    { value: '', label: t('explore.anyRating') },
                    { value: '3', label: '3+' },
                    { value: '4', label: '4+' },
                    { value: '4.5', label: '4.5+' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setRatingFilter(opt.value); setPage(1); }}
                      className={`flex-1 px-3 py-2 text-xs font-medium rounded-xl border transition-all ${
                        ratingFilter === opt.value
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1">
                        {opt.value && <Star className="h-3 w-3" />}
                        {opt.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results Header */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {isLoading ? t('explore.loading') : t('explore.resultsFound', { count: activitiesData?.total ?? 0 })}
          </p>
          {hasActiveFilters && !showFilters && (
            <button onClick={clearFilters} className="text-xs text-sky-600 dark:text-blue-400 hover:underline flex items-center gap-1">
              <X className="h-3 w-3" /> {t('explore.clearFilters')}
            </button>
          )}
        </div>

        {/* Activity Grid — Skeleton or Cards.
            Skeleton count = 3 (was 6) to minimize the height delta between
            the loading state and the loaded state for typical result counts.
            min-h-[800px] reserves vertical space so the footer can't shift
            up when the loaded grid is shorter than the skeleton (CLS guard).
            ~800px holds 1 row on desktop, ~2 rows on mobile, which covers
            the typical 1-6 activity result range without leaving a visible
            gap when real cards land. */}
        <div className="min-h-[800px]">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900/50 overflow-hidden animate-pulse">
                <div className="h-48 bg-gray-200 dark:bg-slate-800" />
                <div className="p-5 space-y-3">
                  <div className="h-4 bg-gray-200 dark:bg-slate-800 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 dark:bg-slate-800 rounded w-1/2" />
                  <div className="h-3 bg-gray-200 dark:bg-slate-800 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {activities.map((activity) => (
              // No per-card JS animation — wrapping each of up to 20 cards in a
              // `motion.div` with a staggered delay mounted 20 motion components
              // and queued ~1 s of animation, which hurt INP. The cards just
              // render; the grid is fine without a fade.
                <Link
                  key={activity.id}
                  href={`/activity/${activity.slug}`}
                  className="group block rounded-2xl border border-gray-200/80 dark:border-slate-800/60 bg-white dark:bg-slate-900/50 overflow-hidden hover:shadow-lg hover:shadow-gray-200/50 dark:hover:shadow-none hover:border-blue-200 dark:hover:border-blue-800/50 transition-all"
                >
                  {/* Image — fixed h-48 (192px) parent reserves space so the
                      image swap doesn't shift surrounding content (CLS).
                      next/image with `fill` lets the optimizer pick AVIF/WebP
                      and proper srcset; `sizes` matches the grid layout. */}
                  <div className="h-48 bg-linear-to-br from-gray-100 to-gray-200 dark:from-slate-800 dark:to-slate-700 relative overflow-hidden">
                    {(activity.coverImage || activity.gallery?.[0]) ? (
                      <Image
                        src={activity.coverImage || activity.gallery[0]}
                        alt={localized(activity, 'title')}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        loading="lazy"
                        // Dev: API serves uploads from localhost:4000 which the
                        // Next image optimizer (running inside docker) can't
                        // reach. In prod, S3/CDN URLs are public and full
                        // AVIF/WebP negotiation runs.
                        unoptimized={process.env.NODE_ENV !== 'production'}
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <MapPin className="h-8 w-8 text-gray-300 dark:text-slate-600" />
                      </div>
                    )}
                    {activity.category && (
                      <span className="absolute top-3 inset-s-3 px-2.5 py-1 rounded-lg text-xs font-medium bg-white/90 dark:bg-slate-900/90 text-gray-700 dark:text-slate-300 backdrop-blur-sm">
                        {localized(activity.category, 'name')}
                      </span>
                    )}
                    {/* Rating badge — top-end corner of the cover. Star + score only
                        (no "reviews" word). Shown only when the activity has reviews. */}
                    {activity.avgRating != null && (
                      <span className="absolute top-3 inset-e-3 flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/90 dark:bg-slate-900/90 text-gray-800 dark:text-slate-100 backdrop-blur-sm">
                        <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                        {activity.avgRating.toFixed(1)}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="p-5">
                    <h2 className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1">
                      {localized(activity, 'title')}
                    </h2>

                    {activity.locationAddress && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span className="line-clamp-1">{activity.locationAddress}</span>
                      </div>
                    )}

                    <div className="mt-2 flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {activity.bookingType === 'DAILY'
                          ? activity.durationValue
                            ? `${activity.durationValue} ${t(activity.durationValue > 1 ? 'explore.nights' : 'explore.night')}`
                            : t('explore.multiDay')
                          : `${activity.durationValue} ${t(activity.durationValue! > 1 ? 'explore.hours' : 'explore.hour')}`}
                      </span>
                      {(activity.hasUnits && (activity.bookingType === 'DAILY' || activity.pricingModel === 'PER_UNIT')
                        ? (activity.unitCapacity ?? 0)
                        : (activity.capacity ?? 0)) > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {/* Unit activities (per-unit hourly + daily rooms) show each
                              unit's capacity; per-person (shared) shows total seats. */}
                          {activity.hasUnits && (activity.bookingType === 'DAILY' || activity.pricingModel === 'PER_UNIT')
                            ? activity.unitCapacity
                            : activity.capacity}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-800/60 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-gray-500 dark:text-slate-400">{t('explore.from')}</span>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">
                          {Number(activity.pricePerPerson).toFixed(0)}{' '}
                          <span className="text-xs font-normal text-gray-500 dark:text-slate-400">
                            {activity.country?.currencyCode ?? 'QAR'}{' '}
                            {activity.bookingType === 'DAILY'
                              ? t('explore.perNight')
                              : activity.pricingModel === 'PER_UNIT'
                                ? t('explore.perUnit')
                                : t('explore.perPerson')}
                          </span>
                        </p>
                      </div>
                      <span className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-xl transition-all">
                        {t('explore.view')}
                      </span>
                    </div>
                  </div>
                </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <Search className="h-12 w-12 text-gray-300 dark:text-slate-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 dark:text-slate-300">{t('explore.noActivitiesFound')}</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{t('explore.tryAdjusting')}</p>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="mt-4 px-4 py-2 bg-sky-600 text-white text-sm font-medium rounded-xl hover:bg-sky-700 transition-colors">
                {t('explore.clearAll')}
              </button>
            )}
          </div>
        )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-10 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (page <= 4) {
                pageNum = i + 1;
              } else if (page >= totalPages - 3) {
                pageNum = totalPages - 6 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-10 h-10 rounded-xl text-sm font-medium transition-colors ${page === pageNum ? 'bg-sky-600 text-white' : 'border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}
