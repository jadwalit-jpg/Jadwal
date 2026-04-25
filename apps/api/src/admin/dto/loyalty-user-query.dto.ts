import { IsOptional, IsIn } from 'class-validator';
import { PaginationDto } from './query-params.dto';

export class LoyaltyUserQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['desc', 'asc'])
  sort?: 'desc' | 'asc';
}
