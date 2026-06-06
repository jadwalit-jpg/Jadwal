import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

/**
 * Cross-field validator: the decorated date-string must be strictly AFTER the
 * value of another date-string property on the same object.
 *
 * Format checking is intentionally left to @IsDateString — this validator only
 * enforces ordering and returns `true` when either side is missing or
 * unparseable, so it composes cleanly with the format validator (which surfaces
 * those errors) instead of double-reporting.
 *
 * Usage:
 *   @IsDateString()
 *   @IsDateAfter('validFrom')
 *   validTo!: string;
 */
export function IsDateAfter(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isDateAfter',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const other = (args.object as Record<string, unknown>)[
            args.constraints[0] as string
          ];
          if (typeof value !== 'string' || typeof other !== 'string') return true;
          const a = Date.parse(value);
          const b = Date.parse(other);
          if (Number.isNaN(a) || Number.isNaN(b)) return true;
          return a > b;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be after ${args.constraints[0] as string}`;
        },
      },
    });
  };
}
