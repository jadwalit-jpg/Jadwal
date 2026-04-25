import { IsEnum } from 'class-validator';

export class UpdateVendorTrustDto {
  @IsEnum(['STANDARD', 'VERIFIED'])
  trustLevel!: 'STANDARD' | 'VERIFIED';
}
