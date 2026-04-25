import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator';

export class CreateCityDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameEn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nameAr!: string;

  @IsString()
  @MaxLength(100)
  countryId!: string;
}

export class UpdateCityDto {
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
}
