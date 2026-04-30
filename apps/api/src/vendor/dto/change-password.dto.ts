import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { IsStrongPassword } from '../../common/validators/password-strength';

export class ChangePasswordDto {
  // See ChangeAdminPasswordDto — same MaxLength rationale (DoS guard
  // around bcrypt.compare input). Cap mirrored across both flows.
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  // zxcvbn-backed strength check — same rule as RegisterDto.
  @IsStrongPassword()
  newPassword!: string;
}
