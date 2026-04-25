import { IsNumber, Min, Max, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateCommissionDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultCommissionPct!: number;
}

export class UpdateVendorCommissionDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPct?: number | null;
}
