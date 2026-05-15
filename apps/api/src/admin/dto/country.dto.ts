import { IsString, IsOptional, IsEnum, IsNumber, Min, Max, MaxLength, MinLength, Matches } from 'class-validator';
import { Type, Transform } from 'class-transformer';
// Shared name-allowlist constants — same regex now reused by city.dto.ts so
// every short identifier field uses the same defence-in-depth XSS allow-list.
// Activity titles use the slightly looser `ACTIVITY_TITLE_REGEX` from the
// same module.
import { COUNTRY_NAME_REGEX, COUNTRY_NAME_MESSAGE } from '../../common/validators/name-allowlist';

export class CreateCountryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(COUNTRY_NAME_REGEX, { message: COUNTRY_NAME_MESSAGE })
  nameEn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(COUNTRY_NAME_REGEX, { message: COUNTRY_NAME_MESSAGE })
  nameAr!: string;

  // ISO 3166-1 alpha-2 (QA, DE, JO) or alpha-3 (QAT, DEU, JOR). MUST be
  // uppercase — `geoip-lite` always returns uppercase, so a lowercase value
  // here breaks the production geo-detect lookup (caused the "Germany
  // visitor sees Qatar events" bug). Trim + uppercase on ingest so admin
  // form casing never drifts the data.
  @IsString()
  @MinLength(2)
  @MaxLength(3)
  @Matches(/^[A-Z]{2,3}$/, { message: 'isoCode must be 2 or 3 uppercase letters (e.g. DE, QA, QAT)' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  isoCode!: string;

  // ISO 4217 currency code (QAR, EUR, USD). Uppercase by spec — same
  // ingest normalisation as isoCode above.
  @IsString()
  @MinLength(2)
  @MaxLength(5)
  @Matches(/^[A-Z]{2,5}$/, { message: 'currencyCode must be 2-5 uppercase letters (e.g. QAR, EUR)' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  currencyCode!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  vatPercentage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10000)
  serviceFeeFixed?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  defaultTimezone?: string;

  @IsOptional()
  @IsEnum(['ACTIVE', 'HIDDEN'])
  status?: 'ACTIVE' | 'HIDDEN';
}

export class UpdateCountryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(COUNTRY_NAME_REGEX, { message: COUNTRY_NAME_MESSAGE })
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(COUNTRY_NAME_REGEX, { message: COUNTRY_NAME_MESSAGE })
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(5)
  @Matches(/^[A-Z]{2,5}$/, { message: 'currencyCode must be 2-5 uppercase letters (e.g. QAR, EUR)' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  currencyCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  vatPercentage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10000)
  serviceFeeFixed?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  defaultTimezone?: string;

  @IsOptional()
  @IsEnum(['ACTIVE', 'HIDDEN'])
  status?: 'ACTIVE' | 'HIDDEN';
}
