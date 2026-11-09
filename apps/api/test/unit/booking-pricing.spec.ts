import { chargedGuests, dailyBaseCents, hourlyBaseCents } from '../../src/bookings/pricing';
import { readFileSync } from 'fs';
import { join } from 'path';

type PricingCase = {
  name: string; pricingModel: string; guests: number; minGuests: number;
  chargedGuests: number; expectedCents: number;
  nightCents?: number[]; priceCents?: number; hoursBooked?: number; durationHours?: number;
};
const cases = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/booking-pricing-cases.json'), 'utf8'),
) as { daily: PricingCase[]; hourly: PricingCase[] };

// The same table runs against the web booking preview
// (apps/web/test/lib/booking-pricing.test.ts), so the preview and the charge
// recorded by the server cannot drift apart.

describe('booking pricing (server)', () => {
  describe.each(cases.daily)('DAILY: $name', (c) => {
    it('charges the expected guests and total', () => {
      expect(chargedGuests(c.pricingModel, c.guests, c.minGuests)).toBe(c.chargedGuests);
      expect(dailyBaseCents(c.nightCents!, c.pricingModel, c.guests, c.minGuests)).toBe(c.expectedCents);
    });
  });

  describe.each(cases.hourly)('HOURLY: $name', (c) => {
    it('charges the expected guests and total', () => {
      expect(chargedGuests(c.pricingModel, c.guests, c.minGuests)).toBe(c.chargedGuests);
      expect(
        hourlyBaseCents(c.priceCents!, c.hoursBooked!, c.durationHours!, c.pricingModel, c.guests, c.minGuests),
      ).toBe(c.expectedCents);
    });
  });

  describe('existing listings price exactly as before', () => {
    // The pre-change formulas, copied from bookings.service before minGuests:
    //   DAILY:  sum of night prices (guests never mattered)
    //   HOURLY: round(price × hours × (PER_UNIT ? 1 : guests) / duration)
    const oldDaily = (nights: number[]) => nights.reduce((s, n) => s + n, 0);
    const oldHourly = (p: number, h: number, d: number, model: string, g: number) =>
      Math.round((p * h * (model === 'PER_UNIT' ? 1 : g)) / d);

    it('DAILY PER_UNIT matches the old total for any guest count and stored minimum', () => {
      for (const nights of [[35000], [35000, 50000], [120000, 120000, 99999]]) {
        for (const guests of [1, 2, 7]) {
          for (const minGuests of [1, 3, null, undefined]) {
            expect(dailyBaseCents(nights, 'PER_UNIT', guests, minGuests)).toBe(oldDaily(nights));
          }
        }
      }
    });

    it('HOURLY (both models) with the default minimum of 1 matches the old total', () => {
      for (const model of ['PER_PERSON', 'PER_UNIT']) {
        for (const [p, h, d] of [[15000, 2, 2], [9999, 4, 3], [12345, 5, 1], [100, 3, 2]]) {
          for (const guests of [1, 2, 9]) {
            expect(hourlyBaseCents(p, h, d, model, guests, 1)).toBe(oldHourly(p, h, d, model, guests));
          }
        }
      }
    });
  });

  it('treats a missing or invalid minimum as no minimum', () => {
    expect(chargedGuests('PER_PERSON', 1, null)).toBe(1);
    expect(chargedGuests('PER_PERSON', 1, undefined)).toBe(1);
    expect(chargedGuests('PER_PERSON', 1, 0)).toBe(1);
    expect(chargedGuests('PER_PERSON', 1, 2.5)).toBe(1);
  });
});
