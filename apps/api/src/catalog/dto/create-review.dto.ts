import { IsUUID, IsInt, Min, Max } from 'class-validator';

// Reviews are RATING-ONLY by product decision — no customer free text. The
// global ValidationPipe (forbidNonWhitelisted) rejects any `text` a client tries
// to POST directly, so there is no customer-generated text to moderate.
export class CreateReviewDto {
  @IsUUID('4')
  activityId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;
}
