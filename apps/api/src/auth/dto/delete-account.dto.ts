import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Body for `DELETE /auth/account` (self-service account deletion).
 *
 * Requires the user's CURRENT password — defense against session
 * hijack. Even if an attacker has the auth cookie they can't permanently
 * delete the account without also knowing the password. Pairs with the
 * Redis per-user delete-rate-limit (1/hour) so a brute-force on the
 * password gate can't cycle quickly.
 *
 * Password is NEVER stored or logged; bcrypt-compared against the
 * existing hash and immediately discarded after verification.
 */
export class DeleteAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
