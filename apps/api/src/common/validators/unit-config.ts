import { BadRequestException } from '@nestjs/common';

/**
 * Cross-field validation for an activity's UNIT configuration.
 *
 * WHY THIS EXISTS
 * ---------------
 * The DTOs validate each unit field in isolation:
 *
 *   @IsInt() @Min(0) @Max(10000) @IsOptional()  unitCount?: number;
 *   @IsInt() @Min(1) @Max(10000) @IsOptional()  unitCapacity?: number;
 *
 * Both optional, and `unitCount` accepts 0. Nothing connects them to
 * `hasUnits`. So `{ hasUnits: true }` with no unit count at all is accepted,
 * and the activity lands in a half-configured state the rest of the system
 * cannot represent. The admin form marks both fields required, but that is a
 * client-side asterisk — a direct API call, or any form bug, walks straight
 * past it. Reported 2026-09-12 from a screenshot of exactly that: the Units
 * toggle on, both boxes empty.
 *
 * WHAT HAPPENS WITHOUT THIS GUARD
 * -------------------------------
 * `hasUnits: true, unitCount: 0` makes the two halves of the system disagree:
 *
 *   getCalendarAvailability   capacity = unitCount = 0, so available is 0 and
 *                             EVERY day reports fully booked, forever
 *   createBooking             `if (hasUnits && unitCount > 0)` is false, so it
 *                             skips units entirely and falls back to the old
 *                             seat capacity — bookings still succeed
 *
 * The calendar says permanently closed while the booking path keeps selling.
 * Nothing errors, nothing logs, and the vendor's activity quietly stops
 * appearing bookable to customers who look at the calendar first.
 *
 * This mirrors `assertHourlyTimesConsistent`, which exists for the same reason
 * on the HOURLY side: a PATCH that turns a mode ON without supplying the fields
 * that mode requires must be rejected, not stored.
 *
 * Call it with the MERGED next state (DTO value ?? stored value) so a partial
 * PATCH is judged on what the activity will actually look like afterwards.
 */
export function assertUnitConfigConsistent(next: {
  hasUnits?: boolean | null;
  unitCount?: number | null;
  unitCapacity?: number | null;
}): void {
  // Units off → unitCount/unitCapacity are inert. Availability counts guests
  // against `capacity` and never reads them, so whatever they hold is
  // harmless and must stay editable.
  if (!next.hasUnits) return;

  if (next.unitCount == null || next.unitCount < 1) {
    throw new BadRequestException(
      'Number of Units is required and must be at least 1 when Units is enabled',
    );
  }

  if (next.unitCapacity == null || next.unitCapacity < 1) {
    throw new BadRequestException(
      'Capacity per Unit is required and must be at least 1 when Units is enabled',
    );
  }
}
