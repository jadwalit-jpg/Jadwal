/**
 * Admin date change ("reschedule") display helpers, shared by the admin
 * bookings page, its Change-date dialog and the payout / bookings CSV exports.
 *
 * Booking datetimes are the activity's local wall-clock time tagged UTC (see
 * buildDatetime on the API), so every formatter reads them with timeZone 'UTC'.
 * Admin panel: English only.
 */

export type PriceDifferenceSettlement = 'PAID_OUTSIDE' | 'REFUNDED_OUTSIDE' | 'WAIVED';

export type BookingRescheduleRecord = {
  createdAt: string;
  fromStartDatetime: string;
  fromEndDatetime: string;
  toStartDatetime: string;
  toEndDatetime: string;
  fromUnitNumber?: number | null;
  toUnitNumber?: number | null;
  priceBefore?: string | number;
  priceAfter?: string | number;
  priceDifference: string | number;
  settlement: PriceDifferenceSettlement | null;
  settlementRef?: string | null;
  reason?: string;
  adminName?: string;
};

export const SETTLEMENT_LABEL: Record<PriceDifferenceSettlement, string> = {
  PAID_OUTSIDE: 'Paid by the customer outside the website',
  REFUNDED_OUTSIDE: 'Refunded to the customer outside the website',
  WAIVED: 'Waived (no money moved)',
};

const dateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });

export function bookingNights(start: string | Date, end: string | Date): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
}

export function bookingHours(start: string | Date, end: string | Date): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000));
}

/** "2 hours" for a slot, "2 nights" for a stay. */
export function bookingLengthLabel(start: string | Date, end: string | Date, bookingType: string): string {
  if (bookingType === 'HOURLY') {
    const h = bookingHours(start, end);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const n = bookingNights(start, end);
  return `${n} night${n === 1 ? '' : 's'}`;
}

/**
 * "Sun, 20 Dec 2026, 10:00–12:00" for a slot;
 * "Sun, 20 Dec 2026 → Tue, 22 Dec 2026 (2 nights)" for a stay.
 */
export function formatBookingWindow(start: string | Date, end: string | Date, bookingType: string): string {
  const s = new Date(start);
  const e = new Date(end);
  if (bookingType === 'HOURLY') return `${dateFmt.format(s)}, ${timeFmt.format(s)}–${timeFmt.format(e)}`;
  return `${dateFmt.format(s)} → ${dateFmt.format(e)} (${bookingLengthLabel(s, e, bookingType)})`;
}

/** "+QAR 100.00", "−QAR 50.00", "QAR 0.00". */
export function signedAmount(amount: number | string, currency: string): string {
  const n = Number(amount) || 0;
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${currency} ${Math.abs(n).toFixed(2)}`;
}

/** One line for a change's money: "No price change" or "+QAR 100.00 · Paid … (ref TRF 1)". */
export function settlementText(change: Pick<BookingRescheduleRecord, 'priceDifference' | 'settlement' | 'settlementRef'>, currency: string): string {
  const diff = Number(change.priceDifference) || 0;
  if (diff === 0) return 'No price change';
  const how = change.settlement ? SETTLEMENT_LABEL[change.settlement] : 'Not recorded';
  const ref = change.settlementRef ? ` (ref ${change.settlementRef})` : '';
  return `${signedAmount(diff, currency)} · ${how}${ref}`;
}

/** The admin row's one-line summary of the latest change. */
export function dateChangeSummary(change: BookingRescheduleRecord, bookingType: string, currency: string): string {
  const when = dateFmt.format(new Date(change.createdAt));
  const unit = change.fromUnitNumber != null && change.toUnitNumber != null && change.fromUnitNumber !== change.toUnitNumber
    ? ` · unit ${change.fromUnitNumber} → ${change.toUnitNumber}`
    : '';
  return `Moved on ${when} by ${change.adminName ?? 'admin'}: was ${formatBookingWindow(change.fromStartDatetime, change.fromEndDatetime, bookingType)}${unit} · ${settlementText(change, currency)}`;
}

export type RescheduleCsvColumns = {
  DateChanged: string;
  OriginalDates: string;
  PriceDifference: string;
  DifferenceSettled: string;
};

/**
 * CSV columns for a booking's date changes (newest first as the API returns
 * them, or any order). Empty strings when the booking was never moved, so the
 * export's shape does not depend on the data.
 *   DateChanged       date of the latest change
 *   OriginalDates     the window the customer first booked and paid for
 *   PriceDifference   sum of all differences (what finance must reconcile)
 *   DifferenceSettled every change's settlement, oldest first
 */
export function rescheduleCsvColumns(
  reschedules: ReadonlyArray<BookingRescheduleRecord> | null | undefined,
  bookingType: string,
  currency: string,
): RescheduleCsvColumns {
  if (!reschedules || reschedules.length === 0) {
    return { DateChanged: '', OriginalDates: '', PriceDifference: '', DifferenceSettled: '' };
  }
  const sorted = [...reschedules].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const total = sorted.reduce((sum, r) => sum + (Number(r.priceDifference) || 0), 0);
  return {
    DateChanged: new Date(last.createdAt).toISOString().slice(0, 10),
    OriginalDates: formatBookingWindow(first.fromStartDatetime, first.fromEndDatetime, bookingType),
    PriceDifference: total.toFixed(2),
    DifferenceSettled: sorted.map((r) => settlementText(r, currency)).join('; '),
  };
}
