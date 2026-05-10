import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `DELETE /auth/account` (self-service account deletion).
 *
 * The confirmation field MUST contain the literal phrase "DELETE"
 * (case-insensitive, trimmed). Same UX as GitHub repo deletion +
 * AWS resource deletion + Vercel project deletion — typing the
 * exact phrase forces a deliberate action and stops accidental
 * double-click destruction.
 *
 * Security trade-off vs the earlier password-confirmation design:
 *   - Password gate stopped session-hijack attackers (cookie theft)
 *     from triggering destructive flows. Confirmation phrase does
 *     NOT stop that — anyone with a stolen session can type DELETE
 *     and submit.
 *   - Compensating controls: 3/min/IP throttle on the endpoint,
 *     ACCOUNT_SELF_DELETED audit log captures the IP + UA of the
 *     destructive call, soft-delete via anonymisation means an
 *     admin can recover within the 30-day window if the user
 *     reports an unauthorised deletion.
 *   - Acceptable for a launch-stage marketplace; revisit if we
 *     start storing high-value financial state on customer accounts.
 *
 * Length cap (50) is generous — the literal expected match is 6
 * chars. Cap deters payload-size DoS / log-bloat without rejecting
 * a stray newline or extra whitespace from the client.
 */
export class DeleteAccountDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(50)
  confirmation!: string;
}
