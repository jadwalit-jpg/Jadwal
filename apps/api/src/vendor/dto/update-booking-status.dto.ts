import { IsEnum } from 'class-validator';

export class VendorUpdateBookingStatusDto {
  @IsEnum(['CONFIRMED', 'COMPLETED', 'CANCELLED'])
  status!: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
}
