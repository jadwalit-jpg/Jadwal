/**
 * Integration — flipping the unit switch THROUGH THE REAL SERVICES.
 *
 * WHY A SEPARATE FILE FROM assign-missing-units.int.spec.ts
 * --------------------------------------------------------
 * That file tests the backfill function directly. This one tests the WIRING:
 * vendor.updateActivity() and admin.updateActivity() must actually invoke it,
 * inside the same transaction, and must invalidate the availability cache
 * afterwards.
 *
 * The distinction matters because a function that works perfectly but is never
 * called looks identical to a fix in every unit test. This whole incident began
 * with code whose own comment asserted an invariant it did not enforce, so the
 * end-to-end path is what gets asserted here:
 *
 *   booking exists with units off  ->  switch flipped via the real endpoint
 *   ->  calendar immediately shows the night as taken
 *   ->  a second customer is refused
 *
 * That sequence is the customer-visible promise. If a future refactor moves the
 * backfill, drops it from one of the two paths, or takes it out of the
 * transaction, something here goes red.
 */

import { getTestContext, seedReference } from './_setup';
import { VendorService } from '../../src/vendor/vendor.service';
import { AdminService } from '../../src/admin/admin.service';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import * as crypto from 'crypto';
import { makeSessionDenylistMock } from '../mocks/auth-deps.mock';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeServices() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const notificationService = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  // Real jest.fn()s so the test can assert invalidation actually happened —
  // changing unit config without clearing the cache would keep serving the
  // pre-change availability until the TTL lapsed.
  const availabilityCache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const refCache = { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any;
  const redisLock = { acquire: jest.fn().mockResolvedValue('lock-token'), release: jest.fn().mockResolvedValue(undefined) } as any;
  const configService = {
    get: (k: string, fb?: string) =>
      (({ RESERVATION_WINDOW_MINUTES: '15', BOOKING_MAX_ADVANCE_MONTHS: '6', REDIS_LOCK_TTL_MS: '30000' }) as Record<string, string>)[k] ?? fb,
  } as any;
  const auditLogger = { log: jest.fn().mockResolvedValue(undefined) } as any;

  const vendor = new VendorService(prismaSvc, notificationService, loyalty, availabilityCache, makeSessionDenylistMock() as any);
  const admin = new AdminService(prismaSvc, notificationService, loyalty, availabilityCache, refCache, makeSessionDenylistMock() as any);
  const bookings = new BookingsService(
    prismaSvc, auditLogger, notificationService, redisLock,
    configService, loyalty, availabilityCache,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
  return { vendor, admin, bookings, availabilityCache };
}

function d(daysFromNow: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + daysFromNow);
  return dt.toISOString().slice(0, 10);
}
const monthOf = (s: string) => s.slice(0, 7);
const PHONE = '+97455123456';

/** A resort with the unit option OFF — how Cavilam looked when it was booked. */
async function makeResortUnitsOff(seed: any) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'Resort', titleAr: 'منتجع',
      slug: 'resort-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و',
      locationAddress: 'Al Ruwais', locationLat: 26.13, locationLng: 51.21,
      bookingType: 'DAILY', pricingModel: 'PER_UNIT',
      pricePerPerson: 1200,
      hasUnits: false, unitCount: 0, unitCapacity: 25, capacity: 25,
      durationValue: null, checkInTime: '15:00', checkOutTime: '12:00',
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

/** Take a real booking while units are off, then confirm it. */
async function bookAndConfirm(bookings: BookingsService, customerId: string, activityId: string) {
  const { booking } = await bookings.createBooking(customerId, {
    activityId, checkInDate: d(5), checkOutDate: d(7), guests: 2, bookingPhone: PHONE,
  } as any);
  await ctx.prisma.booking.update({
    where: { id: booking.id }, data: { status: 'CONFIRMED', reservedUntil: null },
  });
  return booking;
}

const unitOf = async (id: string) =>
  (await ctx.prisma.booking.findUnique({ where: { id }, select: { unitNumber: true } }))!.unitNumber;

/**
 * Stand in for admin re-approval.
 *
 * ANY vendor edit of an ACTIVE activity resets it to PENDING
 * (vendor.service.ts: `shouldResetStatus = activity.status === 'ACTIVE'`), and a
 * non-ACTIVE activity is unbookable and absent from availability. That is a real
 * and useful safety gate on the vendor path: a vendor flipping the unit switch
 * cannot expose anything until an admin looks at it.
 *
 * Worth noting the asymmetry — admin.updateActivity does NOT reset status, so an
 * admin flipping the same switch takes effect immediately on a live activity.
 * That is the riskier of the two paths and is covered separately below.
 */
async function reapprove(activityId: string) {
  await ctx.prisma.activity.update({ where: { id: activityId }, data: { status: 'ACTIVE' } });
}

// ═══════════════════════════════════════════════════════════════════════════

describe('VENDOR flips the unit switch', () => {

  test('the existing guest stays visible and the night cannot be resold', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor, bookings, availabilityCache } = makeServices();
    const act = await makeResortUnitsOff(seed);

    const booking = await bookAndConfirm(bookings, seed.customer.id, act.id);
    expect(await unitOf(booking.id)).toBeNull(); // units were off

    // The flip, through the real vendor endpoint.
    await vendor.updateActivity(seed.vendorUser.id, act.id, {
      hasUnits: true, unitCount: 1, unitCapacity: 25,
    } as any);

    // 1. the guest now holds the unit — the backfill ran inside the flip
    expect(await unitOf(booking.id)).toBe(1);

    // 1b. the vendor edit also parked the activity for re-approval, which is an
    //     extra layer of protection on this path. Assert it so the behaviour is
    //     pinned, then re-approve to check the customer-facing result.
    const parked = await ctx.prisma.activity.findUnique({
      where: { id: act.id }, select: { status: true },
    });
    expect(parked!.status).toBe('PENDING');
    await reapprove(act.id);

    // 2. the calendar shows the night as taken — the reported symptom, gone
    const cal: any = await bookings.getCalendarAvailability(act.id, monthOf(d(5)));
    const day = cal.days.find((x: any) => x.date === d(5));
    expect(day.booked).toBe(1);
    expect(day.available).toBe(0);
    expect(day.isFullyBooked).toBe(true);

    // 3. a second customer cannot take the same nights
    await expect(
      bookings.createBooking((await makeCustomer()).id, {
        activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 2, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow(/fully booked|all units/i);

    // 4. the cache was cleared, or the calendar would serve pre-flip numbers
    expect(availabilityCache.invalidate).toHaveBeenCalledWith(act.id);
  });

  test('an unrelated edit does not disturb existing unit assignments', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor, bookings } = makeServices();
    const act = await makeResortUnitsOff(seed);

    // Units on from the start this time, so the booking is assigned normally.
    await vendor.updateActivity(seed.vendorUser.id, act.id, {
      hasUnits: true, unitCount: 3, unitCapacity: 6,
    } as any);
    await reapprove(act.id);
    const booking = await bookAndConfirm(bookings, seed.customer.id, act.id);
    const before = await unitOf(booking.id);
    expect(before).not.toBeNull();

    // Editing something unrelated must not reshuffle anyone.
    await vendor.updateActivity(seed.vendorUser.id, act.id, { titleEn: 'Renamed Resort' } as any);

    expect(await unitOf(booking.id)).toBe(before);
  });

  test('flipping the switch OFF again leaves the bookings alone', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor, bookings } = makeServices();
    const act = await makeResortUnitsOff(seed);

    await vendor.updateActivity(seed.vendorUser.id, act.id, {
      hasUnits: true, unitCount: 1, unitCapacity: 25,
    } as any);
    await reapprove(act.id);
    const booking = await bookAndConfirm(bookings, seed.customer.id, act.id);
    expect(await unitOf(booking.id)).toBe(1);

    // Turning units off switches availability back to seat counting, which
    // ignores unitNumber entirely — so the stored value is harmless and
    // clearing it would only destroy information needed if units return.
    await vendor.updateActivity(seed.vendorUser.id, act.id, { hasUnits: false } as any);

    expect(await unitOf(booking.id)).toBe(1);
  });
});

describe('ADMIN flips the unit switch', () => {

  test('the same protection applies on the admin path', async () => {
    const seed = await seedReference(ctx.prisma);
    const { admin, bookings, availabilityCache } = makeServices();
    const act = await makeResortUnitsOff(seed);

    const booking = await bookAndConfirm(bookings, seed.customer.id, act.id);
    expect(await unitOf(booking.id)).toBeNull();

    await admin.updateActivity(act.id, { hasUnits: true, unitCount: 1, unitCapacity: 25 } as any);

    expect(await unitOf(booking.id)).toBe(1);

    const cal: any = await bookings.getCalendarAvailability(act.id, monthOf(d(5)));
    expect(cal.days.find((x: any) => x.date === d(5)).isFullyBooked).toBe(true);

    await expect(
      bookings.createBooking((await makeCustomer()).id, {
        activityId: act.id, checkInDate: d(5), checkOutDate: d(7), guests: 2, bookingPhone: PHONE,
      } as any),
    ).rejects.toThrow(/fully booked|all units/i);

    expect(availabilityCache.invalidate).toHaveBeenCalledWith(act.id);
  });
});

describe('the flip is all-or-nothing', () => {

  test('two overlapping guests on a 1-unit flip: one placed, the clash reported', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor, bookings } = makeServices();
    const act = await makeResortUnitsOff(seed);

    // Both legitimately booked while units were off — seat capacity was 25, so
    // the system was right to accept them at the time. They cannot both fit in
    // one unit, and the flip must not pretend otherwise.
    const a = await bookAndConfirm(bookings, seed.customer.id, act.id);
    const b = await bookAndConfirm(bookings, (await makeCustomer()).id, act.id);

    await vendor.updateActivity(seed.vendorUser.id, act.id, {
      hasUnits: true, unitCount: 1, unitCapacity: 25,
    } as any);

    const units = [await unitOf(a.id), await unitOf(b.id)];
    // One gets the unit; the other is left null and logged at error level
    // rather than being stacked on top of the first.
    expect(units).toContain(1);
    expect(units).toContain(null);

    // The switch still flipped — the vendor is not locked out of their own
    // activity by pre-existing data.
    const after = await ctx.prisma.activity.findUnique({
      where: { id: act.id }, select: { hasUnits: true, unitCount: true },
    });
    expect(after).toEqual({ hasUnits: true, unitCount: 1 });
  });
});
