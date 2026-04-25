import { IsEnum } from 'class-validator';

export class UpdateCouponStatusDto {
  @IsEnum(['PENDING', 'APPROVED', 'EXPIRED'])
  status!: 'PENDING' | 'APPROVED' | 'EXPIRED';
}
