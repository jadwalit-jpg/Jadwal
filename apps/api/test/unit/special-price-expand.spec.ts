import { BadRequestException } from '@nestjs/common';
import { expandSpecialPriceDates, BULK_SPECIAL_PRICE_MAX_DATES } from '../../src/vendor/activity-special-prices.logic';

// Pure cross-field expansion/validation for the bulk special-price request.
// Per-date calendar/past/horizon validation lives in createSpecialPriceCore.
const price = 100;

describe('expandSpecialPriceDates', () => {
  it('returns an explicit date list, sorted + de-duped', () => {
    expect(expandSpecialPriceDates({ dates: ['2026-08-25', '2026-08-22', '2026-08-22'], price }))
      .toEqual(['2026-08-22', '2026-08-25']);
  });

  it('expands an inclusive startDate..endDate range', () => {
    expect(expandSpecialPriceDates({ startDate: '2026-08-22', endDate: '2026-08-25', price }))
      .toEqual(['2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25']);
  });

  it('merges a date list with a range and de-dupes the overlap', () => {
    expect(expandSpecialPriceDates({ dates: ['2026-08-24', '2026-09-01'], startDate: '2026-08-23', endDate: '2026-08-25', price }))
      .toEqual(['2026-08-23', '2026-08-24', '2026-08-25', '2026-09-01']);
  });

  it('treats a single-day range (start === end) as that one date', () => {
    expect(expandSpecialPriceDates({ startDate: '2026-08-22', endDate: '2026-08-22', price }))
      .toEqual(['2026-08-22']);
  });

  it('throws when a range is missing one end', () => {
    expect(() => expandSpecialPriceDates({ startDate: '2026-08-22', price })).toThrow(BadRequestException);
    expect(() => expandSpecialPriceDates({ endDate: '2026-08-22', price })).toThrow(BadRequestException);
  });

  it('throws when the range is inverted (end before start)', () => {
    expect(() => expandSpecialPriceDates({ startDate: '2026-08-25', endDate: '2026-08-22', price })).toThrow(BadRequestException);
  });

  it('throws when nothing is provided', () => {
    expect(() => expandSpecialPriceDates({ price })).toThrow(BadRequestException);
    expect(() => expandSpecialPriceDates({ dates: [], price })).toThrow(BadRequestException);
  });

  it(`throws when more than ${BULK_SPECIAL_PRICE_MAX_DATES} dates are requested`, () => {
    // A range spanning > cap days must be rejected, not silently truncated.
    expect(() => expandSpecialPriceDates({ startDate: '2026-01-01', endDate: '2026-12-31', price }))
      .toThrow(BadRequestException);
  });
});
