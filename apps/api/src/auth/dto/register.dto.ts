import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength, IsOptional, Matches, IsBoolean, Equals } from 'class-validator';
import { Transform } from 'class-transformer';
import { IsStrongPassword } from '../../common/validators/password-strength';
import { IsNotDisposableEmail } from '../../common/validators/disposable-email';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  // `\P{Nd}` (capital P) matches anything EXCEPT a decimal digit across
  // every script — rejects ASCII 0-9 AND Arabic-Indic ٠-٩. Real personal
  // names don't contain digits; this is the server-side authority for
  // the same rule enforced client-side by `validateFullName`.
  @Matches(/^\P{Nd}*$/u, { message: 'Full name cannot contain numbers' })
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/[<>]/g, '').trim() : value)
  fullName!: string;

  @IsEmail()
  @MaxLength(254)
  @IsNotDisposableEmail()
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  email!: string;

  // Password rules:
  //   - min 8 / max 128 chars (length-based DoS guard at 128)
  //   - must contain a mix of upper / lower / digit (regex)
  //   - must score >= 3 on zxcvbn (penalises common, leaked, or
  //     personal-info-based passwords like "Password123!" or
  //     "Loaek2026" — see common/validators/password-strength.ts)
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  @IsStrongPassword()
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^\+?[0-9\s\-()]{7,20}$/, { message: 'Invalid phone number' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  phone?: string;

  // Honeypot field. Real users never see or fill this — it's hidden by CSS
  // off-screen on the frontend (apps/web/src/app/register/register-form.tsx).
  // Naive scraper bots that auto-fill every input WILL fill it. The service
  // treats any non-empty value as "this is a bot" and silently returns the
  // same anti-enumeration success response WITHOUT creating a User row.
  //
  // No @IsString / @MaxLength here on purpose: ValidationPipe runs BEFORE
  // the service-side honeypot check, so strict validators would turn a
  // bot's filled honeypot into a 400 instead of the silent fake-success
  // we want — making the honeypot observable. The @Transform coerces any
  // value to a string (or undefined for null/missing) so the service-side
  // `if (data.website && data.website.trim())` check can do its work
  // uniformly without ValidationPipe interfering.
  @IsOptional()
  @Transform(({ value }) => value == null ? undefined : String(value))
  website?: string;

  // Explicit Terms & Privacy consent — required to be `true`. Accepting also
  // confirms the user is 18+ (the minimum age is stated in the Terms). The
  // service records termsAcceptedAt + the current TERMS_VERSION on success.
  @IsBoolean()
  @Equals(true, { message: 'You must accept the Terms and Privacy Policy' })
  termsAccepted!: boolean;
}
