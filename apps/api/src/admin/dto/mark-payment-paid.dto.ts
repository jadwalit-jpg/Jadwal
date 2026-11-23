import { IsString, Length, Matches } from 'class-validator';

/**
 * Admin "Mark as paid" on a PAY2M payment the site could not confirm by itself.
 * The amount is NOT accepted here: the payment's own frozen amount is what gets
 * confirmed, and the admin cannot change it.
 */
export class MarkPaymentPaidDto {
  /** The PAY2M transaction id, as shown on the PAY2M dashboard for the basket. */
  @IsString()
  @Length(3, 64)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: 'transactionId may contain letters, digits, dots, dashes and underscores only',
  })
  transactionId!: string;

  /** What was checked in PAY2M and why the payment is being confirmed by hand. */
  @IsString()
  @Length(5, 500)
  note!: string;
}
