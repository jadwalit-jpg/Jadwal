'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import api from '@/lib/api';
import { getApiError } from '@/lib/api-error';
import DatePicker from '@/components/date-picker';
import {
  SETTLEMENT_LABEL,
  bookingLengthLabel,
  formatBookingWindow,
  signedAmount,
  type PriceDifferenceSettlement,
} from '@/lib/booking-reschedule';
import { bookingHasStarted } from './cancel-booking-modal';

/**
 * Admin "Change date" dialog.
 *
 * Two server round-trips, both to the admin API:
 *   1. GET  /admin/bookings/:id/reschedule-preview?checkInDate=&slotTime=
 *      → the new window (same length as today), the price for the new dates,
 *        the difference against what the customer was charged and which
 *        settlements the server accepts for it. Nothing is written.
 *   2. POST /admin/bookings/:id/reschedule
 *      → moves the booking; the server re-checks availability and the price
 *        and refuses (409) if either changed since the preview.
 *
 * Money is never edited here. When the new dates cost more or less, the admin
 * records how that difference was settled outside the website (or that it
 * was waived); the server stores it on the change record.
 *
 * Admin panel: English only, like every other admin page.
 */

export type ReschedulableBooking = {
  id: string;
  ref: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  startDatetime: string;
  endDatetime: string;
  guests: number;
  currencyCode: string;
  customer: { fullName: string };
  activity: { id: string; titleEn: string; bookingType: 'HOURLY' | 'DAILY' };
};

export type ReschedulePreviewResult = {
  bookingId: string;
  ref: string;
  bookingType: string;
  guests: number;
  currency: string;
  from: { startDatetime: string; endDatetime: string; unitNumber: number | null };
  to: { startDatetime: string; endDatetime: string; checkInDate: string; checkOutDate: string | null; slotTime: string | null; unitNumber: number | null };
  nights: number | null;
  hours: number | null;
  priceBefore: number;
  priceAfter: number;
  difference: number;
  settlementOptions: PriceDifferenceSettlement[];
};

type HourlySlot = { slotStart: string; slotEnd: string; available: number; isPast: boolean; isBlocked: boolean };

/**
 * Which bookings get the "Change date" action: confirmed (paid) and not
 * started yet. The server enforces the same rule.
 */
export function canAdminRescheduleBooking(b: { status: string; startDatetime: string }, now: Date = new Date()): boolean {
  return b.status === 'CONFIRMED' && !bookingHasStarted(b, now);
}

export const RESCHEDULE_REASON_MIN = 5;
export const RESCHEDULE_REASON_MAX = 500;

/** Pure form rule, so the Confirm button and the tests agree. */
export function rescheduleFormReady(args: {
  preview: ReschedulePreviewResult | null;
  reason: string;
  settlement: PriceDifferenceSettlement | '';
}): boolean {
  if (!args.preview) return false;
  const reason = args.reason.trim();
  if (reason.length < RESCHEDULE_REASON_MIN || reason.length > RESCHEDULE_REASON_MAX) return false;
  if (args.preview.difference !== 0 && !args.settlement) return false;
  return true;
}

/** Only the settlements the server accepts for this difference. */
export function settlementChoicesFor(preview: ReschedulePreviewResult | null): PriceDifferenceSettlement[] {
  return preview ? preview.settlementOptions : [];
}

export function RescheduleBookingModal({
  booking,
  onClose,
  onDone,
}: {
  booking: ReschedulableBooking;
  onClose: () => void;
  /** Called after a successful change with the server's message for the toast. */
  onDone: (message: string) => void;
}) {
  const currency = booking.currencyCode || 'QAR';
  const hourly = booking.activity.bookingType === 'HOURLY';
  const [checkInDate, setCheckInDate] = useState('');
  const [slotTime, setSlotTime] = useState('');
  const [reason, setReason] = useState('');
  const [settlement, setSettlement] = useState<PriceDifferenceSettlement | ''>('');
  const [settlementRef, setSettlementRef] = useState('');
  const [preview, setPreview] = useState<ReschedulePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Open start times on the chosen date, so the admin picks from what the
  // listing offers instead of guessing. The preview remains the authority
  // (it also checks the booking's full length fits).
  const slotsQuery = useQuery<HourlySlot[]>({
    queryKey: ['admin', 'reschedule-slots', booking.activity.id, checkInDate],
    queryFn: async () => {
      const { data } = await api.get(`/availability/hourly/${booking.activity.id}?date=${checkInDate}`);
      return (data?.slots ?? []) as HourlySlot[];
    },
    enabled: hourly && !!checkInDate,
    staleTime: 15_000,
  });

  const resetPreview = () => { setPreview(null); setSettlement(''); setError(null); };

  const previewMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({ checkInDate });
      if (hourly) params.set('slotTime', slotTime);
      const { data } = await api.get(`/admin/bookings/${booking.id}/reschedule-preview?${params}`);
      return data as ReschedulePreviewResult;
    },
    onSuccess: (data) => { setPreview(data); setSettlement(''); setError(null); },
    onError: (err) => { setPreview(null); setError(getApiError(err, 'Could not check these dates')); },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error('Check the new dates first');
      const body: Record<string, unknown> = {
        checkInDate,
        reason: reason.trim(),
        expectedDifference: preview.difference,
      };
      if (hourly) body.slotTime = slotTime;
      if (preview.difference !== 0) {
        body.settlement = settlement;
        if (settlementRef.trim()) body.settlementRef = settlementRef.trim();
      }
      const { data } = await api.post(`/admin/bookings/${booking.id}/reschedule`, body);
      return data;
    },
    onSuccess: () => {
      onDone(`Booking ${booking.ref} moved to ${preview ? formatBookingWindow(preview.to.startDatetime, preview.to.endDatetime, booking.activity.bookingType) : 'the new dates'}`);
    },
    onError: (err) => {
      // The slot or the price changed under us (409) or the server refused:
      // show why and make the admin check again before another attempt.
      setError(getApiError(err, 'Could not change the date'));
      setPreview(null);
      setSettlement('');
    },
  });

  const pending = previewMutation.isPending || confirmMutation.isPending;
  const canPreview = !!checkInDate && (!hourly || !!slotTime) && !pending;
  const ready = rescheduleFormReady({ preview, reason, settlement }) && !pending;
  const reasonTooShort = reason.trim().length > 0 && reason.trim().length < RESCHEDULE_REASON_MIN;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-reschedule-title"
        onKeyDown={(e) => { if (e.key === 'Escape' && !pending) onClose(); }}
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 max-w-lg w-full max-h-[92vh] overflow-y-auto"
      >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
              <CalendarClock className="h-5 w-5" aria-hidden="true" />
            </div>
            <h3 id="admin-reschedule-title" className="text-lg font-bold text-gray-900 dark:text-white">Change date</h3>
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
              <dt className="text-gray-500 dark:text-slate-400">Current dates</dt>
              <dd className="font-medium text-gray-900 dark:text-white text-end" data-testid="reschedule-current">
                {formatBookingWindow(booking.startDatetime, booking.endDatetime, booking.activity.bookingType)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 dark:text-slate-400">Length kept</dt>
              <dd className="font-medium text-gray-900 dark:text-white text-end">
                {bookingLengthLabel(booking.startDatetime, booking.endDatetime, booking.activity.bookingType)} · {booking.guests} guest{booking.guests === 1 ? '' : 's'}
              </dd>
            </div>
          </dl>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">
                {hourly ? 'New date' : 'New check-in date'}
              </label>
              <DatePicker
                value={checkInDate}
                onChange={(v) => { setCheckInDate(v); setSlotTime(''); resetPreview(); }}
                disablePast
                placeholder="Pick a date"
              />
            </div>
            {hourly && (
              <div>
                <label htmlFor="reschedule-slot" className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">New start time</label>
                <select
                  id="reschedule-slot"
                  value={slotTime}
                  onChange={(e) => { setSlotTime(e.target.value); resetPreview(); }}
                  disabled={!checkInDate || slotsQuery.isLoading}
                  className="w-full px-3 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white disabled:opacity-50"
                >
                  <option value="">{!checkInDate ? 'Pick a date first' : slotsQuery.isLoading ? 'Loading times…' : 'Choose a start time'}</option>
                  {(slotsQuery.data ?? []).map((s) => {
                    const full = s.available < booking.guests;
                    const unusable = s.isPast || s.isBlocked || full;
                    const note = s.isPast ? ' (past)' : s.isBlocked ? ' (closed)' : full ? ` (${s.available} left)` : '';
                    return (
                      <option key={s.slotStart} value={s.slotStart} disabled={unusable}>
                        {s.slotStart}{note}
                      </option>
                    );
                  })}
                </select>
                {slotsQuery.isError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Could not load the open times for this date.</p>}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-xs text-gray-500 dark:text-slate-400">
              {hourly ? 'The booking keeps its length and guests; the end time follows.' : 'The booking keeps its nights and guests; the check-out follows.'}
            </p>
            <button
              type="button"
              onClick={() => previewMutation.mutate()}
              disabled={!canPreview}
              className="shrink-0 px-3 py-2 text-xs font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 disabled:opacity-40"
            >
              {previewMutation.isPending ? 'Checking…' : 'Check availability and price'}
            </button>
          </div>

          {error && (
            <p role="alert" className="mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 px-4 py-3 text-sm text-red-700 dark:text-red-300" data-testid="reschedule-error">
              {error}
            </p>
          )}

          {preview && (
            <div className="mb-4 rounded-xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-900/10 p-4 text-sm space-y-1.5" data-testid="reschedule-preview">
              <div className="flex justify-between gap-4">
                <span className="text-gray-500 dark:text-slate-400">New dates</span>
                <span className="font-semibold text-gray-900 dark:text-white text-end">{formatBookingWindow(preview.to.startDatetime, preview.to.endDatetime, booking.activity.bookingType)}</span>
              </div>
              {preview.to.unitNumber != null && (
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500 dark:text-slate-400">Unit</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {preview.from.unitNumber != null && preview.from.unitNumber !== preview.to.unitNumber ? `${preview.from.unitNumber} → ${preview.to.unitNumber}` : preview.to.unitNumber}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-gray-500 dark:text-slate-400">Activity price</span>
                <span className="font-medium text-gray-900 dark:text-white tabular-nums">
                  {currency} {preview.priceBefore.toFixed(2)} → {preview.priceAfter.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-500 dark:text-slate-400">Difference</span>
                <span
                  className={`font-semibold tabular-nums ${preview.difference > 0 ? 'text-amber-700 dark:text-amber-400' : preview.difference < 0 ? 'text-blue-700 dark:text-blue-400' : 'text-gray-900 dark:text-white'}`}
                  data-testid="reschedule-difference"
                >
                  {signedAmount(preview.difference, currency)}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 pt-1">
                {preview.difference === 0
                  ? 'Same price on the new dates. Nothing to settle.'
                  : preview.difference > 0
                    ? 'The new dates cost more. The stored totals and the payment are not changed; record how the customer paid the difference.'
                    : 'The new dates cost less. The stored totals and the payment are not changed; record how the customer was refunded.'}
              </p>
            </div>
          )}

          {preview && preview.difference !== 0 && (
            <fieldset className="mb-4" data-testid="reschedule-settlement">
              <legend className="text-xs font-semibold text-gray-600 dark:text-slate-300 mb-2">How was the difference settled?</legend>
              <div className="space-y-2">
                {settlementChoicesFor(preview).map((opt) => (
                  <label key={opt} className="flex items-start gap-2.5 text-sm text-gray-800 dark:text-slate-200 cursor-pointer">
                    <input
                      type="radio"
                      name="reschedule-settlement"
                      value={opt}
                      checked={settlement === opt}
                      onChange={() => setSettlement(opt)}
                      disabled={pending}
                      className="mt-0.5 accent-blue-600"
                    />
                    <span>{SETTLEMENT_LABEL[opt]}</span>
                  </label>
                ))}
              </div>
              {settlement && settlement !== 'WAIVED' && (
                <div className="mt-2">
                  <label htmlFor="reschedule-settlement-ref" className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Reference (optional)</label>
                  <input
                    id="reschedule-settlement-ref"
                    type="text"
                    value={settlementRef}
                    onChange={(e) => setSettlementRef(e.target.value.slice(0, 200))}
                    placeholder="Transfer number, receipt, card link…"
                    disabled={pending}
                    className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white"
                  />
                </div>
              )}
            </fieldset>
          )}

          <div className="mb-5">
            <label htmlFor="reschedule-reason" className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Reason (kept on the booking, admin-only)</label>
            <textarea
              id="reschedule-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, RESCHEDULE_REASON_MAX))}
              rows={2}
              placeholder="Customer asked by phone to move the trip…"
              disabled={pending}
              className={`w-full px-3 py-2.5 bg-white dark:bg-slate-800 border rounded-xl text-sm text-gray-900 dark:text-white ${reasonTooShort ? 'border-red-400' : 'border-gray-200 dark:border-slate-700'}`}
            />
            {reasonTooShort && <p className="mt-1 text-xs text-red-600 dark:text-red-400">At least {RESCHEDULE_REASON_MIN} characters.</p>}
          </div>

          <p className="text-sm text-gray-600 dark:text-slate-400 mb-5">
            The customer and the vendor are notified by email and in the app. The old dates become available again.
          </p>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              autoFocus
              onClick={onClose}
              disabled={pending}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              Keep dates
            </button>
            <button
              type="button"
              onClick={() => confirmMutation.mutate()}
              disabled={!ready}
              title={!preview ? 'Check the new dates first' : !rescheduleFormReady({ preview, reason, settlement }) ? 'Add a reason and, if the price changed, how it was settled' : undefined}
              className="px-4 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-50 bg-blue-600 hover:bg-blue-700"
            >
              {confirmMutation.isPending ? 'Changing…' : 'Change date'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
