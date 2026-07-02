import { IsEnum, IsOptional } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserRoleDto {
  @IsEnum(Role)
  @IsOptional()
  role?: Role;
}

// NOTE: the DeactivateUserDto used by the controller lives in
// ./deactivate-user.dto.ts (field: `isDeactivated`). A duplicate class with a
// divergent field name previously sat here and was dead code — removed to stop
// a future import from silently binding the wrong shape.
