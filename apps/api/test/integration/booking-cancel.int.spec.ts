/**
 * BookingsService.cancelBooking + recordRefundDecision — customer + vendor
 * refund flow against a real Postgres.
 *
 * The flow:
 *   customer cancels  → payment → REFUND_PENDING, booking → CANCELLED
 *   vendor/admin decides → payment → REFUNDED or REJECTED, customer credited
 *                          with Wanasa points (no money back to card)
 *
 * Variants:
 *   - Unpaid booking → hard-delete (ghost cleanup)
 *   - Points-only booking → immediate full refund of points
 *   - Paid booking (cash + points) → two-step (REFUND_PENDING → decision)
 *   - Cancellation policy: FREE_CANCELLATION / PARTIAL_REFUND / NON_REFUNDABLE
 *   - Ownership gate: not-my-booking → ForbiddenException
 *   - Double-cancel race: second call → BadRequest or Conflict
 *   - Already-started: BadRequestException
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
  return {
    svc: new BookingsService(
      prismaSvc,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn(), sendToMany: jest.fn() } as any,
      { acquire: jest.fn().mockResolvedValue('tok'), release: jest.fn().mockResolvedValue(undefined) } as any,
      { get: (_: string, f?: string) => f } as any,
      loyalty,
      { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any,
      { sendBookingOtp: jest.fn().mockResolvedValue(undefined) } as any, { tryConsume: jest.fn().mockResolvedValue(true) } as any, { log: jest.fn() } as any,
    ),
  };
}

/** Seed reference + one CONFIRMED paid booking in the future. */
async function seedPaidBooking(opts: {
  policy?: 'FREE_CANCELLATION' | 'PARTIAL_REFUND' | 'NON_REFUNDABLE' | null;
  paidAmount?: number;
  pointsRedeemed?: number;
  hoursFromNow?: number;
}) {
  const seed = await seedReference(ctx.prisma);
  const policy = opts.policy ?? 'FREE_CANCELLATION';
  const paid = opts.paidAmount ?? 200;
  const pointsRedeemed = opts.pointsRedeemed ?? 0;
  const hours = opts.hoursFromNow ?? 72;

  await ctx.prisma.loyaltyConfig.upsert({
    where: { id: 'singleton' }, create: { id: 'singleton' }, update: {},
  });

  if (policy) {
    // cancellationDeadlineHours + partialRefundPercent are env-driven
    // (CANCELLATION_DEADLINE_HOURS default 24, PARTIAL_REFUND_PERCENT default 50).
    // Only the policy string lives on the Activity row.
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id },
      data: { cancellationPolicy: policy },
    });
  }

  const start = new Date(Date.now() + hours * 3600_000);
  const end = new Date(start.getTime() + 2 * 3600_000);

  const payment = await ctx.prisma.payment.create({
    data: {
      amount: paid, currency: 'QAR', status: 'SUCCESS',
      method: 'PAY2M', paidAt: new Date(),
    },
  });
  const booking = await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-CAN-${crypto.randomUUID().slice(0, 6)}`,
      currencyCode: 'QAR', guests: 2, bookingPhone: '+97455123456', totalPrice: paid, serviceFee: 5, commissionAmount: 20,
      status: 'CONFIRMED', startDatetime: start, endDatetime: end,
      activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      paymentId: payment.id, pointsRedeemed,
    },
  });

  // Admin user for recordRefundDecision tests
  const admin = await ctx.prisma.user.create({
    data: {
      fullName: 'Admin', email: `admin-${crypto.randomUUID().slice(0, 6)}@t.com`,
      password: '$2b$10$dummy', role: 'ADMIN', emailVerified: true,
    },
  });

  return { seed, booking, payment, admin };
}

// ═══════════════════════════════════════════════════════════════════════════
// Customer cancel — unpaid booking hard-delete
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.cancelBooking — unpaid booking', () => {
  test('PENDING without payment → booking deleted, points refunded (if any)', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' }, create: { id: 'singleton' }, update: {},
    });

    // Pre-debit 500 loyalty points to simulate createBooking's redeem
    await ctx.prisma.user.update({
      where: { id: seed.customer.id },
      data: { loyaltyPoints: 0 },
    });
    await ctx.prisma.loyaltyLedger.create({
      data: {
        userId: seed.customer.id, delta: -500, balanceAfter: 0,
        source: 'BOOKING_REDEEM', actorType: 'CUSTOMER', actorId: seed.customer.id,
        reason: 'test redeem',
      },
    });

    const start = new Date(Date.now() + 48 * 3600_000);
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-UNPAID-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR', guests: 1, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 5, commissionAmount: 10,
        status: 'PENDING',
        startDatetime: start, endDatetime: new Date(start.getTime() + 2 * 3600_000),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
        pointsRedeemed: 500,
      },
    });

    const { svc } = makeBookingsService();
    const res = await svc.cancelBooking(seed.customer.id, booking.id);

    expect(res.deleted).toBe(true);
    expect(res.pointsRefunded).toBe(500);
    expect(await ctx.prisma.booking.findUnique({ where: { id: booking.id } })).toBeNull();

    // Points refunded via ledger
    const refundRow = await ctx.prisma.loyaltyLedger.findFirstOrThrow({
      where: { userId: seed.customer.id, source: 'CANCEL_REFUND_UNPAID' },
    });
    // Refund of redeemed points returns the SAME amount that was debited
    // (500) — pass-through, not a rate calc, so unaffected by the
    // pointsPerQar/qarPerPoint redenomination.
    expect(Number(refundRow.delta)).toBe(500);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: seed.customer.id } });
    expect(Number(user.loyaltyPoints)).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Customer cancel — paid booking (2-step refund)
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.cancelBooking — paid booking', () => {
  test('FREE_CANCELLATION within deadline → payment REFUND_PENDING with 100% suggested', async () => {
    const { booking, payment } = await seedPaidBooking({
      policy: 'FREE_CANCELLATION', paidAmount: 200, hoursFromNow: 72,
    });
    const { svc } = makeBookingsService();

    const res = await svc.cancelBooking(booking.customerId, booking.id);

    expect(res.deleted).toBe(false);
    expect(res.status).toBe('REFUND_PENDING');
    expect(res.suggestedRefundPercent).toBe(100);
    expect(res.suggestedRefundAmount).toBe(200);

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('REFUND_PENDING');
    expect(Number(p.refundAmount)).toBe(200);

    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.status).toBe('CANCELLED');
    expect(b.cancelledBy).toBe('CUSTOMER');
  });

  test('NON_REFUNDABLE → payment REFUND_PENDING with 0% suggested', async () => {
    const { booking, payment } = await seedPaidBooking({
      policy: 'NON_REFUNDABLE', paidAmount: 200, hoursFromNow: 72,
    });
    const { svc } = makeBookingsService();
    const res = await svc.cancelBooking(booking.customerId, booking.id);
    expect(res.suggestedRefundPercent).toBe(0);
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.refundAmount).toBeNull();
  });

  test('PARTIAL_REFUND within deadline → 50% suggested', async () => {
    const { booking, payment } = await seedPaidBooking({
      policy: 'PARTIAL_REFUND', paidAmount: 200, hoursFromNow: 72,
    });
    const { svc } = makeBookingsService();
    const res = await svc.cancelBooking(booking.customerId, booking.id);
    expect(res.suggestedRefundPercent).toBe(50);
    expect(res.suggestedRefundAmount).toBe(100);
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(Number(p.refundAmount)).toBe(100);
  });

  test('PARTIAL_REFUND outside deadline → 0% suggested', async () => {
    const { booking } = await seedPaidBooking({
      policy: 'PARTIAL_REFUND', paidAmount: 200, hoursFromNow: 1, // 1h < 24h deadline
    });
    const { svc } = makeBookingsService();
    const res = await svc.cancelBooking(booking.customerId, booking.id);
    expect(res.suggestedRefundPercent).toBe(0);
  });

  test('redeemed points are refunded immediately (not waiting on vendor decision)', async () => {
    const { booking } = await seedPaidBooking({
      policy: 'FREE_CANCELLATION', paidAmount: 200, pointsRedeemed: 1_000, hoursFromNow: 72,
    });
    const { svc } = makeBookingsService();

    await svc.cancelBooking(booking.customerId, booking.id);

    const ledgerRow = await ctx.prisma.loyaltyLedger.findFirstOrThrow({
      where: { userId: booking.customerId, source: 'CANCEL_REFUND_PAID' },
    });
    // pointsRedeemed (1,000) is refunded as-is — pass-through of the
    // debited amount, not a qarPerPoint calc — so the seed is unaffected
    // by the redenomination.
    expect(Number(ledgerRow.delta)).toBe(1_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Customer cancel — points-only booking (immediate full refund)
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.cancelBooking — points-only booking', () => {
  test('WANASA-only payment (amount=0) → immediate REFUNDED + points returned', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.loyaltyConfig.upsert({
      where: { id: 'singleton' }, create: { id: 'singleton' }, update: {},
    });

    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 0, currency: 'QAR', status: 'SUCCESS',
        method: 'WANASA_POINTS', paidAt: new Date(),
      },
    });
    const start = new Date(Date.now() + 48 * 3600_000);
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-WN-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR', guests: 1, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 0, commissionAmount: 10,
        status: 'CONFIRMED',
        startDatetime: start, endDatetime: new Date(start.getTime() + 2 * 3600_000),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
        // Fully paid via points: 100 QAR totalPrice / qarPerPoint (new
        // default 1.0) = 100 points. (Old default qarPerPoint 0.01 gave
        // 100 / 0.01 = 10,000 points for the same 100 QAR price.)
        paymentId: payment.id, pointsRedeemed: 100,
      },
    });

    const { svc } = makeBookingsService();
    const res = await svc.cancelBooking(seed.customer.id, booking.id);
    expect(res.deleted).toBe(false);

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('REFUNDED');
    expect(Number(p.refundAmount)).toBe(0);

    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.status).toBe('CANCELLED');
    expect(b.refundDecisionActor).toBe('CUSTOMER');

    // All 100 points refunded automatically (no vendor review)
    const ledger = await ctx.prisma.loyaltyLedger.findFirstOrThrow({
      where: { userId: seed.customer.id, source: 'CANCEL_REFUND_PAID' },
    });
    expect(Number(ledger.delta)).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cancel guards
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.cancelBooking — guards', () => {
  test('not the booking owner → NotFoundException (IDOR-hardened, post-PR-#94)', async () => {
    // Updated 2026-05-02. Test predates PR #94 (commit 101d018) which
    // moved ownership into the Prisma `where` clause —
    // `findFirst({ where: { id, customerId: userId } })` simply doesn't
    // return foreign rows for the caller, so the response is now a
    // generic "Booking not found" instead of "Not your booking". This
    // collapses the 404/403 oracle (see check-security skill IDOR section).
    const { booking } = await seedPaidBooking({ policy: 'FREE_CANCELLATION' });
    const other = await ctx.prisma.user.create({
      data: {
        fullName: 'Other', email: `o-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
      },
    });
    const { svc } = makeBookingsService();
    await expect(svc.cancelBooking(other.id, booking.id)).rejects.toThrow(/not found/i);
  });

  test('already CANCELLED → BadRequestException (idempotent guard)', async () => {
    const { booking } = await seedPaidBooking({ policy: 'FREE_CANCELLATION' });
    await ctx.prisma.booking.update({
      where: { id: booking.id }, data: { status: 'CANCELLED' },
    });
    const { svc } = makeBookingsService();
    await expect(svc.cancelBooking(booking.customerId, booking.id))
      .rejects.toThrow(/already cancelled/i);
  });

  test('COMPLETED booking → BadRequestException (no refund post-fact)', async () => {
    const { booking } = await seedPaidBooking({ policy: 'FREE_CANCELLATION' });
    await ctx.prisma.booking.update({
      where: { id: booking.id }, data: { status: 'COMPLETED' },
    });
    const { svc } = makeBookingsService();
    await expect(svc.cancelBooking(booking.customerId, booking.id))
      .rejects.toThrow(/completed/i);
  });

  test('booking already started (startDatetime < now) → BadRequestException', async () => {
    const seed = await seedReference(ctx.prisma);
    const start = new Date(Date.now() - 3600_000); // 1h ago
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-STARTED-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR', guests: 1, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 0, commissionAmount: 10,
        status: 'CONFIRMED',
        startDatetime: start, endDatetime: new Date(start.getTime() + 2 * 3600_000),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });
    const { svc } = makeBookingsService();
    await expect(svc.cancelBooking(seed.customer.id, booking.id))
      .rejects.toThrow(/already started/i);
  });

  test('non-existent booking → NotFoundException', async () => {
    await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();
    await expect(
      svc.cancelBooking('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'),
    ).rejects.toThrow(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Vendor/admin refund decision
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.recordRefundDecision — vendor/admin APPROVE', () => {
  test('vendor APPROVE full refund → payment REFUNDED, points credited', async () => {
    const { seed, booking, payment } = await seedPaidBooking({
      policy: 'FREE_CANCELLATION', paidAmount: 200,
    });
    const { svc } = makeBookingsService();
    await svc.cancelBooking(booking.customerId, booking.id); // puts into REFUND_PENDING

    await svc.recordRefundDecision(
      seed.vendorUser.id, 'VENDOR', booking.id, 'APPROVE', 200, 'Full goodwill',
    );

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('REFUNDED');
    expect(Number(p.refundAmount)).toBe(200);

    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.refundDecisionActor).toBe('VENDOR');
    expect(b.refundDecisionBy).toBe(seed.vendorUser.id);

    // 200 QAR / 1.0 qarPerPoint (new default) = 200 points
    // (old default qarPerPoint 0.01 gave 200 / 0.01 = 20,000 points)
    const row = await ctx.prisma.loyaltyLedger.findFirstOrThrow({
      where: { userId: booking.customerId, source: 'VENDOR_REFUND_APPROVED' },
    });
    expect(Number(row.delta)).toBe(200);
  });

  test('vendor APPROVE partial refund with note', async () => {
    const { seed, booking, payment } = await seedPaidBooking({
      policy: 'PARTIAL_REFUND', paidAmount: 200,
    });
    const { svc } = makeBookingsService();
    await svc.cancelBooking(booking.customerId, booking.id);

    await svc.recordRefundDecision(
      seed.vendorUser.id, 'VENDOR', booking.id, 'APPROVE', 75, 'Customer cancelled last minute',
    );

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(Number(p.refundAmount)).toBe(75);
    // 75 QAR / 1.0 qarPerPoint (new default) = 75 points
    // (old default qarPerPoint 0.01 gave 75 / 0.01 = 7,500 points)
    const row = await ctx.prisma.loyaltyLedger.findFirstOrThrow({
      where: { userId: booking.customerId, source: 'VENDOR_REFUND_APPROVED' },
    });
    expect(Number(row.delta)).toBe(75);
  });

  test('admin APPROVE → source=ADMIN_REFUND_APPROVED on ledger row', async () => {
    const { booking, payment, admin } = await seedPaidBooking({
      policy: 'FREE_CANCELLATION', paidAmount: 200,
    });
    const { svc } = makeBookingsService();
    await svc.cancelBooking(booking.customerId, booking.id);

    await svc.recordRefundDecision(
      admin.id, 'ADMIN', booking.id, 'APPROVE', 200, 'Admin override',
    );

    const row = await ctx.prisma.loyaltyLedger.findFirstOrThrow({
      where: { userId: booking.customerId, source: 'ADMIN_REFUND_APPROVED' },
    });
    expect(row.actorType).toBe('ADMIN');
    expect(row.actorId).toBe(admin.id);

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('REFUNDED');
  });

  test('REJECT → payment REJECTED, no ledger row, booking audit has actor', async () => {
    const { seed, booking, payment } = await seedPaidBooking({
      policy: 'NON_REFUNDABLE', paidAmount: 200,
    });
    const { svc } = makeBookingsService();
    await svc.cancelBooking(booking.customerId, booking.id);

    await svc.recordRefundDecision(
      seed.vendorUser.id, 'VENDOR', booking.id, 'REJECT', undefined, 'Policy says non-refundable',
    );

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('REJECTED');
    expect(p.refundAmount).toBeNull();

    // No ledger row written for REJECT
    const rows = await ctx.prisma.loyaltyLedger.findMany({
      where: {
        userId: booking.customerId,
        source: { in: ['VENDOR_REFUND_APPROVED', 'ADMIN_REFUND_APPROVED'] },
      },
    });
    expect(rows).toHaveLength(0);

    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.refundDecisionActor).toBe('VENDOR');
    expect(b.refundDecisionNote).toContain('Policy says');
  });
});

describe('BookingsService.recordRefundDecision — guards', () => {
  test('non-vendor non-admin → ForbiddenException', async () => {
    const { booking } = await seedPaidBooking({ policy: 'FREE_CANCELLATION' });
    const { svc } = makeBookingsService();
    await svc.cancelBooking(booking.customerId, booking.id);

    const random = await ctx.prisma.user.create({
      data: {
        fullName: 'Rando', email: `r-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
      },
    });
    await expect(
      svc.recordRefundDecision(random.id, 'CUSTOMER', booking.id, 'APPROVE', 100, null as any),
    ).rejects.toThrow(/not authorised|forbidden/i);
  });

  test('other-vendor trying to decide on this booking → ForbiddenException', async () => {
    const { booking } = await seedPaidBooking({ policy: 'FREE_CANCELLATION' });
    const { svc } = makeBookingsService();
    await svc.cancelBooking(booking.customerId, booking.id);

    const otherVendorUser = await ctx.prisma.user.create({
      data: {
        fullName: 'OtherVendor', email: `ov-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'VENDOR', emailVerified: true,
      },
    });
    await expect(
      svc.recordRefundDecision(otherVendorUser.id, 'VENDOR', booking.id, 'APPROVE', 100, null as any),
    ).rejects.toThrow(/not authorised/i);
  });

  test('already-decided booking → ConflictException (second call)', async () => {
    const { seed, booking } = await seedPaidBooking({ policy: 'FREE_CANCELLATION' });
    const { svc } = makeBookingsService();
    await svc.cancelBooking(booking.customerId, booking.id);
    await svc.recordRefundDecision(seed.vendorUser.id, 'VENDOR', booking.id, 'APPROVE', 200, 'OK');

    await expect(
      svc.recordRefundDecision(seed.vendorUser.id, 'VENDOR', booking.id, 'APPROVE', 200, 'retry'),
    ).rejects.toThrow(/already been decided/i);
  });

  test('APPROVE with amount > paid → BadRequest (no ballooning refunds)', async () => {
    const { seed, booking } = await seedPaidBooking({ policy: 'FREE_CANCELLATION', paidAmount: 200 });
    const { svc } = makeBookingsService();
    await svc.cancelBooking(booking.customerId, booking.id);

    await expect(
      svc.recordRefundDecision(seed.vendorUser.id, 'VENDOR', booking.id, 'APPROVE', 500, 'overcharge'),
    ).rejects.toThrow(/cannot exceed/i);
  });

  test('APPROVE with negative amount → BadRequest', async () => {
    const { seed, booking } = await seedPaidBooking({ policy: 'FREE_CANCELLATION' });
    const { svc } = makeBookingsService();
    await svc.cancelBooking(booking.customerId, booking.id);

    await expect(
      svc.recordRefundDecision(seed.vendorUser.id, 'VENDOR', booking.id, 'APPROVE', -50, 'neg'),
    ).rejects.toThrow(/negative/i);
  });

  test('booking without payment → BadRequest', async () => {
    const seed = await seedReference(ctx.prisma);
    const start = new Date(Date.now() + 72 * 3600_000);
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-NOPAY-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR', guests: 1, bookingPhone: '+97455123456', totalPrice: 100, serviceFee: 0, commissionAmount: 10,
        status: 'CANCELLED',
        startDatetime: start, endDatetime: new Date(start.getTime() + 2 * 3600_000),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });
    const { svc } = makeBookingsService();
    await expect(
      svc.recordRefundDecision(seed.vendorUser.id, 'VENDOR', booking.id, 'APPROVE', 100, null as any),
    ).rejects.toThrow(/no payment/i);
  });
});
