import { IsOptional, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/[<>]/g, '').trim() : value)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(25)
  @Matches(/^\+?[0-9\s\-()]{7,20}$/, { message: 'Phone must be a valid number (7–20 digits)' })
  phone?: string;
}
