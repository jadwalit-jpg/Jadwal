import { IsEnum } from 'class-validator';

/**
 * Admin escape hatch for re-opening a closed payout request when a
 * wrong action was taken. Two target states are accepted:
 *
 *   PENDING  — full rewind, releases any payment locks
 *   APPROVED — partial rewind (only meaningful from COMPLETED), keeps
 *              the paymentIds lock so the same payments can be re-
 *              completed without re-approval
 *
 * The server still validates which current → target transitions are
 * actually permitted (e.g. REJECTED → APPROVED is blocked — admin
 * must go via PENDING then approve fresh so eligibility is re-checked).
 */
export class RevertPayoutRequestDto {
  @IsEnum(['PENDING', 'APPROVED'])
  targetStatus!: 'PENDING' | 'APPROVED';
}
