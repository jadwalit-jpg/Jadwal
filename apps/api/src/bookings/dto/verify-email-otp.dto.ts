import { IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * Verify the 6-digit booking email-OTP.
 *
 * The regex format gate is critical — it rejects malformed input (wrong
 * length, non-numeric) in O(1) BEFORE any hash computation or database
 * lookup, closing the resource-exhaustion class of attacks where an
 * attacker submits a huge payload to amplify our per-request cost.
 */
export class VerifyEmailOtpDto {
  @IsString()
  @IsNotEmpty({ message: 'Verification code is required' })
  @Matches(/^[0-9]{6}$/, { message: 'Code must be exactly 6 digits' })
  code!: string;
}
