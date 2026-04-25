import { IsString } from 'class-validator';

export class ToggleLikeDto {
  @IsString()
  activityId!: string;
}
