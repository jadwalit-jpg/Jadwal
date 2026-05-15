import { IsOptional, IsIn } from 'class-validator';
import { PaginationDto } from './query-params.dto';

const SUPPRESSION_REASONS = ['BOUNCE', 'COMPLAINT', 'MANUAL'] as const;

export class EmailSuppressionsQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(SUPPRESSION_REASONS as unknown as string[])
  reason?: 'BOUNCE' | 'COMPLAINT' | 'MANUAL';
}
