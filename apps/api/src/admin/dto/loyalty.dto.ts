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
 * Example historical bug: a `qarPerPoint` of 10 (instead of 0.1) made every
 * 1,000-point balance worth 10,000 QAR overnight, letting customers redeem
 * full-price experiences with a handful of points.
 *
 * Current production rates are ~1 point-per-QAR earn and ~0.01 QAR-per-point
 * spend. Both are clamped to ranges that are already generous (10× the
 * current values) but catastrophically cheaper than an unbounded `@Max(10000)`.
 *
 * Any change to these bounds MUST be paired with an audit entry and reviewed
 * by a second engineer — see PROD_CHECKLIST §19.
 */
export class UpdateLoyaltyConfigDto {
  /** Points earned per QAR spent. Typical: 1. Max 100 = very generous. */
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  pointsPerQar?: number;

  /** QAR discount per point redeemed. Typical: 0.01. Max 10 = 10× any sane
   *  rate. Anything higher is almost certainly a typo — reject it. */
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(10)
  qarPerPoint?: number;

  /** Minimum points a customer can redeem per booking. Typical: 100. */
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
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  delta!: number;

  /** Free-text reason — written to the ledger for audit. */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
