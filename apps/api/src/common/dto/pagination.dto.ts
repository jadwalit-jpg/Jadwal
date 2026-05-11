import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Standard pagination query DTO for non-admin list endpoints.
 *
 * Uses the codebase-wide `page` + `limit` convention (matching
 * `admin/dto/query-params.dto.ts:PaginationDto`). Slightly more
 * generous defaults than the admin variant because consumer list
 * endpoints (offers, sessions) routinely show 20-50 items at once.
 *
 * Hard cap of 200 prevents a misbehaving client from requesting
 * `?limit=100000` and exhausting DB connections / memory. Routes that
 * legitimately need higher (admin exports) use `ExportPaginationDto`.
 */
export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}

/**
 * Pagination for admin export endpoints. Higher ceiling (5000) because
 * exports legitimately span thousands of rows in one page — but still
 * bounded so a runaway query can't pin the DB.
 */
export class ExportPaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5_000)
  limit?: number = 1_000;
}
