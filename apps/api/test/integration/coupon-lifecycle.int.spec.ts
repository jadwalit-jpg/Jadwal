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
import { BookingsService, refundCouponUsage } from '../../src/bookings/bookings.service';
import { OffersController } from '../../src/catalog/offers.controller';
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

// ═══════════════════════════════════════════════════════════════════════════
// Platform voucher usage limit — the global usedCount cap must hold ACROSS
// users on the CLAIMED-voucher path (not just the typed-code path). Regression
// for the voucher-path race fix that mirrors the typed-code fix (#306). The
// literal two-concurrent-redemptions race can't be reproduced without a
// concurrency harness, but these cover (a) the cross-user cap and (b) the
// at-limit guard that the conditional updateMany re-asserts.
// ═══════════════════════════════════════════════════════════════════════════

describe('Coupon lifecycle — platform voucher usage limit', () => {
  test('usageLimit=1 voucher: first user redeems, second user is rejected (cap holds across users)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();

    // A second customer — the "second user" in the bug report.
    const customer2 = await ctx.prisma.user.create({
      data: {
        fullName: 'Customer Two', email: `c2-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
      },
    });

    // Platform voucher (vendorId=null) with a single global use.
    const voucher = await ctx.prisma.coupon.create({
      data: {
        code: `PLAT1-${crypto.randomUUID().slice(0, 6)}`, vendorId: null,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date(isoFuture(-1)), validTo: new Date(isoFuture(30)),
        usageLimit: 1, usedCount: 0, status: 'APPROVED',
      },
    });

    // Each user claims it → their own ClaimedCoupon row.
    const claim1 = await ctx.prisma.claimedCoupon.create({ data: { userId: seed.customer.id, couponId: voucher.id } });
    const claim2 = await ctx.prisma.claimedCoupon.create({ data: { userId: customer2.id, couponId: voucher.id } });

    // User 1 redeems → succeeds, usedCount→1.
    const res1 = await bookings.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7), slotTime: '10:00', guests: 2,
      bookingPhone: '+97455123456',
      voucherId: claim1.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(res1.booking.id).toBeTruthy();
    expect((await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: voucher.id } })).usedCount).toBe(1);

    // User 2 redeems the SAME coupon → rejected (cap already reached).
    await expect(
      bookings.createBooking(customer2.id, {
        activityId: seed.activity.id,
        checkInDate: futureDate(8), slotTime: '10:00', guests: 2,
        bookingPhone: '+97455123457',
        voucherId: claim2.id,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow();

    // usedCount never exceeded the limit and only the first booking exists.
    expect((await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: voucher.id } })).usedCount).toBe(1);
    expect(await ctx.prisma.booking.count()).toBe(1);
  });

  test('single-use voucher is RELEASED + re-usable after the booking is cancelled', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();

    const voucher = await ctx.prisma.coupon.create({
      data: {
        code: `RELEASE-${crypto.randomUUID().slice(0, 6)}`, vendorId: null,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date(futureDate(-1)), validTo: new Date(futureDate(60)),
        usageLimit: 1, usedCount: 0, status: 'APPROVED',
      },
    });
    const claim = await ctx.prisma.claimedCoupon.create({ data: { userId: seed.customer.id, couponId: voucher.id } });

    // Book with the voucher → consumed: usedCount 1, auto-capped to EXPIRED, claim.used true.
    const res = await bookings.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7), slotTime: '10:00', guests: 2,
      bookingPhone: '+97455123456',
      voucherId: claim.id,
      idempotencyKey: crypto.randomUUID(),
    });
    const afterBook = await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(afterBook.usedCount).toBe(1);
    expect(afterBook.status).toBe('EXPIRED'); // auto-capped at the limit
    expect((await ctx.prisma.claimedCoupon.findUniqueOrThrow({ where: { id: claim.id } })).used).toBe(true);

    // Cancel → released: usedCount 0, status restored to APPROVED, claim.used false.
    await bookings.cancelBooking(seed.customer.id, res.booking.id);
    const afterCancel = await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(afterCancel.usedCount).toBe(0);
    expect(afterCancel.status).toBe('APPROVED');
    expect((await ctx.prisma.claimedCoupon.findUniqueOrThrow({ where: { id: claim.id } })).used).toBe(false);

    // And it can be applied again on a fresh booking.
    const res2 = await bookings.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(9), slotTime: '10:00', guests: 2,
      bookingPhone: '+97455123456',
      voucherId: claim.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(res2.booking.id).toBeTruthy();
    expect((await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: voucher.id } })).usedCount).toBe(1);
  });

  test('an admin-rejected (EXPIRED, never-used) coupon is NOT resurrected by a release', async () => {
    // Guards the release fix from over-reaching: a rejected coupon has usedCount 0
    // (< limit), so the release must leave it EXPIRED.
    const seed = await seedReference(ctx.prisma);
    const rejected = await ctx.prisma.coupon.create({
      data: {
        code: `REJECTED-${crypto.randomUUID().slice(0, 6)}`, vendorId: null,
        discountType: 'FIXED', discountValue: 5,
        validFrom: new Date(futureDate(-1)), validTo: new Date(futureDate(60)),
        usageLimit: 1, usedCount: 0, status: 'EXPIRED',
      },
    });
    await ctx.prisma.$transaction((tx) => refundCouponUsage(tx, rejected.code, seed.customer.id));
    expect((await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: rejected.id } })).status).toBe('EXPIRED');
  });

  test('createCoupon normalises validTo to END-of-day so it is live through the expiry day', async () => {
    const { admin } = makeServices();
    const today = new Date().toISOString().slice(0, 10);
    const c = await admin.createCoupon({
      code: `EOD-${crypto.randomUUID().slice(0, 6)}`,
      discountType: 'PERCENTAGE', discountValue: 10,
      validFrom: today, validTo: today, // same day — previously rejected / expired at 00:00
    } as any);
    expect(c.validFrom.toISOString()).toContain('T00:00:00.000Z');
    expect(c.validTo.toISOString()).toContain('T23:59:59.999Z');
    expect(c.validTo.getTime()).toBeGreaterThan(Date.now()); // → matches `validTo > now` on /offers
  });

  test('platform-voucher CLAIM is capped at usageLimit (not just redemptions)', async () => {
    const seed = await seedReference(ctx.prisma);
    const offers = new OffersController({ client: ctx.prisma } as any);
    const voucher = await ctx.prisma.coupon.create({
      data: {
        code: `CLAIMCAP-${crypto.randomUUID().slice(0, 6)}`, vendorId: null,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date(futureDate(-1)), validTo: new Date(futureDate(30)),
        usageLimit: 2, usedCount: 0, status: 'APPROVED',
      },
    });
    const mkCustomer = async () => ctx.prisma.user.create({
      data: { email: `cc-${crypto.randomUUID().slice(0, 8)}@t.com`, password: 'x', fullName: 'CC', role: 'CUSTOMER', emailVerified: true },
    });
    const c2 = await mkCustomer();
    const c3 = await mkCustomer();
    await offers.claimOffer({ id: seed.customer.id, role: 'CUSTOMER' } as any, voucher.id);
    await offers.claimOffer({ id: c2.id, role: 'CUSTOMER' } as any, voucher.id);
    // 3rd distinct user exceeds the 2-claim cap → rejected (no redemption needed).
    await expect(offers.claimOffer({ id: c3.id, role: 'CUSTOMER' } as any, voucher.id)).rejects.toThrow();
    expect(await ctx.prisma.claimedCoupon.count({ where: { couponId: voucher.id } })).toBe(2);

    // A fully-claimed voucher is excluded from /offers entirely (nothing left to grab).
    const list = await offers.listOffers({} as any);
    expect(list.find((o) => o.id === voucher.id)).toBeUndefined();
  });

  test('claim + redeem of a usageLimit=1 voucher counts each dimension ONCE (no double-count)', async () => {
    const seed = await seedReference(ctx.prisma);
    const offers = new OffersController({ client: ctx.prisma } as any);
    const { bookings } = makeServices();
    const voucher = await ctx.prisma.coupon.create({
      data: {
        code: `NODBL-${crypto.randomUUID().slice(0, 6)}`, vendorId: null,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date(futureDate(-1)), validTo: new Date(futureDate(30)),
        usageLimit: 1, usedCount: 0, status: 'APPROVED',
      },
    });
    // CLAIM → claim count 1, usedCount untouched (claiming is not a redemption).
    await offers.claimOffer({ id: seed.customer.id, role: 'CUSTOMER' } as any, voucher.id);
    expect(await ctx.prisma.claimedCoupon.count({ where: { couponId: voucher.id } })).toBe(1);
    expect((await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: voucher.id } })).usedCount).toBe(0);

    const claim = await ctx.prisma.claimedCoupon.findFirstOrThrow({ where: { couponId: voucher.id, userId: seed.customer.id } });
    // REDEEM → usedCount becomes 1, claim count STAYS 1 (existing row flipped used=true, no new row).
    await bookings.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7), slotTime: '10:00', guests: 2,
      bookingPhone: '+97455123456',
      voucherId: claim.id,
      idempotencyKey: crypto.randomUUID(),
    });

    const after = await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: voucher.id } });
    expect(after.usedCount).toBe(1); // redeemed exactly once, not doubled
    expect(await ctx.prisma.claimedCoupon.count({ where: { couponId: voucher.id } })).toBe(1); // claimed once, not doubled
    expect((await ctx.prisma.claimedCoupon.findUniqueOrThrow({ where: { id: claim.id } })).used).toBe(true);
  });

  test('voucher redemption rejected when usedCount already at usageLimit', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();

    // Already at the cap but still APPROVED — the conditional updateMany guard
    // (and the read-then-act pre-check) must reject without incrementing.
    const voucher = await ctx.prisma.coupon.create({
      data: {
        code: `PLATMAX-${crypto.randomUUID().slice(0, 6)}`, vendorId: null,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date(isoFuture(-1)), validTo: new Date(isoFuture(30)),
        usageLimit: 1, usedCount: 1, status: 'APPROVED',
      },
    });
    const claim = await ctx.prisma.claimedCoupon.create({ data: { userId: seed.customer.id, couponId: voucher.id } });

    await expect(
      bookings.createBooking(seed.customer.id, {
        activityId: seed.activity.id,
        checkInDate: futureDate(7), slotTime: '10:00', guests: 2,
        bookingPhone: '+97455123456',
        voucherId: claim.id,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/usage limit/i);

    expect(await ctx.prisma.booking.count()).toBe(0);
    expect((await ctx.prisma.coupon.findUniqueOrThrow({ where: { id: voucher.id } })).usedCount).toBe(1);
  });
});
