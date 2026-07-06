import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * True iff `value` is a real, UNAMBIGUOUS IANA timezone.
 *
 * This gates `Country.defaultTimezone` — the field the booking cancel guard,
 * the refund-window math, and the availability past-slot logic all trust to
 * convert stored (local-wall-clock-tagged-UTC) datetimes back to real time. If
 * that field is empty, a typo, or otherwise invalid, those paths silently fall
 * back to raw UTC, which in a +offset country (all of the GCC) re-opens the
 * "cancel during the activity" bug and skews refund deadlines by the offset.
 *
 * Rules:
 *  - reject non-string / empty / whitespace-only
 *  - reject `Etc/GMT±N` — these are POSIX SIGN-INVERTED (`Etc/GMT+3` is UTC−3),
 *    a footgun; region-based zones (e.g. `Asia/Qatar`) have an unambiguous offset
 *  - accept anything `Intl.DateTimeFormat` recognises as a zone (incl. `UTC`)
 */
export function isValidIanaTimezone(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const tz = value.trim();
  if (tz.length === 0) return false;
  if (/^etc\//i.test(tz)) return false; // sign-inverted POSIX zones — reject
  try {
    // Throws RangeError on an unknown/invalid zone.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

@ValidatorConstraint({ name: 'isIanaTimezone', async: false })
export class IsIanaTimezoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidIanaTimezone(value);
  }
  defaultMessage(): string {
    return 'defaultTimezone must be a valid IANA timezone (e.g. Asia/Qatar) — not empty, not an Etc/GMT zone';
  }
}

export function IsIanaTimezone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsIanaTimezoneConstraint,
    });
  };
}
