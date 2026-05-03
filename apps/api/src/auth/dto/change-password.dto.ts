import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from 'class-validator';
import { IsStrongPassword } from '../../common/validators/password-strength';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one digit',
  })
  @IsStrongPassword()
  newPassword!: string;
}
