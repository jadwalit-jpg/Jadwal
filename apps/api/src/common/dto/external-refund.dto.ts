import { IsEnum, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** How a refund was paid back outside the website. Mirrors Prisma enum RefundMethod. */
export const REFUND_METHODS = ['BANK_TRANSFER', 'CASH', 'CARD_PAY2M', 'OTHER'] as const;
export type RefundMethodValue = (typeof REFUND_METHODS)[number];

/** Same sanity ceiling as RefundDecisionDto (the real bound, ≤ cash paid, is checked against the Payment row). */
export const MAX_EXTERNAL_REFUND_AMOUNT = 10_000_000;
export const MAX_REFUND_REFERENCE_LENGTH = 200;

/**
 * "Refund already done outside the website": the admin refunded the customer
 * by bank transfer / cash / a card refund in PAY2M / another way, and records
 * it here so the booking can be cancelled (or the refund request approved)
 * with NO Wanasa points credited for the cash part.
 *
 * Accepted on:
 *   PATCH /admin/bookings/:id/status  (status must be CANCELLED)
 *   POST  /bookings/:id/refund-decision (action must be APPROVE, admin only)
 *
 * The service layer checks the business rules the DTO cannot: the booking
 * has a successful cash payment above 0, amount ≤ cash paid, refundedOn not
 * in the future (activity timezone), caller role.
 */
export class ExternalRefundDto {
  @IsEnum(REFUND_METHODS, { message: 'method must be BANK_TRANSFER, CASH, CARD_PAY2M or OTHER' })
  method!: RefundMethodValue;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount must be a number with up to 2 decimal places' })
  @Min(0.01, { message: 'amount must be above 0' })
  @Max(MAX_EXTERNAL_REFUND_AMOUNT, { message: 'amount is unrealistically large' })
  amount!: number;

  /** Calendar date the refund was made, YYYY-MM-DD. Not in the future. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'refundedOn must be a date (YYYY-MM-DD)' })
  refundedOn!: string;

  /** Optional transfer number / receipt / note. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REFUND_REFERENCE_LENGTH, { message: `reference must be ${MAX_REFUND_REFERENCE_LENGTH} characters or fewer` })
  reference?: string;
}
