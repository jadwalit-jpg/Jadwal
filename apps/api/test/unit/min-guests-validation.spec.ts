import { BadRequestException } from '@nestjs/common';
import { assertMinGuestsConsistent } from '../../src/common/validators/min-guests';

describe('assertMinGuestsConsistent', () => {
  it('accepts the default (1) and a missing value on any listing', () => {
    expect(() => assertMinGuestsConsistent({ minGuests: 1, pricingModel: 'PER_PERSON', capacity: 1 })).not.toThrow();
    expect(() => assertMinGuestsConsistent({ pricingModel: 'PER_PERSON', capacity: 1 })).not.toThrow();
  });

  it('accepts a minimum within capacity (no units)', () => {
    expect(() => assertMinGuestsConsistent({ minGuests: 2, pricingModel: 'PER_PERSON', bookingType: 'DAILY', capacity: 60 })).not.toThrow();
  });

  it('rejects a minimum above capacity (no units)', () => {
    expect(() => assertMinGuestsConsistent({ minGuests: 5, pricingModel: 'PER_PERSON', bookingType: 'HOURLY', capacity: 4 }))
      .toThrow(BadRequestException);
  });

  it('DAILY with units: limit is one unit (a booking takes a whole tent)', () => {
    const tent = { pricingModel: 'PER_PERSON', bookingType: 'DAILY', hasUnits: true, unitCount: 20, unitCapacity: 3 };
    expect(() => assertMinGuestsConsistent({ ...tent, minGuests: 3 })).not.toThrow();
    expect(() => assertMinGuestsConsistent({ ...tent, minGuests: 4 })).toThrow(BadRequestException);
  });

  it('HOURLY per person with units: limit is all seats', () => {
    const boat = { pricingModel: 'PER_PERSON', bookingType: 'HOURLY', hasUnits: true, unitCount: 2, unitCapacity: 5 };
    expect(() => assertMinGuestsConsistent({ ...boat, minGuests: 10 })).not.toThrow();
    expect(() => assertMinGuestsConsistent({ ...boat, minGuests: 11 })).toThrow(BadRequestException);
  });

  it('unlimited capacity (null) accepts any minimum', () => {
    expect(() => assertMinGuestsConsistent({ minGuests: 50, pricingModel: 'PER_PERSON', capacity: null })).not.toThrow();
  });

  it('does not check PER_UNIT listings (the minimum is ignored there)', () => {
    expect(() => assertMinGuestsConsistent({ minGuests: 9, pricingModel: 'PER_UNIT', capacity: 2 })).not.toThrow();
  });
});
