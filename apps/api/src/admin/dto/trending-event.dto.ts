import { IsString, IsOptional, IsBoolean, IsDateString, IsUrl, MaxLength, MinLength, registerDecorator, ValidationOptions } from 'class-validator';

function IsNotPastDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotPastDate',
      target: (object as any).constructor,
      propertyName,
      options: { message: 'eventDate must not be in the past', ...validationOptions },
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null) return true;
          const date = new Date(value as string);
          if (isNaN(date.getTime())) return false;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return date >= today;
        },
      },
    });
  };
}

/** Validates that this date field is on or after a sibling date field (e.g.
 *  eventEndDate >= eventDate). Passes when either value is absent — the
 *  comparison only fires when both are present in the same payload. */
function IsOnOrAfter(siblingProp: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isOnOrAfter',
      target: (object as any).constructor,
      propertyName,
      options: { message: `${propertyName} must be on or after ${siblingProp}`, ...validationOptions },
      validator: {
        validate(value: unknown, args: any) {
          if (value === undefined || value === null) return true;
          const start = args?.object?.[siblingProp];
          if (start === undefined || start === null) return true;
          const end = new Date(value as string);
          const startDate = new Date(start as string);
          if (isNaN(end.getTime()) || isNaN(startDate.getTime())) return false;
          return end >= startDate;
        },
      },
    });
  };
}

export class CreateTrendingEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  titleEn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  titleAr!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Arabic description — optional. Falls back to `description` on render. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descriptionAr?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2000)
  image?: string;

  @IsOptional()
  @IsDateString()
  @IsNotPastDate()
  eventDate?: string;

  /** Optional END date for multi-day events. NULL = single-day (unchanged). */
  @IsOptional()
  @IsDateString()
  @IsNotPastDate({ message: 'eventEndDate must not be in the past' })
  @IsOnOrAfter('eventDate', { message: 'eventEndDate must be on or after eventDate' })
  eventEndDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  countryId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTrendingEventDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  titleEn?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  titleAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Arabic description — optional. Falls back to `description` on render. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descriptionAr?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2000)
  image?: string;

  @IsOptional()
  @IsDateString()
  @IsNotPastDate()
  eventDate?: string;

  /** Optional END date for multi-day events. NULL = single-day (unchanged). */
  @IsOptional()
  @IsDateString()
  @IsNotPastDate({ message: 'eventEndDate must not be in the past' })
  @IsOnOrAfter('eventDate', { message: 'eventEndDate must be on or after eventDate' })
  eventEndDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  countryId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
