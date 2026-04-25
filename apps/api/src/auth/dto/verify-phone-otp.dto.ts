import { IsString, Length, Matches } from 'class-validator';

export class VerifyPhoneOtpDto {
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, { message: 'OTP must be 6 digits' })
  code!: string;
}
