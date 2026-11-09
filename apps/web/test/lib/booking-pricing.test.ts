import { readFileSync } from 'fs';
import { join } from 'path';
import { chargedGuests, dailyBaseCents, hourlyBaseCents } from '../../src/lib/booking-pricing';

// Same table as the server suite (apps/api/test/unit/booking-pricing.spec.ts),
// so the booking page preview and the charge the server records cannot drift.
type PricingCase = {
  name: string; pricingModel: string; guests: number; minGuests: number;
  chargedGuests: number; expectedCents: number;
  nightCents?: number[]; priceCents?: number; hoursBooked?: number; durationHours?: number;
};
const cases = JSON.parse(
  readFileSync(join(__dirname, '../../../api/test/fixtures/booking-pricing-cases.json'), 'utf8'),
) as { daily: PricingCase[]; hourly: PricingCase[] };

describe('booking pricing preview (web) matches the server cases', () => {
  it('has cases to run', () => {
    expect(cases.daily.length).toBeGreaterThan(0);
    expect(cases.hourly.length).toBeGreaterThan(0);
  });

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
});
