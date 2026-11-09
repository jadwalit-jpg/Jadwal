/**
 * Booking price math (base price only, before extras, coupons, points and the
 * service fee). This is the ONLY place the server decides how many guests are
 * charged and how a listing's price scales. `bookings.service` freezes the
 * result on the booking (`totalPrice`) and the payment amount is derived from
 * that same total, so the booking record and the payment always match.
 *
 * The web booking page mirrors this file in apps/web/src/lib/booking-pricing.ts
 * for its preview, and both test suites run the same cases. Change them
 * together.
 *
 * All amounts are integer cents.
 */

export type PricingModelValue = 'PER_PERSON' | 'PER_UNIT' | string;

/**
 * Number of guests the price is multiplied by.
 *   PER_UNIT (flat): 1 — guests and the minimum never change the price.
 *   PER_PERSON: max(guests, minGuests). The booking still records the real
 *   guest count; only the charge uses the minimum.
 */
export function chargedGuests(
  pricingModel: PricingModelValue,
  guests: number,
  minGuests: number | null | undefined,
): number {
  if (pricingModel === 'PER_UNIT') return 1;
  const min = Number.isInteger(minGuests) && (minGuests as number) > 1 ? (minGuests as number) : 1;
  return Math.max(guests, min);
}

/**
 * DAILY base price: the sum of each night's price (special-date price or the
 * base price), times the charged guests for PER_PERSON. PER_UNIT DAILY
 * listings (the default) are the plain sum, exactly as before.
 */
export function dailyBaseCents(
  nightCents: number[],
  pricingModel: PricingModelValue,
  guests: number,
  minGuests: number | null | undefined,
): number {
  const nightsTotal = nightCents.reduce((sum, c) => sum + c, 0);
  return nightsTotal * chargedGuests(pricingModel, guests, minGuests);
}

/**
 * HOURLY base price: the stored price covers `durationHours`; longer bookings
 * are pro-rata per hour, times the charged guests for PER_PERSON:
 *   round(priceCents × hoursBooked × chargedGuests / durationHours)
 */
export function hourlyBaseCents(
  priceCents: number,
  hoursBooked: number,
  durationHours: number,
  pricingModel: PricingModelValue,
  guests: number,
  minGuests: number | null | undefined,
): number {
  return Math.round(
    (priceCents * hoursBooked * chargedGuests(pricingModel, guests, minGuests)) / durationHours,
  );
}
