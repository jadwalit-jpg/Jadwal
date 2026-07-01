import { IsString, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { IsStrongPassword } from '../../common/validators/password-strength';

export class UpdateAdminProfileDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  // Positive whitelist — letters of any script (Arabic + accented Latin),
  // combining marks, spaces, hyphen, apostrophe, period; first char a letter.
  // Rejects digits AND symbols like @$#$.
  @Matches(/^[\p{L}\p{M}][\p{L}\p{M}\s'’.\-]*$/u, {
    message: 'Full name may only contain letters, spaces, hyphens and apostrophes',
  })
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/[<>]/g, '').trim() : value)
  fullName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;
}

export class ChangeAdminPasswordDto {
  // Old password is just compared via bcrypt — we don't need to enforce
  // strength on it (it's whatever the user set previously). But we MUST
  // bound the length so an attacker can't ship a multi-MB string and
  // burn server CPU through bcrypt's input-handling. 128 matches the
  // newPassword cap for symmetry; bcrypt itself silently truncates at
  // 72 bytes anyway, so 128 is generous.
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
  // zxcvbn-backed strength check — admin passwords get the same gate.
  @IsStrongPassword()
  newPassword!: string;
}
