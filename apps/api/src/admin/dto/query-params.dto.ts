import { IsOptional, IsString, IsInt, Min, Max, IsIn, MaxLength, Matches } from 'class-validator';
import { Type } from 'class-transformer';

const PAYMENT_STATUSES = [
  'PENDING', 'SUCCESS', 'FAILED', 'REFUND_PENDING', 'REFUNDED', 'REJECTED',
] as const;

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  // Bound search-string length so a flooded query string cannot turn into a
  // DB-level pattern-match cost spike. 200 chars is generous for a user
  // searching by activity title or vendor name.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  // PaginationDto is shared across vendors / activities / users / bookings /
  // payouts / coupons / reviews — each context has its own status enum
  // (VendorStatus, ActivityStatus, BookingStatus, etc.). Per-call IsEnum
  // would be ideal but breaks the shared shape, so we use a permissive
  // enum-shape pattern: UPPERCASE_SNAKE_CASE, max 50 chars. Bounds DoS +
  // rejects garbage input without coupling the DTO to a specific domain.
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z_]+$/, { message: 'status must be UPPERCASE_SNAKE_CASE' })
  status?: string;

  // Filter /admin/users by User.role (the users page's role dropdown sends
  // this). `role` is the accurate name; getUsers still accepts `status` as a
  // backward-compat fallback (it historically carried the role value).
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z_]+$/, { message: 'role must be UPPERCASE_SNAKE_CASE' })
  role?: string;

  // Filter by Payment.status — used by the admin refund queue page to show
  // only REFUND_PENDING bookings. Strict allowlist so arbitrary strings
  // can't reach the Prisma query.
  @IsOptional()
  @IsIn(PAYMENT_STATUSES as unknown as string[])
  paymentStatus?: string;

  // Filter by User.emailVerified — used by /admin/users to split confirmed
  // signups from pending ones (token sent, link not yet clicked). String
  // values rather than booleans because the source is a query string.
  @IsOptional()
  @IsIn(['verified', 'unverified'])
  verified?: 'verified' | 'unverified';

  // /admin/users hides soft-deleted (anonymised "Deleted User") rows by
  // default. 'true' reveals them so an admin can audit the retained
  // financial/audit trail. String value because the source is a query string.
  @IsOptional()
  @IsIn(['true', 'false'])
  includeDeleted?: 'true' | 'false';
}
