import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ActivityStatus } from '@prisma/client';

export class UpdateActivityStatusDto {
  @IsEnum(ActivityStatus)
  status!: ActivityStatus;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  reason?: string;
}
