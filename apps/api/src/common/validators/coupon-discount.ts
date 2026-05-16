/**
 * Custom class-validator decorator for a coupon's `discountValue`.
 *
 * A PERCENTAGE coupon's value is a percent — it must never exceed 100.
 * The plain `@Max(...)` on the DTOs is sized for the FIXED case (a fixed
 * QAR amount can legitimately be large), so on its own it lets a
 * nonsensical "500% off" coupon through. This validator adds the
 * percentage-specific upper bound by reading the sibling `discountType`.
 *
 * Scope: this ONLY enforces the percentage ceiling. Type / lower-bound /
 * FIXED-case checks stay with the existing `@IsNumber`/`@Min`/`@Max`
 * decorators — this validator returns `true` (passes) for any case it
 * doesn't own, so it composes cleanly instead of duplicating them.
 *
 * Not customer-exploitable (customers can't create coupons and the booking
 * transaction recomputes the price server-side) — this is data-integrity
 * hardening at the admin/vendor coupon-create boundary.
 */

import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'IsValidCouponDiscount', async: false })
export class IsValidCouponDiscountConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    // Not a number → let @IsNumber report it. Not our concern.
    if (typeof value !== 'number' || !Number.isFinite(value)) return true;
    const discountType = (args.object as Record<string, unknown>).discountType;
    // Only the PERCENTAGE case has the 0–100 ceiling. FIXED is bounded by
    // the DTO's own @Max.
    if (discountType !== 'PERCENTAGE') return true;
    return value <= 100;
  }

  defaultMessage(): string {
    return 'discountValue must not exceed 100 for a PERCENTAGE coupon';
  }
}

export function IsValidCouponDiscount(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsValidCouponDiscountConstraint,
    });
  };
}
