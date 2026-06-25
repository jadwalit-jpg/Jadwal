import { IsString, IsOptional, IsArray, ArrayMaxSize, Matches, IsNumber, IsPositive, Max } from 'class-validator';

// YYYY-MM-DD — same shape as the single-date DTO. Calendar validity + horizon
// are re-checked per date in the shared core.
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Set ONE special price across MANY dates in a single request (vendor or admin).
 *
 * Accepts an explicit `dates` list and/or an inclusive `startDate`..`endDate`
 * range; the service expands + de-dupes them and applies `price` to each inside
 * one transaction (atomic — a single bad date rolls the whole batch back). This
 * replaces firing one request per date, which tripped the per-minute rate limit.
 *
 * Bounded to 200 dates total (ArrayMaxSize on the list + a span cap on the range)
 * so one request can't open an unbounded transaction.
 */
export class BulkSpecialPriceDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200, { message: 'Cannot set more than 200 dates at once' })
  @Matches(DATE_RE, { each: true, message: 'each date must be a valid YYYY-MM-DD date' })
  dates?: string[];

  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'startDate must be a valid YYYY-MM-DD date' })
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'endDate must be a valid YYYY-MM-DD date' })
  endDate?: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'price must be a number with at most 2 decimal places' })
  @IsPositive({ message: 'price must be greater than 0' })
  @Max(1_000_000, { message: 'price is unreasonably high' })
  price!: number;
}
