import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength, IsOptional, Matches, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { IsStrongPassword } from '../../common/validators/password-strength';
import { IsNotDisposableEmail } from '../../common/validators/disposable-email';

export class RegisterVendorDto {
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  @MinLength(2, { message: 'Full name must be at least 2 characters' })
  @MaxLength(100, { message: 'Full name is too long' })
  // `\P{Nd}` (capital P) matches anything EXCEPT a decimal digit across
  // every script — rejects ASCII 0-9 AND Arabic-Indic ٠-٩ together. Real
  // personal names don't contain digits in any script. Defence-in-depth
  // server-side: the frontend has the same check in `validateFullName`,
  // this DTO is the canonical authority.
  @Matches(/^\P{Nd}*$/u, { message: 'Full name cannot contain numbers' })
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/[<>]/g, '').trim() : value)
  fullName!: string;

  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(254, { message: 'Email is too long' })
  @IsNotDisposableEmail()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password is too long' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  // zxcvbn-backed strength check.
  @IsStrongPassword()
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Business name (English) is required' })
  @MaxLength(200, { message: 'Business name is too long' })
  businessNameEn!: string;

  @IsString()
  @IsNotEmpty({ message: 'Business name (Arabic) is required' })
  @MaxLength(200, { message: 'Business name is too long' })
  businessNameAr!: string;

  @IsString()
  @IsNotEmpty({ message: 'Business ID is required' })
  @MaxLength(50, { message: 'Business ID is too long' })
  businessId!: string;

  @IsString()
  @IsNotEmpty({ message: 'URL slug is required' })
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must contain only lowercase letters, numbers, and hyphens' })
  @MaxLength(60, { message: 'Slug is too long' })
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Phone must be 7–15 digits, optionally starting with +' })
  phone?: string;

  @IsUUID('4', { message: 'Invalid country' })
  @IsNotEmpty({ message: 'Country is required' })
  countryId!: string;

  // Honeypot field — see RegisterDto.website for full rationale. No
  // @IsString / @MaxLength: strict validators would turn a bot's filled
  // honeypot into a 400 instead of the silent fake-success the service
  // path issues — making the honeypot observable.
  @IsOptional()
  @Transform(({ value }) => value == null ? undefined : String(value))
  website?: string;
}
