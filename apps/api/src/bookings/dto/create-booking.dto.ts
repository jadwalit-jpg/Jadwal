import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsUUID,
  IsArray,
  Min,
  Max,
  MinLength,
  Matches,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
  ValidationArguments,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';

@ValidatorConstraint({ name: 'isValidGuestBreakdown', async: false })
class IsValidGuestBreakdown implements ValidatorConstraintInterface {
  validate(value: unknown, _args: ValidationArguments) {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>;
    if (Object.keys(obj).length > 10) return false; // cap key count
    const KEY_RE = /^[a-zA-Z0-9_]{1,30}$/; // safe alphanumeric + underscore only
    for (const [key, val] of Object.entries(obj)) {
      if (!KEY_RE.test(key)) return false;
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) return false;
    }
    return true;
  }

  defaultMessage() {
    return 'guestBreakdown must be an object with string keys and non-negative integer values';
  }
}

export class CreateBookingDto {
  @IsUUID('4')
  activityId!: string;

  /**
   * HOURLY: the date to book (YYYY-MM-DD)
   * DAILY:  the check-in date (YYYY-MM-DD)
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { message: 'checkInDate must be a valid YYYY-MM-DD date' })
  checkInDate!: string;

  /**
   * HOURLY: the slot start time — MUST be on the hour (HH:00).
   * Flex-start booking: any hour within the activity's operating window is
   * valid, subject to end ≤ checkOutTime. Server re-validates regardless.
   * DAILY: omit (not used)
   */
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):00$/, { message: 'slotTime must start on the hour (HH:00)' })
  slotTime?: string;

  /**
   * HOURLY only, optional: custom end time for an extended booking.
   * When omitted, endDatetime = slotTime + durationValue hours (single slot,
   * unchanged legacy behaviour). When provided, the customer is requesting a
   * range longer than one slot — the server re-validates that:
   *   (end − start) is a positive integer multiple of durationValue hours,
   *   slotTime ≥ checkInTime, slotEndTime ≤ checkOutTime,
   *   multiplier ≤ MAX_SLOT_UNITS (price/DoS bound).
   * Pricing scales linearly: totalPrice = basePrice × multiplier (× guests for
   * PER_PERSON pricing).
   */
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):00$/, { message: 'slotEndTime must start on the hour (HH:00)' })
  slotEndTime?: string;

  /**
   * DAILY only: check-out date (YYYY-MM-DD)
   * HOURLY: omit
   */
  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { message: 'checkOutDate must be a valid YYYY-MM-DD date' })
  checkOutDate?: string;

  /** Number of guests/seats being booked */
  @IsInt()
  @Min(1)
  @Max(500)
  guests!: number;

  /**
   * Customer-provided phone number for THIS specific booking.
   *
   * Required. May differ from User.phone (the account-level phone) —
   * e.g. customer wants to use their work number for a corporate trip.
   * Vendor uses this to reach the customer about this booking; surfaces
   * in admin + vendor + customer booking views.
   *
   * E.164 format expected: `+<country><digits>`, no spaces / dashes.
   * The frontend `validatePhone()` utility normalises before send. The
   * regex below is intentionally lax (7–15 digits) — strict GCC-length
   * checks are FE-only for UX; backend trusts the regex for safety.
   * 20-char cap matches the DB column size and prevents over-long writes.
   */
  @IsString()
  @IsNotEmpty({ message: 'Booking phone is required' })
  @MaxLength(20, { message: 'Phone is too long' })
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Phone must be 7–15 digits, optionally starting with +' })
  bookingPhone!: string;

  /** Optional guest age breakdown (e.g. { adults: 2, children: 1 }) */
  @IsOptional()
  @Validate(IsValidGuestBreakdown)
  guestBreakdown?: Record<string, number>;

  /**
   * Client-generated UUID v4 for idempotency.
   * If the same key is submitted twice (network retry, double-click), the second
   * request returns the existing booking instead of creating a duplicate.
   * The frontend should generate this once when the booking form loads.
   */
  /** Names of paid extras the customer selected (must match activity.extraServices names with price > 0) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  @ArrayMaxSize(50)
  selectedExtras?: string[];

  /** Quantity per extra: { "Food": 3, "VIP Upgrade": 1 }. Per-person extras can be 1..guests, per-booking always 1. */
  @IsOptional()
  @Validate(IsValidGuestBreakdown) // reuse: same shape — string keys, non-negative integer values
  selectedExtrasQty?: Record<string, number>;

  /** Vendor coupon code to apply (optional — typed manually by customer) */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_-]+$/i, { message: 'Invalid coupon code format' })
  couponCode?: string;

  /** Claimed platform voucher ID to apply (optional — selected from claimed vouchers) */
  @IsOptional()
  @IsUUID('4')
  voucherId?: string;

  /** Number of loyalty points to redeem for a discount on this booking */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  redeemPoints?: number;

  @IsOptional()
  @IsUUID('4')
  @MaxLength(64)
  idempotencyKey?: string;
}
