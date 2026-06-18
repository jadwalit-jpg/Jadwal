import { IsString, IsNotEmpty, Matches, IsNumber, IsPositive, Max } from 'class-validator';

// YYYY-MM-DD — same shape as the block + booking DTOs (rejects 2026-13-45 at the
// regex level; full calendar validity is re-checked with isValidDate in the core).
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Set a per-date special price on one activity (vendor or admin flow).
 *
 * The activity's effective price on `date` becomes `price` instead of
 * `pricePerPerson`. Format-only validation here; domain rules (real calendar
 * date, not-in-the-past, within the booking horizon, price bounds) are enforced
 * in the shared core where they can't drift between vendor and admin.
 */
export class CreateSpecialPriceDto {
  @IsString()
  @IsNotEmpty()
  @Matches(DATE_RE, { message: 'date must be a valid YYYY-MM-DD date' })
  date!: string;

  // Positive, ≤ 2 decimals, with a sane upper bound so a fat-finger / abuse
  // can't store an absurd Decimal. Matches the Decimal(10,2) column.
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'price must be a number with at most 2 decimal places' })
  @IsPositive({ message: 'price must be greater than 0' })
  @Max(1_000_000, { message: 'price is unreasonably high' })
  price!: number;
}
