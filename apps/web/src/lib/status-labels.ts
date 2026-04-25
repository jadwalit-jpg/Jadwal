/**
 * Translated labels for backend enum values.
 *
 * Replaces the scattered `const STATUS_CONFIG = { PENDING: 'Pending', ... }`
 * pattern across vendor + admin pages so status chips stay consistent and
 * localised in both EN and AR.
 *
 * Keys live under `status.*` in locales/en.json + ar.json. If the backend
 * enum gains a new value and the translation key is missing, `t(key)` falls
 * back to the raw key — so we never show a blank chip, but a missing key
 * will be visible to QA and caught by the locales parity test.
 */

import type { TFunction } from 'i18next';

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export type PaymentStatus =
  | 'PENDING'
  | 'SUCCESS'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'REJECTED'
  | 'FAILED';
export type PayoutStatus = 'UNPAID' | 'PAID';
export type VendorStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';
export type PayoutRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';

export function bookingStatusLabel(t: TFunction, s: BookingStatus | string): string {
  return t(`status.booking.${s}`, { defaultValue: s });
}

export function paymentStatusLabel(t: TFunction, s: PaymentStatus | string): string {
  return t(`status.payment.${s}`, { defaultValue: s });
}

export function payoutStatusLabel(t: TFunction, s: PayoutStatus | string): string {
  return t(`status.payout.${s}`, { defaultValue: s });
}

export function vendorStatusLabel(t: TFunction, s: VendorStatus | string): string {
  return t(`status.vendor.${s}`, { defaultValue: s });
}

export function payoutRequestStatusLabel(t: TFunction, s: PayoutRequestStatus | string): string {
  return t(`status.payoutRequest.${s}`, { defaultValue: s });
}
