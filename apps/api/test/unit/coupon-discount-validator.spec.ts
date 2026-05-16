/**
 * IsValidCouponDiscount unit tests.
 *
 * The validator enforces the percentage-specific ceiling (PERCENTAGE coupons
 * must be <= 100) and stays out of the way for everything else so it composes
 * with the DTO's own @IsNumber / @Min / @Max decorators.
 */

import 'reflect-metadata'; // class-transformer @Type() needs the metadata reflector
import { validate } from 'class-validator';
import { CreateCouponDto } from '../../src/admin/dto/create-coupon.dto';

function makeDto(overrides: Partial<CreateCouponDto>): CreateCouponDto {
  const dto = new CreateCouponDto();
  dto.code = 'SAVE10';
  dto.discountType = 'PERCENTAGE';
  dto.discountValue = 10;
  dto.validFrom = '2026-01-01';
  dto.validTo = '2026-12-31';
  Object.assign(dto, overrides);
  return dto;
}

/** True if a validation run produced an error on `discountValue`. */
async function hasDiscountValueError(dto: CreateCouponDto): Promise<boolean> {
  const errors = await validate(dto);
  return errors.some((e) => e.property === 'discountValue');
}

describe('IsValidCouponDiscount', () => {
  it('accepts a PERCENTAGE coupon at the boundary (100)', async () => {
    expect(await hasDiscountValueError(makeDto({ discountType: 'PERCENTAGE', discountValue: 100 }))).toBe(false);
  });

  it('accepts a normal PERCENTAGE coupon (25)', async () => {
    expect(await hasDiscountValueError(makeDto({ discountType: 'PERCENTAGE', discountValue: 25 }))).toBe(false);
  });

  it('rejects a PERCENTAGE coupon above 100 (500)', async () => {
    expect(await hasDiscountValueError(makeDto({ discountType: 'PERCENTAGE', discountValue: 500 }))).toBe(true);
  });

  it('rejects a PERCENTAGE coupon just over the boundary (100.01)', async () => {
    expect(await hasDiscountValueError(makeDto({ discountType: 'PERCENTAGE', discountValue: 100.01 }))).toBe(true);
  });

  it('allows a FIXED coupon above 100 (a fixed QAR amount may be large)', async () => {
    expect(await hasDiscountValueError(makeDto({ discountType: 'FIXED', discountValue: 5000 }))).toBe(false);
  });

  it('still rejects a FIXED coupon above the DTO @Max (100000)', async () => {
    expect(await hasDiscountValueError(makeDto({ discountType: 'FIXED', discountValue: 200000 }))).toBe(true);
  });
});
