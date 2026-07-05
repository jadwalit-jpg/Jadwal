import {
  IsNumber,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';

/**
 * Loyalty configuration bounds — TIGHT by design.
 *
 * A typo on any of these numbers drains the platform treasury instantly.
 * Example historical bug: a `qarPerPoint` of 100 (instead of 1) would make
 * every point worth 100 QAR overnight, letting customers redeem full-price
 * experiences with a handful of points.
 *
 * Current production model is "1 point = 1 QAR": earn pointsPerQar = 0.01
 * (1% of cash paid → 100 QAR earns 1.00 point) and redeem qarPerPoint = 1.0
 * (a point is worth 1 QAR). Both are clamped to ranges that are generous but
 * catastrophically cheaper than an unbounded `@Max(10000)`.
 *
 * Any change to these bounds MUST be paired with an audit entry and reviewed
 * by a second engineer — see PROD_CHECKLIST §19.
 */
export class UpdateLoyaltyConfigDto {
  /** Points earned per QAR spent. Typical: 0.01 (= 1% of cash paid). Max 100. */
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  pointsPerQar?: number;

  /** QAR discount per point redeemed. Typical: 1.0 (1 point = 1 QAR). Max 10 =
   *  10× the sane rate. Anything higher is almost certainly a typo — reject it. */
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(10)
  qarPerPoint?: number;

  /** Minimum points (= QAR at 1 pt = 1 QAR) a customer can redeem per booking.
   *  Typical: 1. */
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(100_000)
  minRedemption?: number;
}

/**
 * Admin manual adjustment to a user's point balance. Bounded on both sides
 * to prevent a compromised admin (or a typo) from making anyone a
 * billionaire or zeroing a rival's balance. Env-configurable so the cap can
 * be tightened without a code change.
 */
export class AdjustUserPointsDto {
  // Points are QAR-denominated (1 point = 1 QAR), so an admin may adjust by a
  // fractional amount (2 dp) — e.g. +0.50 to credit half a riyal.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-1_000_000)
  @Max(1_000_000)
  delta!: number;

  /** Free-text reason — written to the ledger for audit. */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
