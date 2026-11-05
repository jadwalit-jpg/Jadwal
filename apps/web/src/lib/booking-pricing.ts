/**
 * Booking price preview: a copy of apps/api/src/bookings/pricing.ts, which is
 * the ONLY place the charged amount is decided. The server re-computes the
 * total when the booking is created and freezes it on the booking; the payment
 * amount is derived from that. This copy only lets the booking page show the
 * same number before the customer books.
 *
 * Both test suites run the same cases (apps/api/test/fixtures/
 * booking-pricing-cases.json). Change both files together.
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
