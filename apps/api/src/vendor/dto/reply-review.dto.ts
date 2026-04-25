import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ReplyReviewDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reply!: string;
}
