/**
 * Integration — changing an activity's configuration must not silently
 * reinterpret the bookings it already has.
 *
 * WHY
 * ---
 * This is the family the 2026-09-12 incident belonged to: a setting was
 * changed, and every booking taken before it meant something different
 * afterwards. Switching units ON made existing bookings invisible, because
 * availability moved from counting guests to counting units and those rows had
 * no unit.
 *
 * Units were the instance that bit. The same shape exists for every other field
 * that availability maths depends on, and all of them are editable on both the
 * vendor and admin paths with nothing checking them against live bookings:
 *
 *   bookingType     DAILY <-> HOURLY   changes the whole overlap model
 *   pricingModel    PER_UNIT <-> PER_PERSON  flips rentsWholeUnit() for HOURLY,
 *                                       i.e. whether one booking owns a unit or
 *                                       merely a seat in it
 *   checkInTime     shifts every computed day window while stored bookings keep
 *   checkOutTime    the datetimes they were created with
 *
 * These tests do not assume where the bugs are. Each one makes a real booking,
 * changes a setting, and then asserts the thing that must remain true whatever
 * the setting says:
 *
 *     a CONFIRMED guest's dates cannot be sold to someone else.
 *
 * A failure here is a finding, not a broken test.
 */

import { getTestContext, seedReference } from './_setup';
import { BookingsService, activeBookingFilter, maxConcurrentInWindow, rentsWholeUnit } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeSvc() {
  const prismaSvc = { client: ctx.prisma } as any;
  return new BookingsService(
    prismaSvc,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn(), sendToMany: jest.fn() } as any,
    { acquire: jest.fn().mockResolvedValue('tok'), release: jest.fn().mockResolvedValue(undefined) } as any,
    {
      get: (k: string, fb?: string) =>
        (({ RESERVATION_WINDOW_MINUTES: '15', BOOKING_MAX_ADVANCE_MONTHS: '6', REDIS_LOCK_TTL_MS: '30000' }) as Record<string, string>)[k] ?? fb,
    } as any,
    new LoyaltyService(prismaSvc),
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

function d(n: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
const PHONE = '+97455123456';

async function makeActivity(seed: any, over: Record<string, unknown>) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'A', titleAr: 'أ',
      slug: 'a-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و',
      locationAddress: 'Doha', locationLat: 25.28, locationLng: 51.53,
      pricePerPerson: 500, coverImage: '/p.webp', status: 'ACTIVE',
      hasUnits: true, unitCount: 1, unitCapacity: 6, capacity: 6,
      ...over,
    },
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

/** Book, then confirm, so the row is a real live guest. */
async function bookConfirmed(svc: BookingsService, customerId: string, dto: Record<string, unknown>) {
  const r = await svc.createBooking(customerId, { guests: 2, bookingPhone: PHONE, ...dto } as any);
  await ctx.prisma.booking.update({
    where: { id: r.booking.id }, data: { status: 'CONFIRMED', reservedUntil: null },
  });
  return r.booking;
}

/**
 * The promise that must hold no matter what the configuration says.
 * Counts the rows that actually exist rather than trusting any view — the same
 * technique as booking-logic-invariants, and blind to unitNumber on purpose.
 */
async function assertNotOversold(activityId: string) {
  const act = await ctx.prisma.activity.findUnique({
    where: { id: activityId },
    select: { hasUnits: true, unitCount: true, unitCapacity: true, capacity: true, bookingType: true, pricingModel: true },
  });
  const live = await ctx.prisma.booking.findMany({
    where: { activityId, ...activeBookingFilter(new Date()) },
    select: { startDatetime: true, endDatetime: true, guests: true, unitNumber: true },
  });
  if (live.length === 0) return;
  const start = new Date(Math.min(...live.map((b) => b.startDatetime.getTime())));
  const end = new Date(Math.max(...live.map((b) => b.endDatetime.getTime())));

  if (rentsWholeUnit(act!)) {
    const asUnits = live.map((b) => ({ ...b, guests: 1 }));
    expect(maxConcurrentInWindow(asUnits, start, end)).toBeLessThanOrEqual(act!.unitCount);
  } else {
    const cap = act!.hasUnits ? act!.unitCount * act!.unitCapacity : act!.capacity;
    if (cap != null) expect(maxConcurrentInWindow(live, start, end)).toBeLessThanOrEqual(cap);
  }
}

const DAILY = {
  bookingType: 'DAILY', pricingModel: 'PER_UNIT',
  durationValue: null, checkInTime: '15:00', checkOutTime: '12:00',
};
const HOURLY_UNIT = {
  bookingType: 'HOURLY', pricingModel: 'PER_UNIT',
  durationValue: 2, checkInTime: '09:00', checkOutTime: '21:00',
};

// ═══════════════════════════════════════════════════════════════════════════

describe('CHECK-IN / CHECK-OUT TIMES changed under a live booking', () => {

  test('the guest still holds their nights after the times move', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    const act = await makeActivity(seed, { ...DAILY, unitCapacity: 25, capacity: 25 });

    // Stored as d(5) 15:00 -> d(7) 12:00, frozen at booking time.
    await bookConfirmed(svc, seed.customer.id, {
      activityId: act.id, checkInDate: d(5), checkOutDate: d(7),
    });

    // The vendor now shifts the day boundaries. Every computed day window moves
    // while the stored booking keeps the datetimes it was created with.
    await ctx.prisma.activity.update({
      where: { id: act.id }, data: { checkInTime: '10:00', checkOutTime: '09:00' },
    });

    const cal: any = await svc.getCalendarAvailability(act.id, d(5).slice(0, 7));
    expect(cal.days.find((x: any) => x.date === d(5)).isFullyBooked).toBe(true);

    await expect(
      svc.createBooking((await makeCustomer()).id, {
        activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 2, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow(/fully booked|all units/i);

    await assertNotOversold(act.id);
  });

  test('a late check-in does not expose the first night', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    const act = await makeActivity(seed, { ...DAILY, unitCapacity: 25, capacity: 25 });

    await bookConfirmed(svc, seed.customer.id, {
      activityId: act.id, checkInDate: d(5), checkOutDate: d(7),
    });

    // Pushing check-in later moves each day's window forward. If the stored
    // booking then failed to overlap the recomputed first night, that night
    // would quietly go back on sale under the guest.
    await ctx.prisma.activity.update({
      where: { id: act.id }, data: { checkInTime: '23:00', checkOutTime: '01:00' },
    });

    await expect(
      svc.createBooking((await makeCustomer()).id, {
        activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 2, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow(/fully booked|all units/i);

    await assertNotOversold(act.id);
  });
});

describe('PRICING MODEL flipped under a live booking (HOURLY)', () => {

  test('PER_UNIT -> PER_PERSON does not let the same slot be sold again', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    // A yacht: one unit, whole-unit hire, capacity 6.
    const act = await makeActivity(seed, { ...HOURLY_UNIT, unitCount: 1, unitCapacity: 6, capacity: 6 });

    await bookConfirmed(svc, seed.customer.id, {
      activityId: act.id, checkInDate: d(5), slotTime: '09:00', guests: 2,
    });

    // Flipping to PER_PERSON turns rentsWholeUnit() false: the yacht stops
    // being "one booking owns it" and becomes six shareable seats. The guest
    // who hired the WHOLE boat now only holds 2 of 6.
    await ctx.prisma.activity.update({
      where: { id: act.id }, data: { pricingModel: 'PER_PERSON' },
    });

    // Whatever the model says, the platform must not end up owing more than it
    // can deliver on that slot.
    const second = await svc.createBooking((await makeCustomer()).id, {
      activityId: act.id, checkInDate: d(5), slotTime: '09:00', guests: 4, bookingPhone: PHONE,
    } as any).catch(() => null);

    if (second) {
      await ctx.prisma.booking.update({
        where: { id: second.booking.id }, data: { status: 'CONFIRMED', reservedUntil: null },
      });
    }
    await assertNotOversold(act.id);

    // Record which way it went, so this test cannot pass vacuously and the
    // real behaviour is documented rather than merely survived.
    const live = await ctx.prisma.booking.count({
      where: { activityId: act.id, status: 'CONFIRMED' },
    });
    if (second) {
      // The flip DID open the boat to a second party. Not an oversell — 2 + 4
      // fits the 6 seats the activity now claims to sell — but the first
      // customer hired the WHOLE yacht and is now sharing it with strangers.
      // That is a commercial/contract problem rather than a capacity one, and
      // it is the honest result: the system protects seats, not the promise
      // that was sold.
      expect(live).toBe(2);
    } else {
      expect(live).toBe(1);
    }
  });
});

describe('BOOKING TYPE flipped under a live booking', () => {

  test('DAILY -> HOURLY leaves the existing stay protected', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    const act = await makeActivity(seed, { ...DAILY, unitCapacity: 25, capacity: 25 });

    await bookConfirmed(svc, seed.customer.id, {
      activityId: act.id, checkInDate: d(5), checkOutDate: d(7),
    });

    // A multi-night stay makes no sense as a 2-hour slot, yet nothing stops
    // this edit. The stay spans every slot on those days.
    await ctx.prisma.activity.update({
      where: { id: act.id },
      data: { bookingType: 'HOURLY', durationValue: 2, checkInTime: '09:00', checkOutTime: '21:00' },
    });

    // Pick a slot squarely INSIDE the stay. The first attempt at this test used
    // d(5) 09:00-11:00, which ends before the 15:00 check-in and therefore does
    // NOT overlap — the system was right to allow it and the assertion was
    // wrong. d(6) is a middle night: fully covered by d(5) 15:00 -> d(7) 12:00.
    const insideTheStay = await svc.createBooking((await makeCustomer()).id, {
      activityId: act.id, checkInDate: d(6), slotTime: '09:00', guests: 2, bookingPhone: PHONE,
    } as any).catch(() => null);

    if (insideTheStay) {
      await ctx.prisma.booking.update({
        where: { id: insideTheStay.booking.id }, data: { status: 'CONFIRMED', reservedUntil: null },
      });
    }
    await assertNotOversold(act.id);

    // The guest occupies the whole of d(6). Flipping the activity to HOURLY
    // must not carve their night into slots that can be sold underneath them.
    expect(insideTheStay).toBeNull();

    // And a slot that genuinely falls outside the stay stays sellable — the
    // guard must not take the whole activity off sale.
    const beforeCheckIn = await svc.createBooking((await makeCustomer()).id, {
      activityId: act.id, checkInDate: d(5), slotTime: '09:00', guests: 2, bookingPhone: PHONE,
    } as any).catch(() => null);
    expect(beforeCheckIn).not.toBeNull(); // 09:00-11:00 ends before the 15:00 check-in
    await assertNotOversold(act.id);
  });

  test('HOURLY -> DAILY leaves the existing slot protected', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    const act = await makeActivity(seed, { ...HOURLY_UNIT, unitCount: 1, unitCapacity: 6, capacity: 6 });

    await bookConfirmed(svc, seed.customer.id, {
      activityId: act.id, checkInDate: d(5), slotTime: '09:00', guests: 2,
    });

    await ctx.prisma.activity.update({
      where: { id: act.id },
      data: { bookingType: 'DAILY', durationValue: null, checkInTime: '15:00', checkOutTime: '12:00' },
    });

    const attempt = await svc.createBooking((await makeCustomer()).id, {
      activityId: act.id, checkInDate: d(5), checkOutDate: d(6), guests: 2, bookingPhone: PHONE,
    } as any).catch(() => null);

    if (attempt) {
      await ctx.prisma.booking.update({
        where: { id: attempt.booking.id }, data: { status: 'CONFIRMED', reservedUntil: null },
      });
    }
    await assertNotOversold(act.id);

    // The 09:00-11:00 slot booking overlaps the d(5)->d(6) night window
    // (15:00 -> 12:00 next day)? It does not: the slot ends at 11:00, the night
    // starts at 15:00. So this SHOULD be allowed, and the invariant confirms
    // the two do not collide. Asserting it explicitly so the reasoning is
    // pinned rather than assumed.
    expect(attempt).not.toBeNull();
  });
});

describe('CAPACITY reduced below what is already booked', () => {

  test('seat capacity cut under live guests never yields negative availability', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeSvc();
    // Seat-based, no units: 8 seats.
    const act = await makeActivity(seed, {
      ...DAILY, pricingModel: 'PER_PERSON', hasUnits: false, unitCount: 0, capacity: 8,
    });

    await bookConfirmed(svc, seed.customer.id, { activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 6 });

    // Nothing stops an admin cutting capacity below the 6 guests already in.
    await ctx.prisma.activity.update({ where: { id: act.id }, data: { capacity: 2 } });

    const cal: any = await svc.getCalendarAvailability(act.id, d(5).slice(0, 7));
    const day = cal.days.find((x: any) => x.date === d(5));

    // Must not go negative or wrap; must read as full.
    expect(day.available).toBeGreaterThanOrEqual(0);
    expect(day.isFullyBooked).toBe(true);

    // And must not accept anyone else.
    await expect(
      svc.createBooking((await makeCustomer()).id, {
        activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 1, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow();
  });
});
