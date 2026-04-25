import { IsString, IsOptional, IsEnum, IsNumber, Min, Max, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCountryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameEn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
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
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
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
