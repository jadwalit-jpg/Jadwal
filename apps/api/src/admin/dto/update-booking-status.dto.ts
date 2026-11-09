import { IsEnum, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BookingStatus } from '@prisma/client';
import { ExternalRefundDto } from '../../common/dto/external-refund.dto';

export class UpdateBookingStatusDto {
  @IsEnum(BookingStatus)
  status!: BookingStatus;

  /**
   * Only with status CANCELLED, on a card-paid booking: the refund was already
   * made outside the website, so the cancel records it (payment REFUNDED with
   * the method) and credits NO Wanasa points for the cash part. Without it the
   * cancel behaves as before (cash refunded as Wanasa points).
   */
  @IsOptional()
  @IsObject({ message: 'externalRefund must be an object' }) // ValidateNested alone lets an array through
  @ValidateNested()
  @Type(() => ExternalRefundDto)
  externalRefund?: ExternalRefundDto;
}
