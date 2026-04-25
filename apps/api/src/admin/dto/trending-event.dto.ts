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

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2000)
  image?: string;

  @IsOptional()
  @IsDateString()
  @IsNotPastDate()
  eventDate?: string;

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

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2000)
  image?: string;

  @IsOptional()
  @IsDateString()
  @IsNotPastDate()
  eventDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  countryId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
