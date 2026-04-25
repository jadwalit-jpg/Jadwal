import { IsString, IsUUID, IsInt, IsOptional, Min, Max, MaxLength } from 'class-validator';

export class CreateReviewDto {
  @IsUUID('4')
  activityId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;
}
