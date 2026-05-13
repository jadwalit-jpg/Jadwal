import { IsString, IsOptional, IsEnum, IsNumber, Min, Max, MaxLength, MinLength, Matches } from 'class-validator';
import { Type } from 'class-transformer';
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

  @IsString()
  @MinLength(2)
  @MaxLength(3)
  isoCode!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(5)
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
