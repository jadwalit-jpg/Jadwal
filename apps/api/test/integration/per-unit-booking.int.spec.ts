/**
 * Integration — whole-unit ("per-unit" / room) reservation, end-to-end.
 *
 * Rule under test (bookings.service `rentsWholeUnit`): a booking reserves an
 * ENTIRE unit — no seat-sharing, regardless of guest count — for:
 *   • HOURLY activities priced PER_UNIT, and
 *   • any DAILY activity with units (rooms — DAILY is always per-unit priced).
 * HOURLY + PER_PERSON activities with units still sell individual seats (shared).
 *
 * Verifies the booking path (real $transaction) AND the availability endpoints
 * agree: a unit taken by anyone shows 0 available; the next booking goes to a
 * different unit; when all units are taken, booking is rejected.
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
  const noopNotify = { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn().mockResolvedValue(undefined), sendToMany: jest.fn().mockResolvedValue(undefined) } as any;
  const redisLock = { acquire: jest.fn().mockResolvedValue('lock'), release: jest.fn().mockResolvedValue(undefined) } as any;
  const config = { get: (k: string, fb?: string) => (({ RESERVATION_WINDOW_MINUTES: '15', BOOKING_MAX_ADVANCE_MONTHS: '6', REDIS_LOCK_TTL_MS: '30000' }) as Record<string, string>)[k] ?? fb } as any;
  const cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any;
  return new BookingsService(
    prismaSvc, { log: jest.fn().mockResolvedValue(undefined) } as any, noopNotify, redisLock,
    config, loyalty, cache,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
}

function futureDate(days: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function makeActivity(seed: any, overrides: Record<string, any>) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id, countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'Units', titleAr: 'و', slug: 'units-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و', locationAddress: 'Doha', locationLat: 25.28, locationLng: 51.53,
      pricePerPerson: 100, coverImage: '/p.webp', status: 'ACTIVE',
      ...overrides,
    },
  });
}

async function makeCustomer() {
  return ctx.prisma.user.create({
    data: { fullName: 'C', email: `c-${crypto.randomUUID().slice(0, 6)}@t.com`, password: '$2b$10$dummy.hash', role: 'CUSTOMER', emailVerified: true },
  });
}

async function unitOf(bookingId: string): Promise<number | null> {
  const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { unitNumber: true } });
  return row.unitNumber;
}

const PHONE = '+97455123456';

// ═══════════════════════════════════════════════════════════════════════════
// HOURLY + PER_UNIT → whole unit, no sharing
// ═══════════════════════════════════════════════════════════════════════════
describe('HOURLY PER_UNIT — one booking owns the whole unit', () => {
  test('partial-guest booking takes the entire unit; next booking gets a different unit; full → rejected', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeActivity(seed, {
      bookingType: 'HOURLY', pricingModel: 'PER_UNIT', hasUnits: true,
      unitCount: 2, unitCapacity: 10, capacity: 20, durationValue: 2,
      checkInTime: '09:00', checkOutTime: '21:00',
    });
    const date = futureDate(7);
    const c2 = await makeCustomer();
    const c3 = await makeCustomer();

    // A books only 2 of 10 seats → still consumes the WHOLE unit.
    const a = await svc.createBooking(seed.customer.id, { activityId: act.id, checkInDate: date, slotTime: '10:00', guests: 2, bookingPhone: PHONE });
    const aUnit = await unitOf(a.booking.id);
    expect(aUnit).toBe(1);

    // Availability: unit 1 fully taken (0 left) despite only 2 guests; unit 2 free.
    const avail: any = await svc.getHourlyAvailability(act.id, date);
    const slot = avail.slots.find((s: any) => s.slotStart === '10:00');
    expect(slot.units.find((u: any) => u.unitNumber === 1).available).toBe(0);
    expect(slot.units.find((u: any) => u.unitNumber === 2).available).toBe(10);

    // B books 3 → goes to unit 2 (NOT shared into unit 1).
    const b = await svc.createBooking(c2.id, { activityId: act.id, checkInDate: date, slotTime: '10:00', guests: 3, bookingPhone: PHONE });
    expect(await unitOf(b.booking.id)).toBe(2);

    // C → both units taken → rejected.
    await expect(
      svc.createBooking(c3.id, { activityId: act.id, checkInDate: date, slotTime: '10:00', guests: 1, bookingPhone: PHONE }),
    ).rejects.toThrow(/fully booked|all units/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DAILY (rooms) → whole room, no sharing (even when priced PER_PERSON)
// ═══════════════════════════════════════════════════════════════════════════
describe('DAILY rooms — a booked room is exclusive', () => {
  test('a 2-guest booking takes the whole 4-cap room; next booking gets the other room; full → rejected', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeActivity(seed, {
      bookingType: 'DAILY', pricingModel: 'PER_PERSON', hasUnits: true, // DAILY is exclusive regardless of pricing model
      unitCount: 2, unitCapacity: 4, capacity: 8, durationValue: null,
      checkInTime: '14:00', checkOutTime: '11:00', pricePerPerson: 200,
    });
    const ci = futureDate(7), co = futureDate(8);
    const c2 = await makeCustomer();
    const c3 = await makeCustomer();

    const a = await svc.createBooking(seed.customer.id, { activityId: act.id, checkInDate: ci, checkOutDate: co, guests: 2, bookingPhone: PHONE });
    expect(await unitOf(a.booking.id)).toBe(1);

    const avail: any = await svc.getDailyAvailability(act.id, ci, co);
    expect(avail.units.find((u: any) => u.unitNumber === 1).available).toBe(0); // whole room taken
    expect(avail.units.find((u: any) => u.unitNumber === 2).available).toBe(4);

    const b = await svc.createBooking(c2.id, { activityId: act.id, checkInDate: ci, checkOutDate: co, guests: 2, bookingPhone: PHONE });
    expect(await unitOf(b.booking.id)).toBe(2);

    await expect(
      svc.createBooking(c3.id, { activityId: act.id, checkInDate: ci, checkOutDate: co, guests: 1, bookingPhone: PHONE }),
    ).rejects.toThrow(/fully booked|all units/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// User scenario — 2 units (cap 10): A & B take both units, C must be REJECTED
// on the SAME date+time (no seat-sharing for PER_UNIT).
// ═══════════════════════════════════════════════════════════════════════════
describe('2 units cap 10 — A & B fill both, C cannot book the same date+time', () => {
  test('userA → unit 1, userB → unit 2, userC same slot → rejected (both units gone)', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeActivity(seed, {
      bookingType: 'HOURLY', pricingModel: 'PER_UNIT', hasUnits: true,
      unitCount: 2, unitCapacity: 10, capacity: 20, durationValue: 2,
      checkInTime: '09:00', checkOutTime: '21:00',
    });
    const date = futureDate(7);
    const userA = seed.customer;            // existing seeded customer
    const userB = await makeCustomer();
    const userC = await makeCustomer();

    // A books the 12:00 slot (4 of 10 seats) → owns the WHOLE first unit.
    const a = await svc.createBooking(userA.id, { activityId: act.id, checkInDate: date, slotTime: '12:00', guests: 4, bookingPhone: PHONE });
    expect(await unitOf(a.booking.id)).toBe(1);

    // B books the SAME 12:00 slot → goes to the second unit (not shared into unit 1).
    const b = await svc.createBooking(userB.id, { activityId: act.id, checkInDate: date, slotTime: '12:00', guests: 4, bookingPhone: PHONE });
    expect(await unitOf(b.booking.id)).toBe(2);

    // Availability for that exact slot: BOTH units show 0 left.
    const avail: any = await svc.getHourlyAvailability(act.id, date);
    const slot = avail.slots.find((s: any) => s.slotStart === '12:00');
    expect(slot.units.every((u: any) => u.available === 0)).toBe(true);

    // C tries the SAME date+time → both units are taken → MUST be rejected.
    await expect(
      svc.createBooking(userC.id, { activityId: act.id, checkInDate: date, slotTime: '12:00', guests: 1, bookingPhone: PHONE }),
    ).rejects.toThrow(/fully booked|all units/i);

    // Sanity: a DIFFERENT slot (14:00) is still bookable for C.
    const c = await svc.createBooking(userC.id, { activityId: act.id, checkInDate: date, slotTime: '14:00', guests: 1, bookingPhone: PHONE });
    expect(await unitOf(c.booking.id)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Control — HOURLY + PER_PERSON units STILL share seats (no regression)
// ═══════════════════════════════════════════════════════════════════════════
describe('HOURLY PER_PERSON units — seats still shared', () => {
  test('two bookings pack into the same unit until its seats run out', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const act = await makeActivity(seed, {
      bookingType: 'HOURLY', pricingModel: 'PER_PERSON', hasUnits: true,
      unitCount: 2, unitCapacity: 10, capacity: 20, durationValue: 2,
      checkInTime: '09:00', checkOutTime: '21:00',
    });
    const date = futureDate(7);
    const c2 = await makeCustomer();

    const a = await svc.createBooking(seed.customer.id, { activityId: act.id, checkInDate: date, slotTime: '10:00', guests: 3, bookingPhone: PHONE });
    expect(await unitOf(a.booking.id)).toBe(1);

    // unit 1 has 7 seats left and is still sellable.
    const avail: any = await svc.getHourlyAvailability(act.id, date);
    expect(avail.slots.find((s: any) => s.slotStart === '10:00').units.find((u: any) => u.unitNumber === 1).available).toBe(7);

    // B books 4 → packed into unit 1 (shared), not pushed to unit 2.
    const b = await svc.createBooking(c2.id, { activityId: act.id, checkInDate: date, slotTime: '10:00', guests: 4, bookingPhone: PHONE });
    expect(await unitOf(b.booking.id)).toBe(1);
  });
});
