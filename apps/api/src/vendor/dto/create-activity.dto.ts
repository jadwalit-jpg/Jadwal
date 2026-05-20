import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsInt,
  IsEnum,
  IsOptional,
  IsArray,
  IsBoolean,
  Min,
  Max,
  MaxLength,
  Matches,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ACTIVITY_TITLE_REGEX, ACTIVITY_TITLE_MESSAGE } from '../../common/validators/name-allowlist';

enum BookingType {
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
}

enum PricingModel {
  PER_PERSON = 'PER_PERSON',
  PER_UNIT   = 'PER_UNIT',
}

export class ExtraServiceItem {
  /**
   * English name — the stable identifier. Booking-time matching of
   * `selectedExtras` runs against this field, so it must NOT be renamed
   * after a vendor publishes (else in-flight bookings lose their reference).
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  /**
   * Arabic name — optional. Displayed to Arabic-locale customers in place
   * of `name`. Existing extras created before bilingual support are missing
   * this field and just fall back to `name` for both languages.
   */
  @IsString()
  @IsOptional()
  @MaxLength(200)
  nameAr?: string;

  @IsNumber()
  @Min(0)
  @Max(100000)
  price!: number; // 0 = free inclusion, >0 = paid add-on

  @IsBoolean()
  @IsOptional()
  perPerson?: boolean; // true = price × guests, false/undefined = flat per booking
}

export class CreateActivityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(ACTIVITY_TITLE_REGEX, { message: ACTIVITY_TITLE_MESSAGE })
  titleEn!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(ACTIVITY_TITLE_REGEX, { message: ACTIVITY_TITLE_MESSAGE })
  titleAr!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  descriptionEn!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  descriptionAr!: string;

  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsString()
  @IsOptional()
  subCategoryId?: string;

  @IsNumber()
  @Min(0)
  pricePerPerson!: number;

  @IsEnum(BookingType)
  bookingType!: BookingType;

  // HOURLY: fixed duration in hours; DAILY fixed: nights; null = flexible DAILY
  @IsInt()
  @Min(1)
  @IsOptional()
  durationValue?: number;

  @IsEnum(PricingModel)
  @IsOptional()
  pricingModel?: PricingModel;

  // HOURLY: activity start/end time ("14:00"); DAILY: check-in/check-out time
  @IsString()
  @IsOptional()
  checkInTime?: string;

  @IsString()
  @IsOptional()
  checkOutTime?: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  @IsOptional()
  capacity?: number;

  @IsNumber()
  locationLat!: number;

  @IsNumber()
  locationLng!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  locationAddress!: string;

  @IsString()
  @IsNotEmpty()
  cityId!: string;

  @IsString()
  @IsOptional()
  coverImage?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  gallery?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  cancellationPolicy?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraServiceItem)
  @ArrayMaxSize(50)
  extraServices?: ExtraServiceItem[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  activeDays?: string[];

  // Units
  @IsBoolean()
  @IsOptional()
  hasUnits?: boolean;

  @IsInt()
  @Min(0)
  @Max(10000)
  @IsOptional()
  unitCount?: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  @IsOptional()
  unitCapacity?: number;
}
