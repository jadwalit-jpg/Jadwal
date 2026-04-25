import { IsUUID } from 'class-validator';

export class InitiatePaymentDto {
  @IsUUID('4')
  bookingId!: string;
}
