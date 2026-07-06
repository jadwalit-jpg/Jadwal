'use client';

import { LocaleLink as Link } from '@/components/locale-link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  MapPin,
  Shield,
  Share2,
  Sparkles,
  Star,
  User,
  X,
} from 'lucide-react';
import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/components/toast';
// Lazy-load the Leaflet map (+ its ~14 KB CSS) — it only renders far below
// the fold and only when the activity has coordinates, so it shouldn't be in
// this page's first-load JS. ssr:false because Leaflet needs `window`.
const ActivityLocationMap = dynamic(() => import('@/components/activity-location-map'), {
  ssr: false,
  loading: () => <div className="h-64 w-full rounded-2xl bg-gray-100 dark:bg-slate-800 animate-pulse" />,
});
import { getApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { localized } from '@/lib/localize';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import TermsAcceptModal from '@/components/terms-accept-modal';
import { ActivityDetailPageSkeleton } from '@/components/ui/skeletons';
import {
  Badge,
  Button,
  CancelBadge,
  Rating,
  Stepper,
} from '@/components/ui';

/* ─── Types ───────────────────────────────────────────────── */

interface Review {
  id: string;
  rating: number;
  text: string | null;
  createdAt: string;
  customer: { displayName: string } | null;
}

export interface ActivityDetail {
  id: string;
  slug: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  pricePerPerson: number;
  capacity: number | null;
  coverImage: string | null;
  locationAddress: string | null;
  locationLat: number | null;
  locationLng: number | null;
  gallery: string[];
  durationValue: number | null;
  bookingType: string;
  pricingModel: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  activeDays: string[];
  extraServices: { name: string; nameAr?: string; price: number; perPerson?: boolean }[] | null;
  cancellationPolicy: string | null;
  createdAt: string;
  category: { nameEn: string; nameAr: string } | null;
  city: { nameEn: string; nameAr: string } | null;
  country: { nameEn: string; nameAr: string; currencyCode: string } | null;
  vendor: { businessNameEn: string; businessNameAr: string; slug: string } | null;
  reviews: Review[];
  hasUnits: boolean;
  unitCapacity: number;
  unitCount: number;
  _count: { reviews: number; bookings: number; likes: number };
}

/* ─── Helpers ─────────────────────────────────────────────── */

function ratingDistribution(reviews: Review[]) {
  const total = reviews.length || 1;
  const buckets = [0, 0, 0, 0, 0];
  reviews.forEach((r) => {
    const idx = Math.min(5, Math.max(1, Math.floor(r.rating))) - 1;
    buckets[idx] += 1;
  });
  return [5, 4, 3, 2, 1].map((n) => ({
    stars: n,
    pct: Math.round((buckets[n - 1] / total) * 100),
  }));
}

function cancelLevel(
  policy: string | null,
): 'free' | 'partial' | 'none' | null {
  if (!policy) return null;
  if (policy === 'FREE_CANCELLATION') return 'free';
  if (policy === 'PARTIAL_REFUND') return 'partial';
  if (policy === 'NON_REFUNDABLE') return 'none';
  return null;
}

/* ─── Section wrapper ─────────────────────────────────────── */

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-2xl border border-jadwal-border-subtle bg-jadwal-surface p-5 md:p-6 shadow-jadwal', className)}>
      <h2 className="font-display text-[18px] md:text-[20px] font-semibold tracking-[-0.4px] text-jadwal-text m-0 mb-4">
        {title}
      </h2>
      {children}
    </section>
  );
}

/* ─── Component ───────────────────────────────────────────── */

export default function ActivityDetailClient({
  slug,
  initialActivity,
}: {
  slug: string;
  // Server-fetched activity (from page.tsx) seeded into react-query so the body
  // renders in the SSR HTML for crawlers. null on an API blip → the client
  // fetches on mount (the pre-SSR behaviour). Either way interactivity is
  // identical — this is the SAME client component, just pre-warmed with data.
  initialActivity: ActivityDetail | null;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const queryClient = useQueryClient();
  const [selectedImage, setSelectedImage] = useState(0);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [guests, setGuests] = useState(1);
  // Action-time Terms gate: a no-consent user who clicks "Book now" gets a
  // popup BEFORE reaching the booking page. Accept → proceed to the captured
  // URL; cancel → stay put. The server guard is still the hard boundary.
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [pendingBookUrl, setPendingBookUrl] = useState<string | null>(null);
  const handleBookNow = useCallback(() => {
    const url = `/activity/${slug}/book${guests > 1 ? `?guests=${guests}` : ''}`;
    if (user?.needsTermsAcceptance) {
      setPendingBookUrl(url);
      setTermsModalOpen(true);
      return;
    }
    router.push(url);
  }, [slug, guests, user?.needsTermsAcceptance, router]);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewHover, setReviewHover] = useState(0);

  const { data: activity, isLoading, isError } = useQuery<ActivityDetail>({
    queryKey: ['public-activity', slug],
    queryFn: () => api.get(`/catalog/activities/${slug}`).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: !!slug,
    // Seeded from the server fetch → first (server) render has data, so the
    // body is in the SSR HTML (not a skeleton). undefined when the server fetch
    // failed, so react-query fetches on mount exactly as before.
    initialData: initialActivity ?? undefined,
  });

  const { data: related } = useQuery<ActivityDetail[]>({
    queryKey: ['related-activities', activity?.slug],
    queryFn: () =>
      api.get(`/catalog/activities/${activity!.slug}/related?limit=4`).then((r) => r.data),
    enabled: !!activity?.slug,
    staleTime: 5 * 60 * 1000,
  });

  const { data: likeData } = useQuery<{ count: number; liked: boolean }>({
    queryKey: ['like-status', activity?.id],
    queryFn: () => api.get(`/customer/likes/${activity!.id}`).then((r) => r.data),
    enabled: !!activity?.id && !!user && user.role === 'CUSTOMER',
    staleTime: 30 * 1000,
  });

  const likeCount = likeData?.count ?? activity?._count.likes ?? 0;
  const isLiked = likeData?.liked ?? false;

  // Optimistic like toggle — flip the heart + count instantly, roll back if the
  // server rejects, then reconcile with server truth on settle. The server stays
  // authoritative (auth + the real persisted state come back via onSettled
  // invalidation); this only changes PERCEIVED latency, no security surface.
  const likeMutation = useMutation({
    mutationFn: () => api.post('/customer/likes/toggle', { activityId: activity!.id }),
    onMutate: async () => {
      const key = ['like-status', activity?.id] as const;
      // Stop any in-flight refetch so it can't clobber our optimistic value.
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<{ count: number; liked: boolean }>(key);
      // Fall back to the derived values when the query hasn't populated yet.
      const base = prev ?? { count: likeCount, liked: isLiked };
      queryClient.setQueryData(key, {
        liked: !base.liked,
        count: Math.max(0, base.count + (base.liked ? -1 : 1)),
      });
      return { prev, key };
    },
    onError: (err, _vars, ctx) => {
      // Roll back to the snapshot; if there was none, drop the key so it refetches.
      if (ctx?.prev !== undefined) queryClient.setQueryData(ctx.key, ctx.prev);
      else if (ctx?.key) queryClient.removeQueries({ queryKey: ctx.key });
      toast(getApiError(err, 'Failed to like'), 'error');
    },
    onSettled: () => {
      // Reconcile with the server's real state (success or after a rollback).
      queryClient.invalidateQueries({ queryKey: ['like-status', activity?.id] });
      queryClient.invalidateQueries({ queryKey: ['public-activity', slug] });
    },
  });

  const redirectToLogin = useCallback(() => {
    const returnPath = `/activity/${slug}`;
    router.push(`/login?callbackUrl=${encodeURIComponent(returnPath)}`);
  }, [router, slug]);

  const handleLike = useCallback(() => {
    if (!user) {
      redirectToLogin();
      return;
    }
    if (user.role !== 'CUSTOMER') {
      toast(t('activity.toast.onlyCustomersCanLike'), 'error');
      return;
    }
    likeMutation.mutate();
  }, [user, redirectToLogin, likeMutation, toast]);

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    const title = localized(activity, 'title') || 'Check out this activity';
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        /* user cancelled */
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast(t('activity.toast.linkCopied'));
    }
  }, [activity, toast]);

  const reviewMutation = useMutation({
    mutationFn: (payload: { activityId: string; rating: number; text?: string }) =>
      api.post('/customer/reviews', payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-activity', slug] });
      setReviewRating(0);
      toast(t('activity.toast.reviewSubmitted'));
    },
    onError: (err) => toast(getApiError(err, 'Failed to submit review'), 'error'),
  });

  const handleSubmitReview = useCallback(() => {
    if (!user) {
      redirectToLogin();
      return;
    }
    if (reviewRating === 0) {
      toast(t('activity.toast.selectRating'), 'error');
      return;
    }
    reviewMutation.mutate({ activityId: activity!.id, rating: reviewRating });
  }, [user, redirectToLogin, reviewRating, reviewMutation, activity, toast]);

  const avgRating = activity?.reviews.length
    ? activity.reviews.reduce((sum, r) => sum + r.rating, 0) / activity.reviews.length
    : 0;

  const currency = activity?.country?.currencyCode ?? 'QAR';
  const price = Number(activity?.pricePerPerson ?? 0);
  const isDaily = activity?.bookingType === 'DAILY';
  const isHourly = activity?.bookingType === 'HOURLY';
  const isPerUnit = activity?.pricingModel === 'PER_UNIT';

  const maxGuests =
    activity?.hasUnits && activity.unitCapacity > 0
      ? activity.unitCapacity
      : (activity?.capacity ?? 99);

  const totalPrice = isDaily || isPerUnit ? price : price * guests;

  if (isLoading) {
    // Shape skeleton composed with Navbar — exactly the same skeleton
    // the route-level loading.tsx renders, so the cold-navigation flash
    // flows continuously into this state with no visible jump.
    return (
      <div className="min-h-screen bg-jadwal-bg font-outfit">
        <Navbar variant="solid" />
        <ActivityDetailPageSkeleton />
      </div>
    );
  }

  if (isError || !activity) {
    return (
      <div className="min-h-screen bg-jadwal-bg font-outfit">
        <Navbar variant="solid" />
        <div className="pt-24 max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center py-20">
            <AlertCircle className="h-12 w-12 text-jadwal-text-faint mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-jadwal-text">
              Activity Not Found
            </h2>
            <p className="mt-2 text-sm text-jadwal-text-muted">
              This activity may have been removed or is no longer available.
            </p>
            <Button
              onClick={() => router.push('/explore')}
              className="mt-6"
              iconEnd={<ChevronRight className="h-4 w-4" />}
            >
              Back to Explore
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const title = localized(activity, 'title');
  const desc = localized(activity, 'description');
  const city = activity.city ? localized(activity.city, 'name') : '';
  const categoryName = activity.category ? localized(activity.category, 'name') : '';
  const vendorName = activity.vendor
    ? localized(activity.vendor, 'businessName')
    : '';
  const policyLevel = cancelLevel(activity.cancellationPolicy);

  // Short label for chips/badges; long `…Desc` text is used inside the policy card body.
  const cancelPolicyLabel =
    policyLevel === 'free'
      ? t('activity.freeCancellationShort', { defaultValue: 'Free cancellation' })
      : policyLevel === 'partial'
        ? t('activity.partialRefundShort', { defaultValue: 'Partial refund' })
        : policyLevel === 'none'
          ? t('activity.nonRefundableShort', { defaultValue: 'Non-refundable' })
          : null;

  const cancelPolicyDesc =
    policyLevel === 'free'
      ? t('activity.freeCancellation', {
          defaultValue:
            'Cancel for free up to 24h before the experience and get a full refund. After that, non-refundable.',
        })
      : policyLevel === 'partial'
        ? t('activity.partialRefund', {
            defaultValue: 'Partial refund if cancelled before the deadline.',
          })
        : policyLevel === 'none'
          ? t('activity.nonRefundable', {
              defaultValue: 'This activity is non-refundable once booked.',
            })
          : null;

  const mainImage = activity.gallery?.[selectedImage] ?? activity.coverImage ?? null;
  const thumbs = activity.gallery ?? [];

  return (
    <div className="min-h-screen bg-jadwal-bg font-outfit">
      <Navbar variant="solid" />

      {/* Breadcrumbs (desktop) */}
      <div className="hidden md:block pt-24 max-w-7xl mx-auto px-6">
        <nav className="text-sm font-medium text-jadwal-text-muted" aria-label="Breadcrumb">
          <ol className="flex items-center gap-2 flex-wrap">
            <li>
              <Link
                href="/"
                className="font-semibold hover:text-jadwal-primary transition-colors"
              >
                {t('nav.home', { defaultValue: 'Home' })}
              </Link>
            </li>
            <li aria-hidden="true" className="text-jadwal-text-faint">/</li>
            <li>
              <Link
                href="/explore"
                className="font-semibold hover:text-jadwal-primary transition-colors"
              >
                {t('nav.explore')}
              </Link>
            </li>
            {categoryName ? (
              <>
                <li aria-hidden="true" className="text-jadwal-text-faint">/</li>
                <li className="font-semibold">{categoryName}</li>
              </>
            ) : null}
            <li aria-hidden="true" className="text-jadwal-text-faint">/</li>
            <li className="font-bold text-jadwal-text truncate max-w-[40ch]">{title}</li>
          </ol>
        </nav>
      </div>

      {/* Title block */}
      <header className="max-w-7xl mx-auto px-4 sm:px-6 pt-20 md:pt-6 pb-4 md:pb-5">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {categoryName ? (
            <Badge variant="neutral" size="sm">
              {categoryName}
            </Badge>
          ) : null}
          {activity._count.reviews > 0 && avgRating >= 4.7 ? (
            <Badge variant="gold" size="sm">
              {t('activity.badge.toprated', { defaultValue: 'Top rated' })}
            </Badge>
          ) : null}
          {policyLevel && cancelPolicyLabel ? (
            <CancelBadge level={policyLevel} label={cancelPolicyLabel} compact />
          ) : null}
        </div>

        <h1 className="font-display text-[26px] md:text-[36px] font-semibold tracking-[-0.8px] md:tracking-[-1px] text-jadwal-text m-0 leading-[1.15] text-balance wrap-break-word">
          {title}
        </h1>

        <div className="mt-3 flex items-center gap-3.5 flex-wrap text-[13px]">
          {activity._count.reviews > 0 ? (
            <Rating value={avgRating} count={activity._count.reviews} size="lg" />
          ) : null}
          {city ? (
            <span className="inline-flex items-center gap-1.5 text-jadwal-text-muted">
              <MapPin className="h-[13px] w-[13px]" aria-hidden="true" />
              {city}
              {activity.country ? `, ${localized(activity.country, 'name')}` : ''}
            </span>
          ) : null}
          {activity.durationValue ? (
            <span className="inline-flex items-center gap-1.5 text-jadwal-text-muted">
              <Clock className="h-[13px] w-[13px]" aria-hidden="true" />
              {activity.durationValue}{' '}
              {isHourly
                ? t(activity.durationValue === 1 ? 'activity.hour' : 'activity.hours')
                : t(activity.durationValue === 1 ? 'activity.night' : 'activity.nights')}
            </span>
          ) : null}
          {vendorName ? (
            <span className="text-jadwal-primary font-medium">
              {isRtl ? `بواسطة ${vendorName}` : `by ${vendorName}`}
            </span>
          ) : null}
        </div>
      </header>

      {/* Gallery */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {thumbs.length >= 1 ? (() => {
          // Adaptive gallery layout — only renders as many tiles as there are
          // images, so a 2-image activity doesn't show 3 empty placeholders.
          // Layouts by count (n = thumbs.length):
          //   n=1  → single hero, full width
          //   n=2  → main (2fr) + 1 tile (1fr), single row
          //   n=3  → main (2fr, row-span-2) + 2 stacked tiles (1fr)
          //   n=4  → main (2fr, row-span-2) + 2 top tiles + 1 wide bottom (col-span-2)
          //   n≥5  → main + 4 tiles (2×2)
          //
          // "View all photos" is a floating badge at the bottom-right of the
          // whole grid — independent of tile count, always clickable when
          // there's more than 1 photo to scroll through. Opens the lightbox
          // at the first image.
          const n = thumbs.length;
          const smallCount = Math.min(n - 1, 4);
          const showViewAllBadge = n >= 2;

          const gridCls = cn(
            'hidden md:grid gap-2 h-[460px] rounded-[20px] overflow-hidden',
            smallCount === 0 && 'grid-cols-1 grid-rows-1',
            smallCount === 1 && 'grid-cols-2 grid-rows-1',
            smallCount === 2 && 'grid-cols-[2fr_1fr] grid-rows-2',
            (smallCount === 3 || smallCount === 4) && 'grid-cols-[2fr_1fr_1fr] grid-rows-2',
          );

          const mainRowSpan = smallCount >= 2 ? 'row-span-2' : '';

          return (
            <div className="relative">
              <div className={gridCls}>
                <div className={cn('relative overflow-hidden group', mainRowSpan)}>
                  <button
                    type="button"
                    onClick={() => setLightbox({ images: thumbs, index: 0 })}
                    className="block w-full h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-primary/40 focus-visible:ring-inset"
                    aria-label="View gallery"
                  >
                    {thumbs[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbs[0]}
                        alt={title}
                        width={760}
                        height={460}
                        fetchPriority="high"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="h-full w-full bg-jadwal-surface-muted grid place-items-center">
                        <MapPin
                          className="h-16 w-16 text-jadwal-text-faint"
                          aria-hidden="true"
                        />
                      </div>
                    )}
                  </button>
                  <div className="absolute top-3 inset-e-3 z-10 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleLike}
                      disabled={likeMutation.isPending}
                      aria-label={isLiked ? 'Unlike' : 'Like'}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-3 h-9 rounded-xl backdrop-blur-md text-xs font-semibold transition-colors',
                        isLiked
                          ? 'bg-red-500/90 text-white'
                          : 'bg-white/90 text-slate-900 hover:bg-white',
                      )}
                    >
                      <Heart
                        className={cn('h-4 w-4', isLiked && 'fill-white')}
                        aria-hidden="true"
                      />
                      {likeCount > 0 ? likeCount : null}
                    </button>
                    <button
                      type="button"
                      onClick={handleShare}
                      aria-label="Share"
                      className="inline-grid place-items-center h-9 w-9 rounded-xl bg-white/90 text-slate-900 hover:bg-white backdrop-blur-md transition-colors"
                    >
                      <Share2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {Array.from({ length: smallCount }, (_, idx) => {
                  const i = idx + 1; // thumbs index (1..4)
                  // For n=4 (smallCount=3): the last small tile occupies the
                  // bottom row across both 1fr columns so the 2×3 grid has no
                  // empty slot.
                  const widenLastTile = smallCount === 3 && idx === 2;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setLightbox({ images: thumbs, index: i })}
                      className={cn(
                        'relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-primary/40',
                        widenLastTile && 'col-span-2',
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbs[i]}
                        alt=""
                        width={380}
                        height={230}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                      />
                    </button>
                  );
                })}
              </div>
              {/* Floating "View all photos" button — absolute-positioned over
                  the gallery's bottom-right corner. Hidden on mobile (the
                  mobile gallery has its own controls). Hidden for 1-image
                  activities where there's nothing else to browse. */}
              {showViewAllBadge ? (
                <button
                  type="button"
                  onClick={() => setLightbox({ images: thumbs, index: 0 })}
                  aria-label={t('activity.viewAllPhotos', { defaultValue: 'View all photos' })}
                  className="hidden md:inline-flex absolute bottom-3 inset-e-3 items-center gap-1.5 px-3 py-2 rounded-full bg-white/95 text-slate-900 text-xs font-semibold shadow-lg hover:bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-primary/40"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('activity.viewAllPhotos', { defaultValue: 'View all photos' })}
                </button>
              ) : null}
            </div>
          );
        })() : null}

        {/* Mobile gallery */}
        <div className="md:hidden">
          <div className="relative h-[280px] rounded-2xl overflow-hidden bg-jadwal-surface-muted">
            {mainImage ? (
              <button
                type="button"
                onClick={() => setLightbox({ images: thumbs, index: selectedImage })}
                className="h-full w-full cursor-pointer"
                aria-label="Open full-size image"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mainImage}
                  alt={title}
                  width={600}
                  height={280}
                  fetchPriority="high"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </button>
            ) : (
              <div className="h-full w-full grid place-items-center">
                <MapPin
                  className="h-12 w-12 text-jadwal-text-faint"
                  aria-hidden="true"
                />
              </div>
            )}
            <div className="absolute top-3 inset-e-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleLike}
                disabled={likeMutation.isPending}
                aria-label={isLiked ? 'Unlike' : 'Like'}
                className={cn(
                  'inline-grid place-items-center h-9 w-9 rounded-xl backdrop-blur-md transition-colors',
                  isLiked
                    ? 'bg-red-500/90 text-white'
                    : 'bg-white/90 text-slate-900',
                )}
              >
                <Heart
                  className={cn('h-4 w-4', isLiked && 'fill-white')}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                onClick={handleShare}
                aria-label="Share"
                className="inline-grid place-items-center h-9 w-9 rounded-xl bg-white/90 text-slate-900 backdrop-blur-md"
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {thumbs.length > 1 ? (
              <span className="absolute bottom-3 inset-e-3 px-2.5 py-1 rounded-full bg-black/70 text-white text-xs font-medium">
                {selectedImage + 1} / {thumbs.length}
              </span>
            ) : null}
          </div>
          {thumbs.length > 1 ? (
            <div className="mt-2 flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              {thumbs.map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedImage(i)}
                  className={cn(
                    'h-14 w-20 shrink-0 rounded-lg overflow-hidden transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-primary/40',
                    i === selectedImage
                      ? 'ring-2 ring-jadwal-primary'
                      : 'opacity-70',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img}
                    alt=""
                    width={80}
                    height={56}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Two-column body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6 md:gap-10 pt-6 md:pt-10 pb-20">
        <div className="flex flex-col gap-6 md:gap-7 min-w-0">
          {/* About */}
          {desc ? (
            <Section
              title={t('activity.aboutExperience', {
                defaultValue: 'About this experience',
              })}
            >
              <p className="text-[15px] leading-[1.7] text-jadwal-text whitespace-pre-line text-pretty wrap-break-word">
                {desc}
              </p>
            </Section>
          ) : null}

          {/* What's Included / Add-ons */}
          {activity.extraServices && activity.extraServices.length > 0
            ? (() => {
                const freeExtras = activity.extraServices!.filter((s) => s.price === 0);
                const paidExtras = activity.extraServices!.filter((s) => s.price > 0);
                return (
                  <>
                    {freeExtras.length > 0 ? (
                      <Section title={t('activity.whatsIncluded')}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {freeExtras.map((svc, i) => (
                            <div key={i} className="flex items-start gap-2.5">
                              <CheckCircle
                                className="h-[18px] w-[18px] text-jadwal-success shrink-0"
                                aria-hidden="true"
                              />
                              <span className="text-sm text-jadwal-text leading-relaxed">
                                {localized(svc, 'name')}
                              </span>
                            </div>
                          ))}
                        </div>
                      </Section>
                    ) : null}
                    {paidExtras.length > 0 ? (
                      <Section title={t('activity.optionalAddons')}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {paidExtras.map((svc, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-jadwal-border-subtle bg-jadwal-surface-muted"
                            >
                              <div className="flex flex-col min-w-0">
                                <span className="text-sm text-jadwal-text truncate">
                                  {localized(svc, 'name')}
                                </span>
                                {svc.perPerson ? (
                                  <span className="text-[10px] text-jadwal-text-faint">
                                    {t('activity.perPersonLabel')}
                                  </span>
                                ) : null}
                              </div>
                              <span className="text-sm font-semibold text-jadwal-text whitespace-nowrap">
                                +{svc.price} {currency}
                              </span>
                            </div>
                          ))}
                        </div>
                      </Section>
                    ) : null}
                  </>
                );
              })()
            : null}

          {/* Schedule */}
          <Section title={t('activity.schedule', { defaultValue: 'Schedule' })}>
            <div className="flex flex-col gap-2 text-sm text-jadwal-text">
              <div className="flex items-center gap-2.5">
                <Clock
                  className="h-4 w-4 text-jadwal-primary shrink-0"
                  aria-hidden="true"
                />
                {activity.checkInTime ? (
                  <span>
                    {isHourly
                      ? t('activity.startTime', { defaultValue: 'Start time' })
                      : t('activity.checkIn', { defaultValue: 'Check-in' })}
                    :{' '}
                    <span className="font-semibold">{activity.checkInTime}</span>
                    {activity.checkOutTime ? (
                      <>
                        {' '}·{' '}
                        {isHourly
                          ? t('activity.endTime', { defaultValue: 'End time' })
                          : t('activity.checkOut', { defaultValue: 'Check-out' })}
                        :{' '}
                        <span className="font-semibold">
                          {activity.checkOutTime}
                        </span>
                      </>
                    ) : null}
                  </span>
                ) : (
                  <span>
                    {t('activity.flexibleTiming', {
                      defaultValue: 'Flexible timing',
                    })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2.5">
                <Calendar
                  className="h-4 w-4 text-jadwal-primary shrink-0"
                  aria-hidden="true"
                />
                {activity.activeDays?.length > 0 ? (
                  <span>{activity.activeDays.join(', ')}</span>
                ) : (
                  <span>
                    {t('activity.allDays', { defaultValue: 'All days' })}
                  </span>
                )}
              </div>
            </div>
          </Section>

          {/* Cancellation policy */}
          {policyLevel && cancelPolicyLabel ? (
            <Section title={t('activity.cancellationPolicy')}>
              <div className="flex items-start gap-3 p-4 rounded-xl border border-jadwal-border-subtle bg-jadwal-surface-muted">
                <div
                  className={cn(
                    'grid h-10 w-10 place-items-center rounded-xl shrink-0',
                    policyLevel === 'free'
                      ? 'bg-emerald-500/10 text-jadwal-success'
                      : policyLevel === 'partial'
                        ? 'bg-amber-500/10 text-jadwal-warning'
                        : 'bg-red-500/10 text-jadwal-danger',
                  )}
                >
                  {policyLevel === 'none' ? (
                    <AlertCircle className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <Shield className="h-5 w-5" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <div className="text-sm font-semibold text-jadwal-text">
                    {cancelPolicyLabel}
                  </div>
                  {cancelPolicyDesc ? (
                    <div className="mt-0.5 text-[13px] text-jadwal-text-muted">
                      {cancelPolicyDesc}
                    </div>
                  ) : null}
                </div>
              </div>
            </Section>
          ) : null}

          {/* Meeting point / Map */}
          {activity.locationAddress ? (
            <Section
              title={t('activity.meetingPoint', {
                defaultValue: 'Meeting point',
              })}
            >
              <div className="flex items-start gap-2 text-sm text-jadwal-text">
                <MapPin
                  className="h-4 w-4 mt-0.5 shrink-0 text-jadwal-primary"
                  aria-hidden="true"
                />
                <span>{activity.locationAddress}</span>
              </div>
              {activity.locationLat && activity.locationLng ? (
                <div className="mt-4 rounded-2xl overflow-hidden border border-jadwal-border-subtle">
                  {/*
                    Leaflet + OpenStreetMap tiles. Replaces the previous
                    Google Maps iframe that broke when Google deprecated
                    the `output=embed` URL pattern (server now sends
                    X-Frame-Options: SAMEORIGIN). Same dependency stack
                    as map-picker-modal.tsx — no new packages or CSP
                    allowlist entries required.
                  */}
                  <ActivityLocationMap
                    lat={activity.locationLat}
                    lng={activity.locationLng}
                    ariaLabel={`Map showing the location of ${title}`}
                  />
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${activity.locationLat},${activity.locationLng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-jadwal-primary hover:bg-jadwal-surface-muted transition-colors border-t border-jadwal-border-subtle"
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('activity.openInMaps', {
                      defaultValue: 'Open in Google Maps',
                    })}
                  </a>
                </div>
              ) : null}
            </Section>
          ) : null}

          {/* Reviews */}
          <Section
            title={`${t('activity.reviews')}${
              activity._count.reviews > 0 ? ` (${activity._count.reviews})` : ''
            }`}
          >
            {activity._count.reviews > 0 ? (
              <div className="flex items-start gap-6 mb-5 flex-wrap">
                <div>
                  <div className="font-display text-[44px] font-bold tracking-[-1.5px] leading-none text-jadwal-text tabular-nums">
                    {avgRating.toFixed(1)}
                  </div>
                  <div className="flex items-center gap-0.5 mt-1.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star
                        key={i}
                        className={cn(
                          'h-3.5 w-3.5',
                          i <= Math.round(avgRating)
                            ? 'fill-jadwal-accent text-jadwal-accent'
                            : 'text-jadwal-text-faint',
                        )}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                  <div className="mt-1 text-xs text-jadwal-text-muted">
                    {activity._count.reviews.toLocaleString()} {t('activity.reviews')}
                  </div>
                </div>
                <div className="flex-1 min-w-[200px]">
                  {ratingDistribution(activity.reviews).map(({ stars, pct }) => (
                    <div
                      key={stars}
                      className="flex items-center gap-2 mb-1 text-xs text-jadwal-text-muted"
                    >
                      <span className="min-w-[10px] tabular-nums">{stars}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-jadwal-surface-muted overflow-hidden">
                        <div
                          className="h-full bg-jadwal-accent rounded-full transition-[width]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {!user || user.role === 'CUSTOMER' ? (
              <div className="mb-5 p-4 rounded-xl border border-jadwal-border-subtle bg-jadwal-surface-muted">
                <p className="text-sm font-medium text-jadwal-text mb-3">
                  {t('activity.rateThis', {
                    defaultValue: 'Rate this activity',
                  })}
                </p>
                <div className="flex items-center gap-1 mb-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        if (!user) {
                          redirectToLogin();
                          return;
                        }
                        setReviewRating(i + 1);
                      }}
                      onMouseEnter={() => setReviewHover(i + 1)}
                      onMouseLeave={() => setReviewHover(0)}
                      aria-label={`${i + 1} star${i > 0 ? 's' : ''}`}
                      className="p-0.5 cursor-pointer transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jadwal-primary/40 rounded"
                    >
                      <Star
                        className={cn(
                          'h-7 w-7 transition-colors',
                          (reviewHover || reviewRating) >= i + 1
                            ? 'fill-jadwal-accent text-jadwal-accent'
                            : 'text-jadwal-text-faint',
                        )}
                      />
                    </button>
                  ))}
                </div>
                {reviewRating > 0 ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setReviewRating(0)}
                    >
                      {t('common.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSubmitReview}
                      loading={reviewMutation.isPending}
                    >
                      {reviewMutation.isPending
                        ? t('common.submitting', { defaultValue: 'Submitting…' })
                        : t('common.submit', { defaultValue: 'Submit' })}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activity.reviews.length > 0
              ? (
                  // The 3 most recent reviews, side-by-side (stacks on mobile).
                  // Text is clamped to keep the three cards a uniform height.
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[...activity.reviews]
                      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
                      .slice(0, 3)
                      .map((review) => (
                        <article
                          key={review.id}
                          className="p-3 rounded-xl border border-jadwal-border-subtle bg-jadwal-surface"
                        >
                          <div className="flex items-center gap-2.5 mb-1.5">
                            <div className="grid h-8 w-8 place-items-center rounded-full text-white font-bold text-xs bg-[linear-gradient(135deg,var(--jadwal-accent),var(--jadwal-primary))]">
                              {(review.customer?.displayName ?? 'A').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-[13px] font-semibold text-jadwal-text">
                                {review.customer?.displayName ?? (
                                  <span className="inline-flex items-center gap-1">
                                    <User className="h-4 w-4" aria-hidden="true" />
                                    {isRtl ? 'زائر' : 'Guest'}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="flex gap-0.5">
                                  {[1, 2, 3, 4, 5].map((i) => (
                                    <Star
                                      key={i}
                                      className={cn(
                                        'h-[10px] w-[10px]',
                                        i <= review.rating
                                          ? 'fill-jadwal-accent text-jadwal-accent'
                                          : 'text-jadwal-text-faint',
                                      )}
                                      aria-hidden="true"
                                    />
                                  ))}
                                </div>
                                <span
                                  className="text-[11px] text-jadwal-text-muted"
                                  suppressHydrationWarning
                                >
                                  {new Date(review.createdAt).toLocaleDateString(
                                    isRtl ? 'ar-EG' : 'en-US',
                                    { month: 'short', day: 'numeric', year: 'numeric' },
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>
                          {/* Reviews are rating-only — no customer free text is shown. */}
                        </article>
                      ))}
                  </div>
                )
              : (
                <p className="text-sm text-jadwal-text-muted text-center py-6">
                  {t('activity.noReviewsYet', {
                    defaultValue: 'No reviews yet',
                  })}
                </p>
              )}
          </Section>

          {/* Related */}
          {related && related.length > 0 ? (
            <section>
              <h2 className="font-display text-[18px] md:text-[20px] font-semibold tracking-[-0.4px] text-jadwal-text m-0 mb-4">
                {t('activity.youMightAlsoLike')}
              </h2>
              <div className="flex gap-4 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
                {related.map((item) => (
                  <div key={item.id} className="shrink-0 w-64">
                    <Link
                      href={`/activity/${item.slug}`}
                      className="group block rounded-2xl overflow-hidden border border-jadwal-border-subtle bg-jadwal-surface shadow-jadwal hover:shadow-jadwal-lg transition-shadow"
                    >
                      <div className="relative h-36 bg-jadwal-surface-muted overflow-hidden">
                        {item.coverImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.coverImage}
                            alt={localized(item, 'title')}
                            width={256}
                            height={144}
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="h-full w-full grid place-items-center">
                            <MapPin
                              className="h-8 w-8 text-jadwal-text-faint"
                              aria-hidden="true"
                            />
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <h3 className="text-sm font-semibold text-jadwal-text truncate">
                          {localized(item, 'title')}
                        </h3>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-jadwal-text-muted truncate">
                            {item.city ? localized(item.city, 'name') : ''}
                          </span>
                          <span className="text-xs font-bold text-jadwal-text whitespace-nowrap tabular-nums">
                            {Number(item.pricePerPerson).toFixed(0)}{' '}
                            {item.country?.currencyCode ?? 'QAR'}
                          </span>
                        </div>
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {/* Right rail — sticky booking card */}
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <div className="rounded-[20px] border border-jadwal-border-subtle bg-jadwal-surface shadow-jadwal-lg p-5">
              <div>
                <div className="text-[11px] text-jadwal-text-muted uppercase tracking-[0.4px] mb-0.5">
                  {t('activity.from', { defaultValue: 'from' })}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-display text-[26px] font-bold tracking-[-0.6px] text-jadwal-text tabular-nums">
                    {price.toFixed(0)}
                  </span>
                  <span className="text-sm text-jadwal-text-muted">
                    {currency}{' '}
                    {isDaily
                      ? t('activity.perUnitNight', {
                          defaultValue: '/ unit · night',
                        })
                      : isHourly
                        ? isPerUnit
                          ? t('activity.perUnitHours', {
                              defaultValue: `/ unit · ${activity.durationValue ?? ''}h`,
                            })
                          : t('activity.perPersonHours', {
                              defaultValue: `/ person · ${activity.durationValue ?? ''}h`,
                            })
                        : isPerUnit
                          ? t('activity.perUnit', { defaultValue: '/ unit' })
                          : t('activity.perPerson', { defaultValue: '/ person' })}
                  </span>
                </div>
                {/* Hourly activities price per baseline block; show the per-
                    hour equivalent + note that longer bookings scale pro-rata,
                    so a customer isn't surprised when the checkout total is
                    higher than the headline number. */}
                {isHourly && activity.durationValue && activity.durationValue > 0 ? (
                  <div className="text-[11px] text-jadwal-text-muted mt-1">
                    ≈ {(price / activity.durationValue).toFixed(0)} {currency} /{' '}
                    {t('activity.hour', { defaultValue: 'hour' })}{' '}
                    ·{' '}
                    {t('activity.scalesWithHours', {
                      defaultValue: 'price scales with hours booked',
                    })}
                  </div>
                ) : null}
              </div>

              {!isDaily && !isPerUnit ? (
                <div className="mt-4 rounded-xl border border-jadwal-border-subtle bg-jadwal-surface-muted p-3 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-jadwal-text-muted uppercase tracking-[0.4px]">
                      {t('activity.guests', { defaultValue: 'Guests' })}
                    </div>
                    <div className="text-sm font-semibold text-jadwal-text mt-0.5">
                      {guests}{' '}
                      {guests === 1
                        ? t('activity.person')
                        : t('activity.people')}
                    </div>
                  </div>
                  <Stepper
                    value={guests}
                    min={1}
                    max={maxGuests}
                    onChange={setGuests}
                    ariaLabel="Guests"
                  />
                </div>
              ) : null}

              {!isDaily && !isPerUnit ? (
                <>
                  {guests >= maxGuests && maxGuests < 99 ? (
                    <p className="mt-2 text-xs text-jadwal-warning leading-relaxed">
                      {t('activity.maxGuestsHint', {
                        defaultValue:
                          'Max {{n}} guests. Need more spots? Make multiple bookings.',
                        n: maxGuests,
                      })}
                    </p>
                  ) : null}
                  <div className="mt-4 pt-4 border-t border-jadwal-border-subtle flex items-center justify-between text-sm">
                    <span className="text-jadwal-text-muted">
                      {price.toFixed(0)} {currency} × {guests}
                    </span>
                    <span className="font-semibold text-jadwal-text tabular-nums">
                      {totalPrice.toFixed(0)} {currency}
                    </span>
                  </div>
                </>
              ) : null}

              {isDaily ? (
                <p className="mt-4 text-xs text-jadwal-text-muted">
                  {t('activity.finalAfterDates', {
                    defaultValue: 'Final total calculated after selecting dates',
                  })}
                </p>
              ) : null}

              <div className="mt-3 pt-3 border-t border-jadwal-border-subtle flex items-baseline justify-between">
                <span className="font-semibold text-jadwal-text">
                  {t('booking.total')}
                </span>
                <span className="font-display text-2xl font-bold tracking-[-0.5px] text-jadwal-text tabular-nums">
                  {(isDaily ? price : totalPrice).toFixed(0)} {currency}
                </span>
              </div>

              {user?.role === 'ADMIN' || user?.role === 'VENDOR' ? (
                <div className="mt-4 py-3 px-4 rounded-xl bg-jadwal-surface-muted text-center text-sm text-jadwal-text-muted">
                  {user?.role === 'ADMIN' ? 'Admins' : 'Vendors'} cannot make
                  bookings
                </div>
              ) : (
                <Button
                  full
                  size="lg"
                  className="mt-4"
                  iconEnd={
                    isRtl ? (
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    )
                  }
                  onClick={handleBookNow}
                >
                  {t('activity.bookNow')}
                </Button>
              )}

              <div className="mt-4 flex flex-col gap-1.5 text-xs text-jadwal-text-muted">
                <div className="flex items-center gap-1.5">
                  <CheckCircle
                    className="h-3.5 w-3.5 text-jadwal-success"
                    aria-hidden="true"
                  />
                  <span>
                    {t('activity.instantConfirmation', {
                      defaultValue: 'Instant confirmation',
                    })}
                  </span>
                </div>
                {policyLevel && cancelPolicyLabel ? (
                  <CancelBadge
                    level={policyLevel}
                    label={cancelPolicyLabel}
                    compact
                  />
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile pinned booking CTA */}
      <div className="lg:hidden sticky bottom-0 inset-x-0 z-30 border-t border-jadwal-border-subtle bg-jadwal-surface/95 backdrop-blur-md">
        <div className="flex items-center gap-3 p-3 max-w-7xl mx-auto">
          <div className="flex-1">
            <div className="text-[11px] text-jadwal-text-muted">
              {t('activity.from', { defaultValue: 'from' })}
            </div>
            <div className="font-display text-lg font-bold tracking-[-0.3px] text-jadwal-text tabular-nums">
              {price.toFixed(0)}{' '}
              <span className="text-xs font-normal text-jadwal-text-muted">
                {currency}{' '}
                {isDaily
                  ? t('activity.perUnitNight', { defaultValue: '/ unit · night' })
                  : isPerUnit
                    ? t('activity.perUnit', { defaultValue: '/ unit' })
                    : t('activity.perPerson', { defaultValue: '/ person' })}
              </span>
            </div>
          </div>
          {user?.role === 'ADMIN' || user?.role === 'VENDOR' ? (
            <span className="text-xs text-jadwal-text-muted">
              {user?.role === 'ADMIN' ? 'Admins' : 'Vendors'} can't book
            </span>
          ) : (
            <Button
              size="md"
              iconEnd={
                isRtl ? (
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                )
              }
              onClick={handleBookNow}
            >
              {t('activity.bookNow')}
            </Button>
          )}
        </div>
      </div>

      <Footer />

      {/* Lightbox */}
      {lightbox ? (
        <div
          className="fixed inset-0 z-9999 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-label="Image gallery"
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close"
            className="absolute top-4 inset-e-4 z-10 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
          <div className="absolute top-4 inset-s-4 z-10 px-3 py-1 rounded-lg bg-white/10 text-white text-sm font-medium">
            {lightbox.index + 1} / {lightbox.images.length}
          </div>
          {lightbox.images.length > 1 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightbox(
                  (lb) =>
                    lb && {
                      ...lb,
                      index: (lb.index - 1 + lb.images.length) % lb.images.length,
                    },
                );
              }}
              aria-label="Previous"
              className="absolute inset-s-4 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </button>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.images[lightbox.index]}
            alt={`${title} ${lightbox.index + 1}`}
            width={1600}
            height={1000}
            decoding="async"
            className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {lightbox.images.length > 1 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightbox(
                  (lb) =>
                    lb && { ...lb, index: (lb.index + 1) % lb.images.length },
                );
              }}
              aria-label="Next"
              className="absolute inset-e-4 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ChevronRight className="h-6 w-6" aria-hidden="true" />
            </button>
          ) : null}
          {lightbox.images.length > 1 ? (
            <div className="absolute bottom-4 flex gap-2 overflow-x-auto max-w-[90vw] px-2">
              {lightbox.images.map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightbox((lb) => lb && { ...lb, index: i });
                  }}
                  className={cn(
                    'shrink-0 h-14 w-20 rounded-lg overflow-hidden border-2 transition-all',
                    i === lightbox.index
                      ? 'border-white'
                      : 'border-white/20 opacity-60 hover:opacity-100',
                  )}
                  aria-label={`Image ${i + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img}
                    alt=""
                    width={80}
                    height={56}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <TermsAcceptModal
        open={termsModalOpen}
        onAccepted={() => { setTermsModalOpen(false); if (pendingBookUrl) router.push(pendingBookUrl); }}
        onCancel={() => setTermsModalOpen(false)}
      />
    </div>
  );
}
