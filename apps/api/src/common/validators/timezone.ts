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

/**
 * "Now" as it reads on the wall clock IN `tz`, returned as a Date whose UTC
 * fields hold that local wall-clock time (i.e. the same "local-wall-clock
 * tagged-UTC" frame that `buildDatetime` stores start/end datetimes in). This
 * is the ONLY correct thing to compare a stored startDatetime/endDatetime
 * against: a raw `new Date()` compare is wrong by the country's UTC offset —
 * e.g. in Qatar (UTC+3) it lets a customer cancel for ~3h into an activity that
 * has really started, and it delays booking auto-completion (and the loyalty
 * points award) by that same offset.
 *
 * Uses `hourCycle: 'h23'` so midnight is "00", not "24". Invalid tz → real UTC
 * now (a UTC activity has no offset, so raw now is already correct).
 */
export function nowInTimezone(tz: string): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    return new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}.000Z`);
  } catch {
    return new Date(); // invalid tz → real now (UTC activity has zero offset anyway)
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
