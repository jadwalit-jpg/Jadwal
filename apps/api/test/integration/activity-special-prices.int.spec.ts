/**
 * Integration — per-date special pricing.
 *
 * Covers: vendor + admin CRUD, vendor ownership scoping, idempotent upsert,
 * validation (past date / bad price), and the critical money path — a booking
 * on a special-price date is charged (and frozen at) the override, for both
 * HOURLY (by date) and DAILY (per night).
 */

import { getTestContext, seedReference } from './_setup';
import { VendorService } from '../../src/vendor/vendor.service';
import { AdminService } from '../../src/admin/admin.service';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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

  const vendor = new VendorService(prismaSvc, notificationService, loyalty, availabilityCache);
  const admin = new AdminService(prismaSvc, notificationService, loyalty, availabilityCache, refCache);
  const bookings = new BookingsService(
    prismaSvc, auditLogger, notificationService, redisLock,
    configService, loyalty, availabilityCache,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any,
    { tryConsume: jest.fn().mockResolvedValue(true) } as any,
    { log: jest.fn() } as any,
  );
  return { vendor, admin, bookings };
}

function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function makeSecondVendorUser() {
  const country = await ctx.prisma.country.findFirstOrThrow();
  const user = await ctx.prisma.user.create({
    data: {
      fullName: 'Other Vendor', email: `ov-${crypto.randomUUID().slice(0, 6)}@t.com`,
      password: '$2b$10$dummy.hash.for.tests', role: 'VENDOR', emailVerified: true,
    },
  });
  await ctx.prisma.vendor.create({
    data: {
      userId: user.id, businessNameEn: 'OV', businessNameAr: 'ع',
      businessId: 'BIZ-' + crypto.randomUUID().slice(0, 6),
      slug: 'ov-' + crypto.randomUUID().slice(0, 6),
      countryId: country.id, status: 'ACTIVE',
    },
  });
  return user;
}

describe('Special prices — CRUD + scope', () => {
  test('vendor create → list → delete', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const date = futureDate(10);

    await vendor.createActivitySpecialPrice(seed.vendorUser.id, seed.activity.id, { date, price: 150 });
    let list = await vendor.getActivitySpecialPrices(seed.vendorUser.id, seed.activity.id);
    expect(list).toHaveLength(1);
    expect(Number(list[0].price)).toBe(150);

    await vendor.deleteActivitySpecialPrice(seed.vendorUser.id, seed.activity.id, list[0].id);
    list = await vendor.getActivitySpecialPrices(seed.vendorUser.id, seed.activity.id);
    expect(list).toHaveLength(0);
  });

  test('bulk: applies one price to a date list + a range in a single call', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const res = await vendor.bulkCreateActivitySpecialPrices(seed.vendorUser.id, seed.activity.id, {
      dates: [futureDate(10), futureDate(11)],
      startDate: futureDate(20), endDate: futureDate(22), // 3-day inclusive range
      price: 250,
    });
    expect(res.count).toBe(5);
    const list = await vendor.getActivitySpecialPrices(seed.vendorUser.id, seed.activity.id);
    expect(list).toHaveLength(5);
    expect(list.every((p) => Number(p.price) === 250)).toBe(true);
  });

  test('bulk: a single invalid (past) date rolls the WHOLE batch back (atomic)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    await expect(
      vendor.bulkCreateActivitySpecialPrices(seed.vendorUser.id, seed.activity.id, {
        dates: [futureDate(10), '2020-01-01'], price: 150,
      }),
    ).rejects.toThrow();
    const list = await vendor.getActivitySpecialPrices(seed.vendorUser.id, seed.activity.id);
    expect(list).toHaveLength(0); // nothing persisted
  });

  test('bulk: a vendor cannot bulk-price another vendor\'s activity', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const other = await makeSecondVendorUser();
    await expect(
      vendor.bulkCreateActivitySpecialPrices(other.id, seed.activity.id, { dates: [futureDate(10)], price: 150 }),
    ).rejects.toThrow(NotFoundException);
  });

  test('setting the same date twice UPDATES (one active row)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const date = futureDate(12);
    await vendor.createActivitySpecialPrice(seed.vendorUser.id, seed.activity.id, { date, price: 150 });
    await vendor.createActivitySpecialPrice(seed.vendorUser.id, seed.activity.id, { date, price: 175 });
    const list = await vendor.getActivitySpecialPrices(seed.vendorUser.id, seed.activity.id);
    expect(list).toHaveLength(1);
    expect(Number(list[0].price)).toBe(175);
  });

  test('vendor cannot set a special price on another vendor\'s activity', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const other = await makeSecondVendorUser();
    await expect(
      vendor.createActivitySpecialPrice(other.id, seed.activity.id, { date: futureDate(10), price: 150 }),
    ).rejects.toThrow(NotFoundException);
  });

  test('admin can set a special price on any activity', async () => {
    const seed = await seedReference(ctx.prisma);
    const { admin } = makeServices();
    await admin.createActivitySpecialPrice(seed.activity.id, { date: futureDate(10), price: 200 });
    const list = await admin.getActivitySpecialPrices(seed.activity.id);
    expect(list).toHaveLength(1);
    expect(Number(list[0].price)).toBe(200);
  });

  test('past date and non-positive price are rejected', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    await expect(vendor.createActivitySpecialPrice(seed.vendorUser.id, seed.activity.id, { date: '2020-01-01', price: 150 }))
      .rejects.toThrow(BadRequestException);
    await expect(vendor.createActivitySpecialPrice(seed.vendorUser.id, seed.activity.id, { date: futureDate(10), price: 0 }))
      .rejects.toThrow(BadRequestException);
  });
});

describe('Special prices — booking is charged the override', () => {
  test('HOURLY booking on a special-price date uses the override', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor, bookings } = makeServices();
    // Baseline 100/hour (duration 1h), per-person, open 09:00–21:00.
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id },
      data: { bookingType: 'HOURLY', pricingModel: 'PER_PERSON', pricePerPerson: 100, durationValue: 1, checkInTime: '09:00', checkOutTime: '21:00', capacity: 10, hasUnits: false, activeDays: [] },
    });
    const date = futureDate(8);
    await vendor.createActivitySpecialPrice(seed.vendorUser.id, seed.activity.id, { date, price: 150 });

    const res: any = await bookings.createBooking(seed.customer.id, {
      activityId: seed.activity.id, checkInDate: date, slotTime: '10:00', guests: 1, bookingPhone: '+97455123456',
    } as any);
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
    // 150 (override) × 1 guest × 1h / 1h baseline = 150 (vs 100 at base price).
    expect(Number(b.totalPrice)).toBe(150);
  });

  test('DAILY booking sums per-night prices (override night + base night)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor, bookings } = makeServices();
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id },
      data: { bookingType: 'DAILY', pricingModel: 'PER_UNIT', pricePerPerson: 100, durationValue: null, checkInTime: '14:00', checkOutTime: '11:00', capacity: 10, hasUnits: false, activeDays: [] },
    });
    const night1 = futureDate(20);
    const night2 = futureDate(21);
    // Override only night1 → total = 150 + 100 = 250.
    await vendor.createActivitySpecialPrice(seed.vendorUser.id, seed.activity.id, { date: night1, price: 150 });

    const res: any = await bookings.createBooking(seed.customer.id, {
      activityId: seed.activity.id, checkInDate: night1, checkOutDate: futureDate(22), guests: 1, bookingPhone: '+97455123456',
    } as any);
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
    expect(Number(b.totalPrice)).toBe(250);
  });
});
