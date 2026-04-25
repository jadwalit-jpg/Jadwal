import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsOptional,
  IsDateString,
  Min,
  Max,
  MaxLength,
  Matches,
} from 'class-validator';

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
  discountValue!: number;

  @IsDateString()
  validFrom!: string;

  @IsDateString()
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
}
