import { IsString, IsOptional, IsEnum, IsNumber, Min, Max, MaxLength, MinLength, Matches } from 'class-validator';
import { Type } from 'class-transformer';

// Country-name character allow-list — defence-in-depth on top of React's
// JSX text-node auto-escaping. `\p{L}` matches Unicode letters across
// scripts (English, Arabic, etc.); `\p{M}` matches combining marks like
// the Arabic damma in `عُمان` and the circumflex in decomposed-form
// `Côte d'Ivoire`. Digits, whitespace, and the small set of real-world
// punctuation are also allowed (`-`, `'`, `(`, `)`, `,`, `.`). Rejects
// anything HTML/JS-shaped — `<`, `>`, `=`, `/`, `;`, `{`, `}`, etc. — so
// a compromised admin account can't plant XSS payloads in
// `countries.nameEn` / `nameAr` rows that downstream pages then render
// (the hero eyebrow being the obvious one).
const COUNTRY_NAME_REGEX = /^[\p{L}\p{M}0-9\s\-'(),.]+$/u;
const COUNTRY_NAME_MESSAGE = 'Country name may only contain letters, digits, spaces, and the punctuation - \' ( ) , .';

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
