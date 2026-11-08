'use client';

import { XCircle } from 'lucide-react';

/**
 * Admin "Cancel booking" confirmation.
 *
 * Confirms the existing admin cancel, PATCH /admin/bookings/:id/status with
 * CANCELLED. The server does everything else exactly as it always has: stamps
 * who and when, frees the slot, refunds a paid amount to the customer as
 * Wanasa points (not to the card), returns any redeemed Wanasa points, marks a
 * pending payment as failed, and notifies the customer. This dialog only
 * spells that out before the click.
 *
 * The admin panel is English-only, like every other admin page.
 */

export type CancelableBooking = {
  id: string;
  ref: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  startDatetime: string;
  totalPrice: string;
  currencyCode: string;
  /** Wanasa points the customer redeemed on this booking (0 = none). */
  pointsRedeemed: number;
  customer: { fullName: string };
  activity: { titleEn: string; bookingType: 'HOURLY' | 'DAILY' };
  /** A points-only booking has amount 0, status SUCCESS, method WANASA_POINTS. */
  payment: { amount: string; status: string; method?: string } | null;
};

/**
 * Which bookings get the "Cancel booking" action. The same two statuses the
 * vendor panel allows (PENDING, CONFIRMED): a completed booking has already
 * happened and a cancelled one has nothing left to cancel.
 */
export function canAdminCancelBooking(b: { status: string }): boolean {
  return b.status === 'PENDING' || b.status === 'CONFIRMED';
}

/** Cash the customer actually paid: the payment amount when it succeeded, else 0. */
export function paidAmount(b: Pick<CancelableBooking, 'payment'>): number {
  return b.payment?.status === 'SUCCESS' ? Number(b.payment.amount) : 0;
}

/**
 * Wanasa points the server will return on cancel. They were debited when the
 * booking was created and come back whenever the booking has a payment row,
 * which every points-funded booking has (points-only ones get a synthetic
 * SUCCESS payment of 0).
 */
export function pointsReturned(b: Pick<CancelableBooking, 'payment' | 'pointsRedeemed'>): number {
  return b.payment ? Number(b.pointsRedeemed) || 0 : 0;
}

/** Same date format the bookings table uses (booking times are stored as local wall-clock tagged UTC). */
export function formatBookingDate(b: Pick<CancelableBooking, 'startDatetime' | 'activity'>): string {
  const d = new Date(b.startDatetime);
  return b.activity.bookingType === 'HOURLY'
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** "QAR 505", "QAR 405 + 100 Wanasa points", "500 Wanasa points" or "Not paid yet". */
export function amountPaidLabel(b: Pick<CancelableBooking, 'payment' | 'pointsRedeemed' | 'currencyCode'>): string {
  const currency = b.currencyCode || 'QAR';
  const cash = paidAmount(b);
  const points = pointsReturned(b);
  const parts: string[] = [];
  if (cash > 0) parts.push(`${currency} ${cash.toLocaleString()}`);
  if (points > 0) parts.push(`${points.toLocaleString()} Wanasa points`);
  return parts.length ? parts.join(' + ') : 'Not paid yet';
}

export function CancelBookingModal({
  booking,
  pending,
  onConfirm,
  onClose,
}: {
  booking: CancelableBooking;
  pending: boolean;
  onConfirm: (bookingId: string) => void;
  onClose: () => void;
}) {
  const currency = booking.currencyCode || 'QAR';
  const cash = paidAmount(booking);
  const points = pointsReturned(booking);
  const paymentPending = booking.payment?.status === 'PENDING';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-cancel-booking-title"
        onKeyDown={(e) => { if (e.key === 'Escape' && !pending) onClose(); }}
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 max-w-md w-full"
      >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
              <XCircle className="h-5 w-5" aria-hidden="true" />
            </div>
            <h3 id="admin-cancel-booking-title" className="text-lg font-bold text-gray-900 dark:text-white">
              Cancel booking
            </h3>
          </div>

          <dl className="mb-4 rounded-xl bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 p-4 text-sm space-y-1.5">
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 dark:text-slate-400">Booking</dt>
              <dd className="font-mono font-semibold text-gray-900 dark:text-white">{booking.ref}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 dark:text-slate-400">Customer</dt>
              <dd className="font-medium text-gray-900 dark:text-white text-end">{booking.customer.fullName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 dark:text-slate-400">Activity</dt>
              <dd className="font-medium text-gray-900 dark:text-white text-end">{booking.activity.titleEn}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 dark:text-slate-400">Date</dt>
              <dd className="font-medium text-gray-900 dark:text-white text-end">{formatBookingDate(booking)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 dark:text-slate-400">Amount paid</dt>
              <dd className="font-semibold text-gray-900 dark:text-white text-end">{amountPaidLabel(booking)}</dd>
            </div>
          </dl>

          <p className="text-sm text-gray-600 dark:text-slate-400 mb-5">
            The customer will be notified and the date becomes available again.
            {cash > 0 && (
              <> The paid amount ({currency} {cash.toLocaleString()}) is refunded to the customer as Wanasa points, not to their card.</>
            )}
            {points > 0 && (
              <> The {points.toLocaleString()} redeemed Wanasa points are returned to the customer.</>
            )}
            {paymentPending && <> The pending payment is marked as failed.</>}
            {' '}This cannot be undone.
          </p>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              autoFocus
              onClick={onClose}
              disabled={pending}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              Keep booking
            </button>
            <button
              type="button"
              onClick={() => onConfirm(booking.id)}
              disabled={pending}
              className="px-4 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-50 bg-red-600 hover:bg-red-700"
            >
              {pending ? 'Cancelling…' : 'Cancel booking'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
