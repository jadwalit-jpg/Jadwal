import { minGuestsLimit, validateMinGuests, minGuestsPayload, type MinGuestsContext } from '../../src/lib/min-guests';

const camp: MinGuestsContext = { pricingModel: 'PER_PERSON', bookingType: 'DAILY', hasUnits: false, unitCount: 0, unitCapacity: 1, capacity: 60 };

describe('min guests (forms)', () => {
  it('accepts empty and 1 (no minimum)', () => {
    expect(validateMinGuests('', camp)).toBeNull();
    expect(validateMinGuests('1', camp)).toBeNull();
  });

  it('accepts a minimum within capacity', () => {
    expect(validateMinGuests('2', camp)).toBeNull();
  });

  it('rejects 0, decimals and more than 500', () => {
    expect(validateMinGuests('0', camp)).toEqual({ kind: 'range' });
    expect(validateMinGuests('2.5', camp)).toEqual({ kind: 'range' });
    expect(validateMinGuests('501', { ...camp, capacity: null })).toEqual({ kind: 'range' });
  });

  it('rejects a minimum above what one booking can hold', () => {
    expect(validateMinGuests('5', { ...camp, capacity: 4 })).toEqual({ kind: 'overCapacity', max: 4 });
    const tents = { ...camp, hasUnits: true, unitCount: 20, unitCapacity: 3 };
    expect(minGuestsLimit(tents)).toBe(3);
    expect(validateMinGuests('4', tents)).toEqual({ kind: 'overCapacity', max: 3 });
    const boat = { ...camp, bookingType: 'HOURLY', hasUnits: true, unitCount: 2, unitCapacity: 5 };
    expect(minGuestsLimit(boat)).toBe(10);
  });

  it('ignores the minimum on per-unit listings and sends 1 for them', () => {
    expect(validateMinGuests('9', { ...camp, pricingModel: 'PER_UNIT', capacity: 2 })).toBeNull();
    expect(minGuestsPayload('9', 'PER_UNIT')).toBe(1);
    expect(minGuestsPayload('2', 'PER_PERSON')).toBe(2);
    expect(minGuestsPayload('', 'PER_PERSON')).toBe(1);
  });
});
