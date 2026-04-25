/**
 * Points + payment-method visibility across actors.
 *
 * Regression-tests a UX gap where a fully Wanasa-paid booking rendered as
 * "QAR 0 · Paid" on the vendor/customer/admin bookings pages with no hint of
 * the actual activity cost or that points were used. The fix exposed the
 * already-persisted fields (pointsRedeemed, pointsDiscount, payment.method)
 * through every booking-list endpoint so the UI could show the breakdown.
 *
 * Also pins the Complete-button guard: manually marking a CONFIRMED booking
 * COMPLETED before endDatetime has passed is rejected — prevents early
 * loyalty-point awards + premature "event complete" notifications.
 */

import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { VendorService } from '../../src/vendor/vendor.service';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeServices() {
  const prismaSvc = { client: ctx.prisma } as any;
  const auditLogger = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const notificationService = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const redisLock = {
    acquire: jest.fn().mockResolvedValue('lock-token'),
    release: jest.fn().mockResolvedValue(undefined),
  } as any;
  const configService = {
    get: (k: string, fallback?: string) => {
      const cfg: Record<string, string> = {
        RESERVATION_WINDOW_MINUTES: '15',
        BOOKING_MAX_ADVANCE_YEARS: '2',
        REDIS_LOCK_TTL_MS: '30000',
      };
      return cfg[k] ?? fallback;
    },
  } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  return {
    admin: new AdminService(prismaSvc, notificationService, loyalty, availabilityCache),
    vendor: new VendorService(prismaSvc, notificationService, loyalty, availabilityCache),
    bookings: new BookingsService(
      prismaSvc, auditLogger, notificationService, redisLock,
      configService, loyalty, availabilityCache,
    ),
  };
}

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/**
 * Create a Wanasa-only booking by granting enough points to cover the full
 * activity price + service fee. Uses the real booking service so we get the
 * actual WANASA_POINTS branch — not a hand-crafted row.
 */
async function createWanasaBooking() {
  const seed = await seedReference(ctx.prisma);
  const { bookings } = makeServices();

  // Loyalty config: 1 point = 1 QAR (simplifies arithmetic)
  await ctx.prisma.loyaltyConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', pointsPerQar: 1, qarPerPoint: 1 },
    update: { pointsPerQar: 1, qarPerPoint: 1 },
  });

  // Grant 10,000 points — far more than needed for 2 guests × 100 QAR + fee
  await ctx.prisma.user.update({
    where: { id: seed.customer.id },
    data: { loyaltyPoints: 10_000 },
  });
  await ctx.prisma.loyaltyLedger.create({
    data: {
      userId: seed.customer.id, delta: 10_000, balanceAfter: 10_000,
      source: 'ADMIN_ADJUST', actorType: 'SYSTEM', reason: 'genesis',
    },
  });

  const res = await bookings.createBooking(seed.customer.id, {
    activityId: seed.activity.id,
    checkInDate: futureDate(7),
    slotTime: '10:00',
    guests: 2,
    redeemPoints: 10_000, // more than enough → full Wanasa coverage
    idempotencyKey: crypto.randomUUID(),
  });

  return { seed, bookingId: res.booking.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// Data-visibility: each list endpoint exposes points + method
// ═══════════════════════════════════════════════════════════════════════════

describe('Booking list endpoints — Wanasa points visibility', () => {
  test('admin.getBookings returns pointsRedeemed + pointsDiscount + payment.method', async () => {
    const { seed } = await createWanasaBooking();
    const { admin } = makeServices();
    // Need an admin user to call the service (vendor profile doesn't matter)
    await ctx.prisma.user.create({
      data: {
        fullName: 'Admin', email: 'admin@test.com',
        password: '$2b$10$dummy.hash.for.tests.never.used.in.auth',
        role: 'ADMIN', emailVerified: true,
      },
    });

    const res: any = await admin.getBookings({ page: 1, limit: 20 });
    expect(res.data).toHaveLength(1);
    const row = res.data[0];

    expect(row.customer.id).toBe(seed.customer.id);
    // Points fields MUST come back (bug fix)
    expect(row.pointsRedeemed).toBeGreaterThan(0);
    expect(Number(row.pointsDiscount)).toBeGreaterThan(0);
    // Payment method identifies the Wanasa path
    expect(row.payment.method).toBe('WANASA_POINTS');
    expect(Number(row.payment.amount)).toBe(0);
    // Under the current accounting model, totalPrice carries the vendor's
    // full earned amount regardless of how the customer paid — Wanasa
    // points are platform-issued store credit backed by cash, so the
    // vendor earns their commission on every booking. For 2 guests ×
    // 100 QAR = 200.
    expect(Number(row.totalPrice)).toBe(200);
  });

  test('vendor.getBookings returns pointsRedeemed + pointsDiscount + payment.method', async () => {
    const { seed } = await createWanasaBooking();
    const { vendor } = makeServices();

    const res: any = await vendor.getBookings(seed.vendorUser.id, { page: 1, limit: 20 });
    expect(res.data).toHaveLength(1);
    const row = res.data[0];

    expect(row.pointsRedeemed).toBeGreaterThan(0);
    expect(Number(row.pointsDiscount)).toBeGreaterThan(0);
    expect(row.payment.method).toBe('WANASA_POINTS');
    // totalPrice = full vendor value (2 × 100 = 200).
    expect(Number(row.totalPrice)).toBe(200);
    // Service fee is WAIVED on Wanasa-paid bookings (loyalty incentive).
    expect(Number(row.serviceFee)).toBe(0);
    // Nominal reconstruction adds back couponDiscount only — totalPrice
    // already carries the full value for every payment method.
    const nominal = Number(row.totalPrice) + Number(row.couponDiscount ?? 0);
    expect(nominal).toBe(200);
  });

  test('bookings.getMyBookings returns pointsRedeemed + pointsDiscount + payment.method', async () => {
    const { seed } = await createWanasaBooking();
    const { bookings } = makeServices();

    const res: any = await bookings.getMyBookings(seed.customer.id);
    expect(res.data).toHaveLength(1);
    const row = res.data[0];

    expect(row.pointsRedeemed).toBeGreaterThan(0);
    expect(Number(row.pointsDiscount)).toBeGreaterThan(0);
    expect(row.payment.method).toBe('WANASA_POINTS');
  });

  test('bookings.getBookingById (customer detail) returns the same fields', async () => {
    const { seed, bookingId } = await createWanasaBooking();
    const { bookings } = makeServices();

    const row: any = await bookings.getBookingById(seed.customer.id, bookingId);
    expect(row.pointsRedeemed).toBeGreaterThan(0);
    expect(Number(row.pointsDiscount)).toBeGreaterThan(0);
    expect(row.payment.method).toBe('WANASA_POINTS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Aggregates: dashboard / earnings / analytics expose Wanasa alongside cash
// ═══════════════════════════════════════════════════════════════════════════

describe('Dashboard & analytics aggregates — Wanasa visibility', () => {
  test('vendor.getDashboardStats — Wanasa booking earns vendor normal commission', async () => {
    const { seed } = await createWanasaBooking();
    const { vendor } = makeServices();

    const stats: any = await vendor.getDashboardStats(seed.vendorUser.id);
    // Under the current accounting model, Wanasa-paid bookings ARE real
    // revenue for the vendor. 2 guests × 100 QAR = 200 gross, 10%
    // commission = 20, vendor's net = 180.
    expect(stats.totalRevenue).toBe(180);
    // bookingsValue = totalPrice + couponDiscount = 200 + 0 = 200.
    expect(stats.bookingsValue).toBe(200);
    // wanasaFundedValue tracks the customer-side spend via points (audit).
    expect(stats.wanasaFundedValue).toBe(200);
  });

  test('vendor.getEarnings — Wanasa booking contributes to pendingPayout', async () => {
    const { seed } = await createWanasaBooking();
    const { vendor } = makeServices();

    const earnings: any = await vendor.getEarnings(seed.vendorUser.id);
    // Wanasa booking creates SUCCESS + UNPAID payment → contributes to
    // pendingPayout. Vendor is owed 180 in cash (platform pays from float).
    expect(Number(earnings.pendingPayout)).toBe(180);
    expect(Number(earnings.totalEarned)).toBe(0); // not yet transferred
    expect(earnings.bookingsValue).toBe(200);
    expect(earnings.wanasaFundedValue).toBe(200);
    // Each recentPayments row must carry enough info to render the
    // Wanasa chip + method badge on the earnings table.
    expect(earnings.recentPayments).toHaveLength(1);
    const p = earnings.recentPayments[0];
    expect(p.pointsRedeemed).toBeGreaterThan(0);
    expect(Number(p.pointsDiscount)).toBeGreaterThan(0);
    expect(p.payment.method).toBe('WANASA_POINTS');
  });

  test('vendor.getRevenueChart — Wanasa booking contributes to monthly revenue', async () => {
    await createWanasaBooking();
    const { vendor } = makeServices();

    const seedUser = await ctx.prisma.user.findFirstOrThrow({ where: { role: 'VENDOR' } });
    const chart: any[] = await vendor.getRevenueChart(seedUser.id);
    expect(chart).toHaveLength(6); // 6 months rolling window
    // Wanasa bookings count toward real revenue now — there's a month
    // where both revenue (cash-owed to vendor) AND bookingsValue are
    // non-zero. wanasaFundedValue tracks customer spend separately.
    const wanasaMonth = chart.find((m) => m.wanasaFundedValue > 0);
    expect(wanasaMonth).toBeDefined();
    expect(wanasaMonth.revenue).toBeGreaterThan(0);
    expect(wanasaMonth.bookingsValue).toBeGreaterThan(0);
    // revenue and bookingsValue are close (differ only by commission).
    expect(wanasaMonth.bookingsValue).toBeGreaterThan(wanasaMonth.revenue);
  });

  test('vendor.getActivityAnalytics — Wanasa booking contributes to per-activity revenue', async () => {
    const { seed } = await createWanasaBooking();
    const { vendor } = makeServices();

    const rows: any[] = await vendor.getActivityAnalytics(seed.vendorUser.id);
    const row = rows.find((r) => r.id === seed.activity.id);
    expect(row).toBeDefined();
    // Wanasa bookings now credit the vendor's revenue like any other.
    expect(row.revenue).toBe(180);
    expect(row.bookingsValue).toBe(200);
    expect(row.wanasaFundedValue).toBe(200);
  });

  test('admin.getDashboardStats — Wanasa booking contributes to commission + owed balance', async () => {
    await createWanasaBooking();
    const { admin } = makeServices();

    const stats: any = await admin.getDashboardStats();
    // totalRevenue = sum of payment.amount (cash collected via PAY2M).
    // A Wanasa booking customer paid no cash, so this stays 0.
    expect(Number(stats.totalRevenue)).toBe(0);
    // Volume: bookingsValue picks up the full 200 nominal.
    expect(stats.bookingsValue).toBe(200);
    expect(stats.wanasaFundedValue).toBe(200);
    // Platform earned commission on this booking — 10% of 200 = 20.
    expect(stats.totalCommission).toBe(20);
    // Vendor is owed 180 from platform float.
    expect(stats.pendingPayoutOwed).toBe(180);
  });

  test('Wanasa-only booking: totalPrice=200 (vendor earns), serviceFee=0 (fee waived)', async () => {
    const { bookingId } = await createWanasaBooking();
    const row = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { totalPrice: true, serviceFee: true, commissionAmount: true, pointsRedeemed: true, pointsDiscount: true },
    });
    // Vendor earns the full booking value (Wanasa points are platform-
    // issued store credit, not a vendor-side discount).
    expect(Number(row.totalPrice)).toBe(200);
    expect(Number(row.commissionAmount)).toBe(20);
    // Service fee is waived as a loyalty incentive to the customer.
    expect(Number(row.serviceFee)).toBe(0);
    // Redemption is capped at activity price — 200 QAR worth of points used.
    expect(row.pointsRedeemed).toBeGreaterThan(0);
    expect(Number(row.pointsDiscount)).toBe(200);
  });

  test('Partial Wanasa redemption (not enough to cover activity) keeps serviceFee intact', async () => {
    const seed = await seedReference(ctx.prisma);
    const { bookings } = makeServices();

    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', pointsPerQar: 1, qarPerPoint: 1 },
      update: { pointsPerQar: 1, qarPerPoint: 1 },
    });
    await ctx.prisma.user.update({
      where: { id: seed.customer.id },
      data: { loyaltyPoints: 10_000 },
    });
    await ctx.prisma.loyaltyLedger.create({
      data: {
        userId: seed.customer.id, delta: 10_000, balanceAfter: 10_000,
        source: 'ADMIN_ADJUST', actorType: 'SYSTEM', reason: 'genesis',
      },
    });

    // Activity is 2 × 100 = 200 QAR. Redeem 100 points (= 100 QAR, above
    // the minRedemption=100 gate) → partial redemption → customer still
    // pays cash for the remaining 100 + 5 fee.
    const res = await bookings.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + 7);
        return d.toISOString().slice(0, 10);
      })(),
      slotTime: '10:00',
      guests: 2,
      redeemPoints: 100, // less than activity price (200) — fee must stay
      idempotencyKey: crypto.randomUUID(),
    });

    const b = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: res.booking.id },
      select: { totalPrice: true, serviceFee: true, pointsRedeemed: true, pointsDiscount: true, status: true, payment: true },
    });
    // Partial redemption: NOT a WANASA-only booking, fee intact, PENDING
    // (awaiting PAY2M), customer owes remaining 100 cash + 5 fee = 105.
    //
    // Wanasa revenue refactor: `totalPrice` now carries the FULL vendor
    // share (200) regardless of how much the customer covered with points.
    // The customer-side saving lives in `pointsDiscount`; vendor still
    // earns the whole 200 because Wanasa points are platform-issued store
    // credit backed by the platform's cash float.
    expect(b.status).toBe('PENDING');
    expect(Number(b.serviceFee)).toBe(5);
    expect(Number(b.totalPrice)).toBe(200);
    expect(b.pointsRedeemed).toBe(100);
    expect(Number(b.pointsDiscount)).toBe(100);
    expect(Number(b.payment!.amount)).toBe(105);
  });

  test('admin.getPayouts nested booking includes points fields via Prisma include', async () => {
    await createWanasaBooking();
    const { admin } = makeServices();

    const res: any = await admin.getPayouts({ page: 1, limit: 20 });
    expect(res.data).toHaveLength(1);
    const p = res.data[0];
    // Admin getPayouts uses `include` (not `select`) on booking → all
    // scalar fields are returned by default, including loyalty fields.
    expect(p.booking.pointsRedeemed).toBeGreaterThan(0);
    expect(Number(p.booking.pointsDiscount)).toBeGreaterThan(0);
    expect(p.method).toBe('WANASA_POINTS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Complete-button guard: backend rejects premature COMPLETED transitions
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorService.updateBookingStatus — Complete guard', () => {
  test('rejects COMPLETED when booking.endDatetime is still in the future', async () => {
    const { seed, bookingId } = await createWanasaBooking();
    const { vendor } = makeServices();

    // Booking was just created with checkInDate = +7 days → endDatetime is
    // well in the future. Attempting to mark it complete now must fail.
    await expect(
      vendor.updateBookingStatus(seed.vendorUser.id, bookingId, 'COMPLETED'),
    ).rejects.toThrow(ForbiddenException);

    // Booking still CONFIRMED (created as CONFIRMED via Wanasa path)
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b.status).toBe('CONFIRMED');
    expect(b.pointsAwarded).toBe(false); // no premature earn
  });

  test('allows COMPLETED once endDatetime has passed', async () => {
    const { seed, bookingId } = await createWanasaBooking();
    const { vendor } = makeServices();

    // Simulate the event ending: back-date endDatetime to 1 minute ago.
    // This is the state a booking would be in just after the event's real
    // end time passes — vendor can now legitimately close it out.
    await ctx.prisma.booking.update({
      where: { id: bookingId },
      data: { endDatetime: new Date(Date.now() - 60_000) },
    });

    const res: any = await vendor.updateBookingStatus(seed.vendorUser.id, bookingId, 'COMPLETED');
    expect(res.status).toBe('COMPLETED');

    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b.status).toBe('COMPLETED');
  });

  test('CANCELLED is still allowed for future bookings (no-show / vendor emergency)', async () => {
    const { seed, bookingId } = await createWanasaBooking();
    const { vendor } = makeServices();

    // Future booking — CANCELLED must succeed (different semantics from
    // Complete: cancel = "won't happen", complete = "did happen").
    const res: any = await vendor.updateBookingStatus(seed.vendorUser.id, bookingId, 'CANCELLED');
    expect(res.status).toBe('CANCELLED');
  });
});
