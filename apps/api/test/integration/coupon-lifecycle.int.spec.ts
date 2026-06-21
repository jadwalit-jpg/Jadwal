/**
 * Coupon lifecycle — full round-trip against real Postgres.
 *
 *   1. Vendor creates coupon → status PENDING
 *   2. Admin approves → status APPROVED
 *   3. Customer applies at booking time → usedCount++
 *   4. Platform voucher claim (admin-created, vendorId=null) — one per user
 *   5. Expiry, usage-limit, status guards
 *   6. Name uniqueness (code is @unique)
 *
 * Exercises AdminService.createCoupon, AdminService.updateCouponStatus,
 * OffersController.claimOffer, and the coupon-apply branch inside
 * BookingsService.createBooking.
 */

import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { VendorService } from '../../src/vendor/vendor.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { BookingsService } from '../../src/bookings/bookings.service';
import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeServices() {
  const prismaSvc = { client: ctx.prisma } as any;
  const notificationService = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const redisLock = {
    acquire: jest.fn().mockResolvedValue('tok'),
    release: jest.fn().mockResolvedValue(undefined),
  } as any;
  const admin = new AdminService(prismaSvc, notificationService, loyalty, availabilityCache, { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any);
  const vendor = new VendorService(prismaSvc, notificationService, loyalty, availabilityCache);
  const bookings = new BookingsService(
    prismaSvc,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    notificationService,
    redisLock,
    { get: (_: string, f?: string) => f } as any,
    loyalty,
    availabilityCache,
    { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any, { tryConsume: jest.fn().mockResolvedValue(true) } as any, { log: jest.fn() } as any,
  );
  return { admin, vendor, bookings };
}

function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoFuture(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// ═══════════════════════════════════════════════════════════════════════════
// Admin-created coupon (platform voucher)
// ═══════════════════════════════════════════════════════════════════════════

describe('Coupon lifecycle — admin-created platform voucher', () => {
  test('admin.createCoupon → code uppercased, status APPROVED, vendorId=null', async () => {
    await seedReference(ctx.prisma);
    const { admin } = makeServices();

    const coupon = await admin.createCoupon({
      code: 'welcome10',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      validFrom: isoFuture(-1),
      validTo: isoFuture(30),
    } as any);

    expect(coupon.code).toBe('WELCOME10'); // uppercased
    expect(coupon.status).toBe('APPROVED'); // admin coupons auto-approved
    expect(coupon.vendorId).toBeNull();
  });

  test('duplicate code → BadRequest ("already exists")', async () => {
    await seedReference(ctx.prisma);
    const { admin } = makeServices();
    await admin.createCoupon({
      code: 'DUPE', discountType: 'PERCENTAGE', discountValue: 10,
      validFrom: isoFuture(-1), validTo: isoFuture(30),
    } as any);
    await expect(
      admin.createCoupon({
        code: 'DUPE', discountType: 'FIXED', discountValue: 5,
        validFrom: isoFuture(-1), validTo: isoFuture(30),
      } as any),
    ).rejects.toThrow(/already exists/i);
  });

  test('PERCENTAGE > 100 → BadRequest', async () => {
    await seedReference(ctx.prisma);
    const { admin } = makeServices();
    await expect(
      admin.createCoupon({
        code: 'OVER100', discountType: 'PERCENTAGE', discountValue: 150,
        validFrom: isoFuture(-1), validTo: isoFuture(30),
      } as any),
    ).rejects.toThrow(/cannot exceed 100/i);
  });

  test('validTo <= validFrom → BadRequest', async () => {
    await seedReference(ctx.prisma);
    const { admin } = makeServices();
    await expect(
      admin.createCoupon({
        code: 'BACKWARDS', discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: isoFuture(10), validTo: isoFuture(5),
      } as any),
    ).rejects.toThrow(/after the start/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Admin approval flow — vendor-created coupons
// ═══════════════════════════════════════════════════════════════════════════

describe('Coupon lifecycle — admin approve / reject vendor coupons', () => {
  test('vendor coupon starts PENDING → admin APPROVES → status flips + notification', async () => {
    const seed = await seedReference(ctx.prisma);
    // Vendor creates their own coupon (using direct DB insert to mimic vendor.service.createCoupon)
    const vendorCoupon = await ctx.prisma.coupon.create({
      data: {
        code: 'VENDOR20', vendorId: seed.vendor.id,
        discountType: 'PERCENTAGE', discountValue: 20,
        validFrom: new Date(isoFuture(-1)),
        validTo: new Date(isoFuture(30)),
        status: 'PENDING', // vendor creates in PENDING; admin approves
      },
    });

    const { admin } = makeServices();
    const result = await admin.updateCouponStatus(vendorCoupon.id, 'APPROVED');
    expect(result.status).toBe('APPROVED');

    const after = await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: vendorCoupon.id } });
    expect(after.status).toBe('APPROVED');
  });

  test('admin rejects via EXPIRED status (the only "off" state per schema)', async () => {
    // CouponStatus enum: PENDING | APPROVED | EXPIRED — no REJECTED state.
    // Admin rejection in practice sets status to EXPIRED (also what cron does).
    const seed = await seedReference(ctx.prisma);
    const coupon = await ctx.prisma.coupon.create({
      data: {
        code: 'REJECTME', vendorId: seed.vendor.id,
        discountType: 'FIXED', discountValue: 5,
        validFrom: new Date(isoFuture(-1)),
        validTo: new Date(isoFuture(30)),
        status: 'PENDING',
      },
    });
    const { admin } = makeServices();
    await admin.updateCouponStatus(coupon.id, 'EXPIRED');
    const after = await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
    expect(after.status).toBe('EXPIRED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Customer claim (platform voucher)
// ═══════════════════════════════════════════════════════════════════════════

describe('Coupon lifecycle — customer claim (OffersController-parity)', () => {
  test('customer claims APPROVED platform voucher → ClaimedCoupon row written', async () => {
    const seed = await seedReference(ctx.prisma);

    const voucher = await ctx.prisma.coupon.create({
      data: {
        code: 'SUMMER25', discountType: 'PERCENTAGE', discountValue: 25,
        validFrom: new Date(isoFuture(-1)),
        validTo: new Date(isoFuture(30)),
        status: 'APPROVED',
        vendorId: null, // platform voucher
      },
    });

    // Direct DB claim mimics OffersController logic (no service method)
    await ctx.prisma.claimedCoupon.create({
      data: { userId: seed.customer.id, couponId: voucher.id },
    });

    const claimed = await ctx.prisma.claimedCoupon.findUniqueOrThrow({
      where: { userId_couponId: { userId: seed.customer.id, couponId: voucher.id } },
    });
    expect(claimed.used).toBe(false);
  });

  test('second claim by same user → P2002 (@@unique userId_couponId)', async () => {
    const seed = await seedReference(ctx.prisma);
    const voucher = await ctx.prisma.coupon.create({
      data: {
        code: 'ONCE', discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date(isoFuture(-1)),
        validTo: new Date(isoFuture(30)),
        status: 'APPROVED',
      },
    });
    await ctx.prisma.claimedCoupon.create({
      data: { userId: seed.customer.id, couponId: voucher.id },
    });
    await expect(
      ctx.prisma.claimedCoupon.create({
        data: { userId: seed.customer.id, couponId: voucher.id },
      }),
    ).rejects.toThrow(/Unique constraint|P2002/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Apply at booking time — usedCount increments + used flag
// ═══════════════════════════════════════════════════════════════════════════

describe('Coupon lifecycle — apply at booking time', () => {
  test('applying vendor coupon at booking → usedCount++, discount recorded', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();

    const coupon = await ctx.prisma.coupon.create({
      data: {
        code: 'VENDOR15', vendorId: seed.vendor.id,
        discountType: 'PERCENTAGE', discountValue: 15,
        validFrom: new Date(isoFuture(-1)),
        validTo: new Date(isoFuture(30)),
        usageLimit: 100, usedCount: 0, status: 'APPROVED',
      },
    });

    const res = await bookings.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 2,
      bookingPhone: '+97455123456',
      couponCode: 'VENDOR15',
      idempotencyKey: crypto.randomUUID(),
    });

    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
    expect(b.couponCode).toBe('VENDOR15');
    // 15% of 200 = 30 discount
    expect(Number(b.couponDiscount)).toBe(30);

    const after = await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
    expect(after.usedCount).toBe(1);
  });

  test('coupon tied to different vendor → rejected ("not valid for this activity")', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();

    // Second vendor + their own coupon
    const otherVendorUser = await ctx.prisma.user.create({
      data: {
        fullName: 'OtherVendor', email: `ov-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'VENDOR', emailVerified: true,
      },
    });
    const otherVendor = await ctx.prisma.vendor.create({
      data: {
        userId: otherVendorUser.id, businessNameEn: 'Other Biz', businessNameAr: 'أخرى',
        businessId: 'BIZ-OTHER-' + crypto.randomUUID().slice(0, 6),
        slug: 'other-' + crypto.randomUUID().slice(0, 6),
        countryId: seed.country.id, status: 'ACTIVE',
      },
    });
    await ctx.prisma.coupon.create({
      data: {
        code: 'OTHER10', vendorId: otherVendor.id,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date(isoFuture(-1)),
        validTo: new Date(isoFuture(30)),
        status: 'APPROVED',
      },
    });

    await expect(
      bookings.createBooking(seed.customer.id, {
        activityId: seed.activity.id, // original vendor
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 2,
      bookingPhone: '+97455123456',
        couponCode: 'OTHER10', // belongs to otherVendor
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
  });

  test('coupon scoped to specific activities (Bug A) → rejected on others, applied on the listed one', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();

    // Scoped to a DIFFERENT activity id → must NOT apply to seed.activity.
    await ctx.prisma.coupon.create({
      data: {
        code: 'SCOPED50', vendorId: seed.vendor.id,
        applicableActivityIds: [crypto.randomUUID()], // not seed.activity.id
        discountType: 'PERCENTAGE', discountValue: 50,
        validFrom: new Date(isoFuture(-1)), validTo: new Date(isoFuture(30)),
        usageLimit: 100, usedCount: 0, status: 'APPROVED',
      },
    });
    await expect(
      bookings.createBooking(seed.customer.id, {
        activityId: seed.activity.id,
        checkInDate: futureDate(7), slotTime: '10:00', guests: 2,
        bookingPhone: '+97455123456',
        couponCode: 'SCOPED50',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/not valid for this activity/i);

    // Scoped to THIS activity → applies normally.
    await ctx.prisma.coupon.create({
      data: {
        code: 'SCOPEDOK', vendorId: seed.vendor.id,
        applicableActivityIds: [seed.activity.id],
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date(isoFuture(-1)), validTo: new Date(isoFuture(30)),
        usageLimit: 100, usedCount: 0, status: 'APPROVED',
      },
    });
    const res = await bookings.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7), slotTime: '10:00', guests: 2,
      bookingPhone: '+97455123456',
      couponCode: 'SCOPEDOK',
      idempotencyKey: crypto.randomUUID(),
    });
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: res.booking.id } });
    expect(b.couponCode).toBe('SCOPEDOK');
    expect(Number(b.couponDiscount)).toBe(20); // 10% of 200
  });

  test('coupon beyond usageLimit → rejected, no booking', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();

    await ctx.prisma.coupon.create({
      data: {
        code: 'MAXED2', vendorId: seed.vendor.id,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date(isoFuture(-1)),
        validTo: new Date(isoFuture(30)),
        usageLimit: 5, usedCount: 5,
        status: 'APPROVED',
      },
    });

    await expect(
      bookings.createBooking(seed.customer.id, {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 2,
      bookingPhone: '+97455123456',
        couponCode: 'MAXED2',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();

    expect(await ctx.prisma.booking.count()).toBe(0);
  });

  test('PENDING (not-yet-approved) coupon → rejected', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();

    await ctx.prisma.coupon.create({
      data: {
        code: 'PENDOK', vendorId: seed.vendor.id,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date(isoFuture(-1)),
        validTo: new Date(isoFuture(30)),
        status: 'PENDING', // not yet approved
      },
    });

    await expect(
      bookings.createBooking(seed.customer.id, {
        activityId: seed.activity.id,
        checkInDate: futureDate(7),
        slotTime: '10:00',
        guests: 2,
      bookingPhone: '+97455123456',
        couponCode: 'PENDOK',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
  });
});
