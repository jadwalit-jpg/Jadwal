import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator';
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

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  // Filter by Payment.status — used by the admin refund queue page to show
  // only REFUND_PENDING bookings. Strict allowlist so arbitrary strings
  // can't reach the Prisma query.
  @IsOptional()
  @IsIn(PAYMENT_STATUSES as unknown as string[])
  paymentStatus?: string;
}
