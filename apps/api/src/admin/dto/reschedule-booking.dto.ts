import { IsEnum, IsNumber, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/** How a price difference from a date change was settled. Mirrors Prisma enum PriceDifferenceSettlement. */
export const PRICE_DIFFERENCE_SETTLEMENTS = ['PAID_OUTSIDE', 'REFUNDED_OUTSIDE', 'WAIVED'] as const;
export type PriceDifferenceSettlementValue = (typeof PRICE_DIFFERENCE_SETTLEMENTS)[number];

export const RESCHEDULE_REASON_MIN = 5;
export const RESCHEDULE_REASON_MAX = 500;
export const SETTLEMENT_REF_MAX = 200;

/**
 * GET /admin/bookings/:id/reschedule-preview?checkInDate=YYYY-MM-DD&slotTime=HH:MM
 *
 * The new dates. The booking keeps its length: a 2-night stay stays 2 nights
 * from the new check-in, a 3-hour slot stays 3 hours from the new start time.
 * `slotTime` is required for HOURLY activities and ignored for DAILY ones.
 */
export class ReschedulePreviewQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'checkInDate must be a date (YYYY-MM-DD)' })
  checkInDate!: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'slotTime must be a time (HH:MM)' })
  slotTime?: string;
}

/**
 * POST /admin/bookings/:id/reschedule
 *
 * Same dates as the preview plus:
 *   reason             why the date changed (kept on the record, admin-only)
 *   expectedDifference the price difference the admin was shown; the server
 *                      recomputes it and refuses (409) when it changed
 *   settlement         required when the difference is not 0: how the money
 *                      moved outside the website (or that it did not)
 *   settlementRef      optional transfer number / receipt / note
 */
export class RescheduleBookingDto extends ReschedulePreviewQueryDto {
  @IsString()
  @Length(RESCHEDULE_REASON_MIN, RESCHEDULE_REASON_MAX, {
    message: `reason must be between ${RESCHEDULE_REASON_MIN} and ${RESCHEDULE_REASON_MAX} characters`,
  })
  reason!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'expectedDifference must be a number with up to 2 decimal places' })
  expectedDifference!: number;

  @IsOptional()
  @IsEnum(PRICE_DIFFERENCE_SETTLEMENTS, { message: 'settlement must be PAID_OUTSIDE, REFUNDED_OUTSIDE or WAIVED' })
  settlement?: PriceDifferenceSettlementValue;

  @IsOptional()
  @IsString()
  @MaxLength(SETTLEMENT_REF_MAX, { message: `settlementRef must be ${SETTLEMENT_REF_MAX} characters or fewer` })
  settlementRef?: string;
}
