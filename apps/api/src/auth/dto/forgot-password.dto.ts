import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class ForgotPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254)
  @Transform(({ value }) => value?.trim().toLowerCase())
  email!: string;
}
