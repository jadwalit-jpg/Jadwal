import { IsBoolean } from 'class-validator';

export class DeactivateUserDto {
  @IsBoolean()
  isDeactivated!: boolean;
}
