import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator';
import { IsStrongPassword } from '../../common/validators/password-strength';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-f0-9]{64}$/, { message: 'Invalid reset token' })
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one digit',
  })
  // zxcvbn-backed strength check — same rule as RegisterDto.
  @IsStrongPassword()
  newPassword!: string;
}
