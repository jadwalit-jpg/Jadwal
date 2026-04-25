/**
 * Below-the-fold sections of the homepage `/`.
 *
 * Extracted from home-client.tsx so it can be lazy-loaded via
 * next/dynamic({ ssr: false }) — defers ~half the page's JS chunk until
 * the user scrolls past the hero. Same UI, same queries, same animations;
 * just delivered as a separate webpack chunk that's not on the LCP path.
 *
 * Queries here re-use the QueryClient from the parent provider — same
 * queryKey shape as home-client so the hero's `categories` fetch and this
 * file's fetch share a single cache entry (no duplicate request).
 */
'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Calendar, Gift, MapPin, ShieldCheck, Zap } from 'lucide-react';

import api from '@/lib/api';
import { localized } from '@/lib/localize';
import { useGeo } from '@/context/geo-context';
import {
  ActivityCard,
  type ActivityCardActivity,
  CategoryPill,
  PatternDivider,
  SectionHeader,
} from '@/components/ui';

interface TrendingEvent {
  id: string;
  titleEn: string;
  titleAr: string;
  description: string | null;
  image: string | null;
  eventDate: string | null;
  countryId: string | null;
}

interface Category {
  id: string;
  nameEn: string;
  nameAr: string;
  slug: string;
  image: string | null;
  _count?: { activities: number };
}

type HomeActivity = ActivityCardActivity & {
  pricingModel?: string;
  distanceKm?: number;
  category?: { nameEn?: string; nameAr?: string; slug: string } | null;
};

export default function HomeBelowFold() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const { country, city, isDetecting, location, locationStatus, requestLocation } = useGeo();

  // Same queryKeys as home-client → shared TanStack cache, no duplicate request.

  const trendingParams = new URLSearchParams();
  if (country?.id) trendingParams.set('countryId', country.id);

  const { data: trendingEvents = [] } = useQuery<TrendingEvent[]>({
    queryKey: ['public-trending', country?.id],
    queryFn: () =>
      api
        .get(`/catalog/trending${trendingParams.toString() ? `?${trendingParams}` : ''}`)
        .then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: !isDetecting,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['public-categories'],
    queryFn: () => api.get('/catalog/categories').then((r) => r.data),
    staleTime: 10 * 60 * 1000,
  });

  const featuredParams = new URLSearchParams({ limit: '6', featured: 'true' });
  if (country?.id) featuredParams.set('countryId', country.id);

  const { data: featuredActivitiesData } = useQuery<{ data: HomeActivity[] }>({
    queryKey: ['public-activities-featured', country?.id],
    queryFn: () => api.get(`/catalog/activities?${featuredParams}`).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: !isDetecting,
  });
  const featuredActivities = featuredActivitiesData?.data ?? [];

  const nearYouParams = new URLSearchParams({ limit: '6' });
  if (country?.id) nearYouParams.set('countryId', country.id);
  if (location) {
    nearYouParams.set('lat', String(location.lat));
    nearYouParams.set('lng', String(location.lng));
  }

  const { data: nearYouData } = useQuery<{ data: HomeActivity[] }>({
    queryKey: ['public-activities-near', country?.id, location?.lat, location?.lng],
    queryFn: () => api.get(`/catalog/activities?${nearYouParams}`).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: !isDetecting && !!country,
  });
  const nearYouActivities = nearYouData?.data ?? [];

  return (
    <>
      {/* ─── Browse by category ─────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="bg-jadwal-bg"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 md:py-16">
          <h2 className="font-display text-[22px] sm:text-[26px] font-semibold tracking-[-0.6px] sm:tracking-[-0.8px] text-jadwal-text m-0 mb-6 md:mb-8">
            {t('home.browseByCategory', { defaultValue: 'Browse by category' })}
          </h2>
          <div className="flex gap-4 md:gap-6 overflow-x-auto pb-2 -mx-4 sm:mx-0 px-4 sm:px-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
            {categories.slice(0, 12).map((cat) => (
              <CategoryPill
                key={cat.id}
                label={localized(cat, 'name')}
                slug={cat.slug}
                image={cat.image}
              />
            ))}
            {categories.length === 0 ? (
              <div className="py-8 text-sm text-jadwal-text-faint">
                {t('home.noCategories', { defaultValue: 'No categories available yet' })}
              </div>
            ) : null}
          </div>
        </div>
      </motion.section>

      {/* ─── Trending ─────────────────────────────────────────── */}
      <motion.section
        id="trending"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="bg-jadwal-bg scroll-mt-24"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-14">
          <SectionHeader
            title={
              country
                ? `${t('home.trendingIn', { defaultValue: t('home.trending') })} ${localized(country, 'name')}`
                : t('home.trending')
            }
            seeAllHref="/explore"
            seeAllLabel={t('home.viewAll')}
            rtl={isRtl}
          />
          {trendingEvents.length > 0 ? (
            <div className="flex gap-4 md:gap-5 overflow-x-auto pb-2 -mx-4 sm:mx-0 px-4 sm:px-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              {trendingEvents.map((event) => (
                <article
                  key={event.id}
                  className="group w-[280px] sm:w-[320px] shrink-0 flex flex-col overflow-hidden rounded-[20px] border border-jadwal-border-subtle bg-jadwal-surface shadow-jadwal transition-shadow hover:shadow-jadwal-lg"
                >
                  {event.image ? (
                    <div className="h-[200px] overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={event.image}
                        alt={localized(event, 'title')}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    </div>
                  ) : null}
                  <div className="p-[14px] flex flex-col gap-2">
                    <h3 className="font-semibold text-jadwal-text text-[15px] tracking-[-0.2px] line-clamp-2 text-balance">
                      {localized(event, 'title')}
                    </h3>
                    {event.description ? (
                      <p className="text-[13px] text-jadwal-text-muted leading-relaxed line-clamp-2">
                        {event.description}
                      </p>
                    ) : null}
                    {event.eventDate ? (
                      <div
                        className="mt-1 flex items-center gap-1.5 text-[12px] text-jadwal-text-faint"
                        suppressHydrationWarning
                      >
                        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                        {new Date(event.eventDate).toLocaleDateString(
                          isRtl ? 'ar-EG' : 'en-US',
                          { month: 'short', day: 'numeric', year: 'numeric' },
                        )}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-jadwal-text-faint text-sm">
              {t('home.noTrending', { defaultValue: 'No trending events yet' })}
            </div>
          )}
        </div>
      </motion.section>

      <PatternDivider />

      {/* ─── Featured (Handpicked for you) ──────────────────────── */}
      <motion.section
        id="featured"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="bg-jadwal-bg scroll-mt-24"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-14">
          <SectionHeader
            title={t('home.featured')}
            seeAllHref="/explore"
            seeAllLabel={t('home.viewAll')}
            rtl={isRtl}
          />
          {featuredActivities.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
              {featuredActivities.map((activity) => (
                <ActivityCard key={activity.id} activity={activity} size="fill" />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-jadwal-text-faint text-sm">
              {t('home.noFeatured', { defaultValue: 'No featured activities yet' })}
            </div>
          )}
        </div>
      </motion.section>

      {/* ─── Near You ─────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="bg-jadwal-bg-soft"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-14">
          <div className="flex items-end justify-between mb-5 gap-3 flex-wrap">
            <div>
              <h2 className="font-display text-[22px] sm:text-[26px] font-semibold tracking-[-0.6px] sm:tracking-[-0.8px] text-jadwal-text m-0 leading-[1.15]">
                {city
                  ? `${t('home.nearYou')} — ${localized(city, 'name')}`
                  : country
                    ? `${t('home.nearYou')} — ${localized(country, 'name')}`
                    : t('home.nearYou')}
              </h2>
              <p className="mt-1.5 text-sm text-jadwal-text-muted">
                {t('home.nearYouSubtitle')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {locationStatus !== 'granted' && locationStatus !== 'requesting' ? (
                <button
                  type="button"
                  onClick={requestLocation}
                  className="hidden sm:inline-flex items-center gap-1.5 px-4 h-10 text-sm font-semibold text-jadwal-on-primary bg-jadwal-primary hover:bg-jadwal-primary-hover rounded-xl transition-colors"
                >
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  {t('home.findNearMe')}
                </button>
              ) : null}
              {locationStatus === 'requesting' ? (
                <span className="hidden sm:inline-flex items-center gap-1.5 px-4 h-10 text-sm text-jadwal-text-muted">
                  <MapPin className="h-4 w-4 animate-pulse" aria-hidden="true" />
                  {t('common.loading')}
                </span>
              ) : null}
              {locationStatus === 'denied' ? (
                <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-jadwal-warning">
                  {t('home.locationDenied')}
                </span>
              ) : null}
              <Link
                href="/explore"
                className="hidden sm:inline-flex items-center gap-1 text-sm font-medium text-jadwal-primary hover:underline"
              >
                {t('home.viewAll')}
              </Link>
            </div>
          </div>

          {nearYouActivities.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
              {nearYouActivities.map((activity) => (
                <ActivityCard key={activity.id} activity={activity} size="fill" />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-jadwal-border-subtle bg-jadwal-surface h-60 flex items-center justify-center">
              <div className="text-center">
                <MapPin
                  className="h-10 w-10 text-jadwal-text-faint mx-auto mb-3"
                  aria-hidden="true"
                />
                <p className="text-jadwal-text-muted font-medium">
                  {isDetecting
                    ? t('home.detectingLocation', { defaultValue: 'Detecting your location...' })
                    : t('home.noNearYou', { defaultValue: 'No activities in your area yet' })}
                </p>
                <p className="text-xs text-jadwal-text-faint mt-1">
                  {t('home.checkBackSoon', { defaultValue: 'Check back soon for new experiences' })}
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.section>

      {/* ─── Why Jadwal (Trust strip) ─────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="bg-jadwal-surface-muted border-y border-jadwal-border-subtle"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 md:py-14">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
            {[
              {
                icon: ShieldCheck,
                titleKey: 'home.verifiedPartners',
                descKey: 'home.verifiedPartnersDesc',
                gold: false,
              },
              {
                icon: Zap,
                titleKey: 'home.easyCancellation',
                descKey: 'home.easyCancellationDesc',
                gold: false,
              },
              {
                icon: Gift,
                titleKey: 'home.instantConfirmation',
                descKey: 'home.instantConfirmationDesc',
                gold: true,
              },
            ].map((item) => (
              <div key={item.titleKey} className="flex items-start gap-3.5">
                <div
                  className={
                    'grid h-11 w-11 place-items-center rounded-xl shrink-0 ' +
                    (item.gold
                      ? 'bg-jadwal-accent-soft text-jadwal-accent'
                      : 'bg-sky-500/10 text-jadwal-primary')
                  }
                >
                  <item.icon
                    className="h-[22px] w-[22px]"
                    strokeWidth={1.7}
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <div className="text-[15px] font-semibold text-jadwal-text tracking-[-0.2px] mb-0.5">
                    {t(item.titleKey)}
                  </div>
                  <div className="text-[13px] text-jadwal-text-muted leading-relaxed">
                    {t(item.descKey)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ─── CTA ────────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-linear-to-br from-sky-600 to-indigo-700" />
        <div
          aria-hidden="true"
          className="absolute top-0 -inset-s-20 w-80 h-80 bg-white/5 rounded-full blur-[80px]"
        />
        <div
          aria-hidden="true"
          className="absolute bottom-0 -inset-e-20 w-80 h-80 bg-white/5 rounded-full blur-[80px]"
        />
        <div className="relative max-w-7xl mx-auto px-6 py-16 md:py-20 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-[-0.8px] text-white max-w-2xl mx-auto text-balance">
            {t('home.ctaTitle')}
          </h2>
          <p className="mt-4 text-base md:text-lg text-blue-100 max-w-xl mx-auto">
            {t('home.ctaSubtitle')}
          </p>
          <Link
            href="/explore"
            className="inline-flex items-center gap-2 mt-8 px-8 py-4 bg-white text-jadwal-primary font-bold rounded-2xl hover:bg-sky-50 transition-colors shadow-xl shadow-blue-900/30"
          >
            {t('home.getStarted')}
          </Link>
        </div>
      </motion.section>
    </>
  );
}
