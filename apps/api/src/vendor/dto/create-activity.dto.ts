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
import { IsNotReservedSlug } from '../../common/validators/reserved-slug';
import { CreateActivityBlockDto } from './create-activity-block.dto';
import { CreateSpecialPriceDto } from './create-special-price.dto';

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

  // URL slug — same contract as the vendor slug: lowercase a-z/0-9/hyphen only,
  // and not a reserved system word (admin, api, login, …). Prevents an activity
  // slug from carrying spaces/unicode or squatting a reserved route name.
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(/^[a-z0-9-]+$/, { message: 'URL slug may only contain lowercase letters, numbers, and hyphens' })
  @IsNotReservedSlug()
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

  // HOURLY: activity start/end time; DAILY: check-in/check-out time. Format only
  // here (any valid HH:MM). The 30-min-grid rule for HOURLY (:00/:30) is enforced
  // in assertHourlyTimesConsistent, so DAILY (a day boundary, not a slot grid) can
  // use any minute without being blocked.
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

  // ── Optional availability LOCKS + SPECIAL PRICES set DURING create. The add
  // wizard collects the exact same shapes the live sub-resource endpoints accept;
  // createActivity processes them atomically (same transaction) via the SAME core
  // logic the standalone endpoints use, so validation/expansion can't drift.
  // Bounded so a nested-create payload stays sane.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateActivityBlockDto)
  @ArrayMaxSize(200)
  blocks?: CreateActivityBlockDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSpecialPriceDto)
  @ArrayMaxSize(200)
  specialPrices?: CreateSpecialPriceDto[];
}
