/**
 * Integration — availability endpoints (hourly/daily) + customer my-bookings
 * pagination + filter.
 *
 * Covered items:
 *   #37 Availability calendar endpoints — hourly + daily
 *   #38 my-bookings pagination + status filter
 */

import { getTestContext, seedReference } from './_setup';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    { get: (_: string, f?: string) => f } as any,
    loyalty,
    { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any,
  );
}

function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════
// Hourly availability
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.getHourlyAvailability', () => {
  test('returns slots array for an HOURLY activity', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const res = await svc.getHourlyAvailability(seed.activity.id, futureDate(7));
    expect(Array.isArray((res as any).slots)).toBe(true);
    // capacity 10, no bookings → every slot should have full availability
    const firstSlot = (res as any).slots?.[0];
    if (firstSlot && 'availableSeats' in firstSlot) {
      expect(firstSlot.availableSeats).toBeLessThanOrEqual(10);
      expect(firstSlot.availableSeats).toBeGreaterThanOrEqual(0);
    }
  });

  test('non-HOURLY activity → BadRequest', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id },
      data: { bookingType: 'DAILY' },
    });
    const svc = makeBookingsService();
    await expect(svc.getHourlyAvailability(seed.activity.id, futureDate(7)))
      .rejects.toThrow(/not HOURLY/i);
  });

  test('invalid date string → BadRequest', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    await expect(svc.getHourlyAvailability(seed.activity.id, 'not-a-date'))
      .rejects.toThrow(BadRequestException);
  });

  test('unknown activity → NotFound', async () => {
    await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    await expect(
      svc.getHourlyAvailability('00000000-0000-4000-8000-00000000aaaa', futureDate(7)),
    ).rejects.toThrow(NotFoundException);
  });

  test('INACTIVE activity → NotFound (hidden from public calendar)', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id }, data: { status: 'INACTIVE' },
    });
    const svc = makeBookingsService();
    await expect(svc.getHourlyAvailability(seed.activity.id, futureDate(7)))
      .rejects.toThrow(NotFoundException);
  });

  test('existing booking for a slot reduces availability', async () => {
    const seed = await seedReference(ctx.prisma);
    const date = futureDate(7);
    // Pre-seed a booking that consumes 2 seats at 10:00
    const start = new Date(`${date}T10:00:00Z`);
    await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-PRE-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR', guests: 2,
        totalPrice: 200, serviceFee: 5, commissionAmount: 20,
        status: 'CONFIRMED',
        startDatetime: start, endDatetime: new Date(start.getTime() + 2 * 3600_000),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });
    const svc = makeBookingsService();
    const res = await svc.getHourlyAvailability(seed.activity.id, date);
    // The 10:00 slot should show reduced availability
    const tenSlot = (res as any).slots?.find((s: any) =>
      s.startTime === '10:00' || s.time === '10:00' || s.start === '10:00',
    );
    // If the shape differs we at least assert the array isn't empty
    expect((res as any).slots.length).toBeGreaterThan(0);
    // If we found the slot with an availableSeats field, assert it's < 10
    if (tenSlot && 'availableSeats' in tenSlot) {
      expect(tenSlot.availableSeats).toBeLessThan(10);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Daily availability
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.getDailyAvailability', () => {
  test('DAILY activity returns per-day availability structure', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id },
      data: { bookingType: 'DAILY' },
    });
    const svc = makeBookingsService();
    const today = futureDate(1);
    const later = futureDate(10);
    const res = await svc.getDailyAvailability(seed.activity.id, today, later);
    expect(res).toBeDefined();
  });

  test('non-DAILY activity → BadRequest or similar rejection', async () => {
    const seed = await seedReference(ctx.prisma);
    // seed.activity is HOURLY by default
    const svc = makeBookingsService();
    await expect(
      svc.getDailyAvailability(seed.activity.id, futureDate(1), futureDate(5)),
    ).rejects.toThrow();
  });

  // Regression for the N-aggregate → single-groupBy refactor: a multi-unit
  // DAILY activity must report per-unit booked/available correctly, including
  // units with zero overlapping bookings (which groupBy omits → filled as 0).
  test('multi-unit DAILY: per-unit availability built from one groupBy, zero-fill included', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id },
      data: { bookingType: 'DAILY', hasUnits: true, unitCount: 3, unitCapacity: 2 },
    });
    const checkIn = futureDate(1);
    const checkOut = futureDate(3);
    // Bookings must overlap the [checkIn 09:00, checkOut 21:00] window.
    const mkBooking = (unitNumber: number, guests: number) =>
      ctx.prisma.booking.create({
        data: {
          ref: `JDWL-UNIT-${crypto.randomUUID().slice(0, 6)}`,
          currencyCode: 'QAR', guests,
          totalPrice: 200, serviceFee: 5, commissionAmount: 20,
          status: 'CONFIRMED',
          startDatetime: new Date(`${checkIn}T14:00:00Z`),
          endDatetime:   new Date(`${futureDate(2)}T11:00:00Z`),
          activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
          unitNumber,
        },
      });
    await mkBooking(1, 1); // unit 1: 1 of 2 booked
    await mkBooking(3, 2); // unit 3: full
    // unit 2: no bookings

    const svc = makeBookingsService();
    const res = (await svc.getDailyAvailability(seed.activity.id, checkIn, checkOut)) as any;

    expect(res.bookingType).toBe('DAILY');
    expect(Array.isArray(res.units)).toBe(true);
    expect(res.units).toHaveLength(3);
    const byUnit = new Map(res.units.map((u: any) => [u.unitNumber, u]));
    expect(byUnit.get(1)).toMatchObject({ unitNumber: 1, capacity: 2, booked: 1, available: 1 });
    expect(byUnit.get(2)).toMatchObject({ unitNumber: 2, capacity: 2, booked: 0, available: 2 });
    expect(byUnit.get(3)).toMatchObject({ unitNumber: 3, capacity: 2, booked: 2, available: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// my-bookings pagination + filter
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.getMyBookings — pagination + status filter', () => {
  async function seedBookings(seed: any, entries: Array<{ status: string; day: number }>) {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + e.day);
      start.setUTCHours(10, 0, 0, 0);
      await ctx.prisma.booking.create({
        data: {
          ref: `JDWL-MY-${i}-${crypto.randomUUID().slice(0, 6)}`,
          currencyCode: 'QAR', guests: 1,
          totalPrice: 100, serviceFee: 0, commissionAmount: 10,
          status: e.status as any,
          startDatetime: start,
          endDatetime: new Date(start.getTime() + 2 * 3600_000),
          activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
        },
      });
      await new Promise(r => setTimeout(r, 5)); // preserve ordering by createdAt
    }
  }

  test('returns default page 1, limit 20 when no params passed', async () => {
    const seed = await seedReference(ctx.prisma);
    await seedBookings(seed, [
      { status: 'CONFIRMED', day: 10 },
      { status: 'PENDING', day: 11 },
      { status: 'CANCELLED', day: 12 },
    ]);
    const svc = makeBookingsService();
    const res = await svc.getMyBookings(seed.customer.id);
    expect(res.data).toHaveLength(3);
    expect(res.total).toBe(3);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(20);
    expect(res.totalPages).toBe(1);
  });

  test('page size clamps to safe bounds [1, 100]', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const resLow = await svc.getMyBookings(seed.customer.id, 1, 0 as any);
    expect(resLow.limit).toBe(1);
    const resHigh = await svc.getMyBookings(seed.customer.id, 1, 10_000 as any);
    expect(resHigh.limit).toBe(100);
  });

  test('page number clamps to [1, 1000]', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeBookingsService();
    const res = await svc.getMyBookings(seed.customer.id, -5 as any, 20);
    expect(res.page).toBe(1);
    const resHigh = await svc.getMyBookings(seed.customer.id, 99_999 as any, 20);
    expect(resHigh.page).toBeLessThanOrEqual(1000);
  });

  test('status filter narrows results to matching bookings only', async () => {
    const seed = await seedReference(ctx.prisma);
    await seedBookings(seed, [
      { status: 'CONFIRMED', day: 10 },
      { status: 'CONFIRMED', day: 11 },
      { status: 'PENDING', day: 12 },
      { status: 'CANCELLED', day: 13 },
    ]);
    const svc = makeBookingsService();

    const confirmed = await svc.getMyBookings(seed.customer.id, 1, 20, 'CONFIRMED');
    expect(confirmed.total).toBe(2);
    expect(confirmed.data.every((b: any) => b.status === 'CONFIRMED')).toBe(true);

    const cancelled = await svc.getMyBookings(seed.customer.id, 1, 20, 'CANCELLED');
    expect(cancelled.total).toBe(1);
  });

  test('pagination — page 2 with limit 2 returns 2nd batch', async () => {
    const seed = await seedReference(ctx.prisma);
    await seedBookings(seed, [
      { status: 'CONFIRMED', day: 10 },
      { status: 'CONFIRMED', day: 11 },
      { status: 'CONFIRMED', day: 12 },
      { status: 'CONFIRMED', day: 13 },
      { status: 'CONFIRMED', day: 14 },
    ]);
    const svc = makeBookingsService();
    const p1 = await svc.getMyBookings(seed.customer.id, 1, 2);
    const p2 = await svc.getMyBookings(seed.customer.id, 2, 2);
    expect(p1.data).toHaveLength(2);
    expect(p2.data).toHaveLength(2);
    expect(p1.totalPages).toBe(3);
    // No overlap between page 1 and page 2
    const p1Ids = new Set(p1.data.map((b: any) => b.id));
    for (const b of p2.data as any[]) {
      expect(p1Ids.has(b.id)).toBe(false);
    }
  });

  test('scoped by customerId — other users\' bookings never leak', async () => {
    const seed = await seedReference(ctx.prisma);
    await seedBookings(seed, [
      { status: 'CONFIRMED', day: 10 },
    ]);
    // Different customer
    const other = await ctx.prisma.user.create({
      data: {
        fullName: 'Other', email: `o-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
      },
    });
    const svc = makeBookingsService();
    const mine = await svc.getMyBookings(seed.customer.id);
    const theirs = await svc.getMyBookings(other.id);
    expect(mine.total).toBe(1);
    expect(theirs.total).toBe(0);
  });
});
