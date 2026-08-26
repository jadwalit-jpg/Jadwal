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
import { ExtraServiceItem } from './create-activity.dto';
import { ACTIVITY_TITLE_REGEX, ACTIVITY_TITLE_MESSAGE } from '../../common/validators/name-allowlist';

enum BookingType {
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
}

enum PricingModel {
  PER_PERSON = 'PER_PERSON',
  PER_UNIT   = 'PER_UNIT',
}

export class UpdateActivityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(ACTIVITY_TITLE_REGEX, { message: ACTIVITY_TITLE_MESSAGE })
  @IsOptional()
  titleEn?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(ACTIVITY_TITLE_REGEX, { message: ACTIVITY_TITLE_MESSAGE })
  @IsOptional()
  titleAr?: string;

  // NO `slug` FIELD ON PURPOSE. A slug is a permanent public URL: changing it
  // breaks every existing link — a bookmark, a WhatsApp share, Google's index
  // entry — because nothing records the old address. Vendors may rename their
  // activity freely (titleEn/titleAr above); the URL stays put.
  //
  // Admins CAN still correct a slug via the admin endpoint, which is the escape
  // hatch for the handful that were generated wrong before slugify was fixed.
  // ValidationPipe runs with forbidNonWhitelisted, so a vendor POSTing `slug`
  // is REJECTED rather than silently ignored — the field being absent here is
  // the enforcement, not just documentation.

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  @IsOptional()
  descriptionEn?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  @IsOptional()
  descriptionAr?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  subCategoryId?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  pricePerPerson?: number;

  @IsEnum(BookingType)
  @IsOptional()
  bookingType?: BookingType;

  @IsInt()
  @Min(1)
  @IsOptional()
  durationValue?: number;

  @IsEnum(PricingModel)
  @IsOptional()
  pricingModel?: PricingModel;

  // Format only (any valid HH:MM). The 30-min-grid rule for HOURLY is enforced in
  // assertHourlyTimesConsistent so DAILY check-in/out isn't over-restricted.
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'checkInTime must be a valid time (HH:MM)' })
  checkInTime?: string;

  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'checkOutTime must be a valid time (HH:MM)' })
  checkOutTime?: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  @IsOptional()
  capacity?: number;

  @IsNumber()
  @IsOptional()
  locationLat?: number;

  @IsNumber()
  @IsOptional()
  locationLng?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @IsOptional()
  locationAddress?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  cityId?: string;

  @IsString()
  @IsOptional()
  coverImage?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  gallery?: string[];

  @IsString()
  @MaxLength(2000)
  @IsOptional()
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
