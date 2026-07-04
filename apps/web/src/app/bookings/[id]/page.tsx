'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle,
  Clock,
  Coins,
  MapPin,
  Sparkles,
  Tag,
  Users,
  XCircle,
} from 'lucide-react';
import { motion } from 'framer-motion';
import api from '@/lib/api';
import { fbTrack } from '@/lib/fb-pixel';
import { localized } from '@/lib/localize';
import { getApiError } from '@/lib/api-error';
import { isAllowedPay2mFormAction } from '@/lib/pay2m';
import Navbar from '@/components/navbar';
import Footer from '@/components/footer';
import { BookingEmailOtpModal } from '@/components/booking-email-otp-modal';
import { useToast } from '@/components/toast';
import { Badge, Button } from '@/components/ui';

// ─── Countdown hook ───────────────────────────────────────────────────────────

function useCountdown(reservedUntil: string | null) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!reservedUntil) return;
    const tick = () => {
      const diff = Math.max(
        0,
        Math.floor(
          (new Date(reservedUntil).getTime() - Date.now()) / 1000,
        ),
      );
      setSecondsLeft(diff);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [reservedUntil]);

  return secondsLeft;
}

function formatCountdown(seconds: number) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ─── Status → Badge variant ───────────────────────────────────────────────────

const STATUS_VARIANT: Record<
  string,
  'warning' | 'success' | 'neutral' | 'danger'
> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
};

// ─── Row helper ───────────────────────────────────────────────────────────────

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4 border-b border-jadwal-border-subtle last:border-0">
      <p className="text-[11px] text-jadwal-text-muted uppercase tracking-[0.4px] mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function BookingDetailSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 bg-jadwal-surface-muted rounded-xl" />
      <div className="h-24 rounded-2xl bg-jadwal-surface-muted" />
      <div className="h-64 rounded-2xl bg-jadwal-surface-muted" />
      <div className="h-32 rounded-2xl bg-jadwal-surface-muted" />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BookingDetailPage() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const locale = isRtl ? 'ar-EG' : 'en-GB';
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: booking, isLoading, isError } = useQuery({
    queryKey: ['booking', id],
    queryFn: () => api.get(`/bookings/my/${id}`).then((r) => r.data),
    enabled: !!id,
    staleTime: 20_000,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'PENDING' ? 10_000 : false;
    },
  });

  const secondsLeft = useCountdown(booking?.reservedUntil ?? null);
  const isExpired = secondsLeft === 0 && booking?.status === 'PENDING';

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Email-OTP gate. Booking-create auto-sends a 6-digit code to the
  // customer's email; they must verify before /payment/initiate will
  // hand them a PAY2M token. We auto-open the modal as soon as we know
  // the booking is PENDING + not yet verified, so the customer never
  // sees a "Pay" button that mysteriously fails.
  const needsEmailOtp =
    booking?.status === 'PENDING' && !booking?.emailOtpVerifiedAt;
  const [showEmailOtpModal, setShowEmailOtpModal] = useState(false);
  useEffect(() => {
    if (needsEmailOtp) setShowEmailOtpModal(true);
  }, [needsEmailOtp]);

  // Meta Pixel: Purchase fires once when the booking is CONFIRMED — covers both
  // card-paid and points-only bookings (both land here confirmed) and never
  // fires on PENDING/failed ones. sessionStorage guard prevents a re-fire on
  // revisit. No-ops unless the pixel loaded after cookie consent.
  useEffect(() => {
    if (booking?.status !== 'CONFIRMED' || !id) return;
    const key = `fb_purchase_${id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      // sessionStorage unavailable — fall through (at worst a rare double-count).
    }
    const cur = booking.currencyCode ?? booking.activity?.country?.currencyCode ?? 'QAR';
    const value = Number(booking.totalPrice ?? 0) + Number(booking.serviceFee ?? 0);
    fbTrack('Purchase', { currency: cur, value });
  }, [booking, id]);

  const handleOtpVerified = useCallback(() => {
    setShowEmailOtpModal(false);
    // Refetch so emailOtpVerifiedAt flips to a value and the page state
    // (PaymentButton enabled, verify-email banner removed) updates.
    queryClient.invalidateQueries({ queryKey: ['booking', id], refetchType: 'all' });
  }, [id, queryClient]);

  const handleCancelReservation = useCallback(async () => {
    setCancelling(true);
    try {
      const { data } = await api.delete(`/bookings/${id}/cancel`);
      // refetchType: 'all' so the inactive /bookings list query (we're
      // about to navigate there) refetches immediately instead of
      // waiting for mount. Default 'active' left the list showing the
      // stale pre-cancel row.
      await queryClient.invalidateQueries({ queryKey: ['my-bookings'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['booking', id], refetchType: 'all' });
      // Points refund (booking cancel returns redeemed points).
      queryClient.invalidateQueries({ queryKey: ['user-points-checkout'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['loyalty'], refetchType: 'all' });
      // Seat freed — availability caches must refresh.
      queryClient.invalidateQueries({ queryKey: ['hourly-slots'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['hourly-cal'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['calendar'], refetchType: 'all' });
      if (data?.status === 'REFUND_PENDING') {
        toast(
          'Cancellation submitted. The vendor will review your refund request — any approved amount will be added as Wanasa points.',
          'success',
        );
      } else {
        toast(t('booking.toast.cancelled'), 'success');
      }
      setShowCancelConfirm(false);
      router.push('/bookings');
    } catch {
      toast(t('booking.toast.cancelFailed'), 'error');
      setCancelling(false);
    }
  }, [id, router, toast, queryClient]);

  const currency =
    booking?.currencyCode ?? booking?.activity?.country?.currencyCode ?? 'QAR';
  // Pricing breakdown fields. Under the current accounting, totalPrice
  // carries the full vendor-earned amount for every booking (including
  // Wanasa-paid ones — the platform backs points with cash so vendors get
  // their share regardless). nominal = totalPrice + couponDiscount;
  // pointsDiscount must NOT be added — it's the customer-side saving, not
  // an addition to the activity value.
  const pointsUsed = Number(booking?.pointsRedeemed || 0);
  const pointsValue = Number(booking?.pointsDiscount || 0);
  const couponValue = Number(booking?.couponDiscount || 0);
  const nominalSubtotal = booking
    ? Number(booking.totalPrice) + couponValue
    : 0;
  const cashPaid = Number(booking?.payment?.amount || 0);
  const paidWithWanasa = booking?.payment?.method === 'WANASA_POINTS';
  const total = booking
    ? Number(booking.totalPrice) + Number(booking.serviceFee)
    : 0;
  const statusVariant =
    booking && STATUS_VARIANT[booking.status]
      ? STATUS_VARIANT[booking.status]
      : 'warning';
  const statusLabel = booking
    ? t(`booking.status.${booking.status.toLowerCase()}`, {
        defaultValue:
          booking.status.charAt(0) + booking.status.slice(1).toLowerCase(),
      })
    : '';

  return (
    <div className="min-h-screen bg-jadwal-bg flex flex-col font-outfit">
      <Navbar variant="solid" />

      <main className="flex-1 pt-24 pb-16">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          {/* Back */}
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-sm font-semibold text-jadwal-text-muted hover:text-jadwal-primary transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            {t('booking.myBookings')}
          </button>

          {/* Loading */}
          {isLoading ? <BookingDetailSkeleton /> : null}

          {/* Error */}
          {isError && !isLoading ? (
            <div className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle py-16 text-center">
              <p className="text-sm text-jadwal-text-muted">
                {t('booking.bookingNotFound')}
              </p>
              <Link
                href="/bookings"
                className="text-xs text-jadwal-primary hover:underline mt-2 inline-block"
              >
                {t('booking.backToBookings')}
              </Link>
            </div>
          ) : null}

          {/* Content */}
          {!isLoading && booking ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h1 className="font-display text-[22px] md:text-[28px] font-semibold tracking-[-0.6px] md:tracking-[-0.8px] text-jadwal-text leading-[1.2] m-0">
                    {t('booking.booked')} #{booking.ref}
                  </h1>
                  <p
                    className="text-sm text-jadwal-text-muted mt-1"
                    suppressHydrationWarning
                  >
                    {t('booking.booked')}{' '}
                    {new Date(booking.createdAt).toLocaleDateString(locale, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <Badge variant={statusVariant}>{statusLabel}</Badge>
              </div>

              {/* Countdown for PENDING bookings */}
              {booking.status === 'PENDING' &&
              booking.reservedUntil &&
              secondsLeft != null &&
              !isExpired ? (
                <div className="rounded-2xl p-4 bg-jadwal-accent-soft border border-[rgba(181,136,32,0.25)] flex items-center gap-3">
                  <Clock
                    className="w-5 h-5 text-jadwal-accent-text shrink-0"
                    aria-hidden="true"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-jadwal-accent-text">
                      {t('booking.reservationHoldTitle', {
                        defaultValue: 'Reservation held',
                      })}
                    </p>
                    <p className="text-xs text-jadwal-accent-text/80 mt-0.5">
                      {t('booking.reservationHoldDesc', {
                        defaultValue:
                          'Complete payment within {{time}} to secure your spot.',
                        time: formatCountdown(secondsLeft),
                      })}
                    </p>
                  </div>
                  <div className="font-mono text-base font-bold text-jadwal-accent-text tabular-nums">
                    {formatCountdown(secondsLeft)}
                  </div>
                </div>
              ) : null}

              {/* ── Status banners ───────────────────────────────── */}

              {booking.status === 'PENDING' &&
              booking.payment?.status !== 'FAILED' ? (
                <div className="rounded-2xl p-4 bg-sky-500/10 border border-sky-500/25 flex items-center gap-3">
                  <AlertCircle
                    className="w-5 h-5 text-jadwal-primary shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-semibold text-jadwal-primary">
                      {t('booking.awaitingPayment')}
                    </p>
                    <p className="text-xs text-jadwal-primary/80 mt-0.5">
                      {t('booking.completePayment')}
                    </p>
                  </div>
                </div>
              ) : null}

              {booking.status === 'CONFIRMED' ? (
                <div className="rounded-2xl p-5 md:p-6 text-white relative overflow-hidden shadow-jadwal-lg bg-[linear-gradient(135deg,var(--color-emerald-500,#10b981)_0%,var(--jadwal-primary)_100%)] dark:bg-[linear-gradient(135deg,#059669_0%,#0284c7_100%)]">
                  <div
                    aria-hidden="true"
                    className="absolute -top-10 -end-10 w-48 h-48 rounded-full border-2 border-dashed border-white/20 pointer-events-none"
                  />
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="w-4 h-4" aria-hidden="true" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.4px]">
                      {t('booking.bookingConfirmed')}
                    </span>
                  </div>
                  <p className="font-display text-[20px] md:text-[24px] font-semibold tracking-[-0.5px] mb-1">
                    {booking.activity ? localized(booking.activity, 'title') : ''}
                  </p>
                  <p className="text-sm opacity-90">
                    {t('booking.spotSecured')}
                    {booking.payment?.paidAt ? (
                      <>
                        {' · '}
                        {t('booking.paidOn')}{' '}
                        <span suppressHydrationWarning>
                          {new Date(booking.payment.paidAt).toLocaleDateString(
                            locale,
                            {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            },
                          )}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
              ) : null}

              {booking.status === 'PENDING' &&
              booking.payment?.status === 'FAILED' ? (
                <div className="rounded-2xl bg-red-500/10 border border-red-500/25 p-4 flex items-start gap-3">
                  <XCircle
                    className="w-5 h-5 text-jadwal-danger shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-semibold text-jadwal-danger">
                      {t('booking.paymentFailed')}
                    </p>
                    <p className="text-xs text-jadwal-danger/80 mt-0.5">
                      {t('booking.paymentFailedDesc')}
                    </p>
                  </div>
                </div>
              ) : null}

              {booking.status === 'CANCELLED' &&
              booking.payment?.status === 'REFUND_PENDING' ? (
                <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-4 flex items-start gap-3">
                  <Clock
                    className="w-5 h-5 text-jadwal-warning shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  {booking.cancelledBy === 'SYSTEM' ? (
                    // System auto-cancel (e.g. the spot became unavailable before
                    // the payment could be confirmed): the customer did NOT ask
                    // to cancel, so reassure them their money is coming back
                    // rather than framing it as a "refund request under review".
                    <div>
                      <p className="text-sm font-semibold text-jadwal-warning">
                        {t('booking.refundQueuedTitle', {
                          defaultValue: "We couldn't confirm your booking",
                        })}
                      </p>
                      <p className="text-xs text-jadwal-warning/90 mt-0.5">
                        {t('booking.refundQueuedDesc', {
                          defaultValue:
                            'The spot became unavailable before your payment could be confirmed. Your payment of {{amount}} {{cur}} is safe — a refund has been queued and will be added to your balance as Wanasa points once processed. No action needed.',
                          amount: Number(
                            booking.payment.refundAmount ??
                              booking.payment.amount ??
                              0,
                          ).toLocaleString(),
                          cur: currency,
                        })}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-semibold text-jadwal-warning">
                        {t('booking.refundPendingTitle', {
                          defaultValue:
                            'Cancellation recorded · Awaiting vendor review',
                        })}
                      </p>
                      <p className="text-xs text-jadwal-warning/90 mt-0.5">
                        {t('booking.refundPendingDesc', {
                          defaultValue:
                            'The vendor will review your refund request. Any approved amount will be added as Wanasa points to your balance.',
                        })}
                      </p>
                    </div>
                  )}
                </div>
              ) : null}

              {booking.status === 'CANCELLED' &&
              booking.payment?.status === 'REFUNDED' ? (
                <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-4 flex items-start gap-3">
                  <Coins
                    className="w-5 h-5 text-jadwal-success shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-semibold text-jadwal-success">
                      {t('booking.refundApprovedTitle', {
                        defaultValue:
                          'Refund of {{amount}} {{cur}} added as Wanasa points',
                        amount: Number(
                          booking.payment.refundAmount ?? 0,
                        ).toLocaleString(),
                        cur: currency,
                      })}
                    </p>
                    <p className="text-xs text-jadwal-success/90 mt-0.5">
                      {t('booking.refundApprovedDesc', {
                        defaultValue:
                          'The refund has been converted to Wanasa loyalty points and added to your balance.',
                      })}
                    </p>
                    {booking.refundDecisionNote ? (
                      <p className="text-xs text-jadwal-success/90 mt-2 italic">
                        &ldquo;{booking.refundDecisionNote}&rdquo;
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {booking.status === 'CANCELLED' &&
              booking.payment?.status === 'REJECTED' ? (
                <div className="rounded-2xl bg-red-500/10 border border-red-500/25 p-4 flex items-start gap-3">
                  <XCircle
                    className="w-5 h-5 text-jadwal-danger shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-semibold text-jadwal-danger">
                      {t('booking.refundRejectedTitle', {
                        defaultValue: 'Refund request declined',
                      })}
                    </p>
                    <p className="text-xs text-jadwal-danger/80 mt-0.5">
                      {t('booking.refundRejectedDesc', {
                        defaultValue:
                          'The vendor did not approve a refund for this cancellation.',
                      })}
                    </p>
                    {booking.refundDecisionNote ? (
                      <p className="text-xs text-jadwal-danger/90 mt-2 italic">
                        &ldquo;{booking.refundDecisionNote}&rdquo;
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* ── Details card ────────────────────────────────── */}
              <div className="rounded-2xl bg-jadwal-surface border border-jadwal-border-subtle shadow-jadwal overflow-hidden">
                <DetailRow
                  label={t('booking.activity', { defaultValue: 'Activity' })}
                >
                  <p className="text-sm font-semibold text-jadwal-text">
                    {booking.activity ? localized(booking.activity, 'title') : ''}
                  </p>
                </DetailRow>

                <div className="grid grid-cols-2 border-b border-jadwal-border-subtle">
                  <div className="px-5 py-4 border-e border-jadwal-border-subtle">
                    <p className="text-[11px] text-jadwal-text-muted uppercase tracking-[0.4px] mb-1">
                      {booking.activity?.bookingType === 'DAILY'
                        ? t('booking.checkIn')
                        : t('booking.date')}
                    </p>
                    <p
                      className="text-sm font-medium text-jadwal-text flex items-center gap-1.5"
                      suppressHydrationWarning
                    >
                      <Calendar
                        className="w-3.5 h-3.5 text-jadwal-text-muted"
                        aria-hidden="true"
                      />
                      {new Date(booking.startDatetime).toLocaleDateString(
                        locale,
                        { day: 'numeric', month: 'short', year: 'numeric' },
                      )}
                    </p>
                    {/* Show activity's fixed check-in time only for DAILY
                        bookings. For HOURLY the customer's own booked time
                        range is shown in the dedicated Time block below, so
                        echoing the activity's operating window here would be
                        redundant and misleading. */}
                    {booking.activity?.bookingType === 'DAILY' && booking.activity?.checkInTime ? (
                      <p className="text-xs text-jadwal-text-muted mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {booking.activity.checkInTime}
                      </p>
                    ) : null}
                  </div>
                  {booking.activity?.bookingType === 'DAILY' ? (
                    <div className="px-5 py-4">
                      <p className="text-[11px] text-jadwal-text-muted uppercase tracking-[0.4px] mb-1">
                        {t('booking.checkOut')}
                      </p>
                      <p
                        className="text-sm font-medium text-jadwal-text flex items-center gap-1.5"
                        suppressHydrationWarning
                      >
                        <Calendar
                          className="w-3.5 h-3.5 text-jadwal-text-muted"
                          aria-hidden="true"
                        />
                        {new Date(booking.endDatetime).toLocaleDateString(
                          locale,
                          { day: 'numeric', month: 'short', year: 'numeric' },
                        )}
                      </p>
                      {booking.activity?.checkOutTime ? (
                        <p className="text-xs text-jadwal-text-muted mt-0.5 flex items-center gap-1">
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          {booking.activity.checkOutTime}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="px-5 py-4">
                      <p className="text-[11px] text-jadwal-text-muted uppercase tracking-[0.4px] mb-1">
                        {t('booking.time')}
                      </p>
                      <p
                        className="text-sm font-medium text-jadwal-text flex items-center gap-1.5"
                        suppressHydrationWarning
                      >
                        <Clock
                          className="w-3.5 h-3.5 text-jadwal-text-muted"
                          aria-hidden="true"
                        />
                        {(() => {
                          const opts = {
                            hour: '2-digit' as const,
                            minute: '2-digit' as const,
                            hour12: false,
                            timeZone: 'UTC',
                          };
                          const startStr = new Date(booking.startDatetime).toLocaleTimeString(locale, opts);
                          const endStr = new Date(booking.endDatetime).toLocaleTimeString(locale, opts);
                          return `${startStr} — ${endStr}`;
                        })()}
                      </p>
                      {(() => {
                        const hours = Math.round(
                          (new Date(booking.endDatetime).getTime() -
                            new Date(booking.startDatetime).getTime()) /
                            (60 * 60 * 1000),
                        );
                        return hours > 0 ? (
                          <p className="text-xs text-jadwal-text-muted mt-0.5 ms-5">
                            {hours}h
                          </p>
                        ) : null;
                      })()}
                    </div>
                  )}
                </div>

                <div className="px-5 py-4 border-b border-jadwal-border-subtle flex items-center justify-between">
                  <div>
                    <p className="text-[11px] text-jadwal-text-muted uppercase tracking-[0.4px] mb-1">
                      {t('booking.guests')}
                    </p>
                    <p className="text-sm font-medium text-jadwal-text flex items-center gap-1.5">
                      <Users
                        className="w-3.5 h-3.5 text-jadwal-text-muted"
                        aria-hidden="true"
                      />
                      {booking.guests}{' '}
                      {booking.guests === 1
                        ? t('activity.person')
                        : t('activity.people')}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="text-[11px] text-jadwal-text-muted uppercase tracking-[0.4px] mb-1">
                      {t('booking.statusLabel')}
                    </p>
                    <Badge variant={statusVariant} size="sm">
                      {statusLabel}
                    </Badge>
                  </div>
                </div>

                {/* Per-booking phone — what the customer entered when
                    creating this booking. Shown read-only so they can
                    verify the vendor will call the right number. */}
                {booking.bookingPhone && (
                  <div className="px-5 py-4 border-b border-jadwal-border-subtle">
                    <p className="text-[11px] text-jadwal-text-muted uppercase tracking-[0.4px] mb-1">
                      {t('booking.bookingPhoneLabel', { defaultValue: 'Contact phone' })}
                    </p>
                    <p className="text-sm font-medium text-jadwal-text tabular-nums">
                      {booking.bookingPhone}
                    </p>
                  </div>
                )}

                {booking.activity?.locationAddress ? (
                  <DetailRow label={t('activity.location')}>
                    <p className="text-sm text-jadwal-text flex items-start gap-1.5">
                      <MapPin
                        className="w-3.5 h-3.5 text-jadwal-text-muted shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      {booking.activity.locationAddress}
                    </p>
                  </DetailRow>
                ) : null}

                <div className="px-5 py-4 space-y-2.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-jadwal-text-muted">
                      {t('booking.subtotal')}
                    </span>
                    <span className="text-jadwal-text font-medium tabular-nums">
                      {currency} {nominalSubtotal.toFixed(2)}
                    </span>
                  </div>
                  {couponValue > 0 ? (
                    <div className="flex justify-between text-sm">
                      <span className="text-jadwal-text-muted inline-flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('booking.couponDiscount', { defaultValue: 'Coupon' })}
                        {booking.couponCode ? ` · ${booking.couponCode}` : ''}
                      </span>
                      <span className="text-emerald-600 font-medium tabular-nums">
                        − {currency} {couponValue.toFixed(2)}
                      </span>
                    </div>
                  ) : null}
                  {pointsUsed > 0 ? (
                    <div className="flex justify-between text-sm">
                      <span className="text-jadwal-text-muted inline-flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-600" aria-hidden="true" />
                        {t('booking.pointsRedeemed', {
                          defaultValue: 'Wanasa points ({{n}})',
                          n: pointsUsed,
                        })}
                      </span>
                      <span className="text-purple-600 font-medium tabular-nums">
                        − {currency} {pointsValue.toFixed(2)}
                      </span>
                    </div>
                  ) : null}
                  {/* Service fee — hidden when 0 (Wanasa-funded bookings
                      waive it; some countries don't charge a fee at all).
                      Showing "QAR 0.00" as a line item just clutters the
                      breakdown. When points waived the fee, render a
                      badge so the customer knows it was a promotional
                      benefit rather than a config quirk. */}
                  {Number(booking.serviceFee) > 0 ? (
                    <div className="flex justify-between text-sm">
                      <span className="text-jadwal-text-muted">
                        {t('booking.serviceFee')}
                      </span>
                      <span className="text-jadwal-text font-medium tabular-nums">
                        {currency} {Number(booking.serviceFee).toFixed(2)}
                      </span>
                    </div>
                  ) : paidWithWanasa ? (
                    <div className="flex justify-between text-sm">
                      <span className="inline-flex items-center gap-1.5 text-purple-600">
                        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('booking.serviceFee')}
                      </span>
                      <span className="text-purple-600 font-medium">
                        {t('booking.feeWaived', { defaultValue: 'Waived with Wanasa' })}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex justify-between items-baseline pt-2.5 border-t border-jadwal-border-subtle">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-jadwal-text font-semibold">
                        {t('booking.youPaid', { defaultValue: 'You paid' })}
                      </span>
                      {paidWithWanasa ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-purple-100 text-purple-700">
                          <Sparkles className="w-3 h-3" aria-hidden="true" />
                          {t('booking.paidWithWanasa', { defaultValue: 'Wanasa' })}
                        </span>
                      ) : null}
                    </div>
                    <span className="font-display text-xl font-bold text-jadwal-text tabular-nums">
                      {currency} {(paidWithWanasa ? cashPaid : total).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Actions ─────────────────────────────────────── */}
              {booking.status === 'PENDING' && needsEmailOtp ? (
                <div className="space-y-2">
                  <div className="px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 text-sm text-blue-700 dark:text-blue-400">
                    {t('booking.emailOtp.verifyToPay')}
                  </div>
                  <Button
                    full
                    size="lg"
                    onClick={() => setShowEmailOtpModal(true)}
                  >
                    {t('booking.emailOtp.reopenCta')}
                  </Button>
                </div>
              ) : null}
              {booking.status === 'PENDING' && !needsEmailOtp ? (
                <PaymentButton bookingId={booking.id} />
              ) : null}

              {booking.status === 'PENDING' ? (
                <Button
                  full
                  variant="ghost"
                  onClick={handleCancelReservation}
                  disabled={cancelling}
                  loading={cancelling}
                  className="text-jadwal-danger hover:text-jadwal-danger"
                >
                  {cancelling
                    ? t('common.cancelling', { defaultValue: 'Cancelling…' })
                    : t('booking.cancel')}
                </Button>
              ) : null}

              {booking.status === 'CONFIRMED' ? (
                <div className="flex flex-col gap-2">
                  <Button
                    full
                    size="lg"
                    onClick={() => router.push('/bookings')}
                  >
                    {t('booking.backToBookings')}
                  </Button>
                  <Button
                    full
                    variant="ghost"
                    onClick={() => setShowCancelConfirm(true)}
                    className="text-jadwal-danger hover:text-jadwal-danger"
                  >
                    {t('booking.cancelThisBooking', {
                      defaultValue: 'Cancel this booking',
                    })}
                  </Button>
                </div>
              ) : null}

              {booking.status === 'CANCELLED' && booking.activity?.slug ? (
                <Button
                  full
                  size="lg"
                  onClick={() =>
                    router.push(`/activity/${booking.activity.slug}`)
                  }
                >
                  {t('booking.bookAgain')}
                </Button>
              ) : null}
            </motion.div>
          ) : null}
        </div>
      </main>

      <Footer />

      {/* ── Email-OTP verification modal — auto-opens for PENDING bookings ── */}
      {booking ? (
        <BookingEmailOtpModal
          isOpen={showEmailOtpModal}
          onClose={() => setShowEmailOtpModal(false)}
          onVerified={handleOtpVerified}
          bookingId={booking.id}
        />
      ) : null}

      {/* ── Wanasa points cancel confirmation popup ── */}
      {showCancelConfirm ? (
        <div
          className="fixed inset-0 z-9999 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-dialog-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-jadwal-surface rounded-2xl shadow-jadwal-lg border border-jadwal-border-subtle max-w-md w-full p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-jadwal-accent-soft">
                <AlertCircle
                  className="h-5 w-5 text-jadwal-accent-text"
                  aria-hidden="true"
                />
              </div>
              <h3
                id="cancel-dialog-title"
                className="text-lg font-semibold text-jadwal-text"
              >
                {t('booking.cancelConfirmTitle', {
                  defaultValue: 'Cancel this booking?',
                })}
              </h3>
            </div>

            <div className="space-y-3 mb-6">
              <p className="text-sm text-jadwal-text-muted">
                {t('booking.cancelConfirmIntro', {
                  defaultValue:
                    'If you cancel this booking, the refund will be reviewed by the vendor.',
                })}
              </p>
              <div className="rounded-xl bg-jadwal-accent-soft border border-[rgba(181,136,32,0.25)] p-4">
                <p className="text-sm font-semibold text-jadwal-accent-text mb-1">
                  {t('booking.refundToWanasaTitle', {
                    defaultValue: 'Refund goes to your Wanasa balance',
                  })}
                </p>
                <p className="text-xs text-jadwal-accent-text/90">
                  {t('booking.refundToWanasaDesc', {
                    defaultValue:
                      'Any approved refund amount will be converted to Wanasa loyalty points and added to your balance — not returned to your payment method.',
                  })}
                </p>
              </div>
              <p className="text-xs text-jadwal-text-muted">
                {t('booking.cancelReviewNote', {
                  defaultValue:
                    "The vendor will review your request and decide the refund amount based on the activity's cancellation policy.",
                })}
              </p>
            </div>

            <div className="flex items-center justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowCancelConfirm(false)}
                disabled={cancelling}
              >
                {t('booking.keepBooking', { defaultValue: 'Keep booking' })}
              </Button>
              <Button
                variant="danger"
                onClick={handleCancelReservation}
                disabled={cancelling}
                loading={cancelling}
              >
                {cancelling
                  ? t('common.cancelling', { defaultValue: 'Cancelling…' })
                  : t('booking.confirmCancel', {
                      defaultValue: 'Yes, cancel booking',
                    })}
              </Button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Payment Button Component ────────────────────────────────────────────────

function PaymentButton({ bookingId }: { bookingId: string }) {
  const { t } = useTranslation();
  const [initiating, setInitiating] = useState(false);
  const [pay2mData, setPay2mData] = useState<{
    formAction: string;
    formFields: Record<string, string>;
  } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { toast } = useToast();

  // Auto-submit the hidden form when PAY2M data is ready.
  // Re-validate the formAction immediately before submit as belt-and-suspenders:
  // even if pay2mData was set, refuse to navigate to an unexpected origin.
  useEffect(() => {
    if (pay2mData && formRef.current) {
      if (!isAllowedPay2mFormAction(pay2mData.formAction)) {
        setPay2mData(null);
        setInitiating(false);
        toast(
          t('booking.paymentBlocked', {
            defaultValue: 'Payment blocked: unrecognised gateway. Please try again.',
          }),
          'error',
        );
        return;
      }
      formRef.current.submit();
    }
  }, [pay2mData, t, toast]);

  const handlePay = async () => {
    setInitiating(true);
    try {
      const { data } = await api.post('/payment/initiate', { bookingId });
      // Refuse to render the auto-submitting form if the API returned a
      // formAction outside the PAY2M allowlist. Defends against compromised
      // backend / rogue proxy / response tampering even with CSP form-action.
      if (!data?.formAction || !isAllowedPay2mFormAction(data.formAction)) {
        toast(
          t('booking.paymentBlocked', {
            defaultValue: 'Payment blocked: unrecognised gateway. Please try again.',
          }),
          'error',
        );
        setInitiating(false);
        return;
      }
      setPay2mData(data);
    } catch (err) {
      toast(
        getApiError(err, 'Could not start payment. Please try again.'),
        'error',
      );
      setInitiating(false);
    }
  };

  return (
    <>
      <Button
        full
        size="lg"
        onClick={handlePay}
        disabled={initiating}
        loading={initiating}
      >
        {initiating
          ? t('booking.connectingPayment')
          : t('booking.proceedToPayment')}
      </Button>

      {/* Hidden form — auto-submits to PAY2M hosted checkout */}
      {pay2mData ? (
        <form
          ref={formRef}
          action={pay2mData.formAction}
          method="POST"
          className="hidden"
        >
          {Object.entries(pay2mData.formFields).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
        </form>
      ) : null}
    </>
  );
}
