/**
 * AdminService — vendor suspend / activity deactivate cascade.
 *
 * This is the "no-money-loss" contract: when support pulls the plug on a
 * vendor, every future paid booking must be cancelled, refunded to Wanasa
 * points, and the customer must be notified. Failures in one booking must
 * not abort the others. Past bookings must be left alone.
 *
 * Only a real DB can prove these end-to-end:
 *   - Vendor row flips to SUSPENDED + sessions killed
 *   - All vendor activities flip to INACTIVE
 *   - Future PENDING/CONFIRMED bookings → CANCELLED with cancelledBy=ADMIN
 *   - SUCCESS payment → REFUNDED with refundAmount
 *   - PENDING payment → FAILED
 *   - Loyalty ledger rows written for paid refund + redeemed points
 *   - Notifications persisted for vendor + every affected customer
 *   - Past bookings untouched (no silent rewrite)
 */

import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { NotificationService } from '../../src/common/services/notification.service';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeAdminService() {
  const prismaSvc = { client: ctx.prisma } as any;

  // LoyaltyService only uses the tx passed to its public methods, never
  // prisma.client directly — null works but we pass the same shim for safety.
  const loyalty = new LoyaltyService(prismaSvc);

  // NotificationService writes to Notification table. Stub web-push so
  // no VAPID keys are needed. Silent sendToUser lets us assert DB rows.
  const webPushStub = { sendToUser: jest.fn().mockResolvedValue(undefined) } as any;
  const notification = new NotificationService(prismaSvc, webPushStub);

  // AvailabilityCacheService — admin fires invalidate() fire-and-forget but
  // we don't exercise it here; a stub keeps the DI wiring honest.
  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;

  return new AdminService(prismaSvc, notification, loyalty, availabilityCache);
}

/**
 * Seed reference + a second activity + N future CONFIRMED bookings with
 * SUCCESS payments so the cascade has real work to do. Returns handles.
 */
async function seedWithBookings(opts: {
  numFutureBookings?: number;
  startingPoints?: number;
  pointsRedeemedPerBooking?: number;
  paymentAmountQar?: number;
} = {}) {
  const numFuture = opts.numFutureBookings ?? 3;
  const pointsRedeemed = opts.pointsRedeemedPerBooking ?? 0;
  const paymentAmount = opts.paymentAmountQar ?? 200;

  const seed = await seedReference(ctx.prisma);

  // Ensure a loyalty config exists so cascadeCancelFutureBookings doesn't race
  // to create it mid-cascade. Default qarPerPoint=0.01 → 200 QAR = 20,000 pts.
  await ctx.prisma.loyaltyConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  });

  // Additional customer who will own all the bookings
  const buyer = await ctx.prisma.user.create({
    data: {
      fullName: 'Buyer', email: `buyer-${crypto.randomUUID().slice(0, 8)}@t.com`,
      password: '$2b$10$dummy.hash.for.tests.never.used.in.auth',
      role: 'CUSTOMER', emailVerified: true,
      loyaltyPoints: opts.startingPoints ?? 0,
    },
  });

  // Admin user (needed as adminUserId argument)
  const admin = await ctx.prisma.user.create({
    data: {
      fullName: 'Admin', email: `admin-${crypto.randomUUID().slice(0, 8)}@t.com`,
      password: '$2b$10$dummy.hash.for.tests.never.used.in.auth',
      role: 'ADMIN', emailVerified: true,
    },
  });

  const bookings: Array<{ id: string; paymentId: string | null }> = [];
  for (let i = 0; i < numFuture; i++) {
    // Each future booking is on a distinct slot so overlap guards don't fire
    const start = new Date(`2030-07-${String(10 + i).padStart(2, '0')}T10:00:00Z`);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    // Booking owns the FK via Booking.paymentId — create Payment first, then
    // Booking with paymentId set (mirrors the real createBooking flow).
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: paymentAmount, currency: 'QAR',
        status: 'SUCCESS', method: 'card', paidAt: new Date(),
      },
    });
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-CAS-${i}-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 2, totalPrice: paymentAmount, serviceFee: 5, commissionAmount: 20,
        status: 'CONFIRMED',
        startDatetime: start, endDatetime: end,
        activityId: seed.activity.id,
        customerId: buyer.id,
        vendorId: seed.vendor.id,
        pointsRedeemed,
        paymentId: payment.id,
      },
    });
    bookings.push({ id: booking.id, paymentId: payment.id });
  }

  // A PAST booking we expect the cascade to IGNORE.
  const pastStart = new Date('2020-01-01T10:00:00Z');
  const pastEnd = new Date('2020-01-01T12:00:00Z');
  const pastBooking = await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-PAST-${crypto.randomUUID().slice(0, 6)}`,
      currencyCode: 'QAR',
      guests: 2, totalPrice: paymentAmount, serviceFee: 5, commissionAmount: 20,
      status: 'CONFIRMED',
      startDatetime: pastStart, endDatetime: pastEnd,
      activityId: seed.activity.id,
      customerId: buyer.id,
      vendorId: seed.vendor.id,
    },
  });

  return { seed, buyer, admin, bookings, pastBookingId: pastBooking.id };
}

// ═══════════════════════════════════════════════════════════════════════════
// Vendor suspend — full cascade
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.updateVendorStatus — SUSPENDED cascade', () => {
  test('vendor row flips to SUSPENDED', async () => {
    const { seed, admin } = await seedWithBookings({ numFutureBookings: 1 });
    const svc = makeAdminService();

    await svc.updateVendorStatus(seed.vendor.id, 'SUSPENDED', admin.id);

    const v = await ctx.prisma.vendor.findUniqueOrThrow({ where: { id: seed.vendor.id } });
    expect(v.status).toBe('SUSPENDED');
  });

  test('vendor refresh tokens are deleted (active sessions killed)', async () => {
    const { seed, admin } = await seedWithBookings({ numFutureBookings: 0 });
    // Seed two refresh tokens for the vendor user
    await ctx.prisma.refreshToken.create({
      data: {
        userId: seed.vendorUser.id,
        tokenHash: 'hash-1',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await ctx.prisma.refreshToken.create({
      data: {
        userId: seed.vendorUser.id,
        tokenHash: 'hash-2',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.vendorUser.id } })).toBe(2);

    const svc = makeAdminService();
    await svc.updateVendorStatus(seed.vendor.id, 'SUSPENDED', admin.id);

    expect(await ctx.prisma.refreshToken.count({ where: { userId: seed.vendorUser.id } })).toBe(0);
  });

  test('all vendor activities flip ACTIVE → INACTIVE', async () => {
    const { seed, admin } = await seedWithBookings({ numFutureBookings: 0 });

    // Add a second ACTIVE activity + a PENDING one
    const extra = await ctx.prisma.activity.create({
      data: {
        vendorId: seed.vendor.id, categoryId: seed.category.id,
        countryId: seed.country.id, cityId: seed.city.id,
        titleEn: 'Extra', titleAr: 'إضافي',
        slug: 'extra-' + crypto.randomUUID().slice(0, 6),
        descriptionEn: 'd', descriptionAr: 'د', locationAddress: 'x',
        locationLat: 25, locationLng: 51,
        bookingType: 'HOURLY', pricingModel: 'PER_PERSON',
        pricePerPerson: 50, capacity: 5, durationValue: 2,
        checkInTime: '09:00', checkOutTime: '21:00',
        coverImage: '/p.webp', status: 'ACTIVE',
      },
    });
    const pending = await ctx.prisma.activity.create({
      data: {
        vendorId: seed.vendor.id, categoryId: seed.category.id,
        countryId: seed.country.id, cityId: seed.city.id,
        titleEn: 'Pending', titleAr: 'قيد',
        slug: 'pend-' + crypto.randomUUID().slice(0, 6),
        descriptionEn: 'd', descriptionAr: 'د', locationAddress: 'x',
        locationLat: 25, locationLng: 51,
        bookingType: 'HOURLY', pricingModel: 'PER_PERSON',
        pricePerPerson: 50, capacity: 5, durationValue: 2,
        checkInTime: '09:00', checkOutTime: '21:00',
        coverImage: '/p.webp', status: 'PENDING',
      },
    });

    const svc = makeAdminService();
    await svc.updateVendorStatus(seed.vendor.id, 'SUSPENDED', admin.id);

    const all = await ctx.prisma.activity.findMany({
      where: { vendorId: seed.vendor.id }, orderBy: { createdAt: 'asc' },
    });
    for (const a of all) expect(a.status).toBe('INACTIVE');
    // Sanity: the extra+pending IDs specifically
    const extraAfter = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: extra.id } });
    const pendingAfter = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: pending.id } });
    expect(extraAfter.status).toBe('INACTIVE');
    expect(pendingAfter.status).toBe('INACTIVE');
  });

  test('every future CONFIRMED booking → CANCELLED with cancelledBy=ADMIN', async () => {
    const { seed, admin, bookings } = await seedWithBookings({ numFutureBookings: 3 });
    const svc = makeAdminService();

    await svc.updateVendorStatus(seed.vendor.id, 'SUSPENDED', admin.id);

    for (const b of bookings) {
      const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
      expect(row.status).toBe('CANCELLED');
      expect(row.cancelledBy).toBe('ADMIN');
      expect(row.refundDecisionActor).toBe('ADMIN');
      expect(row.refundDecisionBy).toBe(admin.id);
      expect(row.cancelledAt).toBeInstanceOf(Date);
    }
  });

  test('past booking is NOT touched (startDatetime < now filter)', async () => {
    const { seed, admin, pastBookingId } = await seedWithBookings({ numFutureBookings: 1 });
    const svc = makeAdminService();
    await svc.updateVendorStatus(seed.vendor.id, 'SUSPENDED', admin.id);

    const past = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: pastBookingId } });
    expect(past.status).toBe('CONFIRMED'); // unchanged
    expect(past.cancelledBy).toBeNull();
  });

  test('SUCCESS payment → REFUNDED with refundAmount + refundedAt', async () => {
    const { seed, admin, bookings } = await seedWithBookings({ numFutureBookings: 2, paymentAmountQar: 150 });
    const svc = makeAdminService();
    await svc.updateVendorStatus(seed.vendor.id, 'SUSPENDED', admin.id);

    for (const b of bookings) {
      const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: b.paymentId! } });
      expect(p.status).toBe('REFUNDED');
      expect(Number(p.refundAmount)).toBe(150);
      expect(p.refundedAt).toBeInstanceOf(Date);
    }
  });

  test('PENDING payment → FAILED (no refund row; pending money never moved)', async () => {
    const { seed, admin, buyer } = await seedWithBookings({ numFutureBookings: 0 });

    // Booking with PENDING payment — Payment first, Booking owns the FK.
    const payment = await ctx.prisma.payment.create({
      data: { amount: 100, currency: 'QAR', status: 'PENDING', method: 'card' },
    });
    const start = new Date('2030-08-01T10:00:00Z');
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-PEND-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 1, totalPrice: 100, serviceFee: 5, commissionAmount: 10,
        status: 'PENDING',
        startDatetime: start, endDatetime: new Date(start.getTime() + 2 * 3600_000),
        activityId: seed.activity.id, customerId: buyer.id, vendorId: seed.vendor.id,
        paymentId: payment.id,
      },
    });

    const svc = makeAdminService();
    await svc.updateVendorStatus(seed.vendor.id, 'SUSPENDED', admin.id);

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('FAILED');
    expect(p.refundAmount).toBeNull();
  });

  test('loyalty ledger row written for paid refund → Wanasa points (paidAmount / qarPerPoint)', async () => {
    // qarPerPoint default = 0.01 → 200 QAR ≡ 20,000 points
    const { seed, admin, buyer, bookings } = await seedWithBookings({
      numFutureBookings: 1, paymentAmountQar: 200,
    });
    const svc = makeAdminService();
    await svc.updateVendorStatus(seed.vendor.id, 'SUSPENDED', admin.id);

    const rows = await ctx.prisma.loyaltyLedger.findMany({
      where: { userId: buyer.id, source: 'ADMIN_REFUND_APPROVED' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].delta).toBe(20_000);
    expect(rows[0].bookingId).toBe(bookings[0].id);
    expect(rows[0].actorType).toBe('ADMIN');
    expect(rows[0].actorId).toBe(admin.id);

    // User balance increased by the same amount
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: buyer.id } });
    expect(u.loyaltyPoints).toBe(20_000);
  });

  test('redeemed points on the booking are also refunded via CANCEL_REFUND_PAID ledger row', async () => {
    const { seed, admin, buyer } = await seedWithBookings({
      numFutureBookings: 1, paymentAmountQar: 0, pointsRedeemedPerBooking: 500,
      startingPoints: 0, // balance after redeem would have gone negative in real flow;
                        // here we only care about the cascade refund ledger row
    });
    const svc = makeAdminService();
    await svc.updateVendorStatus(seed.vendor.id, 'SUSPENDED', admin.id);

    const redemptionRefunds = await ctx.prisma.loyaltyLedger.findMany({
      where: { userId: buyer.id, source: 'CANCEL_REFUND_PAID' },
    });
    expect(redemptionRefunds).toHaveLength(1);
    expect(redemptionRefunds[0].delta).toBe(500);
    expect(redemptionRefunds[0].actorType).toBe('ADMIN');
  });

  test('VENDOR_SUSPENDED notification written for the vendor user', async () => {
    const { seed, admin } = await seedWithBookings({ numFutureBookings: 0 });
    const svc = makeAdminService();
    await svc.updateVendorStatus(seed.vendor.id, 'SUSPENDED', admin.id);

    // Notification is fire-and-forget — wait briefly for the .catch chain
    await new Promise(r => setTimeout(r, 100));

    const n = await ctx.prisma.notification.findMany({
      where: { userId: seed.vendorUser.id, type: 'VENDOR_SUSPENDED' },
    });
    expect(n.length).toBeGreaterThanOrEqual(1);
    expect(n[0].title.toLowerCase()).toContain('suspended');
  });

  test('BOOKING_CANCELLED notification written to each affected customer', async () => {
    const { seed, admin, buyer, bookings } = await seedWithBookings({ numFutureBookings: 3 });
    const svc = makeAdminService();
    await svc.updateVendorStatus(seed.vendor.id, 'SUSPENDED', admin.id);

    await new Promise(r => setTimeout(r, 150));

    const n = await ctx.prisma.notification.findMany({
      where: { userId: buyer.id, type: 'BOOKING_CANCELLED' },
    });
    expect(n).toHaveLength(bookings.length);
    // Every notification mentions the refund line since payments were SUCCESS
    for (const row of n) {
      expect(row.message).toMatch(/refunded as Wanasa points/i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard cases — cascade must be gated
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.updateVendorStatus — cascade gating', () => {
  test('SUSPENDED without adminUserId → no cascade (vendor flips, bookings untouched)', async () => {
    const { seed, bookings } = await seedWithBookings({ numFutureBookings: 2 });
    const svc = makeAdminService();

    // Missing adminUserId — the service uses it as the gate for the refund cascade
    await svc.updateVendorStatus(seed.vendor.id, 'SUSPENDED', undefined);

    const v = await ctx.prisma.vendor.findUniqueOrThrow({ where: { id: seed.vendor.id } });
    expect(v.status).toBe('SUSPENDED'); // Status still flipped

    // But bookings are NOT cancelled — no audit attribution available
    for (const b of bookings) {
      const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
      expect(row.status).toBe('CONFIRMED');
    }

    // Activities also stay ACTIVE under the gated branch
    const a = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: seed.activity.id } });
    expect(a.status).toBe('ACTIVE');
  });

  test('flipping back to ACTIVE → does NOT cancel bookings, just status', async () => {
    const { seed, admin, bookings } = await seedWithBookings({ numFutureBookings: 2 });

    // Pre-suspend the vendor (without cascade) to set up the ACTIVE-flip test.
    await ctx.prisma.vendor.update({ where: { id: seed.vendor.id }, data: { status: 'SUSPENDED' } });

    const svc = makeAdminService();
    await svc.updateVendorStatus(seed.vendor.id, 'ACTIVE', admin.id);

    const v = await ctx.prisma.vendor.findUniqueOrThrow({ where: { id: seed.vendor.id } });
    expect(v.status).toBe('ACTIVE');

    for (const b of bookings) {
      const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
      expect(row.status).toBe('CONFIRMED');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Activity-level cascade
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.updateActivityStatus — single-activity cascade', () => {
  test('activity INACTIVE cascades bookings on that activity only', async () => {
    const { seed, admin, bookings } = await seedWithBookings({ numFutureBookings: 2 });

    // Second activity + its own future booking that MUST stay untouched
    const other = await ctx.prisma.activity.create({
      data: {
        vendorId: seed.vendor.id, categoryId: seed.category.id,
        countryId: seed.country.id, cityId: seed.city.id,
        titleEn: 'Other', titleAr: 'آخر',
        slug: 'other-' + crypto.randomUUID().slice(0, 6),
        descriptionEn: 'd', descriptionAr: 'د', locationAddress: 'x',
        locationLat: 25, locationLng: 51,
        bookingType: 'HOURLY', pricingModel: 'PER_PERSON',
        pricePerPerson: 50, capacity: 5, durationValue: 2,
        checkInTime: '09:00', checkOutTime: '21:00',
        coverImage: '/p.webp', status: 'ACTIVE',
      },
    });
    const otherBooking = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-OTHER-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR',
        guests: 2, totalPrice: 100, serviceFee: 5, commissionAmount: 10,
        status: 'CONFIRMED',
        startDatetime: new Date('2030-07-20T10:00:00Z'),
        endDatetime: new Date('2030-07-20T12:00:00Z'),
        activityId: other.id,
        customerId: (await ctx.prisma.user.findFirstOrThrow({ where: { role: 'CUSTOMER' } })).id,
        vendorId: seed.vendor.id,
      },
    });

    const svc = makeAdminService();
    await svc.updateActivityStatus(seed.activity.id, 'INACTIVE', admin.id, 'Cleanup');

    // Target activity bookings cancelled
    for (const b of bookings) {
      const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
      expect(row.status).toBe('CANCELLED');
    }

    // Other activity's booking untouched
    const untouched = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: otherBooking.id } });
    expect(untouched.status).toBe('CONFIRMED');
  });

  test('activity ACTIVE (approval) → no cascade', async () => {
    const { seed, admin, bookings } = await seedWithBookings({ numFutureBookings: 1 });
    // Flip to PENDING first so the ACTIVE flip is a real state change
    await ctx.prisma.activity.update({ where: { id: seed.activity.id }, data: { status: 'PENDING' } });

    const svc = makeAdminService();
    await svc.updateActivityStatus(seed.activity.id, 'ACTIVE', admin.id);

    for (const b of bookings) {
      const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
      expect(row.status).toBe('CONFIRMED');
    }
  });
});
