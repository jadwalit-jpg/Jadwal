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
  PER_UNIT = 'PER_UNIT',
}

enum ActivityStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  BLOCKED = 'BLOCKED',
}

class ExtraServiceItem {
  @IsString()
  @IsNotEmpty()
  name!: string;

  /**
   * Arabic name — optional, mirrors the vendor-side
   * ExtraServiceItem.nameAr. Pre-bilingual rows have this missing and
   * fall back to `name` for the Arabic locale. MaxLength matches the
   * vendor DTO so PATCH and POST stay symmetric.
   */
  @IsString()
  @IsOptional()
  @MaxLength(200)
  nameAr?: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsBoolean()
  perPerson!: boolean;
}

export class UpdateActivityDto {
  @IsString() @IsNotEmpty() @MaxLength(200) @Matches(ACTIVITY_TITLE_REGEX, { message: ACTIVITY_TITLE_MESSAGE }) @IsOptional()
  titleEn?: string;

  @IsString() @IsNotEmpty() @MaxLength(200) @Matches(ACTIVITY_TITLE_REGEX, { message: ACTIVITY_TITLE_MESSAGE }) @IsOptional()
  titleAr?: string;

  @IsString() @IsNotEmpty() @MaxLength(120) @IsOptional()
  slug?: string;

  @IsString() @IsNotEmpty() @MaxLength(5000) @IsOptional()
  descriptionEn?: string;

  @IsString() @IsNotEmpty() @MaxLength(5000) @IsOptional()
  descriptionAr?: string;

  @IsString() @IsNotEmpty() @IsOptional()
  categoryId?: string;

  @IsString() @IsOptional()
  subCategoryId?: string;

  @IsNumber() @Min(0) @IsOptional()
  pricePerPerson?: number;

  @IsEnum(BookingType) @IsOptional()
  bookingType?: BookingType;

  @IsInt() @Min(1) @IsOptional()
  durationValue?: number;

  @IsEnum(PricingModel) @IsOptional()
  pricingModel?: PricingModel;

  // Must align to the 30-min booking-slot grid (:00 or :30) — off-grid → unbookable (KAN-12).
  @IsString() @IsOptional()
  @Matches(/^([01]\d|2[0-3]):(00|30)$/, { message: 'checkInTime must be on the hour or half-hour (HH:00 or HH:30)' })
  checkInTime?: string;

  @IsString() @IsOptional()
  @Matches(/^([01]\d|2[0-3]):(00|30)$/, { message: 'checkOutTime must be on the hour or half-hour (HH:00 or HH:30)' })
  checkOutTime?: string;

  @IsInt() @Min(1) @Max(10000) @IsOptional()
  capacity?: number;

  @IsNumber() @IsOptional()
  locationLat?: number;

  @IsNumber() @IsOptional()
  locationLng?: number;

  @IsString() @IsNotEmpty() @MaxLength(500) @IsOptional()
  locationAddress?: string;

  @IsString() @IsNotEmpty() @IsOptional()
  cityId?: string;

  @IsString() @IsOptional()
  coverImage?: string;

  @IsArray() @IsString({ each: true }) @IsOptional()
  gallery?: string[];

  @IsString() @MaxLength(2000) @IsOptional()
  cancellationPolicy?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ExtraServiceItem) @ArrayMaxSize(50)
  extraServices?: ExtraServiceItem[];

  @IsArray() @IsString({ each: true }) @IsOptional()
  activeDays?: string[];

  @IsBoolean() @IsOptional()
  hasUnits?: boolean;

  @IsInt() @Min(0) @IsOptional()
  unitCount?: number;

  @IsInt() @Min(1) @IsOptional()
  unitCapacity?: number;

  @IsEnum(ActivityStatus) @IsOptional()
  status?: ActivityStatus;
}
