import { IsArray, IsString, IsEnum } from 'class-validator';

export class BulkVendorStatusDto {
  @IsArray()
  @IsString({ each: true })
  vendorIds!: string[];

  @IsString()
  status!: string;
}

export class BulkActivityStatusDto {
  @IsArray()
  @IsString({ each: true })
  activityIds!: string[];

  @IsString()
  status!: string;
}

export class BulkDeleteUsersDto {
  @IsArray()
  @IsString({ each: true })
  userIds!: string[];
}
