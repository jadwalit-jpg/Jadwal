/**
 * Custom class-validator decorator that runs zxcvbn against the field.
 *
 * Why zxcvbn (not just length + class regex):
 *   - "Password123!" satisfies the existing min-8 + upper + lower + digit
 *     regex but is weak: it appears in every credential-stuffing dump.
 *   - zxcvbn scores entropy against a corpus of leaked passwords, common
 *     patterns (keyboard walks, l33t-speak, dates), and dictionary words.
 *     Score 0–4: 0 = trivially guessable; 4 = takes centuries.
 *
 * Threshold: score >= 3 ("safely unguessable; protects against unthrottled
 * online attack" per zxcvbn's own scale). 4 is overkill for a consumer
 * marketplace and frustrates real users.
 *
 * The user's email + full name + phone are passed in as `userInputs` so
 * the score gets penalised when the password contains personal info
 * (e.g. "Loaek2026!" with email "loaek@…" is correctly flagged as weak).
 */

import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
// IMPORTANT: zxcvbn is a CJS module that exports the function as
// `module.exports = function() {...}`, NOT `module.exports.default = ...`.
// With our tsconfig (module: commonjs, esModuleInterop NOT enabled), an
// `import zxcvbn from 'zxcvbn'` compiles to `zxcvbn_1.default(...)` which
// resolves to `undefined` at runtime → 'TypeError: ... is not a function'
// the moment the validator runs (caught in production after seed-admin's
// first password change attempt). The TS `import = require` form below
// produces `zxcvbn_1(...)` directly and is the canonical way to consume a
// function-export CJS module without esModuleInterop.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import zxcvbn = require('zxcvbn');

const MIN_SCORE = 3; // 0..4 zxcvbn scale; 3 = "very strong"

@ValidatorConstraint({ name: 'IsStrongPassword', async: false })
export class IsStrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'string' || !value) return false;
    const obj = args.object as Record<string, unknown>;
    const userInputs = [
      obj.email,
      obj.fullName,
      obj.phone,
      // Domain-specific words attackers will guess first:
      'jadwal',
      'qatar',
      'doha',
    ]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .flatMap((v) => v.split(/[\s@.+\-_]+/))
      .filter((v) => v.length >= 3);

    const result = zxcvbn(value, userInputs);
    return result.score >= MIN_SCORE;
  }

  defaultMessage(args: ValidationArguments): string {
    const value = (args.value as string) ?? '';
    const obj = args.object as Record<string, unknown>;
    const userInputs = [obj.email, obj.fullName, obj.phone]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .flatMap((v) => v.split(/[\s@.+\-_]+/))
      .filter((v) => v.length >= 3);
    const result = zxcvbn(value, userInputs);
    const feedback = result.feedback?.warning || 'Password is too weak';
    const suggestions = (result.feedback?.suggestions || []).slice(0, 2).join(' ');
    return `${feedback}${suggestions ? '. ' + suggestions : ''}`;
  }
}

export function IsStrongPassword(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsStrongPasswordConstraint,
    });
  };
}
