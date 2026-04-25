import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class ProcessPayoutRequestDto {
  @IsEnum(['APPROVED', 'REJECTED', 'COMPLETED'])
  action!: 'APPROVED' | 'REJECTED' | 'COMPLETED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminNote?: string;
}
