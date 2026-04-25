import { IsEmail, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class ResendVerificationDto {
  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;
}
