import { IsArray, IsString } from 'class-validator';

export class MarkPayoutPaidDto {
  @IsArray()
  @IsString({ each: true })
  paymentIds!: string[];
}

/**
 * Reverts a payment's payoutStatus from PAID back to UNPAID. Used when admin
 * marked a payout by mistake. No reason required — the audit log auto-
 * stamps "mistake revert" as the default motive, and the confirmation UI
 * already spells out the impact.
 */
export class MarkPayoutUnpaidDto {
  @IsString()
  paymentId!: string;
}
