import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsOptional,
  IsDateString,
  IsArray,
  IsUUID,
  Min,
  Max,
  MaxLength,
  Matches,
} from 'class-validator';
import { IsValidCouponDiscount } from '../../common/validators/coupon-discount';
import { IsDateAfter } from '../../common/validators/is-date-after';

export class CreateVendorCouponDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_-]+$/i, { message: 'Coupon code must be alphanumeric with hyphens or underscores' })
  code!: string;

  @IsEnum(['PERCENTAGE', 'FIXED'])
  discountType!: 'PERCENTAGE' | 'FIXED';

  @IsNumber()
  @Min(0)
  @Max(10000)
  @IsValidCouponDiscount() // PERCENTAGE coupons capped at 100
  discountValue!: number;

  @IsDateString()
  validFrom!: string;

  @IsDateString()
  @IsDateAfter('validFrom', { message: 'validTo must be after validFrom' })
  validTo!: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100000)
  usageLimit?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  minOrderAmount?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  maxDiscount?: number;

  // The vendor coupons UI lets the vendor scope the coupon to specific
  // activities (or leave empty = applies to all). The form always sends an
  // array (empty when no scoping). Currently the service ignores it; storing
  // the scoping is a follow-up — for now just whitelist the field so the
  // global ValidationPipe (`forbidNonWhitelisted: true`) doesn't reject the
  // request.
  @IsArray()
  @IsOptional()
  @IsUUID('all', { each: true })
  activityIds?: string[];
}
