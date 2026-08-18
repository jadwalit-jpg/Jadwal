/**
 * Integration — single-unit partial-overlap scenarios (DAILY + HOURLY).
 *
 * Core question: if unit 1 is taken on Day N, can a customer book a multi-day
 * stay that INCLUDES Day N? Answer: NO — the unit is exclusive; any overlap
 * with an existing booking on the same unit makes the whole requested range
 * unavailable.
 *
 * The overlap predicate used everywhere (createBooking + availability) is:
 *   existing.start < new.end  AND  existing.end > new.start
 *
 * "End-touching-start" (existing ends exactly when new starts, or vice versa)
 * does NOT satisfy the strict inequality → the two windows do NOT overlap →
 * the unit is free.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DAILY scenarios (1 unit, whole-unit rental, flexible nights):
 *
 *  D-1  Existing: Jan14→Jan15 (1 night).  New: Jan10→Jan15 (spans Jan14) → BLOCKED
 *  D-2  Existing: Jan14→Jan15.            New: Jan10→Jan13 (ends before Jan14) → OK
 *  D-3  Existing: Jan14→Jan15.            New: Jan15→Jan20 (starts after checkout) → OK
 *  D-4  Existing: Jan10→Jan15 (5 nights). New: Jan12→Jan17 (overlapping) → BLOCKED
 *  D-5  getDailyAvailability reports unit=0 for any window that overlaps the booked range
 *       and unit=cap for windows that don't.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOURLY scenarios (1 unit, PER_UNIT → whole-unit, 2h duration, 09:00–21:00):
 *
 *  H-1  Existing: slot 12:00–14:00.   New multi-slot: 10:00–14:00 (spans 12:00) → BLOCKED
 *  H-2  Existing: slot 10:00–14:00 (multi-slot). New single: 12:00–14:00 (inside) → BLOCKED
 *  H-3  Existing: slot 12:00–14:00.   New: 10:00–12:00 (ends exactly when existing starts) → OK
 *  H-4  Existing: slot 12:00–14:00.   New: 14:00–16:00 (starts exactly when existing ends) → OK
 *  H-5  getHourlyAvailability reports unit=0 for the booked slot; adjacent slots stay open.
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
    { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
}

/** YYYY-MM-DD for N days from today (UTC). */
function d(daysFromNow: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + daysFromNow);
  return dt.toISOString().slice(0, 10);
}

const PHONE = '+97455123456';

/** Single-unit DAILY activity (1 room, capacity 4, flexible nights). */
async function makeDailyUnit1(seed: any) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'Room', titleAr: 'غرفة',
      slug: 'room-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و',
      locationAddress: 'Doha', locationLat: 25.28, locationLng: 51.53,
      bookingType: 'DAILY', pricingModel: 'PER_UNIT',
      pricePerPerson: 300,
      hasUnits: true, unitCount: 1, unitCapacity: 4, capacity: 4,
      durationValue: null,          // flexible nights
      checkInTime: '14:00', checkOutTime: '11:00',
      coverImage: '/p.webp', status: 'ACTIVE',
    },
  });
}

/** Single-unit HOURLY PER_UNIT activity (1 unit, capacity 4, 2h duration, 09:00-21:00). */
async function makeHourlyUnit1(seed: any) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'Cabin', titleAr: 'كابينة',
      slug: 'cabin-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و',
      locationAddress: 'Doha', locationLat: 25.28, locationLng: 51.53,
      bookingType: 'HOURLY', pricingModel: 'PER_UNIT',
      pricePerPerson: 100,
      hasUnits: true, unitCount: 1, unitCapacity: 4, capacity: 4,
      durationValue: 2, checkInTime: '09:00', checkOutTime: '21:00',
      coverImage: '/p.webp', status: 'ACTIVE',
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

// ═══════════════════════════════════════════════════════════════════════════
// DAILY scenarios
// ═══════════════════════════════════════════════════════════════════════════

describe('DAILY single-unit — existing booking blocks any range that includes its nights', () => {

  test('D-1: 5-night stay Jan10–Jan15 BLOCKED because unit is booked on Jan14', async () => {
    // Existing: Jan14→Jan15 (1 night, checkIn=d(14), checkOut=d(15))
    // startDatetime = d(14)T14:00Z, endDatetime = d(15)T11:00Z
    //
    // New attempt: Jan10→Jan15 (5 nights, checkIn=d(10), checkOut=d(15))
    // new.start = d(10)T14:00Z, new.end = d(15)T11:00Z
    //
    // Overlap: existing.start d(14)T14 < new.end d(15)T11 ✓
    //          existing.end   d(15)T11 > new.start d(10)T14 ✓ → OVERLAPS → BLOCKED
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDailyUnit1(seed);
    const c2 = await makeCustomer();

    // First customer books Jan14→Jan15 (day-14 to day-15)
    const existing = await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: d(14), checkOutDate: d(15), guests: 1, bookingPhone: PHONE,
    });
    expect(existing.booking.status).toBe('PENDING');

    // Second customer tries Jan10→Jan15 — spans the already-booked Jan14 night
    await expect(
      svc.createBooking(c2.id, {
        activityId: act.id, checkInDate: d(10), checkOutDate: d(15), guests: 1, bookingPhone: PHONE,
      }),
    ).rejects.toThrow(/fully booked|all units/i);
  });

  test('D-2: Jan10→Jan13 (ends BEFORE Jan14 check-in time) succeeds — no overlap', async () => {
    // new.end = d(13)T11:00Z  <  existing.start = d(14)T14:00Z → strict less-than, no overlap
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDailyUnit1(seed);
    const c2 = await makeCustomer();

    await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: d(14), checkOutDate: d(15), guests: 1, bookingPhone: PHONE,
    });

    // Jan10→Jan13 — checkout day is d(13), endDatetime = d(13)T11:00Z
    // d(13)T11 < d(14)T14 → existing booking NOT in windowBookings → unit free
    const b = await svc.createBooking(c2.id, {
      activityId: act.id, checkInDate: d(10), checkOutDate: d(13), guests: 1, bookingPhone: PHONE,
    });
    expect(b.booking.status).toBe('PENDING');
  });

  test('D-3: Jan15→Jan20 (starts on checkout day, AFTER checkout time) succeeds — no overlap', async () => {
    // existing.end = d(15)T11:00Z  <  new.start = d(15)T14:00Z → strict less-than, no overlap
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDailyUnit1(seed);
    const c2 = await makeCustomer();

    await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: d(14), checkOutDate: d(15), guests: 1, bookingPhone: PHONE,
    });

    // Jan15→Jan20 — check-in day is d(15) at 14:00, which is AFTER existing's checkout at 11:00
    const b = await svc.createBooking(c2.id, {
      activityId: act.id, checkInDate: d(15), checkOutDate: d(20), guests: 1, bookingPhone: PHONE,
    });
    expect(b.booking.status).toBe('PENDING');
  });

  test('D-4: 5-night stay Jan10–Jan15 exists; Jan12–Jan17 (partial overlap) BLOCKED', async () => {
    // Existing: d(10)→d(15), new: d(12)→d(17)
    // existing.start d(10)T14 < new.end d(17)T11 ✓
    // existing.end   d(15)T11 > new.start d(12)T14 ✓ → overlap → BLOCKED
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDailyUnit1(seed);
    const c2 = await makeCustomer();

    await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: d(10), checkOutDate: d(15), guests: 1, bookingPhone: PHONE,
    });

    await expect(
      svc.createBooking(c2.id, {
        activityId: act.id, checkInDate: d(12), checkOutDate: d(17), guests: 1, bookingPhone: PHONE,
      }),
    ).rejects.toThrow(/fully booked|all units/i);
  });

  test('D-5: getDailyAvailability reflects the unit state — blocked for overlapping windows, open for non-overlapping', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeDailyUnit1(seed);

    // Book unit 1 for d(14)→d(15)
    await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: d(14), checkOutDate: d(15), guests: 1, bookingPhone: PHONE,
    });

    // Window that INCLUDES the booked night → unit shows available=0
    const blocked = await svc.getDailyAvailability(act.id, d(10), d(15)) as any;
    expect(blocked.units).toHaveLength(1);
    expect(blocked.units[0]).toMatchObject({ unitNumber: 1, available: 0 });

    // Window BEFORE the booked night (d(10)→d(13), ends d(13)T11 < d(14)T14) → unit open
    const before = await svc.getDailyAvailability(act.id, d(10), d(13)) as any;
    expect(before.units[0].available).toBe(4); // unitCapacity

    // Window AFTER the booked night (d(15)→d(18), starts d(15)T14 > d(15)T11) → unit open
    const after = await svc.getDailyAvailability(act.id, d(15), d(18)) as any;
    expect(after.units[0].available).toBe(4);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// HOURLY scenarios
// ═══════════════════════════════════════════════════════════════════════════

describe('HOURLY single-unit PER_UNIT — existing slot blocks any multi-slot span that includes it', () => {

  test('H-1: existing 12:00–14:00; multi-slot attempt 10:00–14:00 (spans 12:00) BLOCKED', async () => {
    // existing: start=12:00, end=14:00
    // new: start=10:00, end=14:00 (slotEndTime='14:00')
    // overlap: existing.start 12 < new.end 14 ✓, existing.end 14 > new.start 10 ✓ → BLOCKED
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeHourlyUnit1(seed);
    const date = d(7);
    const c2 = await makeCustomer();

    const a = await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: date, slotTime: '12:00', guests: 1, bookingPhone: PHONE,
    });
    expect(a.booking.status).toBe('PENDING');

    // Multi-slot 10:00–14:00 spans the already-booked 12:00–14:00
    await expect(
      svc.createBooking(c2.id, {
        activityId: act.id, checkInDate: date, slotTime: '10:00', slotEndTime: '14:00', guests: 1, bookingPhone: PHONE,
      }),
    ).rejects.toThrow(/fully booked|all units/i);
  });

  test('H-2: existing multi-slot 10:00–14:00; single slot 12:00 (inside) BLOCKED', async () => {
    // existing: start=10:00, end=14:00 (spans 12:00–14:00 slot inside it)
    // new: start=12:00, end=14:00
    // overlap: existing.start 10 < new.end 14 ✓, existing.end 14 > new.start 12 ✓ → BLOCKED
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeHourlyUnit1(seed);
    const date = d(7);
    const c2 = await makeCustomer();

    // Book the wide 10:00–14:00 window first
    await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: date, slotTime: '10:00', slotEndTime: '14:00', guests: 1, bookingPhone: PHONE,
    });

    // Single slot 12:00 falls INSIDE the existing booking → BLOCKED
    await expect(
      svc.createBooking(c2.id, {
        activityId: act.id, checkInDate: date, slotTime: '12:00', guests: 1, bookingPhone: PHONE,
      }),
    ).rejects.toThrow(/fully booked|all units/i);
  });

  test('H-3: existing 12:00–14:00; slot 10:00–12:00 (ends exactly when existing starts) → OK', async () => {
    // existing.start = 12:00T. new.end = 12:00T.
    // Overlap requires: existing.end > new.start AND existing.start < new.end
    // existing.start(12) < new.end(12)? NO (strict less-than) → NOT overlapping → unit free.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeHourlyUnit1(seed);
    const date = d(7);
    const c2 = await makeCustomer();

    await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: date, slotTime: '12:00', guests: 1, bookingPhone: PHONE,
    });

    // 10:00–12:00 ends precisely when existing starts — not concurrent
    const b = await svc.createBooking(c2.id, {
      activityId: act.id, checkInDate: date, slotTime: '10:00', guests: 1, bookingPhone: PHONE,
    });
    expect(b.booking.status).toBe('PENDING');
  });

  test('H-4: existing 12:00–14:00; slot 14:00–16:00 (starts exactly when existing ends) → OK', async () => {
    // existing.end = 14:00T. new.start = 14:00T.
    // Overlap requires: existing.end > new.start → 14:00 > 14:00? NO → NOT overlapping → unit free.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeHourlyUnit1(seed);
    const date = d(7);
    const c2 = await makeCustomer();

    await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: date, slotTime: '12:00', guests: 1, bookingPhone: PHONE,
    });

    // 14:00 starts precisely when existing ends — not concurrent
    const b = await svc.createBooking(c2.id, {
      activityId: act.id, checkInDate: date, slotTime: '14:00', guests: 1, bookingPhone: PHONE,
    });
    expect(b.booking.status).toBe('PENDING');
  });

  test('H-5: getHourlyAvailability shows unit=0 for the booked slot; before/after slots open', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeHourlyUnit1(seed);
    const date = d(7);

    // Book 12:00–14:00
    await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: date, slotTime: '12:00', guests: 1, bookingPhone: PHONE,
    });

    const avail: any = await svc.getHourlyAvailability(act.id, date);
    const slots = avail.slots as any[];

    const slot12 = slots.find((s: any) => s.slotStart === '12:00');
    const slot10 = slots.find((s: any) => s.slotStart === '10:00');
    const slot14 = slots.find((s: any) => s.slotStart === '14:00');

    expect(slot12).toBeDefined();
    // Unit 1 is taken at 12:00
    expect(slot12.units.find((u: any) => u.unitNumber === 1).available).toBe(0);

    // Slots before and after should be open (unit free)
    if (slot10) {
      expect(slot10.units.find((u: any) => u.unitNumber === 1).available).toBeGreaterThan(0);
    }
    if (slot14) {
      expect(slot14.units.find((u: any) => u.unitNumber === 1).available).toBeGreaterThan(0);
    }
  });

  test('H-6: three consecutive slots all succeed on the same unit (back-to-back fills)', async () => {
    // 10:00–12:00 → 12:00–14:00 → 14:00–16:00 on the same unit.
    // Each ends exactly when the next starts → none overlap → all 3 succeed.
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeHourlyUnit1(seed);
    const date = d(7);
    const c2 = await makeCustomer();
    const c3 = await makeCustomer();

    const a = await svc.createBooking(seed.customer.id, {
      activityId: act.id, checkInDate: date, slotTime: '10:00', guests: 1, bookingPhone: PHONE,
    });
    const b = await svc.createBooking(c2.id, {
      activityId: act.id, checkInDate: date, slotTime: '12:00', guests: 1, bookingPhone: PHONE,
    });
    const c = await svc.createBooking(c3.id, {
      activityId: act.id, checkInDate: date, slotTime: '14:00', guests: 1, bookingPhone: PHONE,
    });

    expect(a.booking.status).toBe('PENDING');
    expect(b.booking.status).toBe('PENDING');
    expect(c.booking.status).toBe('PENDING');

    // All 3 ended up in unit 1 (the only unit)
    const bookings = await ctx.prisma.booking.findMany({ select: { unitNumber: true } });
    expect(bookings.every((b) => b.unitNumber === 1)).toBe(true);
    expect(await ctx.prisma.booking.count()).toBe(3);
  });

});
