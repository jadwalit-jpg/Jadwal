import { IsString, IsOptional, IsNumber, Min, Max, MaxLength, MinLength, IsEmail } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePlatformSettingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultCommissionPct?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  platformName?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  @MaxLength(255)
  supportEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  supportPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  aboutText?: string;
}
