/**
 * Payout integrity invariants — "vendor cannot be paid for refunded bookings."
 *
 * These are money-out guards. If someone refactors the WHERE clauses in
 * vendor.getEarnings or admin.markPayoutsPaid and loosens the payment.status
 * filter, the vendor would be credited (and potentially paid) for bookings
 * where the customer already got their money back. These tests pin the
 * current safe behavior so that regression is caught before ship.
 *
 * Invariants asserted:
 *   1. Bookings with payment.status = REFUNDED are excluded from
 *      vendor.getEarnings (neither totalEarned nor pendingPayout).
 *   2. Bookings with payment.status = REFUND_PENDING are excluded
 *      (awaiting decision — platform hasn't decided yet, so not payout-safe).
 *   3. Bookings with payment.status = REJECTED are excluded. Current policy:
 *      platform pockets the cash on rejected refunds. If that policy changes,
 *      THIS TEST MUST CHANGE — it's the canary for the "REJECTED semantic"
 *      discussion.
 *   4. admin.markPayoutsPaid refuses to flip non-SUCCESS payments to PAID.
 *      Even if a caller hands in a list of refunded payment IDs, the
 *      status:'SUCCESS' guard in the WHERE clause blocks the update.
 */

import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { VendorService } from '../../src/vendor/vendor.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { makeSessionDenylistMock } from '../mocks/auth-deps.mock';

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
  return {
    admin: new AdminService(prismaSvc, notificationService, loyalty, availabilityCache, { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any, makeSessionDenylistMock() as any),
    vendor: new VendorService(prismaSvc, notificationService, loyalty, availabilityCache, makeSessionDenylistMock() as any),
  };
}

/**
 * Create a minimal paid booking with explicit payment.status. Bypasses the
 * full createBooking flow so each test can isolate one payment state without
 * going through the WANASA/PAY2M branches.
 */
async function seedBooking(paymentStatus: 'SUCCESS' | 'REFUND_PENDING' | 'REFUNDED' | 'REJECTED' | 'FAILED') {
  const seed = await seedReference(ctx.prisma);
  const payment = await ctx.prisma.payment.create({
    data: {
      amount: 100,
      currency: 'QAR',
      status: paymentStatus,
      payoutStatus: 'UNPAID',
      method: paymentStatus === 'REFUNDED' || paymentStatus === 'REJECTED' ? 'PAY2M' : 'PAY2M',
      paidAt: paymentStatus !== 'FAILED' ? new Date() : null,
      refundAmount: paymentStatus === 'REFUNDED' ? 100 : null,
    },
  });
  const booking = await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-${paymentStatus.slice(0, 4)}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      activityId: seed.activity.id,
      vendorId: seed.vendor.id,
      customerId: seed.customer.id,
      guests: 1,
      bookingPhone: '+97455123456',
      totalPrice: 100,
      serviceFee: 5,
      commissionPct: 10,
      commissionAmount: 10,
      currencyCode: 'QAR',
      startDatetime: new Date('2020-01-01T10:00:00Z'),
      endDatetime: new Date('2020-01-01T12:00:00Z'),
      status: paymentStatus === 'REFUNDED' || paymentStatus === 'REJECTED' || paymentStatus === 'REFUND_PENDING' ? 'CANCELLED' : 'CONFIRMED',
      paymentId: payment.id,
    },
  });
  await ctx.prisma.payment.update({ where: { id: payment.id }, data: { bookingId: booking.id } });
  return { seed, booking, payment };
}

// ═══════════════════════════════════════════════════════════════════════════
// vendor.getEarnings — refunded bookings must not show in earnings
// ═══════════════════════════════════════════════════════════════════════════

describe('vendor.getEarnings — refund exclusion invariant', () => {
  test('SUCCESS + UNPAID booking appears in pendingPayout', async () => {
    const { seed } = await seedBooking('SUCCESS');
    const { vendor } = makeServices();

    const earnings: any = await vendor.getEarnings(seed.vendorUser.id);
    // 100 totalPrice − 10 commission = 90 net
    expect(Number(earnings.pendingPayout)).toBe(90);
    expect(Number(earnings.totalEarned)).toBe(0);
  });

  test('REFUND_PENDING booking is EXCLUDED from both totals', async () => {
    const { seed } = await seedBooking('REFUND_PENDING');
    const { vendor } = makeServices();

    const earnings: any = await vendor.getEarnings(seed.vendorUser.id);
    // Customer cancelled, decision pending → vendor must not see earnings
    // queued for a booking whose fate is undecided.
    expect(Number(earnings.pendingPayout)).toBe(0);
    expect(Number(earnings.totalEarned)).toBe(0);
  });

  test('REFUNDED booking is EXCLUDED from both totals', async () => {
    const { seed } = await seedBooking('REFUNDED');
    const { vendor } = makeServices();

    const earnings: any = await vendor.getEarnings(seed.vendorUser.id);
    // Refund approved → customer got store credit/cash → vendor gets 0.
    expect(Number(earnings.pendingPayout)).toBe(0);
    expect(Number(earnings.totalEarned)).toBe(0);
  });

  test('REJECTED booking is EXCLUDED from both totals (current policy)', async () => {
    // NOTE: Current platform policy keeps the cash on rejected refunds
    // (see bookings.service.ts comment: "platform keeps the PAY2M charge").
    // Vendor gets nothing. If the policy changes to "vendor paid on
    // rejected refund", this test needs to flip and earnings filter
    // needs `status: { in: ['SUCCESS', 'REJECTED'] }`.
    const { seed } = await seedBooking('REJECTED');
    const { vendor } = makeServices();

    const earnings: any = await vendor.getEarnings(seed.vendorUser.id);
    expect(Number(earnings.pendingPayout)).toBe(0);
    expect(Number(earnings.totalEarned)).toBe(0);
  });

  test('FAILED booking is EXCLUDED', async () => {
    const { seed } = await seedBooking('FAILED');
    const { vendor } = makeServices();

    const earnings: any = await vendor.getEarnings(seed.vendorUser.id);
    expect(Number(earnings.pendingPayout)).toBe(0);
    expect(Number(earnings.totalEarned)).toBe(0);
  });

  test('mixed ledger: SUCCESS counted, REFUNDED ignored side-by-side', async () => {
    const seed = await seedReference(ctx.prisma);
    // One SUCCESS booking → counts
    await ctx.prisma.payment.create({
      data: {
        amount: 100, currency: 'QAR', status: 'SUCCESS',
        payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date(),
        booking: {
          create: {
            ref: 'JDWL-MIX1',
            activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: seed.customer.id,
            bookingPhone: '+97455123456',
            guests: 1, totalPrice: 100, serviceFee: 5,
            commissionPct: 10, commissionAmount: 10,
            currencyCode: 'QAR',
            startDatetime: new Date('2020-01-01T10:00:00Z'),
            endDatetime: new Date('2020-01-01T12:00:00Z'),
            status: 'CONFIRMED',
          },
        },
      },
    });
    // One REFUNDED booking → must NOT count
    await ctx.prisma.payment.create({
      data: {
        amount: 200, currency: 'QAR', status: 'REFUNDED',
        payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date(),
        refundAmount: 200, refundedAt: new Date(),
        booking: {
          create: {
            ref: 'JDWL-MIX2',
            activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: seed.customer.id,
            bookingPhone: '+97455123456',
            guests: 2, totalPrice: 200, serviceFee: 5,
            commissionPct: 10, commissionAmount: 20,
            currencyCode: 'QAR',
            startDatetime: new Date('2020-01-02T10:00:00Z'),
            endDatetime: new Date('2020-01-02T12:00:00Z'),
            status: 'CANCELLED',
          },
        },
      },
    });

    const { vendor } = makeServices();
    const earnings: any = await vendor.getEarnings(seed.vendorUser.id);
    // 100 − 10 = 90 from the SUCCESS booking ONLY. The 200 REFUNDED one must not leak in.
    expect(Number(earnings.pendingPayout)).toBe(90);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// admin.markPayoutsPaid — cannot flip non-SUCCESS to PAID
// ═══════════════════════════════════════════════════════════════════════════

describe('admin.markPayoutsPaid — payout-eligibility guard', () => {
  test('marks SUCCESS + UNPAID payment as PAID', async () => {
    const { payment } = await seedBooking('SUCCESS');
    const { admin } = makeServices();

    await admin.markPayoutsPaid([payment.id], 'TEST-WIRE-REF');
    const after = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.payoutStatus).toBe('PAID');
  });

  test('REFUSES to mark REFUNDED payment as PAID', async () => {
    const { payment } = await seedBooking('REFUNDED');
    const { admin } = makeServices();

    await admin.markPayoutsPaid([payment.id], 'TEST-WIRE-REF');
    const after = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    // Must remain UNPAID — the status:'SUCCESS' guard in the WHERE blocks the update.
    expect(after.payoutStatus).toBe('UNPAID');
    expect(after.status).toBe('REFUNDED');
  });

  test('REFUSES to mark REFUND_PENDING payment as PAID', async () => {
    const { payment } = await seedBooking('REFUND_PENDING');
    const { admin } = makeServices();

    await admin.markPayoutsPaid([payment.id], 'TEST-WIRE-REF');
    const after = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.payoutStatus).toBe('UNPAID');
  });

  test('REFUSES to mark REJECTED payment as PAID', async () => {
    const { payment } = await seedBooking('REJECTED');
    const { admin } = makeServices();

    await admin.markPayoutsPaid([payment.id], 'TEST-WIRE-REF');
    const after = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.payoutStatus).toBe('UNPAID');
  });

  test('processPayoutRequest(APPROVED) — LOCKS paymentIds but does NOT flip payoutStatus yet', async () => {
    // Under the new two-step flow, APPROVE records the lock set but the
    // money hasn't physically moved — payoutStatus stays UNPAID until
    // COMPLETE is called (which happens after admin confirms bank transfer).
    const seed = await seedReference(ctx.prisma);
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 200, currency: 'QAR', status: 'SUCCESS',
        payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date(),
        booking: {
          create: {
            ref: 'JDWL-LOCK', activityId: seed.activity.id, vendorId: seed.vendor.id,
            customerId: seed.customer.id,
            bookingPhone: '+97455123456',
            guests: 2, totalPrice: 200, serviceFee: 5,
            commissionPct: 10, commissionAmount: 20,
            currencyCode: 'QAR',
            startDatetime: new Date('2020-01-01T10:00:00Z'),
            endDatetime: new Date('2020-01-01T12:00:00Z'),
            status: 'CONFIRMED',
          },
        },
      },
    });
    const req = await ctx.prisma.payoutRequest.create({
      data: { vendorId: seed.vendor.id, amount: 180, currency: 'QAR', status: 'PENDING' },
    });

    const { admin } = makeServices();
    const approved = await admin.processPayoutRequest(req.id, 'APPROVED', 'OK');

    // Request: status APPROVED, paymentIds populated with the locked set.
    expect(approved.status).toBe('APPROVED');
    expect((approved as any).paymentIds).toEqual([payment.id]);

    // Payment: payoutStatus MUST stay UNPAID. Admin hasn't wired money yet.
    const paymentAfterApprove = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paymentAfterApprove.payoutStatus).toBe('UNPAID');
    expect(paymentAfterApprove.paidAt).not.toBeNull(); // paidAt was set at checkout, unchanged
  });

  test('processPayoutRequest(COMPLETED) — flips locked payments to PAID', async () => {
    // Full happy path: approve locks the paymentIds; complete actually
    // flips them. Mirrors what admin does after the bank transfer.
    const seed = await seedReference(ctx.prisma);
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 200, currency: 'QAR', status: 'SUCCESS',
        payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date(),
        booking: {
          create: {
            ref: 'JDWL-COMP', activityId: seed.activity.id, vendorId: seed.vendor.id,
            customerId: seed.customer.id,
            bookingPhone: '+97455123456',
            guests: 2, totalPrice: 200, serviceFee: 5,
            commissionPct: 10, commissionAmount: 20,
            currencyCode: 'QAR',
            startDatetime: new Date('2020-02-01T10:00:00Z'),
            endDatetime: new Date('2020-02-01T12:00:00Z'),
            status: 'CONFIRMED',
          },
        },
      },
    });
    const req = await ctx.prisma.payoutRequest.create({
      data: { vendorId: seed.vendor.id, amount: 180, currency: 'QAR', status: 'PENDING' },
    });

    const { admin } = makeServices();
    await admin.processPayoutRequest(req.id, 'APPROVED', 'OK');

    // Two-step settlement (post-refactor): COMPLETE closes the workflow but
    // does NOT flip payments to PAID. Admin has to click Mark Paid on the
    // Payments tab separately. We assert the new invariant here.
    const completed = await admin.processPayoutRequest(req.id, 'COMPLETED', 'Wired via ACH');
    expect(completed.status).toBe('COMPLETED');

    const paymentAfterComplete = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paymentAfterComplete.payoutStatus).toBe('UNPAID');
    // The request's paymentIds stay locked so the second-step Mark Paid
    // on /admin/payouts can target them deterministically.
    const requestAfter = await ctx.prisma.payoutRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(requestAfter.paymentIds ?? []).toContain(payment.id);
  });

  test('processPayoutRequest(COMPLETED) — refuses to complete if a locked payment changed state mid-flight', async () => {
    // Edge case: between APPROVE and COMPLETE (while admin is at the bank
    // wiring money), the customer cancels one of the locked bookings and
    // its payment goes REFUNDED. Admin then clicks "Mark transferred." We
    // MUST refuse — otherwise we'd mark a REFUNDED payment as PAID, which
    // breaks the payout filter used by markPayoutsPaid and confuses
    // downstream accounting. Admin has to resolve manually.
    const seed = await seedReference(ctx.prisma);
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 200, currency: 'QAR', status: 'SUCCESS',
        payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date(),
        booking: {
          create: {
            ref: 'JDWL-SLIP', activityId: seed.activity.id, vendorId: seed.vendor.id,
            customerId: seed.customer.id,
            bookingPhone: '+97455123456',
            guests: 2, totalPrice: 200, serviceFee: 5,
            commissionPct: 10, commissionAmount: 20,
            currencyCode: 'QAR',
            startDatetime: new Date('2020-03-01T10:00:00Z'),
            endDatetime: new Date('2020-03-01T12:00:00Z'),
            status: 'CONFIRMED',
          },
        },
      },
    });
    const req = await ctx.prisma.payoutRequest.create({
      data: { vendorId: seed.vendor.id, amount: 180, currency: 'QAR', status: 'PENDING' },
    });

    const { admin } = makeServices();
    await admin.processPayoutRequest(req.id, 'APPROVED', 'OK');

    // Simulate a refund happening between APPROVE and COMPLETE.
    await ctx.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', refundAmount: 200, refundedAt: new Date() },
    });

    await expect(admin.processPayoutRequest(req.id, 'COMPLETED', 'Wired'))
      .rejects.toThrow(/no longer eligible/i);

    // §M2 contract — request auto-reverts to PENDING with a system note so
    // admin can re-run eligibility and complete a fresh approve cycle
    // (was APPROVED-stuck-limbo before §M2).
    const after = await ctx.prisma.payoutRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe('PENDING');
    expect(after.adminNote ?? '').toMatch(/no longer eligible|re-evaluate|auto-reverted/i);
    expect(after.paymentIds ?? []).toEqual([]);
    expect(after.processedAt).toBeNull();
  });

  test('processPayoutRequest(APPROVED) — SCAM BLOCKER: refund before approve throws', async () => {
    // Original scam: customer cancels + full refund between request and
    // approve. Still must block at APPROVE (nothing eligible to lock).
    const seed = await seedReference(ctx.prisma);
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 200, currency: 'QAR', status: 'SUCCESS',
        payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date(),
        booking: {
          create: {
            ref: 'JDWL-SCAM',
            activityId: seed.activity.id, vendorId: seed.vendor.id,
            customerId: seed.customer.id,
            bookingPhone: '+97455123456',
            guests: 2, totalPrice: 200, serviceFee: 5,
            commissionPct: 10, commissionAmount: 20,
            currencyCode: 'QAR',
            startDatetime: new Date('2020-05-01T10:00:00Z'),
            endDatetime: new Date('2020-05-01T12:00:00Z'),
            status: 'CONFIRMED',
          },
        },
      },
      include: { booking: true },
    });

    // Vendor files the payout request at full eligible (180).
    const req = await ctx.prisma.payoutRequest.create({
      data: {
        vendorId: seed.vendor.id,
        amount: 180,
        currency: 'QAR',
        status: 'PENDING',
      },
    });

    // Between request and approve, the customer cancels + vendor approves
    // the full refund. Payment flips to REFUNDED.
    await ctx.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', refundAmount: 200, refundedAt: new Date() },
    });
    await ctx.prisma.booking.update({
      where: { id: (payment as any).booking.id },
      data: { status: 'CANCELLED' },
    });

    const { admin } = makeServices();
    // Admin tries to approve the stale request → must be rejected.
    // "No eligible payments remain" is the scam-blocker error.
    await expect(admin.processPayoutRequest(req.id, 'APPROVED', 'OK'))
      .rejects.toThrow(/no eligible payments remain/i);

    // Request still PENDING — admin must explicitly reject.
    const after = await ctx.prisma.payoutRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe('PENDING');
    // Payment stays REFUNDED — no side effects from the refused approval.
    const paymentAfter = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paymentAfter.status).toBe('REFUNDED');
    expect(paymentAfter.payoutStatus).toBe('UNPAID');
  });

  test('processPayoutRequest(APPROVED) — partial refund caps amount + locks only remaining payments', async () => {
    // T1: vendor has TWO bookings totaling QAR 360 (2×180 net)
    // T2: vendor files request for QAR 360
    // T3: one booking cancels with full refund (−180)
    // T4: admin approves → amount auto-capped to QAR 180, ONLY the
    //     unrefunded payment is LOCKED into the request (paymentIds).
    //     Both payments stay payoutStatus=UNPAID until COMPLETE runs.
    const seed = await seedReference(ctx.prisma);
    const okPayment = await ctx.prisma.payment.create({
      data: {
        amount: 200, currency: 'QAR', status: 'SUCCESS',
        payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date(),
        booking: {
          create: {
            ref: 'JDWL-MIXOK',
            activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: seed.customer.id,
            bookingPhone: '+97455123456',
            guests: 2, totalPrice: 200, serviceFee: 5,
            commissionPct: 10, commissionAmount: 20,
            currencyCode: 'QAR',
            startDatetime: new Date('2020-06-01T10:00:00Z'),
            endDatetime: new Date('2020-06-01T12:00:00Z'),
            status: 'CONFIRMED',
          },
        },
      },
    });
    const refundedPayment = await ctx.prisma.payment.create({
      data: {
        amount: 200, currency: 'QAR', status: 'SUCCESS',
        payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date(),
        booking: {
          create: {
            ref: 'JDWL-MIXRF',
            activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: seed.customer.id,
            bookingPhone: '+97455123456',
            guests: 2, totalPrice: 200, serviceFee: 5,
            commissionPct: 10, commissionAmount: 20,
            currencyCode: 'QAR',
            startDatetime: new Date('2020-06-02T10:00:00Z'),
            endDatetime: new Date('2020-06-02T12:00:00Z'),
            status: 'CONFIRMED',
          },
        },
      },
    });

    const req = await ctx.prisma.payoutRequest.create({
      data: {
        vendorId: seed.vendor.id,
        amount: 360, // both bookings' net
        currency: 'QAR',
        status: 'PENDING',
      },
    });

    // Refund one of the two after the request was filed.
    await ctx.prisma.payment.update({
      where: { id: refundedPayment.id },
      data: { status: 'REFUNDED', refundAmount: 200, refundedAt: new Date() },
    });

    const { admin } = makeServices();
    const result = await admin.processPayoutRequest(req.id, 'APPROVED', 'Monthly payout');

    // Amount capped to the remaining eligible: 180 (not 360).
    expect(Number(result.amount)).toBe(180);
    expect(result.status).toBe('APPROVED');
    // Admin note carries the system adjustment message so operators see why.
    expect(result.adminNote).toMatch(/auto-adjusted from 360/i);
    // Only the unrefunded payment is locked into the request.
    expect((result as any).paymentIds).toEqual([okPayment.id]);

    // Neither payment flips to PAID at APPROVE — admin still has to wire
    // money and call COMPLETE. The REFUNDED one stays REFUNDED+UNPAID.
    const okAfter = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: okPayment.id } });
    expect(okAfter.payoutStatus).toBe('UNPAID');
    const rfAfter = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: refundedPayment.id } });
    expect(rfAfter.payoutStatus).toBe('UNPAID');
    expect(rfAfter.status).toBe('REFUNDED');
  });

  test('processPayoutRequest(APPROVED) — happy path: amount preserved, paymentIds locked, payoutStatus stays UNPAID', async () => {
    const seed = await seedReference(ctx.prisma);
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 200, currency: 'QAR', status: 'SUCCESS',
        payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date(),
        booking: {
          create: {
            ref: 'JDWL-HAPPY',
            activityId: seed.activity.id, vendorId: seed.vendor.id, customerId: seed.customer.id,
            bookingPhone: '+97455123456',
            guests: 2, totalPrice: 200, serviceFee: 5,
            commissionPct: 10, commissionAmount: 20,
            currencyCode: 'QAR',
            startDatetime: new Date('2020-07-01T10:00:00Z'),
            endDatetime: new Date('2020-07-01T12:00:00Z'),
            status: 'CONFIRMED',
          },
        },
      },
    });
    const req = await ctx.prisma.payoutRequest.create({
      data: {
        vendorId: seed.vendor.id, amount: 180, currency: 'QAR', status: 'PENDING',
      },
    });

    const { admin } = makeServices();
    const result = await admin.processPayoutRequest(req.id, 'APPROVED', 'OK');

    expect(Number(result.amount)).toBe(180); // unchanged
    expect(result.status).toBe('APPROVED');
    // Note should be the plain admin note (no auto-adjustment)
    expect(result.adminNote).toBe('OK');
    // paymentIds carry the locked set so COMPLETE can flip deterministically.
    expect((result as any).paymentIds).toEqual([payment.id]);

    // Critical: payoutStatus MUST stay UNPAID. Money has not moved yet —
    // the flip to PAID is deferred to the COMPLETED transition so the
    // vendor's "Transferred" card doesn't light up before admin actually wires.
    const paymentAfter = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paymentAfter.payoutStatus).toBe('UNPAID');
  });

  test('mixed batch: only SUCCESS payments flip, others untouched', async () => {
    // One SUCCESS booking (via seedBooking which calls seedReference once).
    const success = await seedBooking('SUCCESS');
    // A second booking reusing the same seed — create payment+booking
    // directly so we don't re-run seedReference (Country.nameEn is unique).
    const refundedPayment = await ctx.prisma.payment.create({
      data: {
        amount: 50, currency: 'QAR', status: 'REFUNDED',
        payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date(),
        refundAmount: 50, refundedAt: new Date(),
        booking: {
          create: {
            ref: 'JDWL-BATCH',
            bookingPhone: '+97455123456',
            activityId: success.seed.activity.id, vendorId: success.seed.vendor.id,
            customerId: success.seed.customer.id,
            guests: 1, totalPrice: 50, serviceFee: 5,
            commissionPct: 10, commissionAmount: 5,
            currencyCode: 'QAR',
            startDatetime: new Date('2020-02-01T10:00:00Z'),
            endDatetime: new Date('2020-02-01T12:00:00Z'),
            status: 'CANCELLED',
          },
        },
      },
    });

    const { admin } = makeServices();
    await admin.markPayoutsPaid([success.payment.id, refundedPayment.id], 'TEST-WIRE-REF');

    const successAfter = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: success.payment.id } });
    const refundedAfter = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: refundedPayment.id } });
    expect(successAfter.payoutStatus).toBe('PAID');
    // Refunded one stays UNPAID — WHERE filtered it out silently.
    expect(refundedAfter.payoutStatus).toBe('UNPAID');
  });
});
