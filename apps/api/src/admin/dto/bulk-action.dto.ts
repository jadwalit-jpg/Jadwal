import { IsArray, IsEnum, IsUUID, ArrayMaxSize, ArrayMinSize } from 'class-validator';
import { VendorStatus, ActivityStatus } from '@prisma/client';

// Bulk endpoints accept up to 100 IDs at a time — bounds the per-request
// blast radius (audit-log writes, DB query size) and matches the rate-limit
// posture on /admin/bulk/*.
const MAX_BULK = 100;

export class BulkVendorStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK)
  @IsUUID('4', { each: true })
  vendorIds!: string[];

  @IsEnum(VendorStatus, { message: 'status must be one of PENDING, ACTIVE, SUSPENDED' })
  status!: VendorStatus;
}

export class BulkActivityStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK)
  @IsUUID('4', { each: true })
  activityIds!: string[];

  @IsEnum(ActivityStatus, { message: 'status must be one of PENDING, ACTIVE, INACTIVE, BLOCKED' })
  status!: ActivityStatus;
}

export class BulkDeleteUsersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK)
  @IsUUID('4', { each: true })
  userIds!: string[];
}
