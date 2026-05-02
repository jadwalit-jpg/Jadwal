import { IsArray, IsUUID, ArrayMinSize, ArrayMaxSize, IsString, MinLength, MaxLength } from 'class-validator';

export class MarkPayoutPaidDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)  // generous batch ceiling — admin marks a settlement run
  @IsUUID('4', { each: true })
  paymentIds!: string[];

  /// §M4 — bank-side wire confirmation number. Required so every PAID
  /// payment row links to a real bank transaction, which forensic / dispute
  /// resolution depends on. Free-form (banks vary) but bounded to keep
  /// pathological inputs out of audit logs.
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  bankTransferRef!: string;
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
