import { IsString, IsEnum, IsNumber, IsOptional, IsInt, IsDateString, IsArray, IsUUID, Min, Max, MaxLength, MinLength, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { IsValidCouponDiscount } from '../../common/validators/coupon-discount';

export class CreateCouponDto {
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[A-Z0-9_-]+$/, { message: 'code must be uppercase alphanumeric (A-Z, 0-9, _, -)' })
  code!: string;

  @IsEnum(['PERCENTAGE', 'FIXED'])
  discountType!: 'PERCENTAGE' | 'FIXED';

  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'discountValue must be greater than 0' })
  @Max(100000)
  @IsValidCouponDiscount() // PERCENTAGE coupons capped at 100
  discountValue!: number;

  @IsDateString()
  validFrom!: string;

  @IsDateString()
  validTo!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  usageLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  minOrderAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  maxDiscount?: number;

  // Activity scoping (Bug A): when non-empty, the coupon is valid ONLY for these
  // activity ids; empty/omitted = applies to all. Admin coupons may scope to any
  // activity (vendor coupons are restricted to the vendor's own — see vendor svc).
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  activityIds?: string[];
}
