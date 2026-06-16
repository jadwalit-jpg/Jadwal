import { IsOptional, IsString, IsNotEmpty, IsBoolean, IsArray, ArrayMaxSize, Matches } from 'class-validator';

// YYYY-MM-DD — same shape as create-booking.dto.ts (rejects 2026-13-45 at the
// regex level; full calendar validity re-checked with isValidDate in the service).
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
// HH:MM 24-hour. Slots align to the activity's checkInTime, which may be off the
// hour, so we accept any minute.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Create a vendor availability "block" on one activity.
 *
 * - DAILY activity  → block whole day(s): `date` (+ optional `endDate` range).
 * - HOURLY activity → block whole day(s) (default), OR specific START-TIME slots
 *   on one `date` via `slotTimes` (each "HH:MM"). A slot lock makes ONLY a
 *   booking that STARTS at that time unbookable — bookings that start earlier
 *   and run across it are still accepted.
 * - `repeatWeekly` → whole-day weekday recurrence (incompatible with slotTimes).
 *
 * Format-only validation here. Domain rules (real calendar date, endDate ≥ date,
 * slotTimes only on HOURLY, not-in-the-past, no duplicate) are enforced in
 * VendorService where the activity's bookingType is known.
 */
export class CreateActivityBlockDto {
  @IsString()
  @IsNotEmpty()
  @Matches(DATE_RE, { message: 'date must be a valid YYYY-MM-DD date' })
  date!: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'endDate must be a valid YYYY-MM-DD date' })
  endDate?: string;

  // Specific start-time slots to lock (HOURLY only), e.g. ["12:00","15:00"].
  // Each becomes a 1-hour [t, t+60min) row; only a booking STARTING at t is
  // rejected. Mutually exclusive with whole-day / repeatWeekly.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(48)
  @Matches(TIME_RE, { each: true, message: 'each slot time must be HH:MM (24-hour)' })
  slotTimes?: string[];

  // When true, block the WHOLE day for every weekday spanned by [date, endDate],
  // every week for the next 6 months. Whole-day only — incompatible with slotTimes.
  @IsOptional()
  @IsBoolean()
  repeatWeekly?: boolean;
}
