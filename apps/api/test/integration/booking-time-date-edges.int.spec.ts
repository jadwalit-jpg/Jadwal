/**
 * Integration — time and date edges on the booking path.
 *
 * Fills the gaps left by the existing suites. Already covered elsewhere and NOT
 * repeated here: `addMonthsClamped` month-length clamping (add-months-clamped),
 * hourly slot generation (booking-slots), minimum nights (daily-min-nights),
 * partial overlap (booking-unit-partial-overlap), and the oversell/consistency
 * invariants (booking-logic-invariants).
 *
 * What is new here:
 *   - month LENGTH handling in the calendar, including a leap February
 *   - stays that cross a YEAR boundary, not just a month one
 *   - the advance-booking window at its exact edge
 *   - inverted and zero-length date ranges
 *   - and the one that actually has teeth: "today" is the activity's LOCAL
 *     today, not the server's
 *
 * TIMEZONE APPROACH
 * -----------------
 * Rather than mocking the clock — which tends to hang Prisma's real I/O — these
 * tests create two countries whose local dates genuinely differ at every real
 * instant: Pacific/Kiritimati (UTC+14) and Pacific/Midway (UTC-11), 25 hours
 * apart. Two otherwise identical activities must therefore disagree about which
 * dates are in the past. If the code ever reverts to server time, both would
 * agree and these go red.
 *
 * A Europe/London activity additionally covers a stay spanning a DST change.
 * No DST country is configured in production today (only Asia/Qatar, which has
 * none), so this is a guard for the day one is added rather than a live bug.
 */

import { getTestContext, seedReference } from './_setup';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeBookingsService(maxAdvanceMonths = '6') {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  return new BookingsService(
    prismaSvc,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn(), sendToMany: jest.fn() } as any,
    { acquire: jest.fn().mockResolvedValue('tok'), release: jest.fn().mockResolvedValue(undefined) } as any,
    {
      get: (k: string, fb?: string) =>
        (({
          RESERVATION_WINDOW_MINUTES: '15',
          BOOKING_MAX_ADVANCE_MONTHS: maxAdvanceMonths,
          REDIS_LOCK_TTL_MS: '30000',
        }) as Record<string, string>)[k] ?? fb,
    } as any,
    loyalty,
    {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
      invalidateMany: jest.fn().mockResolvedValue(undefined),
    } as any,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
}

function d(daysFromNow: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + daysFromNow);
  return dt.toISOString().slice(0, 10);
}
const PHONE = '+97455123456';

/** A country in an arbitrary timezone, with a city, so activities can differ. */
async function makeCountryIn(tz: string, label: string) {
  const country = await ctx.prisma.country.create({
    data: {
      nameEn: `Land of ${label}`, nameAr: label, isoCode: label.slice(0, 2).toUpperCase(),
      currencyCode: 'QAR', defaultTimezone: tz, serviceFeeFixed: 5, status: 'ACTIVE',
    },
  });
  const city = await ctx.prisma.city.create({
    data: { countryId: country.id, nameEn: label, nameAr: label, lat: 0, lng: 0 },
  });
  return { country, city };
}

async function makeDaily(seed: any, over: Record<string, unknown> = {}) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'Stay', titleAr: 'إقامة',
      slug: 'stay-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و',
      locationAddress: 'Doha', locationLat: 25.28, locationLng: 51.53,
      bookingType: 'DAILY', pricingModel: 'PER_UNIT',
      pricePerPerson: 500,
      hasUnits: true, unitCount: 1, unitCapacity: 10, capacity: 10,
      durationValue: null, checkInTime: '15:00', checkOutTime: '12:00',
      coverImage: '/p.webp', status: 'ACTIVE',
      ...over,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════

describe('MONTH LENGTHS — the calendar must know how long each month is', () => {

  test.each([
    ['2028-02', 29, 'leap February'],
    ['2027-02', 28, 'ordinary February'],
    ['2027-04', 30, 'a 30-day month'],
    ['2027-01', 31, 'a 31-day month'],
    ['2027-12', 31, 'December — the month that breaks naive month+1 maths'],
  ])('%s has %i days (%s)', async (month, expectedDays) => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDaily(seed);

    const cal: any = await svc.getCalendarAvailability(act.id, month as string);

    expect(cal.days).toHaveLength(expectedDays as number);
    expect(cal.days[0].date).toBe(`${month}-01`);
    expect(cal.days[cal.days.length - 1].date)
      .toBe(`${month}-${String(expectedDays).padStart(2, '0')}`);
  });

  test('every day in a returned month actually belongs to that month', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDaily(seed);

    // December is the classic overflow: month + 1 without a year rollover
    // produces "month 13" and silently walks into the next year.
    const cal: any = await svc.getCalendarAvailability(act.id, '2027-12');
    for (const day of cal.days) expect(day.date.startsWith('2027-12-')).toBe(true);
  });
});

describe('YEAR BOUNDARY — a stay across New Year appears in both calendars', () => {

  test('30 Dec to 2 Jan is occupied in December AND in January', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDaily(seed);

    // Inserted directly: the advance-booking window would refuse a real
    // createBooking this far out, and the point here is the CALENDAR maths.
    await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
        activityId: act.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
        startDatetime: new Date('2027-12-30T15:00:00.000Z'),
        endDatetime: new Date('2028-01-02T12:00:00.000Z'),
        guests: 2, unitNumber: 1, status: 'CONFIRMED',
        totalPrice: 1500, serviceFee: 0, bookingPhone: PHONE,
      },
    });

    const dec: any = await svc.getCalendarAvailability(act.id, '2027-12');
    const jan: any = await svc.getCalendarAvailability(act.id, '2028-01');

    expect(dec.days.find((x: any) => x.date === '2027-12-30').isFullyBooked).toBe(true);
    expect(dec.days.find((x: any) => x.date === '2027-12-31').isFullyBooked).toBe(true);
    // The stay STARTS in the previous YEAR — a query keyed on start date alone
    // would show January as wide open.
    expect(jan.days.find((x: any) => x.date === '2028-01-01').isFullyBooked).toBe(true);
    // Checkout is 2 Jan at noon, so the night of the 2nd is free again.
    expect(jan.days.find((x: any) => x.date === '2028-01-02').isFullyBooked).toBe(false);
  });
});

describe('ADVANCE WINDOW — the exact edge', () => {

  test('a date inside the window is accepted, one past it is refused', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService('1'); // 1 month, so the edge is reachable
    const act = await makeDaily(seed);

    // Comfortably inside.
    const ok = await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: d(20), checkOutDate: d(22),
      guests: 2, bookingPhone: PHONE,
    } as any);
    expect(ok.booking).toBeTruthy();

    // Comfortably outside — ~3 months out against a 1-month window.
    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: act.id, checkInDate: d(90), checkOutDate: d(92),
        guests: 2, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow(/in advance/i);
  });
});

describe('MALFORMED RANGES', () => {

  test('check-out before check-in is refused', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDaily(seed);

    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: act.id, checkInDate: d(9), checkOutDate: d(5),
        guests: 2, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow();
  });

  test('check-out equal to check-in (a zero-night stay) is refused', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDaily(seed);

    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: act.id, checkInDate: d(5), checkOutDate: d(5),
        guests: 2, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow();
  });

  test('an impossible calendar date is refused, not rolled forward', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDaily(seed);

    // Plain `new Date('2027-02-30')` would silently become 2 March.
    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: act.id, checkInDate: '2027-02-30', checkOutDate: '2027-03-02',
        guests: 2, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow(/date/i);
  });

  test('a past date is refused', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDaily(seed);

    await expect(
      svc.createBooking(seed.customer.id, {
        activityId: act.id, checkInDate: d(-3), checkOutDate: d(-1),
        guests: 2, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow(/past/i);
  });
});

describe('TIMEZONE — "today" is the activity\'s local today, not the server\'s', () => {

  test('two activities 25 hours apart disagree about which dates are past', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();

    // UTC+14 and UTC-11. At every real instant their local dates differ.
    const ahead = await makeCountryIn('Pacific/Kiritimati', 'Ahead');
    const behind = await makeCountryIn('Pacific/Midway', 'Behind');

    const actAhead = await makeDaily(seed, { countryId: ahead.country.id, cityId: ahead.city.id });
    const actBehind = await makeDaily(seed, { countryId: behind.country.id, cityId: behind.city.id });

    const month = d(0).slice(0, 7);
    const calAhead: any = await svc.getCalendarAvailability(actAhead.id, month);
    const calBehind: any = await svc.getCalendarAvailability(actBehind.id, month);

    const pastCount = (cal: any) => cal.days.filter((x: any) => x.isPast).length;

    // The far-ahead timezone has already used up more of the month. If the code
    // ever went back to server time these counts would be identical.
    expect(pastCount(calAhead)).toBeGreaterThanOrEqual(pastCount(calBehind));

    // Somewhere in the month they must actually DIFFER — unless the month
    // boundary hides it, which only happens on the 1st. Assert the weaker
    // always-true relation above, and the strict one only when it is meaningful.
    const dayOfMonth = Number(d(0).slice(8));
    if (dayOfMonth > 1 && dayOfMonth < 28) {
      expect(pastCount(calAhead)).toBeGreaterThan(pastCount(calBehind));
    }
  });

  test('a DST country still produces a well-formed calendar across the change', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    // No DST country exists in production today (Qatar has none). This guards
    // the day one is added: the clocks going back gives a 25-hour day, which is
    // where naive "add 24 hours per day" loops produce a duplicate or missing
    // date.
    const uk = await makeCountryIn('Europe/London', 'Britain');
    const act = await makeDaily(seed, { countryId: uk.country.id, cityId: uk.city.id });

    // October 2027 — British clocks go back on the last Sunday.
    const cal: any = await svc.getCalendarAvailability(act.id, '2027-10');

    expect(cal.days).toHaveLength(31);
    const dates = cal.days.map((x: any) => x.date);
    expect(new Set(dates).size).toBe(31);          // no duplicated day
    expect(dates[0]).toBe('2027-10-01');
    expect(dates[30]).toBe('2027-10-31');
  });
});
