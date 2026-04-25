import { IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserRoleDto {
  @IsEnum(Role)
  @IsOptional()
  role?: Role;
}

export class DeactivateUserDto {
  @IsBoolean()
  deactivated!: boolean;
}
