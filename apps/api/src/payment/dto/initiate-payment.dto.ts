import { IsOptional, IsUUID } from 'class-validator';

export class InitiatePaymentDto {
  @IsUUID('4')
  bookingId!: string;

  /**
   * Optional client-generated UUID v4 for idempotency. If the same key is
   * submitted twice (network retry, double-tap on "Pay now"), the second
   * request is treated as a retry of the first — it re-uses the existing
   * gateway basket and returns a fresh PAY2M form rather than spinning up a
   * second payment attempt. A key that collides with a different booking or
   * owner is rejected (409). Mirrors CreateBookingDto.idempotencyKey.
   */
  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;
}
