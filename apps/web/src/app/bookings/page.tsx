'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  Calendar,
  ChevronRight,
  Clock,
  Inbox,
  MapPin,
  Sparkles,
  Users,
} from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { localized } from '@/lib/localize';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { Badge, Button, Chip, Skeleton } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

interface BookingSummary {
  id: string;
  ref: string;
  status: BookingStatus;
  guests: number;
  totalPrice: string;
  serviceFee: string;
  pointsRedeemed?: number | null;
  pointsDiscount?: string | number | null;
  couponDiscount?: string | number | null;
  currencyCode: string;
  startDatetime: string;
  endDatetime: string;
  createdAt: string;
  activity: {
    titleEn: string;
    titleAr?: string | null;
    slug: string;
    coverImage: string | null;
    bookingType: string;
    city?: { nameEn?: string | null; nameAr?: string | null } | null;
  } | null;
  payment: {
    status: string;
    method?: string | null;
    paidAt: string | null;
  } | null;
}

interface BookingsPage {
  data: BookingSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const STATUS_VARIANT: Record<BookingStatus, 'warning' | 'success' | 'neutral' | 'danger'> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
};

const STATUS_LABEL_KEY: Record<BookingStatus, string> = {
  PENDING: 'booking.status.pending',
  CONFIRMED: 'booking.status.confirmed',
  CANCELLED: 'booking.status.cancelled',
  COMPLETED: 'booking.status.completed',
};

const STATUS_FILTER_VALUES = [
  { key: 'booking.status.all', value: 'all' },
  { key: 'booking.status.confirmed', value: 'CONFIRMED' },
  { key: 'booking.status.pending', value: 'PENDING' },
  { key: 'booking.status.completed', value: 'COMPLETED' },
  { key: 'booking.status.cancelled', value: 'CANCELLED' },
] as const;

const PAGE_SIZE = 10;

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function BookingCardSkeleton() {
  return (
    <div className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle p-4 shadow-jadwal">
      <div className="flex gap-4">
        <Skeleton className="w-[88px] h-[72px] rounded-xl shrink-0" />
        <div className="flex-1 flex flex-col gap-2 py-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <Skeleton className="w-20 h-6 rounded-full shrink-0 mt-1" />
      </div>
    </div>
  );
}

// ─── Booking card ─────────────────────────────────────────────────────────────

function BookingCard({ booking }: { booking: BookingSummary }) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-GB';
  const variant = STATUS_VARIANT[booking.status] ?? 'warning';
  const statusLabel = t(
    STATUS_LABEL_KEY[booking.status] ?? 'booking.status.pending',
  );
  const isDaily = booking.activity?.bookingType === 'DAILY';

  const startDate = new Date(booking.startDatetime);
  const endDate = new Date(booking.endDatetime);

  // timeZone:'UTC' — booking datetimes are local-wall-clock tagged UTC; must match
  // the UTC-pinned timeLabel below (else the date can read off-by-one vs the time).
  const dateLabel = isDaily
    ? `${startDate.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      })} – ${endDate.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })}`
    : startDate.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });

  const timeLabel = isDaily
    ? null
    : startDate.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
      });

  // Nominal value = the activity's full customer-facing price. Under the
  // current accounting, totalPrice already includes the full vendor value
  // regardless of payment method (Wanasa bookings no longer store 0). So
  // reconstructing gross: totalPrice + couponDiscount + serviceFee.
  // pointsDiscount is a customer-side saving and must NOT be added — it
  // would double-count the already-included value.
  const pointsUsed = Number(booking.pointsRedeemed || 0);
  const couponValue = Number(booking.couponDiscount || 0);
  const nominalTotal = (
    Number(booking.totalPrice) + couponValue + Number(booking.serviceFee)
  ).toFixed(2);
  const paidWithWanasa = booking.payment?.method === 'WANASA_POINTS';

  const city = booking.activity?.city
    ? localized(booking.activity.city, 'name')
    : '';

  return (
    <Link href={`/bookings/${booking.id}`}>
      <motion.article
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.995 }}
        className="group rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle shadow-jadwal p-4 md:p-[18px] flex flex-col md:flex-row gap-3 md:gap-[18px] hover:shadow-jadwal-lg hover:border-jadwal-border-strong transition-[box-shadow,border-color,transform] cursor-pointer"
      >
        <div className="w-full md:w-[120px] h-[140px] md:h-[90px] rounded-xl overflow-hidden bg-jadwal-surface-muted shrink-0 relative">
          {booking.activity?.coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={booking.activity.coverImage}
              alt={
                booking.activity
                  ? localized(booking.activity, 'title')
                  : 'Booking'
              }
              width={120}
              height={90}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full grid place-items-center">
              <Calendar
                className="w-6 h-6 text-jadwal-text-faint"
                aria-hidden="true"
              />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <Badge variant={variant} size="sm">
              {statusLabel}
            </Badge>
            <span
              className="text-[11px] text-jadwal-text-muted font-mono"
              aria-label="Booking reference"
            >
              #{booking.ref}
            </span>
          </div>
          <p className="text-[15px] font-semibold tracking-[-0.2px] text-jadwal-text truncate">
            {booking.activity
              ? localized(booking.activity, 'title')
              : t('booking.activity', { defaultValue: 'Activity' })}
          </p>
          <div
            className="flex items-center gap-3 mt-1 flex-wrap text-[12px] text-jadwal-text-muted"
            suppressHydrationWarning
          >
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3 h-3" aria-hidden="true" />
              {dateLabel}
            </span>
            {timeLabel ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" aria-hidden="true" />
                {timeLabel}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Users className="w-3 h-3" aria-hidden="true" />
              {booking.guests}{' '}
              {booking.guests === 1 ? t('activity.person') : t('activity.people')}
            </span>
            {city ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" aria-hidden="true" />
                {city}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-jadwal-text tabular-nums">
              {booking.currencyCode} {nominalTotal}
            </span>
            {paidWithWanasa ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-purple-100 text-purple-700">
                <Sparkles className="w-3 h-3" aria-hidden="true" />
                {t('booking.paidWithWanasa', { defaultValue: 'Paid with Wanasa' })}
              </span>
            ) : pointsUsed > 0 ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-600">
                <Sparkles className="w-3 h-3" aria-hidden="true" />
                {t('booking.pointsUsed', {
                  defaultValue: '{{n}} pts used',
                  n: pointsUsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                })}
              </span>
            ) : null}
            {booking.payment?.status === 'FAILED' ? (
              <span className="text-xs text-jadwal-danger font-medium">
                {t('booking.paymentFailed')}
              </span>
            ) : null}
          </div>
        </div>

        <div className="hidden md:flex items-center">
          <ChevronRight
            className="w-4 h-4 text-jadwal-text-faint group-hover:text-jadwal-primary transition-colors"
            aria-hidden="true"
          />
        </div>
      </motion.article>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MyBookingsPage() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    isError,
  } = useInfiniteQuery({
    queryKey: ['my-bookings', statusFilter],
    queryFn: ({ pageParam = 1 }) =>
      api
        .get('/bookings/my', {
          params: {
            page: pageParam,
            limit: PAGE_SIZE,
            ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          },
        })
        .then((r) => r.data as BookingsPage),
    getNextPageParam: (last) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    initialPageParam: 1,
    staleTime: 30_000,
  });

  const allBookings = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="min-h-screen bg-jadwal-bg flex flex-col font-outfit">
      <Navbar variant="solid" />

      <main className="flex-1 pt-24 pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          {/* Page heading */}
          <div className="mb-6">
            <h1 className="font-display text-[26px] md:text-[34px] font-semibold tracking-[-0.8px] md:tracking-[-1px] text-jadwal-text leading-[1.15] m-0">
              {t('booking.myBookings')}
            </h1>
            <p className="mt-1.5 text-sm text-jadwal-text-muted">
              {total > 0
                ? t('booking.totalCount', {
                    defaultValue: '{{n}} bookings',
                    n: total,
                  })
                : t('booking.trackReservations')}
            </p>
          </div>

          {/* Status filter pills */}
          <div
            className={cn(
              'flex gap-2 overflow-x-auto pb-2 mb-6',
              '[&::-webkit-scrollbar]:hidden [scrollbar-width:none]',
            )}
          >
            {STATUS_FILTER_VALUES.map((f) => (
              <Chip
                key={f.value}
                active={statusFilter === f.value}
                onClick={() => setStatusFilter(f.value)}
              >
                {t(f.key)}
              </Chip>
            ))}
          </div>

          {/* Skeletons */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <BookingCardSkeleton key={i} />
              ))}
            </div>
          ) : null}

          {/* Error */}
          {isError && !isLoading ? (
            <div className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle py-16 text-center">
              <p className="text-sm text-jadwal-text-muted">
                {t('booking.failedToLoad')}
              </p>
              <Link
                href="/"
                className="text-xs text-jadwal-primary hover:underline mt-2 inline-block"
              >
                {t('common.backHome', { defaultValue: 'Back to home' })}
              </Link>
            </div>
          ) : null}

          {/* Empty */}
          {!isLoading && !isError && allBookings.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle py-16 md:py-20 text-center flex flex-col items-center gap-3"
            >
              <div className="w-[72px] h-[72px] rounded-2xl bg-jadwal-surface-muted grid place-items-center">
                <Inbox
                  className="w-8 h-8 text-jadwal-text-muted"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </div>
              <div>
                <p className="text-base font-semibold text-jadwal-text tracking-[-0.3px]">
                  {statusFilter === 'all'
                    ? t('booking.noBookings')
                    : t('booking.noStatusBookings', {
                        defaultValue: 'No {{status}} bookings',
                        status: statusFilter.toLowerCase(),
                      })}
                </p>
                <p className="text-[13px] text-jadwal-text-muted mt-1 max-w-sm">
                  {statusFilter === 'all'
                    ? t('booking.noBookingsDesc')
                    : t('booking.tryDifferentFilter')}
                </p>
              </div>
              {statusFilter === 'all' ? (
                <Button
                  onClick={() => (window.location.href = '/explore')}
                  className="mt-2"
                >
                  {t('booking.browseActivities')}
                </Button>
              ) : null}
            </motion.div>
          ) : null}

          {/* Booking list */}
          {!isLoading && allBookings.length > 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-3"
            >
              {allBookings.map((booking, i) => (
                <motion.div
                  key={booking.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.4) }}
                >
                  <BookingCard booking={booking} />
                </motion.div>
              ))}
            </motion.div>
          ) : null}

          {/* Load more */}
          {hasNextPage && !isLoading ? (
            <div className="mt-6 text-center">
              <Button
                variant="secondary"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                loading={isFetchingNextPage}
              >
                {isFetchingNextPage
                  ? t('booking.loading')
                  : t('booking.loadMore')}
              </Button>
            </div>
          ) : null}
        </div>
      </main>

      <Footer />
    </div>
  );
}
