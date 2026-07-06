import { BadRequestException } from '@nestjs/common';

/**
 * Cross-field validation for HOURLY activities — duration must fit inside the
 * operating window. Used by admin + vendor activity update flows.
 *
 * Called with the MERGED next-state fields (dto value OR existing value) so
 * partial updates (e.g. only durationValue) still validate against the full
 * resulting activity.
 *
 * Throws BadRequestException on any incompatibility. Never logs user input.
 */
export function assertHourlyTimesConsistent(next: {
  bookingType?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  durationValue?: number | null;
}): void {
  if (next.bookingType !== 'HOURLY') return;

  // For HOURLY, ALL three time fields are mandatory. A PATCH that flips
  // bookingType → HOURLY without supplying them must be rejected — otherwise
  // the activity lands in a half-configured state where availability / booking
  // / calendar endpoints crash with "Activity configuration incomplete". When
  // validating MERGED next-state values, the caller passes DTO ?? current, so
  // a missing field here means neither the DTO nor the stored row has one.
  if (!next.checkInTime) {
    throw new BadRequestException('HOURLY activities require checkInTime (HH:MM)');
  }
  if (!next.checkOutTime) {
    throw new BadRequestException('HOURLY activities require checkOutTime (HH:MM)');
  }
  if (next.durationValue == null) {
    throw new BadRequestException('HOURLY activities require durationValue (hours)');
  }

  // HOURLY slots step on the :00/:30 grid (HOURLY_SLOT_GRANULARITY_MINUTES), so the
  // operating-window bounds must align too — an off-grid checkInTime makes every
  // generated slot off-grid and unbookable (the booking DTO only accepts :00/:30).
  // Enforced HERE, not in the DTO regex, so DAILY (early-returned above) keeps any
  // valid HH:MM: its check-in/out is a day boundary, not a slot grid.
  const ALIGNED = /^([01]\d|2[0-3]):(00|30)$/;
  if (!ALIGNED.test(next.checkInTime)) {
    throw new BadRequestException('HOURLY checkInTime must be on the hour or half-hour (HH:00 or HH:30)');
  }
  if (!ALIGNED.test(next.checkOutTime)) {
    throw new BadRequestException('HOURLY checkOutTime must be on the hour or half-hour (HH:00 or HH:30)');
  }

  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) {
      throw new BadRequestException('Invalid time format — must be HH:MM');
    }
    return h * 60 + m;
  };

  const startMins = toMinutes(next.checkInTime);
  const endMins = toMinutes(next.checkOutTime);
  const durationMins = next.durationValue * 60;

  if (endMins <= startMins) {
    throw new BadRequestException('checkOutTime must be after checkInTime');
  }
  if (durationMins <= 0) {
    throw new BadRequestException('durationValue must be greater than 0');
  }
  if (durationMins > endMins - startMins) {
    throw new BadRequestException(
      'durationValue exceeds the operating window (checkOutTime - checkInTime)',
    );
  }
}
