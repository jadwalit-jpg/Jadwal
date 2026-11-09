import { BadRequestException } from '@nestjs/common';

/**
 * Cross-field validation for `minGuests` (the minimum number of guests charged
 * on a PER_PERSON listing; the booking still records the real guest count).
 *
 * The DTO already bounds the value to 1–500. This adds the rule the DTO cannot
 * see: on a PER_PERSON listing the minimum must not exceed what ONE booking can
 * hold, otherwise every booking is charged for guests who could never fit.
 *   • whole-unit listings (DAILY with units, or PER_UNIT with units): one
 *     booking takes one unit → limit = unitCapacity
 *   • seat-based listings with units: limit = unitCount × unitCapacity
 *   • no units: limit = capacity (null = unlimited)
 *
 * PER_UNIT (flat) listings ignore the minimum when pricing, so it is not
 * checked for them.
 *
 * Call it with the MERGED next state (DTO value ?? stored value) so a partial
 * PATCH is judged on what the activity will actually look like afterwards.
 */
export function assertMinGuestsConsistent(next: {
  minGuests?: number | null;
  pricingModel?: string | null;
  bookingType?: string | null;
  hasUnits?: boolean | null;
  unitCount?: number | null;
  unitCapacity?: number | null;
  capacity?: number | null;
}): void {
  const min = next.minGuests ?? 1;
  if (min <= 1) return;
  if (next.pricingModel === 'PER_UNIT') return;

  let limit: number | null;
  if (next.hasUnits) {
    const wholeUnit = next.bookingType === 'DAILY';
    limit = wholeUnit
      ? (next.unitCapacity ?? 1)
      : (next.unitCount ?? 0) * (next.unitCapacity ?? 1);
  } else {
    limit = next.capacity ?? null;
  }

  if (limit != null && min > limit) {
    throw new BadRequestException(
      `Minimum guests (${min}) cannot be more than one booking can hold (${limit})`,
    );
  }
}
