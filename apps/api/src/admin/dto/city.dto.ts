import { IsString, IsOptional, MaxLength, MinLength, Matches } from 'class-validator';
import { COUNTRY_NAME_REGEX, COUNTRY_NAME_MESSAGE } from '../../common/validators/name-allowlist';

export class CreateCityDto {
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
  @MaxLength(100)
  countryId!: string;
}

export class UpdateCityDto {
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
}
