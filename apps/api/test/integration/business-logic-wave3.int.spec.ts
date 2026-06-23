/**
 * Wave 3 business-logic remediation contracts.
 *
 *   §B2 — orphan-recovery: callback arrives after cron deleted the booking
 *         → re-insert from server-derived snapshot, refund only as fallback
 *   §M6 — un-cancel callback: callback arrives after cron flipped the
 *         booking to CANCELLED-by-SYSTEM → un-cancel safely or refund
 *
 * Every abuse vector designed against in the plan has at least one test
 * here. Tests are LOGIC contracts (no exception/HTTP shapes); a future
 * refactor cannot accidentally re-open one of these gaps without flipping
 * a red dot.
 */

import { getTestContext, seedReference } from './_setup';
import { PaymentService } from '../../src/payment/payment.service';
import { buildBookingSnapshot } from '../../src/bookings/bookings.service';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

// ─── PAY2M test config + service factory (mirrors payment-callback spec) ────

const PAY2M = {
  MERCHANT_ID:   'TEST_MERCHANT',
  SECURED_KEY:   'secret-key',
  SECRET_WORD:   'secret-word',
  RETURN_URL:    'https://example.com/return',
  API_URL:       'https://pay2m.test',
  MERCHANT_NAME: 'Jadwal Test',
};

function configShim(overrides: Record<string, string> = {}) {
  const merged: Record<string, string> = {
    PAYMENT_ENABLED:     'true',
    PAY2M_MERCHANT_ID:   PAY2M.MERCHANT_ID,
    PAY2M_SECURED_KEY:   PAY2M.SECURED_KEY,
    PAY2M_SECRET_WORD:   PAY2M.SECRET_WORD,
    PAY2M_RETURN_URL:    PAY2M.RETURN_URL,
    PAY2M_API_URL:       PAY2M.API_URL,
    PAY2M_MERCHANT_NAME: PAY2M.MERCHANT_NAME,
    ...overrides,
  };
  return {
    get: (k: string, fallback?: string) => merged[k] ?? fallback,
    getOrThrow: <T,>(k: string): T => {
      const v = merged[k];
      if (v === undefined) throw new Error(`Missing config: ${k}`);
      return v as any;
    },
  };
}

function makePaymentService() {
  const prismaSvc = { client: ctx.prisma } as any;
  const redisLock = {
    acquire: jest.fn().mockResolvedValue('lock-token'),
    release: jest.fn().mockResolvedValue(undefined),
  } as any;
  // Real auditLogger so we can assert on FINANCIAL audit rows.
  const auditLogger = {
    log: jest.fn(async (params: any) => {
      await ctx.prisma.auditLog.create({
        data: {
          actorType: params.actorType,
          actorId: params.actorId,
          actorName: params.actorName,
          action: params.action,
          entity: params.entity,
          entityId: params.entityId ?? null,
          details: params.details ?? null,
          actionCategory: params.actionCategory ?? 'OPERATIONAL',
        },
      });
    }),
  } as any;
  const notificationService = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
  } as any;
  const emailService = {
    sendBookingConfirmation: jest.fn().mockResolvedValue(undefined),
  } as any;
  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
  } as any;
  const loyalty = {
    refund: jest.fn().mockResolvedValue(undefined),
    redeem: jest.fn().mockResolvedValue(undefined),
    reverseAwarded: jest.fn().mockResolvedValue(undefined),
  } as any;

  return {
    svc: new PaymentService(
      configShim() as any,
      prismaSvc,
      redisLock,
      auditLogger,
      notificationService,
      emailService,
      availabilityCache,
      loyalty,
    ),
    auditLogger,
    notificationService,
    availabilityCache,
  };
}

// PAY2M Response_Key recipe (Merchant Integration Guide, Table 1.2):
// SHA256(merchant_id + basket_id + secret_word + amount + err_code).
function signCallback(basketId: string, amount: string, errCode: string): string {
  const raw = `${PAY2M.MERCHANT_ID}${basketId}${PAY2M.SECRET_WORD}${amount}${errCode}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─── §B2 fixture: payment with snapshot but no booking (cron deleted it) ────

interface OrphanFixtureOpts {
  amountQar?: number;
  startOffsetMs?: number;     // booking start time relative to now (ms)
  endOffsetMs?: number;       // booking end time relative to now (ms)
  guests?: number;
  activityCapacity?: number;
  bookingPhone?: string;
}

async function seedOrphanedPayment(opts: OrphanFixtureOpts = {}) {
  const amountQar = opts.amountQar ?? 200;
  const startDt = new Date(Date.now() + (opts.startOffsetMs ?? 24 * 3600_000));
  const endDt = new Date(Date.now() + (opts.endOffsetMs ?? 26 * 3600_000));
  const seed = await seedReference(ctx.prisma);

  // If caller wants a different capacity, override.
  if (opts.activityCapacity !== undefined) {
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id },
      data: { capacity: opts.activityCapacity },
    });
  }

  const basketId = `BSK-${crypto.randomUUID().slice(0, 8)}`;
  const ref = `JDWL-ORPHAN-${crypto.randomUUID().slice(0, 6)}`;

  // Create the booking momentarily so we can use buildBookingSnapshot on a
  // real persisted row — this matches what bookings.service.createBooking
  // does — then delete it to simulate the cron's hard-delete.
  const booking = await ctx.prisma.booking.create({
    data: {
      ref,
      activityId: seed.activity.id,
      vendorId: seed.vendor.id,
      customerId: seed.customer.id,
      guests: opts.guests ?? 2,
      bookingPhone: opts.bookingPhone ?? '+97455123456',
      guestBreakdown: {},
      startDatetime: startDt,
      endDatetime: endDt,
      totalPrice: amountQar,
      currencyCode: 'QAR',
      commissionPct: 10,
      commissionAmount: amountQar * 0.1,
      serviceFee: 5,
      status: 'PENDING',
    },
  });
  const snapshot = buildBookingSnapshot(booking);

  const payment = await ctx.prisma.payment.create({
    data: {
      amount: amountQar,
      currency: 'QAR',
      status: 'PENDING',
      method: 'PAY2M',
      gatewayBasketId: basketId,
      bookingId: booking.id,
      bookingSnapshot: snapshot as any,
    },
  });

  // Now simulate the cron's hard-delete: drop the booking, leaving only the
  // payment with its snapshot.
  await ctx.prisma.booking.delete({ where: { id: booking.id } });

  return {
    seed,
    basketId,
    paymentId: payment.id,
    snapshot,
    amountStr: amountQar.toFixed(2),
    originalBookingId: booking.id,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §B2 — orphan-recovery
// ═══════════════════════════════════════════════════════════════════════════

describe('§B2 — orphan booking auto-recreates from snapshot', () => {
  test('happy path: booking re-inserted, payment SUCCESS, audit RECREATE, no refund', async () => {
    const { svc, auditLogger, notificationService } = makePaymentService();
    const { basketId, paymentId, amountStr, snapshot, originalBookingId } = await seedOrphanedPayment();

    const res = await svc.handleCallback({
      err_code: '00',
      basket_id: basketId,
      transaction_id: 'TXN-RECREATE',
      Response_Key: signCallback(basketId, amountStr, '00'),
    });

    expect(res.status).toBe('success');

    // Booking re-inserted with the EXACT ref + snapshot fields
    const recreated = await ctx.prisma.booking.findFirst({
      where: { ref: snapshot.ref },
      select: { id: true, status: true, totalPrice: true, paymentId: true, createdAt: true },
    });
    expect(recreated).not.toBeNull();
    expect(recreated!.status).toBe('CONFIRMED');
    expect(recreated!.totalPrice.toString()).toBe('200');
    expect(recreated!.paymentId).toBe(paymentId);
    // H1: re-created under the ORIGINAL booking id (retained on payment.bookingId)
    // so the redirect/poll/email/notification references all resolve to it
    // instead of dangling at a now-deleted id.
    expect(recreated!.id).toBe(originalBookingId);

    // Customer's original cancellation window preserved
    expect(recreated!.createdAt.toISOString()).toBe(snapshot.originalCreatedAt);

    // Payment now SUCCESS, points at the new booking, recreatedAt stamped
    const payment = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(payment!.status).toBe('SUCCESS');
    expect(payment!.bookingId).toBe(recreated!.id);
    expect(payment!.bookingRecreatedAt).not.toBeNull();
    // No refund queued
    expect(payment!.refundAmount).toBeNull();

    // FINANCIAL audit row written
    const auditCalls = (auditLogger.log as jest.Mock).mock.calls.map(c => c[0]);
    const recreateAudit = auditCalls.find(c => c.action === 'PAYMENT_RECOVERED_VIA_RECREATE');
    expect(recreateAudit).toBeDefined();
    expect(recreateAudit.actionCategory).toBe('FINANCIAL');

    // No admin alert (admin only pinged on refund-fallback paths)
    expect(notificationService.notifyAdmins).not.toHaveBeenCalled();
  });

  test('idempotency: replayed callback does NOT create a second booking', async () => {
    const { svc, auditLogger } = makePaymentService();
    const { basketId, paymentId, amountStr, snapshot } = await seedOrphanedPayment();
    const validKey = signCallback(basketId, amountStr, '00');

    await svc.handleCallback({ err_code: '00', basket_id: basketId, transaction_id: 'T1', Response_Key: validKey });
    // Second call (same basket, same hash) — PAY2M's at-least-once delivery
    await svc.handleCallback({ err_code: '00', basket_id: basketId, transaction_id: 'T1', Response_Key: validKey });

    const bookings = await ctx.prisma.booking.findMany({ where: { ref: snapshot.ref } });
    expect(bookings).toHaveLength(1);

    const payment = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(payment!.bookingRecreatedAt).not.toBeNull();
    // Only ONE recreate audit row (the second callback short-circuits via
    // bookingRecreatedAt before re-running the recreate path).
    const recreateAudits = (auditLogger.log as jest.Mock).mock.calls
      .map(c => c[0])
      .filter((c: any) => c.action === 'PAYMENT_RECOVERED_VIA_RECREATE');
    expect(recreateAudits).toHaveLength(1);
  });

  test('activity already ended → REFUND_PENDING, audit ACTIVITY_ALREADY_ENDED', async () => {
    const { svc, auditLogger, notificationService } = makePaymentService();
    // Activity ended 1h ago
    const { basketId, paymentId, amountStr, snapshot } = await seedOrphanedPayment({
      startOffsetMs: -3 * 3600_000,
      endOffsetMs:   -1 * 3600_000,
    });

    await svc.handleCallback({
      err_code: '00', basket_id: basketId, transaction_id: 'T1',
      Response_Key: signCallback(basketId, amountStr, '00'),
    });

    // No booking was recreated
    expect(await ctx.prisma.booking.findFirst({ where: { ref: snapshot.ref } })).toBeNull();
    // Payment flipped to REFUND_PENDING with the full amount
    const p = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(p!.status).toBe('REFUND_PENDING');
    expect(p!.refundAmount?.toString()).toBe('200');

    // Audit row tags the reason
    const reasons = (auditLogger.log as jest.Mock).mock.calls.map(c => c[0]);
    const refundAudit = reasons.find((c: any) => c.action === 'PAYMENT_RECOVERY_REFUND_QUEUED');
    expect(refundAudit).toBeDefined();
    expect(refundAudit.details).toMatch(/ACTIVITY_ALREADY_ENDED/);
    expect(refundAudit.actionCategory).toBe('FINANCIAL');

    // Admin alerted
    expect(notificationService.notifyAdmins).toHaveBeenCalledTimes(1);
  });

  test('slot already taken → REFUND_PENDING, audit SLOT_CONFLICT', async () => {
    const { svc, auditLogger } = makePaymentService();
    const { basketId, paymentId, amountStr, snapshot, seed } = await seedOrphanedPayment({
      activityCapacity: 2,                  // tiny capacity to force conflict
      guests: 2,
      bookingPhone: '+97455123456',
    });
    // While the original customer was at PAY2M, another customer booked the slot
    await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-INTRUDER',
        activityId: seed.activity.id,
        vendorId: seed.vendor.id,
        customerId: seed.customer.id,
        guests: 2,
        bookingPhone: '+97455123456',
        guestBreakdown: {},
        startDatetime: new Date(snapshot.startDatetime),
        endDatetime: new Date(snapshot.endDatetime),
        totalPrice: 200,
        currencyCode: 'QAR',
        commissionPct: 10,
        commissionAmount: 20,
        serviceFee: 5,
        status: 'CONFIRMED',
      },
    });

    await svc.handleCallback({
      err_code: '00', basket_id: basketId, transaction_id: 'T1',
      Response_Key: signCallback(basketId, amountStr, '00'),
    });

    // Original snapshot's ref was NOT recreated
    expect(await ctx.prisma.booking.findFirst({ where: { ref: snapshot.ref } })).toBeNull();
    // Payment is REFUND_PENDING
    const p = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(p!.status).toBe('REFUND_PENDING');
    expect(p!.refundAmount?.toString()).toBe('200');
    // bookingRecreatedAt was stamped before the conflict was detected,
    // which is fine — it acts as a "this payment has been processed" marker
    // and prevents replay-recovery from re-trying recreate.
    expect(p!.bookingRecreatedAt).not.toBeNull();
    // Audit reason
    const reasons = (auditLogger.log as jest.Mock).mock.calls.map(c => c[0]);
    expect(reasons.some((c: any) =>
      c.action === 'PAYMENT_RECOVERY_REFUND_QUEUED' && /SLOT_CONFLICT/.test(c.details))).toBe(true);
  });

  test('activity hard-deleted → REFUND_PENDING, audit ACTIVITY_DELETED', async () => {
    const { svc, auditLogger } = makePaymentService();
    const { basketId, paymentId, amountStr, snapshot, seed } = await seedOrphanedPayment();
    // Deleting the activity also forces FK cleanup; do bookings first
    await ctx.prisma.booking.deleteMany({ where: { activityId: seed.activity.id } });
    await ctx.prisma.activity.delete({ where: { id: seed.activity.id } });

    await svc.handleCallback({
      err_code: '00', basket_id: basketId, transaction_id: 'T1',
      Response_Key: signCallback(basketId, amountStr, '00'),
    });

    expect(await ctx.prisma.booking.findFirst({ where: { ref: snapshot.ref } })).toBeNull();
    const p = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(p!.status).toBe('REFUND_PENDING');
    const reasons = (auditLogger.log as jest.Mock).mock.calls.map(c => c[0]);
    expect(reasons.some((c: any) =>
      c.action === 'PAYMENT_RECOVERY_REFUND_QUEUED' && /ACTIVITY_DELETED/.test(c.details))).toBe(true);
  });

  test('activity status INACTIVE → REFUND_PENDING, audit ACTIVITY_STATUS', async () => {
    const { svc, auditLogger } = makePaymentService();
    const { basketId, paymentId, amountStr, snapshot, seed } = await seedOrphanedPayment();
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id },
      data: { status: 'INACTIVE' },
    });

    await svc.handleCallback({
      err_code: '00', basket_id: basketId, transaction_id: 'T1',
      Response_Key: signCallback(basketId, amountStr, '00'),
    });

    expect(await ctx.prisma.booking.findFirst({ where: { ref: snapshot.ref } })).toBeNull();
    const p = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(p!.status).toBe('REFUND_PENDING');
    const reasons = (auditLogger.log as jest.Mock).mock.calls.map(c => c[0]);
    expect(reasons.some((c: any) =>
      c.action === 'PAYMENT_RECOVERY_REFUND_QUEUED' && /ACTIVITY_STATUS:INACTIVE/.test(c.details))).toBe(true);
  });

  test('coupon usedCount is re-incremented on recreate (cleanup decremented it)', async () => {
    const { svc } = makePaymentService();
    const seed = await seedReference(ctx.prisma);
    // Create a coupon used by the booking; cleanup would have decremented
    // usedCount when it deleted the booking, so we simulate that by
    // setting it 1 lower than what creation would have set it to.
    const coupon = await ctx.prisma.coupon.create({
      data: {
        code: 'SUMMER10', vendorId: seed.vendor.id,
        discountType: 'PERCENTAGE', discountValue: 10,
        validFrom: new Date(Date.now() - 24 * 3600_000),
        validTo: new Date(Date.now() + 24 * 3600_000),
        usageLimit: 100, usedCount: 0,           // cleanup already decremented to 0
        status: 'APPROVED',
      },
    });
    const claimed = await ctx.prisma.claimedCoupon.create({
      data: { userId: seed.customer.id, couponId: coupon.id, used: false },  // cleanup reset
    });
    void claimed;

    const basketId = `BSK-COUPON-${crypto.randomUUID().slice(0, 6)}`;
    const ref = `JDWL-COUPON-${crypto.randomUUID().slice(0, 6)}`;
    const startDt = new Date(Date.now() + 24 * 3600_000);
    const endDt = new Date(Date.now() + 26 * 3600_000);
    const booking = await ctx.prisma.booking.create({
      data: {
        ref,
        activityId: seed.activity.id,
        vendorId: seed.vendor.id,
        customerId: seed.customer.id,
        bookingPhone: '+97455123456',
        guests: 2, guestBreakdown: {},
        startDatetime: startDt, endDatetime: endDt,
        totalPrice: 180,           // 200 - 10% coupon discount
        currencyCode: 'QAR',
        commissionPct: 10, commissionAmount: 18, serviceFee: 5,
        couponCode: coupon.code, couponDiscount: 20,
        status: 'PENDING',
      },
    });
    const snapshot = buildBookingSnapshot(booking);
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 180, currency: 'QAR', status: 'PENDING',
        method: 'PAY2M', gatewayBasketId: basketId,
        bookingId: booking.id,
        bookingSnapshot: snapshot as any,
      },
    });
    await ctx.prisma.booking.delete({ where: { id: booking.id } });

    await svc.handleCallback({
      err_code: '00', basket_id: basketId, transaction_id: 'T1',
      Response_Key: signCallback(basketId, '180.00', '00'),
    });

    // Booking re-inserted
    const recreated = await ctx.prisma.booking.findFirst({ where: { ref } });
    expect(recreated).not.toBeNull();

    // Coupon usedCount went from 0 (post-cleanup) to 1 (post-recreate)
    const couponAfter = await ctx.prisma.coupon.findUnique({ where: { code: 'SUMMER10' } });
    expect(couponAfter!.usedCount).toBe(1);

    // ClaimedCoupon flipped used=true again
    const claimedAfter = await ctx.prisma.claimedCoupon.findFirst({
      where: { userId: seed.customer.id, couponId: coupon.id },
    });
    expect(claimedAfter!.used).toBe(true);

    void payment;
  });

  test('vendor SUSPENDED but activity ACTIVE → recreate AND flag for admin', async () => {
    const { svc, auditLogger } = makePaymentService();
    const { basketId, paymentId, amountStr, snapshot, seed } = await seedOrphanedPayment();
    // Vendor suspended after customer paid in good faith
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: { status: 'SUSPENDED' },
    });

    await svc.handleCallback({
      err_code: '00', basket_id: basketId, transaction_id: 'T1',
      Response_Key: signCallback(basketId, amountStr, '00'),
    });

    // Booking IS recreated — customer's money is real, vendor's status is
    // not the customer's problem.
    const recreated = await ctx.prisma.booking.findFirst({ where: { ref: snapshot.ref } });
    expect(recreated).not.toBeNull();
    expect(recreated!.status).toBe('CONFIRMED');
    const p = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(p!.status).toBe('SUCCESS');

    // Audit flags the booking for admin review
    const reasons = (auditLogger.log as jest.Mock).mock.calls.map(c => c[0]);
    const recreateAudit = reasons.find((c: any) => c.action === 'PAYMENT_RECOVERED_VIA_RECREATE');
    expect(recreateAudit).toBeDefined();
    expect(recreateAudit.details).toMatch(/VENDOR_NOT_ACTIVE_FLAG_FOR_REVIEW/);
  });

  test('legacy payment with no snapshot → REFUND_PENDING, audit NO_SNAPSHOT', async () => {
    const { svc, auditLogger } = makePaymentService();
    // Hand-built fixture: payment without snapshot (predates §B2 schema)
    const seed = await seedReference(ctx.prisma);
    const basketId = `BSK-LEGACY-${crypto.randomUUID().slice(0, 6)}`;
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 150, currency: 'QAR', status: 'PENDING',
        method: 'PAY2M', gatewayBasketId: basketId,
        // Don't set bookingSnapshot at all — legacy row has null by default
      },
    });
    // Don't even need to seed a booking — handleCallback's FAILED-status
    // recovery path expects payment.bookingId to be set, but our orphan
    // path treats !booking exactly the same regardless of bookingId
    // pointing nowhere. To match production-path: the seed customer's
    // booking was deleted by cron, leaving payment.bookingId pointing to
    // a now-nonexistent row.
    await ctx.prisma.payment.update({
      where: { id: payment.id },
      data: { bookingId: 'deadbeef-dead-beef-dead-beefdeadbeef' as any },
    });

    void seed;

    await svc.handleCallback({
      err_code: '00', basket_id: basketId, transaction_id: 'T1',
      Response_Key: signCallback(basketId, '150.00', '00'),
    });

    const p = await ctx.prisma.payment.findUnique({ where: { id: payment.id } });
    expect(p!.status).toBe('REFUND_PENDING');
    const reasons = (auditLogger.log as jest.Mock).mock.calls.map(c => c[0]);
    expect(reasons.some((c: any) =>
      c.action === 'PAYMENT_RECOVERY_REFUND_QUEUED' && /NO_SNAPSHOT/.test(c.details))).toBe(true);
  });

  test('snapshot with unknown version (forward-incompat) → REFUND_PENDING', async () => {
    const { svc, auditLogger } = makePaymentService();
    const { basketId, paymentId, amountStr, snapshot } = await seedOrphanedPayment();
    // Tamper with the saved snapshot's version field (simulates a prod
    // payment row written by a future schema we don't understand yet).
    await ctx.prisma.payment.update({
      where: { id: paymentId },
      data: { bookingSnapshot: { ...snapshot, v: 99 } as any },
    });

    await svc.handleCallback({
      err_code: '00', basket_id: basketId, transaction_id: 'T1',
      Response_Key: signCallback(basketId, amountStr, '00'),
    });

    const p = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(p!.status).toBe('REFUND_PENDING');
    const reasons = (auditLogger.log as jest.Mock).mock.calls.map(c => c[0]);
    expect(reasons.some((c: any) =>
      c.action === 'PAYMENT_RECOVERY_REFUND_QUEUED' && /UNKNOWN_SNAPSHOT_VERSION:99/.test(c.details))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §M6 — un-cancel callback after SYSTEM cron-cancelled
// ═══════════════════════════════════════════════════════════════════════════

describe('§M6 — callback un-cancels SYSTEM-cancelled booking when safe', () => {
  async function seedSystemCancelledFixture(opts: { startOffsetMs?: number; endOffsetMs?: number; activityCapacity?: number; guests?: number; } = {}) {
    const seed = await seedReference(ctx.prisma);
    if (opts.activityCapacity !== undefined) {
      await ctx.prisma.activity.update({
        where: { id: seed.activity.id },
        data: { capacity: opts.activityCapacity },
      });
    }
    const basketId = `BSK-M6-${crypto.randomUUID().slice(0, 6)}`;
    const ref = `JDWL-M6-${crypto.randomUUID().slice(0, 6)}`;
    const startDt = new Date(Date.now() + (opts.startOffsetMs ?? 24 * 3600_000));
    const endDt = new Date(Date.now() + (opts.endOffsetMs ?? 26 * 3600_000));

    const booking = await ctx.prisma.booking.create({
      data: {
        ref,
        activityId: seed.activity.id,
        vendorId: seed.vendor.id,
        customerId: seed.customer.id,
        bookingPhone: '+97455123456',
        guests: opts.guests ?? 2,
        guestBreakdown: {},
        startDatetime: startDt,
        endDatetime: endDt,
        totalPrice: 200,
        currencyCode: 'QAR',
        commissionPct: 10,
        commissionAmount: 20,
        serviceFee: 5,
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: 'SYSTEM',
      },
    });
    // buildBookingSnapshot ignores status; we just need the row's
    // shape (it was a real CANCELLED row, but the snapshot the recreate
    // path will read should look like a normal pending booking).
    const snapshot = buildBookingSnapshot(booking);
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 200, currency: 'QAR', status: 'PENDING',
        method: 'PAY2M', gatewayBasketId: basketId,
        bookingId: booking.id,
        bookingSnapshot: snapshot as any,
      },
    });
    await ctx.prisma.booking.update({ where: { id: booking.id }, data: { paymentId: payment.id } });
    return { seed, basketId, paymentId: payment.id, bookingId: booking.id, snapshot };
  }

  test('happy path: SYSTEM-cancelled booking flipped back to CONFIRMED, audit UNCANCEL', async () => {
    const { svc, auditLogger, availabilityCache } = makePaymentService();
    const { basketId, paymentId, bookingId } = await seedSystemCancelledFixture();

    const res = await svc.handleCallback({
      err_code: '00', basket_id: basketId, transaction_id: 'T1',
      Response_Key: signCallback(basketId, '200.00', '00'),
    });
    expect(res.status).toBe('success');

    const booking = await ctx.prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking!.status).toBe('CONFIRMED');
    expect(booking!.cancelledAt).toBeNull();
    expect(booking!.cancelledBy).toBeNull();

    const p = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(p!.status).toBe('SUCCESS');
    expect(p!.refundAmount).toBeNull();

    const reasons = (auditLogger.log as jest.Mock).mock.calls.map(c => c[0]);
    expect(reasons.find((c: any) => c.action === 'PAYMENT_RECOVERED_VIA_UNCANCEL')).toBeDefined();
    expect(availabilityCache.invalidate).toHaveBeenCalled();
  });

  test('slot taken by another customer → REFUND_PENDING, no un-cancel', async () => {
    const { svc, auditLogger } = makePaymentService();
    const { basketId, paymentId, bookingId, seed } = await seedSystemCancelledFixture({ activityCapacity: 2, guests: 2 });
    // Another customer grabbed the slot while booking was CANCELLED-by-SYSTEM
    await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-INTRUDER-M6',
        activityId: seed.activity.id,
        vendorId: seed.vendor.id,
        customerId: seed.customer.id,
        guests: 2,
      bookingPhone: '+97455123456',
        guestBreakdown: {},
        startDatetime: new Date(Date.now() + 24 * 3600_000),
        endDatetime:   new Date(Date.now() + 26 * 3600_000),
        totalPrice: 200,
        currencyCode: 'QAR',
        commissionPct: 10, commissionAmount: 20, serviceFee: 5,
        status: 'CONFIRMED',
      },
    });

    await svc.handleCallback({
      err_code: '00', basket_id: basketId, transaction_id: 'T1',
      Response_Key: signCallback(basketId, '200.00', '00'),
    });

    // Booking stays CANCELLED — the un-cancel was rolled back
    const booking = await ctx.prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking!.status).toBe('CANCELLED');
    expect(booking!.cancelledBy).toBe('SYSTEM');

    // Payment now REFUND_PENDING
    const p = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(p!.status).toBe('REFUND_PENDING');

    const reasons = (auditLogger.log as jest.Mock).mock.calls.map(c => c[0]);
    expect(reasons.some((c: any) =>
      c.action === 'PAYMENT_RECOVERY_REFUND_QUEUED' && /SLOT_CONFLICT/.test(c.details))).toBe(true);
  });

  test('activity already ended → REFUND_PENDING, no un-cancel', async () => {
    const { svc, auditLogger } = makePaymentService();
    const { basketId, paymentId, bookingId } = await seedSystemCancelledFixture({
      startOffsetMs: -3 * 3600_000,
      endOffsetMs:   -1 * 3600_000,
    });

    await svc.handleCallback({
      err_code: '00', basket_id: basketId, transaction_id: 'T1',
      Response_Key: signCallback(basketId, '200.00', '00'),
    });

    const booking = await ctx.prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking!.status).toBe('CANCELLED');
    const p = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(p!.status).toBe('REFUND_PENDING');
    const reasons = (auditLogger.log as jest.Mock).mock.calls.map(c => c[0]);
    expect(reasons.some((c: any) =>
      c.action === 'PAYMENT_RECOVERY_REFUND_QUEUED' && /ACTIVITY_ALREADY_ENDED/.test(c.details))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Snapshot is server-derived (NOT from request DTO)
// ═══════════════════════════════════════════════════════════════════════════

describe('booking snapshot is server-derived', () => {
  test('buildBookingSnapshot reads from the persisted row, not the input DTO', () => {
    // Plain unit assertion — buildBookingSnapshot takes a row object whose
    // shape mirrors the persisted `Booking`. Caller in createBooking passes
    // the row Prisma JUST inserted (`createdBooking`), never the DTO.
    const fakeBookingRow: any = {
      ref: 'JDWL-A',
      activityId: 'a1',
      vendorId: 'v1',
      customerId: 'c1',
      unitNumber: null,
      startDatetime: new Date('2030-01-01T10:00:00Z'),
      endDatetime: new Date('2030-01-01T12:00:00Z'),
      guests: 2,
      bookingPhone: '+97455123456',
      guestBreakdown: { adults: 2 },
      selectedExtras: null,
      totalPrice: { toString: () => '200.00' },
      serviceFee: { toString: () => '5.00' },
      commissionPct: { toString: () => '10' },
      commissionAmount: { toString: () => '20.00' },
      couponCode: null,
      couponDiscount: { toString: () => '0' },
      pointsRedeemed: 0,
      pointsDiscount: { toString: () => '0' },
      currencyCode: 'QAR',
      idempotencyKey: null,
      createdAt: new Date('2030-01-01T09:00:00Z'),
    };
    const snap = buildBookingSnapshot(fakeBookingRow);
    expect(snap.v).toBe(2);
    expect(snap.bookingPhone).toBe('+97455123456');
    expect(snap.totalPrice).toBe('200.00');
    expect(snap.commissionAmount).toBe('20.00');
    expect(snap.startDatetime).toBe('2030-01-01T10:00:00.000Z');
    expect(snap.originalCreatedAt).toBe('2030-01-01T09:00:00.000Z');
  });
});
