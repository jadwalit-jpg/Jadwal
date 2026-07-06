import { IsString, IsOptional, IsNumber, Min, Max, MaxLength, MinLength, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameEn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameAr!: string;

  // URL slug — used as the `?category=` filter key. Same format contract as the
  // vendor/activity slugs (lowercase a-z/0-9/hyphen); no reserved-word check needed
  // here since it's a query param, not a route segment.
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Matches(/^[a-z0-9-]+$/, { message: 'URL slug may only contain lowercase letters, numbers, and hyphens' })
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  image?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPct?: number | null;
}

export class UpdateCategoryDto {
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
  @MinLength(1)
  @MaxLength(60)
  @Matches(/^[a-z0-9-]+$/, { message: 'URL slug may only contain lowercase letters, numbers, and hyphens' })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  image?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPct?: number | null;
}
