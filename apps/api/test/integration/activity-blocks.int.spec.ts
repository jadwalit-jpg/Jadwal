/**
 * Integration — vendor availability "blocks" (locks), end-to-end against a real
 * DB. Unit tests cover the create/validation branches with a mocked Prisma; this
 * suite pins the cross-service behaviour that mocks can't prove:
 *
 *   - A vendor lock actually zeroes the overlapping customer slots, and
 *     `createBooking` (the money path, real $transaction) REJECTS a booking in
 *     the locked window — while a non-overlapping slot still books.
 *   - Deleting the lock makes the slot bookable again.
 *   - A whole-day lock fully disables the day on the calendar.
 *   - Cross-vendor isolation: another vendor can neither create nor delete
 *     blocks on an activity they don't own (collapses to 404).
 *   - `affectedBookings` reports existing bookings in the window WITHOUT
 *     cancelling them (a lock only stops NEW bookings).
 *   - `repeatWeekly` persists multiple whole-day rows for the seed weekday.
 */

import { getTestContext, seedReference } from './_setup';
import { VendorService } from '../../src/vendor/vendor.service';
import { AdminService } from '../../src/admin/admin.service';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';

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
  const availabilityCache = {
    get: jest.fn().mockResolvedValue(null),       // force compute (don't hit Redis cache)
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const redisLock = {
    acquire: jest.fn().mockResolvedValue('lock-token'),
    release: jest.fn().mockResolvedValue(undefined),
  } as any;
  const configService = {
    get: (k: string, fb?: string) =>
      (({ RESERVATION_WINDOW_MINUTES: '15', BOOKING_MAX_ADVANCE_MONTHS: '6', REDIS_LOCK_TTL_MS: '30000' }) as Record<string, string>)[k] ?? fb,
  } as any;
  const auditLogger = { log: jest.fn().mockResolvedValue(undefined) } as any;

  const vendor = new VendorService(prismaSvc, notificationService, loyalty, availabilityCache);
  const bookings = new BookingsService(
    prismaSvc, auditLogger, notificationService, redisLock,
    configService, loyalty, availabilityCache,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
  return { vendor, bookings };
}

/** YYYY-MM-DD `days` from now (future, within the 6-month cap). */
function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function makeSecondVendor() {
  const country = await ctx.prisma.country.findFirstOrThrow();
  const user = await ctx.prisma.user.create({
    data: {
      fullName: 'Other Vendor', email: `ov-${crypto.randomUUID().slice(0, 6)}@t.com`,
      password: '$2b$10$dummy.hash.for.tests', role: 'VENDOR', emailVerified: true,
    },
  });
  const vendor = await ctx.prisma.vendor.create({
    data: {
      userId: user.id, businessNameEn: 'OV', businessNameAr: 'ع',
      businessId: 'BIZ-' + crypto.randomUUID().slice(0, 6),
      slug: 'ov-' + crypto.randomUUID().slice(0, 6),
      countryId: country.id, status: 'ACTIVE',
    },
  });
  return { user, vendor };
}

const PHONE = '+97455123456';

// ═══════════════════════════════════════════════════════════════════════════
// Enforcement: lock → unavailable → booking rejected
// ═══════════════════════════════════════════════════════════════════════════
describe('vendor lock enforcement (HOURLY)', () => {
  test('locking a start slot blocks ONLY that start; a booking starting earlier may span across it', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor, bookings } = makeServices();
    const date = futureDate(7);

    // Lock the 10:00 start slot. Activity is 2h, 09:00–21:00 → slots 09:00..19:00.
    await vendor.createActivityBlock(seed.vendorUser.id, seed.activity.id, { date, slotTimes: ['10:00'] });

    const avail: any = await bookings.getHourlyAvailability(seed.activity.id, date);
    const slot = (s: string) => avail.slots.find((x: any) => x.slotStart === s);
    // Only 10:00 is start-locked; 09:00 is NOT (its 9–11 booking merely runs across it).
    expect(slot('10:00').isBlocked).toBe(true);
    expect(slot('09:00').isBlocked).toBe(false);
    // Capacity is intact on the locked slot (not zeroed) so spanning still works.
    expect(slot('10:00').available).toBe(10);

    // A booking that STARTS at 10:00 → rejected.
    await expect(
      bookings.createBooking(seed.customer.id, { activityId: seed.activity.id, checkInDate: date, slotTime: '10:00', guests: 2, bookingPhone: PHONE }),
    ).rejects.toThrow(/not available/i);

    // A booking that STARTS at 09:00 (runs 9–11, across the locked 10:00) → ALLOWED.
    const ok = await bookings.createBooking(seed.customer.id, { activityId: seed.activity.id, checkInDate: date, slotTime: '09:00', guests: 2, bookingPhone: PHONE });
    expect(ok.booking.id).toBeTruthy();
  });

  test('deleting the lock makes the slot bookable again', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor, bookings } = makeServices();
    const date = futureDate(7);

    await vendor.createActivityBlock(seed.vendorUser.id, seed.activity.id, { date, slotTimes: ['10:00'] });
    await expect(
      bookings.createBooking(seed.customer.id, { activityId: seed.activity.id, checkInDate: date, slotTime: '10:00', guests: 1, bookingPhone: PHONE }),
    ).rejects.toThrow(/not available/i);

    // slotTimes-create returns a count, not ids — fetch the row to delete it.
    const blk = await ctx.prisma.activityBlock.findFirstOrThrow({ where: { activityId: seed.activity.id, deletedAt: null } });
    await vendor.deleteActivityBlock(seed.vendorUser.id, seed.activity.id, blk.id);

    const avail: any = await bookings.getHourlyAvailability(seed.activity.id, date);
    expect(avail.slots.find((x: any) => x.slotStart === '10:00').isBlocked).toBe(false);

    const ok = await bookings.createBooking(seed.customer.id, { activityId: seed.activity.id, checkInDate: date, slotTime: '10:00', guests: 1, bookingPhone: PHONE });
    expect(ok.booking).toBeDefined();
  });

  test('a whole-day lock fully disables the calendar day + rejects any booking that day', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor, bookings } = makeServices();
    const date = futureDate(9);

    await vendor.createActivityBlock(seed.vendorUser.id, seed.activity.id, { date }); // whole day

    const cal: any = await bookings.getCalendarAvailability(seed.activity.id, date.slice(0, 7));
    const day = cal.days.find((d: any) => d.date === date);
    expect(day.isBlocked).toBe(true);
    expect(day.isFullyBooked).toBe(true);
    expect(day.available).toBe(0);

    await expect(
      bookings.createBooking(seed.customer.id, { activityId: seed.activity.id, checkInDate: date, slotTime: '12:00', guests: 1, bookingPhone: PHONE }),
    ).rejects.toThrow(/not available/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-vendor isolation
// ═══════════════════════════════════════════════════════════════════════════
describe('cross-vendor isolation', () => {
  test('another vendor cannot create or delete blocks on an activity they do not own (404)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const other = await makeSecondVendor();
    const date = futureDate(7);

    await expect(vendor.createActivityBlock(other.user.id, seed.activity.id, { date }))
      .rejects.toThrow(NotFoundException);

    const blk: any = await vendor.createActivityBlock(seed.vendorUser.id, seed.activity.id, { date });
    await expect(vendor.deleteActivityBlock(other.user.id, seed.activity.id, blk.id))
      .rejects.toThrow(NotFoundException);

    // The owner's block is untouched.
    const rows = await vendor.getActivityBlocks(seed.vendorUser.id, seed.activity.id);
    expect(rows.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// affectedBookings — informs, never cancels
// ═══════════════════════════════════════════════════════════════════════════
describe('affectedBookings reporting', () => {
  test('locking a window with an existing booking reports it and does NOT cancel it', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor, bookings } = makeServices();
    const date = futureDate(8);

    const existing = await bookings.createBooking(seed.customer.id, { activityId: seed.activity.id, checkInDate: date, slotTime: '10:00', guests: 2, bookingPhone: PHONE });

    // Lock the 10:00 start slot — the existing booking starts there → reported.
    const blk: any = await vendor.createActivityBlock(seed.vendorUser.id, seed.activity.id, { date, slotTimes: ['10:00'] });
    expect(blk.affectedBookings).toBeGreaterThanOrEqual(1);

    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: existing.booking.id } });
    expect(row.status).not.toBe('CANCELLED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Recurrence
// ═══════════════════════════════════════════════════════════════════════════
describe('repeatWeekly recurrence', () => {
  test('persists multiple whole-day rows, all on the seed weekday', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const date = futureDate(7);
    const seedWeekday = new Date(date + 'T00:00:00.000Z').getUTCDay();

    const res: any = await vendor.createActivityBlock(seed.vendorUser.id, seed.activity.id, { date, repeatWeekly: true });
    expect(res.created).toBeGreaterThan(1);

    const rows = await ctx.prisma.activityBlock.findMany({ where: { activityId: seed.activity.id, deletedAt: null } });
    expect(rows.length).toBe(res.created);
    for (const r of rows) {
      expect(r.blockEnd.getTime() - r.blockStart.getTime()).toBe(24 * 60 * 60 * 1000); // whole day
      expect(r.blockStart.getUTCDay()).toBe(seedWeekday);                              // same weekday
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Admin — platform-wide block management (any activity, not just own)
// ═══════════════════════════════════════════════════════════════════════════
function makeAdmin() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const noop = { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn().mockResolvedValue(undefined), sendToMany: jest.fn().mockResolvedValue(undefined) } as any;
  const cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any;
  return new AdminService(prismaSvc, noop, loyalty, cache, { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any);
}

describe('admin block management (any activity)', () => {
  test('admin locks a slot on a vendor\'s activity → enforced; admin deletes it → bookable again', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = makeAdmin();
    const { bookings } = makeServices();
    const date = futureDate(7);

    const r: any = await admin.createActivityBlock(seed.activity.id, { date, slotTimes: ['10:00'] });
    expect(r.created).toBe(1);

    const avail: any = await bookings.getHourlyAvailability(seed.activity.id, date);
    expect(avail.slots.find((x: any) => x.slotStart === '10:00').isBlocked).toBe(true);

    await expect(
      bookings.createBooking(seed.customer.id, { activityId: seed.activity.id, checkInDate: date, slotTime: '10:00', guests: 1, bookingPhone: PHONE }),
    ).rejects.toThrow(/not available/i);

    const blk = await ctx.prisma.activityBlock.findFirstOrThrow({ where: { activityId: seed.activity.id, deletedAt: null } });
    await admin.deleteActivityBlock(seed.activity.id, blk.id);

    const avail2: any = await bookings.getHourlyAvailability(seed.activity.id, date);
    expect(avail2.slots.find((x: any) => x.slotStart === '10:00').isBlocked).toBe(false);
  });

  test('admin block on a non-existent activity → NotFoundException', async () => {
    const admin = makeAdmin();
    await expect(
      admin.createActivityBlock('00000000-0000-4000-8000-000000000000', { date: futureDate(7), slotTimes: ['10:00'] }),
    ).rejects.toThrow(NotFoundException);
  });
});
