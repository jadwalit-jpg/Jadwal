import { IsIn } from 'class-validator';

/** "Later" hides the ask until the next one; "never" stops asks for this booking. */
export class DismissReviewPromptDto {
  @IsIn(['later', 'never'])
  mode!: 'later' | 'never';
}
