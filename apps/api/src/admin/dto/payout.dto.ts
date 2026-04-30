import { IsArray, IsUUID, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class MarkPayoutPaidDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)  // generous batch ceiling — admin marks a settlement run
  @IsUUID('4', { each: true })
  paymentIds!: string[];
}

/**
 * Reverts a payment's payoutStatus from PAID back to UNPAID. Used when admin
 * marked a payout by mistake. No reason required — the audit log auto-
 * stamps "mistake revert" as the default motive, and the confirmation UI
 * already spells out the impact.
 */
export class MarkPayoutUnpaidDto {
  @IsUUID('4')
  paymentId!: string;
}
