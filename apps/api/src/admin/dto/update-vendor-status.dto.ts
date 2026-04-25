import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { VendorStatus } from '@prisma/client';

export class UpdateVendorStatusDto {
  @IsEnum(VendorStatus)
  status!: VendorStatus;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  reason?: string;
}
