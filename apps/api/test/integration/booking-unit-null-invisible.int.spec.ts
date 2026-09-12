/**
 * Integration — REPRODUCTION of the 2026-09-12 "Cavilam Resort" report.
 *
 * REPORTED SYMPTOM
 * ----------------
 * A customer booked a 1-unit resort for two nights. The booking is CONFIRMED.
 * The customer-facing calendar never showed those dates as fully booked, so
 * staff closed them by hand. Production confirms the calendar returns
 * `booked: 0` on days that really are booked.
 *
 * THE SEQUENCE THIS REPRODUCES
 * ----------------------------
 * `unitNumber` is only ever assigned when `hasUnits && unitCount > 0` at the
 * MOMENT OF BOOKING (bookings.service.ts, createBooking). The schema defaults
 * are `hasUnits = false` / `unitCount = 0`, so a booking taken before units
 * were switched on is stored with `unitNumber = null`.
 *
 * Once units ARE switched on, `rentsWholeUnit()` becomes true and availability
 * switches to counting UNITS. Every unit-counting path then skips null rows:
 *
 *   getCalendarAvailability  if (b.unitNumber != null && overlaps) occupied.add(...)
 *   getDailyAvailability     if (g.unitNumber == null) continue;
 *   createBooking            windowBookings.filter(b => b.unitNumber === unitNum)
 *
 * `null === 1` is false, so the booking is invisible to all three. It does not
 * show on the calendar AND it does not block a second booking of the same
 * dates — the inventory is silently double-sellable.
 *
 * These tests assert the BUGGY behaviour on purpose, so they FAIL the moment
 * the fix lands. That is the point: they pin the exact shape of the defect and
 * they are the regression guard afterwards. Each one says what it should become.
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
  const loyalty = new LoyaltyService(prismaSvc);
  return new BookingsService(
    prismaSvc,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn(), sendToMany: jest.fn() } as any,
    { acquire: jest.fn().mockResolvedValue('tok'), release: jest.fn().mockResolvedValue(undefined) } as any,
    {
      get: (k: string, fb?: string) =>
        (({ RESERVATION_WINDOW_MINUTES: '15', BOOKING_MAX_ADVANCE_YEARS: '2', REDIS_LOCK_TTL_MS: '30000' }) as Record<string, string>)[k] ?? fb,
    } as any,
    loyalty,
    {
      // get() returns null so every read recomputes from Postgres — we are
      // testing the computation, and a cache hit would mask it.
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

/** YYYY-MM-DD, N days from today (UTC). */
function d(daysFromNow: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + daysFromNow);
  return dt.toISOString().slice(0, 10);
}

/** 'YYYY-MM' of a 'YYYY-MM-DD' — the month the calendar endpoint expects. */
function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

const PHONE = '+97455123456';

/**
 * The resort AS IT WAS when the customer booked: units not yet switched on.
 * Mirrors Cavilam's real figures (1200/night, 25 guests, 15:00/12:00).
 */
async function makeResortUnitsOff(seed: any) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'Resort', titleAr: 'منتجع',
      slug: 'resort-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و',
      locationAddress: 'Al Ruwais', locationLat: 26.1396, locationLng: 51.2123,
      bookingType: 'DAILY', pricingModel: 'PER_UNIT',
      pricePerPerson: 1200,
      hasUnits: false, unitCount: 0, unitCapacity: 25, capacity: 25,
      durationValue: null,
      checkInTime: '15:00', checkOutTime: '12:00',
      coverImage: '/p.webp', status: 'ACTIVE',
    },
  });
}

/** What staff did later in the admin form: switch the unit option on. */
async function switchUnitsOn(activityId: string) {
  return ctx.prisma.activity.update({
    where: { id: activityId },
    data: { hasUnits: true, unitCount: 1, unitCapacity: 25 },
  });
}

async function makeCustomer() {
  return ctx.prisma.user.create({
    data: {
      fullName: 'C', email: `c-${crypto.randomUUID().slice(0, 6)}@t.com`,
      password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
    },
  });
}

/**
 * The reported scenario, start to finish: book with units off, confirm the
 * booking, switch units on, then look at what the customer sees.
 */
async function reproduce(checkIn: string, checkOut: string) {
  const seed = await seedReference(ctx.prisma);
  const svc = makeBookingsService();
  const act = await makeResortUnitsOff(seed);

  const { booking } = await svc.createBooking(seed.customer.id, {
    activityId: act.id, checkInDate: checkIn, checkOutDate: checkOut,
    guests: 2, bookingPhone: PHONE,
  });

  // The real booking is CONFIRMED (owner verified this in the admin dashboard),
  // so a PENDING-expiry explanation is ruled out by construction here.
  await ctx.prisma.booking.update({
    where: { id: booking.id },
    data: { status: 'CONFIRMED', reservedUntil: null },
  });

  await switchUnitsOn(act.id);

  return { seed, svc, act, bookingId: booking.id };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('A booking taken while the unit option was OFF', () => {

  test('is stored with unitNumber = null', async () => {
    const { bookingId } = await reproduce(d(5), d(7));

    const row = await ctx.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { unitNumber: true, status: true },
    });

    expect(row!.status).toBe('CONFIRMED');
    // This is the root cause. createBooking only assigns a unit when
    // `hasUnits && unitCount > 0`, which was false at booking time.
    expect(row!.unitNumber).toBeNull();
  });

  test('BUG: the calendar reports booked = 0 on nights that are occupied', async () => {
    const checkIn = d(5);
    const { svc, act } = await reproduce(checkIn, d(7));

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(checkIn));
    const day = cal.days.find((x: any) => x.date === checkIn);

    expect(day).toBeDefined();
    expect(day.capacity).toBe(1); // counting in UNITS now that units are on

    // ── the defect ──────────────────────────────────────────────────────────
    // A CONFIRMED guest occupies the only unit, yet the day reports nobody.
    // Matches production for Cavilam on 2026-09-17/18/19: booked = 0.
    expect(day.booked).toBe(0);
    expect(day.isFullyBooked).toBe(false);
    expect(day.available).toBe(1);
    // AFTER THE FIX this must become: booked = 1, available = 0,
    // isFullyBooked = true.
  });

  test('BUG: the booking form also shows the unit as free', async () => {
    const checkIn = d(5);
    const checkOut = d(7);
    const { svc, act } = await reproduce(checkIn, checkOut);

    const avail: any = await svc.getDailyAvailability(act.id, checkIn, checkOut);

    // getDailyAvailability skips null-unit rows (`if (g.unitNumber == null) continue`)
    // so unit 1 looks untouched.
    expect(avail.units[0].booked).toBe(0);
    expect(avail.units[0].available).toBe(avail.units[0].capacity);
    // AFTER THE FIX: booked reflects the guest and available is 0.
  });

  test('BUG: a SECOND customer can book the very same nights — double-sold', async () => {
    const checkIn = d(5);
    const checkOut = d(7);
    const { svc, act } = await reproduce(checkIn, checkOut);
    const second = await makeCustomer();

    // `windowBookings.filter(b => b.unitNumber === unitNum)` never matches the
    // null row, so unit 1 is offered again. This is the commercial risk: two
    // paying guests for one resort on the same nights.
    const dupe = await svc.createBooking(second.id, {
      activityId: act.id, checkInDate: checkIn, checkOutDate: checkOut,
      guests: 2, bookingPhone: PHONE,
    });
    expect(dupe.booking.unitNumber).toBe(1);

    const overlapping = await ctx.prisma.booking.count({
      where: {
        activityId: act.id,
        status: { notIn: ['CANCELLED'] },
        startDatetime: { lt: new Date(`${checkOut}T12:00:00.000Z`) },
        endDatetime: { gt: new Date(`${checkIn}T15:00:00.000Z`) },
      },
    });
    // Two live bookings on a one-unit resort for the same nights.
    expect(overlapping).toBe(2);
    // AFTER THE FIX the second createBooking must throw BOOKING.CAPACITY_FULL
    // and this count must stay at 1.
  });
});

describe('CONTROL — the same resort with units on from the start behaves correctly', () => {

  test('booking gets unit 1, calendar shows it, and a second booking is refused', async () => {
    const checkIn = d(5);
    const checkOut = d(7);
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();

    // Identical activity, except the unit option was set BEFORE anyone booked.
    const act = await makeResortUnitsOff(seed);
    await switchUnitsOn(act.id);

    const { booking } = await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: checkIn, checkOutDate: checkOut,
      guests: 2, bookingPhone: PHONE,
    });
    await ctx.prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'CONFIRMED', reservedUntil: null },
    });

    // A unit IS assigned this time.
    expect(booking.unitNumber).toBe(1);

    // ...so the calendar sees it.
    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(checkIn));
    const day = cal.days.find((x: any) => x.date === checkIn);
    expect(day.booked).toBe(1);
    expect(day.available).toBe(0);
    expect(day.isFullyBooked).toBe(true);

    // ...and the dates are protected.
    const second = await makeCustomer();
    await expect(
      svc.createBooking(second.id, {
        activityId: act.id, checkInDate: checkIn, checkOutDate: checkOut,
        guests: 2, bookingPhone: PHONE,
      }),
    ).rejects.toThrow(/fully booked|all units/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Separate, pre-existing defect surfaced while scoping the fix above.
// ═══════════════════════════════════════════════════════════════════════════

describe('A whole-property rental with the unit option OFF is sold BY THE SEAT', () => {

  /**
   * Mirrors "Stone Chalet Qatar - Private Chalet" in production:
   *   hasUnits=false, unitCount=0, pricingModel=PER_UNIT, capacity=8
   *
   * rentsWholeUnit() requires hasUnits, so with the option off this private
   * chalet falls through to SEAT counting against capacity=8 — in both the
   * calendar and createBooking (capacityLimit = activity.capacity ?? Infinity).
   *
   * Consequence: four unrelated families of two can each "book the chalet"
   * for the same night and all four succeed. Nothing in this file's fix
   * touches this path — it is broken independently, and turning the unit
   * option ON is what would fix it (which is exactly why the backfill step
   * matters: flipping it would otherwise orphan the existing bookings).
   */
  async function makeChaletUnitsOff(seed: any) {
    return ctx.prisma.activity.create({
      data: {
        vendorId: seed.vendor.id, categoryId: seed.category.id,
        countryId: seed.country.id, cityId: seed.city.id,
        titleEn: 'Chalet', titleAr: 'شاليه',
        slug: 'chalet-' + crypto.randomUUID().slice(0, 8),
        descriptionEn: 'd', descriptionAr: 'و',
        locationAddress: 'Doha', locationLat: 25.28, locationLng: 51.53,
        bookingType: 'DAILY', pricingModel: 'PER_UNIT',
        pricePerPerson: 2500,
        hasUnits: false, unitCount: 0, unitCapacity: 1, capacity: 8,
        durationValue: null,
        checkInTime: '15:00', checkOutTime: '12:00',
        coverImage: '/p.webp', status: 'ACTIVE',
      },
    });
  }

  test('BUG: four separate families each book the same chalet for the same night', async () => {
    const checkIn = d(5);
    const checkOut = d(6);
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeChaletUnitsOff(seed);

    // capacity 8, two guests per family -> the seat maths happily allows four.
    const ids = [seed.customer.id];
    for (let i = 0; i < 3; i++) ids.push((await makeCustomer()).id);

    for (const customerId of ids) {
      const { booking } = await svc.createBooking(customerId, {
        activityId: act.id, checkInDate: checkIn, checkOutDate: checkOut,
        guests: 2, bookingPhone: PHONE,
      });
      await ctx.prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'CONFIRMED', reservedUntil: null },
      });
      // No unit is assigned, and for this activity that is the CORRECT
      // behaviour - it is not a unit activity at all.
      expect(booking.unitNumber).toBeNull();
    }

    const live = await ctx.prisma.booking.count({
      where: {
        activityId: act.id,
        status: { notIn: ['CANCELLED'] },
        startDatetime: { lt: new Date(`${checkOut}T12:00:00.000Z`) },
        endDatetime: { gt: new Date(`${checkIn}T15:00:00.000Z`) },
      },
    });
    // Four confirmed bookings for ONE private chalet on ONE night.
    expect(live).toBe(4);

    // And the calendar still advertises room for more.
    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(checkIn));
    const day = cal.days.find((x: any) => x.date === checkIn);
    expect(day.capacity).toBe(8);   // seats, not "1 chalet"
    expect(day.booked).toBe(8);
    expect(day.isFullyBooked).toBe(true);
    // It only reads "full" because 4x2 guests happened to reach 8 seats.
    // A single family of two would have left it 75% "available".
  });

  test('BUG: one family of two leaves the whole chalet looking 75% available', async () => {
    const checkIn = d(5);
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeChaletUnitsOff(seed);

    const { booking } = await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: checkIn, checkOutDate: d(6),
      guests: 2, bookingPhone: PHONE,
    });
    await ctx.prisma.booking.update({
      where: { id: booking.id }, data: { status: 'CONFIRMED', reservedUntil: null },
    });

    const cal: any = await svc.getCalendarAvailability(act.id, monthOf(checkIn));
    const day = cal.days.find((x: any) => x.date === checkIn);
    expect(day.booked).toBe(2);
    expect(day.available).toBe(6);      // 6 "seats" in a booked private chalet
    expect(day.isFullyBooked).toBe(false);
  });
});
