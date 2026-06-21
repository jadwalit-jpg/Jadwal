/**
 * Below-the-fold sections of the homepage `/`.
 *
 * Extracted from home-client.tsx so it can be lazy-loaded via
 * next/dynamic({ ssr: false }) — keeps ~half the page's JS off the
 * hero/LCP chunk; the chunk loads as soon as the page hydrates (not on
 * scroll), so the sections render and start fetching immediately.
 *
 * No scroll-gated entrance animations: these sections used to be
 * `motion.section` with `whileInView` + `initial={{ opacity: 0 }}`, which
 * meant everything below a full-height hero stayed invisible until the
 * user scrolled it into view — it read as "the page only loads when I
 * scroll". They now render plainly (loading states are the React Query
 * skeletons below). Removing framer-motion here also drops it from the
 * homepage entirely.
 *
 * Queries here re-use the QueryClient from the parent provider — same
 * queryKey shape as home-client so the hero's `categories` fetch and this
 * file's fetch share a single cache entry (no duplicate request).
 */
'use client';

import Image from 'next/image';
import { LocaleLink as Link } from '@/components/locale-link';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Gift,
  MapPin,
  ShieldCheck,
  Zap,
} from 'lucide-react';

import api from '@/lib/api';
import { localized } from '@/lib/localize';
import { useGeo } from '@/context/geo-context';
import {
  ActivityCard,
  ActivityCardSkeleton,
  type ActivityCardActivity,
  PatternDivider,
  SectionHeader,
} from '@/components/ui';
import { TrendingRowSkeleton } from './_home-islands/below-fold-skeleton';
import { TrendingEventModal } from './_home-islands/trending-event-modal';

// Heuristic for "the description is likely truncated by line-clamp-2 and
// worth a Read more affordance". Trending cards are 280-320px wide and use
// `text-[13px] leading-relaxed`, which fits roughly 90-110 characters across
// two lines. 100 chars is the conservative cutoff: shorter descriptions fit
// fully on the card (no need for a modal), longer ones are guaranteed to be
// clipped. Cheaper + more deterministic than a runtime scrollHeight check.
const READ_MORE_THRESHOLD = 100;

interface TrendingEvent {
  id: string;
  titleEn: string;
  titleAr: string;
  description: string | null;
  descriptionAr: string | null;
  image: string | null;
  eventDate: string | null;
  eventEndDate: string | null;
  countryId: string | null;
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

  // Open trending event for the "Read more" modal. null = modal closed.
  // Keeping the state at this level (rather than per-card) means only one
  // modal is mounted at a time and we don't have N <dialog>s in the DOM.
  const [openTrendingEvent, setOpenTrendingEvent] = useState<TrendingEvent | null>(null);

  // Desktop prev/next arrows for the horizontally-scrolling trending row.
  // The row scrolls fine via swipe/trackpad, but its scrollbar is hidden
  // (matches the design), so on a desktop mouse there's no affordance that
  // cards continue off-screen — they read as "cropped". These arrows give
  // that affordance. `scrollBy` honors the element's content direction, so a
  // positive `left` advances in reading order in both LTR and RTL.
  const trendingScrollRef = useRef<HTMLDivElement>(null);
  const scrollTrendingByCard = (direction: 'prev' | 'next') => {
    const el = trendingScrollRef.current;
    if (!el) return;
    // ~one card + gap; clamps itself at the ends, so no bounds math needed.
    const amount = Math.round(el.clientWidth * 0.85);
    el.scrollBy({ left: direction === 'next' ? amount : -amount, behavior: 'smooth' });
  };

  // Same queryKeys as home-client → shared TanStack cache, no duplicate request.

  const trendingParams = new URLSearchParams();
  if (country?.id) trendingParams.set('countryId', country.id);

  const { data: trendingEvents = [], isLoading: trendingLoading } = useQuery<TrendingEvent[]>({
    queryKey: ['public-trending', country?.id],
    queryFn: () =>
      api
        .get(`/catalog/trending${trendingParams.toString() ? `?${trendingParams}` : ''}`)
        .then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: !isDetecting,
  });

  const featuredParams = new URLSearchParams({ limit: '6', featured: 'true' });
  if (country?.id) featuredParams.set('countryId', country.id);

  const { data: featuredActivitiesData, isLoading: featuredLoading } = useQuery<{ data: HomeActivity[] }>({
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

  const { data: nearYouData, isLoading: nearYouLoading } = useQuery<{ data: HomeActivity[] }>({
    queryKey: ['public-activities-near', country?.id, location?.lat, location?.lng],
    queryFn: () => api.get(`/catalog/activities?${nearYouParams}`).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: !isDetecting && !!country,
  });
  const nearYouActivities = nearYouData?.data ?? [];

  return (
    <>
      {/* ─── Trending ─────────────────────────────────────────── */}
      <section id="trending" className="bg-jadwal-bg scroll-mt-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-14">
          <SectionHeader
            title={
              country
                ? `${t('home.trendingIn', { defaultValue: t('home.trending') })} ${localized(country, 'name')}`
                : t('home.trending')
            }
            rtl={isRtl}
          />
          {isDetecting || trendingLoading ? (
            <TrendingRowSkeleton />
          ) : trendingEvents.length > 0 ? (
            <div className="relative">
              <div
                ref={trendingScrollRef}
                className="flex gap-4 md:gap-5 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 -mx-4 sm:mx-0 px-4 sm:px-0 pe-4 sm:pe-6 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
              >
              {trendingEvents.map((event) => (
                <article
                  key={event.id}
                  className="group w-[280px] sm:w-[320px] shrink-0 snap-start flex flex-col overflow-hidden rounded-[20px] border border-jadwal-border-subtle bg-jadwal-surface shadow-jadwal transition-shadow hover:shadow-jadwal-lg"
                >
                  {event.image ? (
                    <div className="relative h-[200px] overflow-hidden">
                      <Image
                        src={event.image}
                        alt={localized(event, 'title')}
                        fill
                        sizes="(max-width: 640px) 280px, 320px"
                        loading="lazy"
                        // In dev the API serves uploads from a private
                        // hostname the in-container Next.js image
                        // optimizer cannot reach, so we bypass it. In
                        // prod, S3 / CDN URLs are public and the full
                        // AVIF/WebP negotiation + responsive srcset
                        // pipeline runs. Mirrors ActivityCard.
                        unoptimized={process.env.NODE_ENV !== 'production'}
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    </div>
                  ) : null}
                  <div className="p-[14px] flex flex-col gap-2">
                    <h3 className="font-semibold text-jadwal-text text-[15px] tracking-[-0.2px] line-clamp-2 text-balance">
                      {localized(event, 'title')}
                    </h3>
                    {(() => {
                      const desc = localized(event, 'description');
                      if (!desc) return null;
                      return (
                      <>
                        <p className="text-[13px] text-jadwal-text-muted leading-relaxed line-clamp-2">
                          {desc}
                        </p>
                        {desc.length > READ_MORE_THRESHOLD ? (
                          // Inline link-style trigger (NOT a button-styled CTA).
                          // Sits on its own line so it doesn't get clipped by the
                          // line-clamp above. Underline + accent color reads as a
                          // link; `text-start` keeps it left-aligned in LTR and
                          // right-aligned in RTL via the logical property.
                          <button
                            type="button"
                            onClick={() => setOpenTrendingEvent(event)}
                            className="
                              self-start text-start
                              text-[12px] font-medium text-jadwal-accent
                              underline underline-offset-2 decoration-jadwal-accent/40
                              hover:decoration-jadwal-accent transition-colors
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-accent rounded
                            "
                          >
                            {t('home.readMore', { defaultValue: 'Read more' })}
                          </button>
                        ) : null}
                      </>
                      );
                    })()}
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
                        {event.eventEndDate ? (
                          <>
                            {' – '}
                            {new Date(event.eventEndDate).toLocaleDateString(
                              isRtl ? 'ar-EG' : 'en-US',
                              { month: 'short', day: 'numeric', year: 'numeric' },
                            )}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
              </div>

              {/* Desktop scroll affordance. Hidden on mobile (touch swipe is
                  natural there). Positioned with logical start/end so they
                  flip in RTL; the chevron icon flips with reading direction.
                  No Framer Motion: this homepage chunk deliberately excludes
                  it (see docstring) — plain Tailwind transitions instead. */}
              {/* aria-labels use common.{prev,next} (translated EN + AR);
                  defaultValue kept as a belt-and-braces fallback. */}
              <button
                type="button"
                onClick={() => scrollTrendingByCard('prev')}
                aria-label={t('common.prev', { defaultValue: 'Previous' })}
                className="hidden md:grid place-items-center absolute top-[100px] -translate-y-1/2 inset-s-0 -ms-3 h-10 w-10 rounded-full bg-jadwal-surface/90 backdrop-blur border border-jadwal-border-subtle text-jadwal-text shadow-jadwal hover:bg-jadwal-surface hover:shadow-jadwal-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-accent"
              >
                {isRtl ? (
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={() => scrollTrendingByCard('next')}
                aria-label={t('common.next', { defaultValue: 'Next' })}
                className="hidden md:grid place-items-center absolute top-[100px] -translate-y-1/2 inset-e-0 -me-3 h-10 w-10 rounded-full bg-jadwal-surface/90 backdrop-blur border border-jadwal-border-subtle text-jadwal-text shadow-jadwal hover:bg-jadwal-surface hover:shadow-jadwal-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-accent"
              >
                {isRtl ? (
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                )}
              </button>
            </div>
          ) : (
            <div className="text-center py-12 text-jadwal-text-faint text-sm">
              {t('home.noTrending', { defaultValue: 'No trending events yet' })}
            </div>
          )}
        </div>

        {/* Permanently mounted; opens via openTrendingEvent state. Uses the
            native <dialog> element — Escape + backdrop click + focus trap
            handled by the browser. See trending-event-modal.tsx. */}
        <TrendingEventModal
          event={openTrendingEvent}
          onClose={() => setOpenTrendingEvent(null)}
          isRtl={isRtl}
          closeLabel={t('home.close', { defaultValue: 'Close' })}
        />
      </section>

      <PatternDivider />

      {/* ─── Featured (Handpicked for you) ──────────────────────── */}
      <section id="featured" className="bg-jadwal-bg scroll-mt-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-14">
          <SectionHeader
            title={t('home.featured')}
            rtl={isRtl}
          />
          {/* Mobile: horizontal snap-scroll row (like Trending). sm+: grid.
              No "View all" — the whole set scrolls instead. */}
          {featuredActivities.length > 0 ? (
            <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 -mx-4 px-4 [&::-webkit-scrollbar]:hidden [scrollbar-width:none] sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:mx-0 sm:px-0 lg:grid-cols-3 md:gap-5">
              {featuredActivities.map((activity) => (
                <div key={activity.id} className="shrink-0 w-[78vw] max-w-[300px] snap-start sm:w-auto sm:max-w-none">
                  <ActivityCard activity={activity} size="fill" />
                </div>
              ))}
            </div>
          ) : isDetecting || featuredLoading ? (
            // Skeleton row (not a short text placeholder) so the section height
            // stays ~constant when the real cards arrive — avoids the CLS jump.
            // Same mobile-scroll / desktop-grid shape as the live cards above.
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 [&::-webkit-scrollbar]:hidden [scrollbar-width:none] sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:mx-0 sm:px-0 lg:grid-cols-3 md:gap-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="shrink-0 w-[78vw] max-w-[300px] sm:w-auto sm:max-w-none">
                  <ActivityCardSkeleton />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-jadwal-text-faint text-sm">
              {t('home.noFeatured', { defaultValue: 'No featured activities yet' })}
            </div>
          )}
        </div>
      </section>

      {/* ─── Near You ─────────────────────────────────────────── */}
      <section className="bg-jadwal-bg-soft">
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
          ) : isDetecting || (!!country && nearYouLoading) ? (
            // Skeleton grid while detecting location / fetching — keeps this
            // section's height ~constant so the real cards don't shove the rest
            // of the page (this was the homepage's main CLS source). The short
            // box below is only for the genuinely-empty / no-geo case.
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <ActivityCardSkeleton key={i} />
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
                  {/* Reached only when !isDetecting && !nearYouLoading && no
                      activities — the detecting/loading state shows the
                      skeleton grid above, so there's no "detecting…" branch
                      to take here (CodeQL flagged the old ternary as a
                      useless conditional, correctly). */}
                  {t('home.noNearYou', { defaultValue: 'No activities in your area yet' })}
                </p>
                <p className="text-xs text-jadwal-text-faint mt-1">
                  {t('home.checkBackSoon', { defaultValue: 'Check back soon for new experiences' })}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ─── Why AL Jadwal (Trust strip) ─────────────────────────── */}
      <section className="bg-jadwal-surface-muted border-y border-jadwal-border-subtle">
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
      </section>

      {/* ─── CTA ────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
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
      </section>
    </>
  );
}
