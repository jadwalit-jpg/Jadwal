import { IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Absolute upper bound for any single refund amount.
 *
 * Purpose: a sanity check against deserialisation overflow and obvious misuse
 * (e.g. someone typing `999999999`). The REAL upper bound — `amount ≤ paid` —
 * is enforced in the service layer against the live Payment row, NEVER here.
 *
 * Value rationale: the `Booking.totalPrice` / `Payment.amount` columns are
 * `Decimal(10, 2)` (max 99,999,999.99). A ten-million cap is well within that
 * range and represents "no single refund should ever exceed 10M of any
 * currency" — a reasonable business-layer sanity check.
 */
export const MAX_REFUND_AMOUNT = 10_000_000;

/** Max length of the vendor/admin note attached to a refund decision. */
export const MAX_REFUND_NOTE_LENGTH = 1000;

/**
 * Body for POST /bookings/:id/refund-decision.
 *
 * Security notes:
 *   - `action` is a strict enum — no "other" values possible
 *   - `amount` is validated to a non-negative number ≤ MAX_REFUND_AMOUNT
 *     but the real upper bound (≤ original payment amount) is enforced in
 *     the service layer against the DB row, not here
 *   - `note` is length-capped; XSS is handled by the global SanitizePipe
 *     before the DTO is constructed
 */
export class RefundDecisionDto {
  @IsEnum(['APPROVE', 'REJECT'] as const, {
    message: 'action must be APPROVE or REJECT',
  })
  action!: 'APPROVE' | 'REJECT';

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount must be a number with up to 2 decimal places' })
  @Min(0, { message: 'amount cannot be negative' })
  @Max(MAX_REFUND_AMOUNT, { message: 'amount is unrealistically large' })
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFUND_NOTE_LENGTH, { message: `note must be ${MAX_REFUND_NOTE_LENGTH} characters or fewer` })
  note?: string;
}
