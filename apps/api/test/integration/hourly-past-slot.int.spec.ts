/**
 * Integration — an HOURLY slot that has already started today is not bookable.
 *
 * THE BUG
 * -------
 * createBooking's past-date guard is date-granular: `checkInDate < todayStr`.
 * On today's date every slot cleared it, including ones that had finished hours
 * earlier. Measured before fixing, not theorised: at 11:14 local time a 00:00
 * slot for the same day was ACCEPTED.
 *
 * getHourlyAvailability already marked such slots `isPast`, so the picker greyed
 * them out and no ordinary customer met this. The calendar is not the authority
 * though — a stale tab, a retry, or a direct API call all reach createBooking,
 * and the result is a paid booking for a trip that has already sailed.
 *
 * MAKING IT DETERMINISTIC
 * -----------------------
 * "Is a slot in the past?" depends on the wall clock, so a naive test passes or
 * fails by the hour of the CI run — the date-fragility trap that already bit
 * this suite once.
 *
 * Instead the activity's country is pinned to a timezone DERIVED from the
 * current UTC hour, so local "now" always lands in the 12:00 hour. 08:00 is
 * then reliably past and 16:00 reliably future, at every instant of the year.
 *
 * Fixed extreme zones are not enough, which is how the first draft failed: in
 * UTC+14 local now can be 23:50, leaving no later slot bookable at all.
 */

import { getTestContext, seedReference } from './_setup';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeBookingsService() {
  const prismaSvc = { client: ctx.prisma } as any;
  return new BookingsService(
    prismaSvc, { log: jest.fn().mockResolvedValue(undefined) } as any,
    {
      send: jest.fn().mockResolvedValue(undefined),
      notifyAdmins: jest.fn().mockResolvedValue(undefined),
      sendToMany: jest.fn().mockResolvedValue(undefined),
    } as any,
    { acquire: jest.fn().mockResolvedValue('lock'), release: jest.fn().mockResolvedValue(undefined) } as any,
    {
      get: (k: string, fb?: string) =>
        (({ RESERVATION_WINDOW_MINUTES: '15', BOOKING_MAX_ADVANCE_MONTHS: '6', REDIS_LOCK_TTL_MS: '30000' }) as Record<string, string>)[k] ?? fb,
    } as any,
    new LoyaltyService(prismaSvc),
    {
      get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined),
    } as any,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
}

/**
 * A timezone in which local "now" falls in the given hour.
 *
 * Fixed zones are not enough: in UTC+14 local now can be 23:50, leaving no
 * later slot to book, and in UTC-12 it can be 23:00, leaving nothing earlier.
 * A test that only holds for part of the day is the date-fragility trap that
 * already bit this suite once.
 *
 * So the zone is chosen from the current UTC hour instead, which pins local
 * time to a known band whatever the clock says. POSIX inverts the sign in the
 * Etc/GMT names — Etc/GMT-3 is UTC+3 — hence the flip below.
 */
function tzWithLocalHour(targetHour: number): string {
  const utcHour = new Date().getUTCHours();
  let offset = (targetHour - utcHour + 24) % 24; // 0..23
  if (offset > 14) offset -= 24;                 // -9..14, all real Etc zones
  return offset >= 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/** Today, as the given timezone sees it. */
function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

/** Local wall-clock HH:MM in the given timezone. */
function nowIn(tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

async function seedInTz(tz: string) {
  const seed = await seedReference(ctx.prisma);
  await ctx.prisma.country.update({
    where: { id: seed.country.id },
    data: { defaultTimezone: tz },
  });
  const activity = await ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'Past slot', titleAr: 'ع', slug: 'past-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و', locationAddress: 'Doha',
      locationLat: 25.28, locationLng: 51.53, pricePerPerson: 100,
      coverImage: '/p.webp', status: 'ACTIVE',
      bookingType: 'HOURLY', pricingModel: 'PER_PERSON',
      capacity: 10, checkInTime: '00:00', checkOutTime: '23:30', durationValue: 1,
    },
  });
  const customer = await ctx.prisma.user.create({
    data: {
      fullName: 'C', email: `c-${crypto.randomUUID().slice(0, 6)}@t.com`,
      password: '$2b$10$dummy.hash', role: 'CUSTOMER', emailVerified: true,
    },
  });
  return { activity, customer };
}

const PHONE = '+97455123456';
/** Local now sits in the 12:00 hour, so 08:00 is past and 16:00 is future. */
const MIDDAY_TZ = tzWithLocalHour(12);
const PAST_SLOT = '08:00';
const FUTURE_SLOT = '16:00';

// ════════════════════════════════════════════════════════════════════════════

describe('HOURLY — a slot that has already started today is refused', () => {

  it('a slot earlier today is refused', async () => {
    const svc = makeBookingsService();
    const { activity, customer } = await seedInTz(MIDDAY_TZ);

    // Guard the guard. If the zone arithmetic ever drifts, this fails loudly
    // rather than the test passing for the wrong reason.
    expect(nowIn(MIDDAY_TZ) > PAST_SLOT).toBe(true);

    await expect(
      svc.createBooking(customer.id, {
        activityId: activity.id, checkInDate: todayIn(MIDDAY_TZ), slotTime: PAST_SLOT,
        guests: 1, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow(/already started/i);
  });

  it('a LATER slot today is still bookable — the guard is not a blanket ban on today', async () => {
    const svc = makeBookingsService();
    const { activity, customer } = await seedInTz(MIDDAY_TZ);

    expect(nowIn(MIDDAY_TZ) < FUTURE_SLOT).toBe(true);

    const res = await svc.createBooking(customer.id, {
      activityId: activity.id, checkInDate: todayIn(MIDDAY_TZ), slotTime: FUTURE_SLOT,
      guests: 1, bookingPhone: PHONE,
    } as any);
    expect(res.booking.id).toBeTruthy();
  });

  it('the same slot on a FUTURE date is unaffected', async () => {
    // The guard is scoped to today. A 00:00 slot tomorrow has not started.
    const svc = makeBookingsService();
    const { activity, customer } = await seedInTz(MIDDAY_TZ);
    const tomorrow = new Date(`${todayIn(MIDDAY_TZ)}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const res = await svc.createBooking(customer.id, {
      activityId: activity.id,
      checkInDate: tomorrow.toISOString().slice(0, 10),
      slotTime: '00:00', guests: 1, bookingPhone: PHONE,
    } as any);
    expect(res.booking.id).toBeTruthy();
  });

  it('a past DATE is still refused by the older, date-level guard', async () => {
    // The two guards are distinct and both must hold. This one pins that the
    // new check did not displace the old one.
    const svc = makeBookingsService();
    const { activity, customer } = await seedInTz(MIDDAY_TZ);
    const yesterday = new Date(`${todayIn(MIDDAY_TZ)}T00:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    await expect(
      svc.createBooking(customer.id, {
        activityId: activity.id,
        checkInDate: yesterday.toISOString().slice(0, 10),
        slotTime: '23:00', guests: 1, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow(/past date/i);
  });
});

describe('DAILY is untouched by the hourly slot guard', () => {

  it('a stay starting TODAY is still accepted', async () => {
    // A stay is booked by date; its 14:00 check-in has no intra-day deadline.
    // Rejecting a same-day stay because "now" is past midnight would break
    // walk-in bookings entirely.
    const svc = makeBookingsService();
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.country.update({
      where: { id: seed.country.id },
      data: { defaultTimezone: MIDDAY_TZ },
    });
    const activity = await ctx.prisma.activity.create({
      data: {
        vendorId: seed.vendor.id, categoryId: seed.category.id,
        countryId: seed.country.id, cityId: seed.city.id,
        titleEn: 'Stay', titleAr: 'ع', slug: 'stay-' + crypto.randomUUID().slice(0, 8),
        descriptionEn: 'd', descriptionAr: 'و', locationAddress: 'Doha',
        locationLat: 25.28, locationLng: 51.53, pricePerPerson: 300,
        coverImage: '/p.webp', status: 'ACTIVE',
        bookingType: 'DAILY', pricingModel: 'PER_UNIT',
        hasUnits: true, unitCount: 1, unitCapacity: 4, capacity: 4,
        checkInTime: '14:00', checkOutTime: '11:00',
      },
    });
    const customer = await ctx.prisma.user.create({
      data: {
        fullName: 'C', email: `c-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy.hash', role: 'CUSTOMER', emailVerified: true,
      },
    });

    const today = todayIn(MIDDAY_TZ);
    const tomorrow = new Date(`${today}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const res = await svc.createBooking(customer.id, {
      activityId: activity.id, checkInDate: today,
      checkOutDate: tomorrow.toISOString().slice(0, 10),
      guests: 1, bookingPhone: PHONE,
    } as any);
    expect(res.booking.id).toBeTruthy();
  });
});
