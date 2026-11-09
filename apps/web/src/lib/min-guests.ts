/**
 * Form-side check for "Minimum guests" (vendor wizard, vendor edit, admin
 * edit). Mirrors apps/api/src/common/validators/min-guests.ts, which is the
 * rule the server enforces; this only gives the vendor the error before saving.
 *
 * On a PER_PERSON listing the minimum must be 1–500 and must not exceed what
 * ONE booking can hold:
 *   • DAILY with units: one booking takes one unit → unitCapacity
 *   • HOURLY with units (seats): unitCount × unitCapacity
 *   • no units: capacity (empty = unlimited)
 * PER_UNIT listings ignore the minimum, so nothing is checked for them.
 */
export type MinGuestsContext = {
  pricingModel: string;
  bookingType: string;
  hasUnits: boolean;
  unitCount: number;
  unitCapacity: number;
  capacity: number | null;
};

export type MinGuestsError = { kind: 'range' } | { kind: 'overCapacity'; max: number } | null;

export function minGuestsLimit(c: MinGuestsContext): number | null {
  if (c.hasUnits) {
    return c.bookingType === 'DAILY'
      ? (c.unitCapacity || 1)
      : (c.unitCount || 0) * (c.unitCapacity || 1);
  }
  return c.capacity && c.capacity > 0 ? c.capacity : null;
}

export function validateMinGuests(value: string | number, c: MinGuestsContext): MinGuestsError {
  if (c.pricingModel === 'PER_UNIT') return null;
  if (value === '' || value == null) return null; // empty = 1 (no minimum)
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 500) return { kind: 'range' };
  const max = minGuestsLimit(c);
  if (n > 1 && max != null && n > max) return { kind: 'overCapacity', max };
  return null;
}

/** Value to send to the API: the minimum for PER_PERSON, 1 for PER_UNIT. */
export function minGuestsPayload(value: string | number, pricingModel: string): number {
  if (pricingModel === 'PER_UNIT') return 1;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
