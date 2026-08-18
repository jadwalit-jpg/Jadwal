/**
 * Vendor getPayoutEligibility — DB-backed.
 *
 * Most eligibility branches are covered at unit level with mocked Prisma.
 * These integration tests target the parts that only prove out against
 * real SQL: the `id: { notIn }` exclusion on booking.aggregate, currency
 * resolution from the vendor's country, and in-process MIN_PAYOUT_AMOUNT
 * env overrides.
 */

import { getTestContext, seedReference } from './_setup';
import { VendorService } from '../../src/vendor/vendor.service';
import { AdminService } from '../../src/admin/admin.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import * as crypto from 'crypto';
import { makeSessionDenylistMock } from '../mocks/auth-deps.mock';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeServices() {
  const prismaSvc = { client: ctx.prisma } as any;
  const notificationService = {
    send:         jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany:   jest.fn().mockResolvedValue(undefined),
  } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const availabilityCache = {
    invalidate:     jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const vendor = new VendorService(prismaSvc, notificationService, loyalty, availabilityCache, makeSessionDenylistMock() as any);
  const admin  = new AdminService(prismaSvc, notificationService, loyalty, availabilityCache, { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any, makeSessionDenylistMock() as any);
  return { vendor, admin };
}

async function seedEligibleBooking(
  vendorId: string, customerId: string, activityId: string,
  total: number, commission: number,
) {
  const payment = await ctx.prisma.payment.create({
    data: {
      amount: total, currency: 'QAR', status: 'SUCCESS',
      method: 'PAY2M', paidAt: new Date(), payoutStatus: 'UNPAID',
    },
  });
  const start = new Date(Date.now() - 86_400_000);
  await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-EL-${crypto.randomUUID().slice(0, 6)}`,
      currencyCode: 'QAR', guests: 1,
      bookingPhone: '+97455123456',
      totalPrice: total, serviceFee: 0, commissionAmount: commission,
      status: 'COMPLETED',
      startDatetime: start, endDatetime: new Date(start.getTime() + 3600_000),
      activityId, customerId, vendorId,
      paymentId: payment.id,
    },
  });
  return payment.id;
}

describe('VendorService.getPayoutEligibility — DB-backed', () => {
  test('excludes APPROVED-locked payments from `available` via id.notIn', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: { bankDetails: { iban: 'QA00..' } as any },
    });
    // Three eligible bookings. Vendor requests payout → admin approves → the
    // approval locks specific paymentIds via FIFO greedy accumulation. Only
    // the unlocked tail remains available for a new eligibility view.
    await seedEligibleBooking(seed.vendor.id, seed.customer.id, seed.activity.id, 200, 20); // net 180
    await seedEligibleBooking(seed.vendor.id, seed.customer.id, seed.activity.id, 200, 20); // net 180
    await seedEligibleBooking(seed.vendor.id, seed.customer.id, seed.activity.id, 200, 20); // net 180

    const { vendor, admin } = makeServices();
    // Vendor requests payout. Request.amount = 540. All 3 payments get locked on approve.
    const req = await vendor.requestPayout(seed.vendorUser.id);
    await admin.processPayoutRequest(req.id, 'APPROVED', 'OK');

    // After APPROVED, eligibility should surface INFLIGHT_APPROVED (short-circuit),
    // NOT attempt to re-aggregate (the inflight check precedes the aggregate).
    const elig: any = await vendor.getPayoutEligibility(seed.vendorUser.id);
    expect(elig.ok).toBe(false);
    expect(elig.code).toBe('INFLIGHT_APPROVED');

    // Now complete the request. The paymentIds stay locked in the request's
    // paymentIds[] even after COMPLETED (two-step flow). A re-query for
    // eligibility must exclude those locked ids via id.notIn, so available
    // falls back to 0 once every payment is covered.
    await admin.processPayoutRequest(req.id, 'COMPLETED');

    const elig2: any = await vendor.getPayoutEligibility(seed.vendorUser.id);
    // All 3 payments are locked in the COMPLETED request → available = 0 → NO_BALANCE.
    expect(elig2.ok).toBe(false);
    expect(elig2.code).toBe('NO_BALANCE');
    expect(elig2.available).toBe(0);
  });

  test('escrow: a FUTURE-activity booking is NOT payout-eligible (endDatetime > now)', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: { bankDetails: { iban: 'QA00..' } as any },
    });
    // Paid + SUCCESS + UNPAID, but the activity is still 30 days out — the
    // customer can still cancel, so this must NOT be payable (refund-after-
    // payout collusion guard). Gated on endDatetime in evaluatePayoutEligibility.
    const payment = await ctx.prisma.payment.create({
      data: { amount: 500, currency: 'QAR', status: 'SUCCESS', method: 'PAY2M', paidAt: new Date(), payoutStatus: 'UNPAID' },
    });
    const futureStart = new Date(Date.now() + 30 * 86_400_000);
    await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-FUT-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR', guests: 1, bookingPhone: '+97455123456',
        totalPrice: 500, serviceFee: 0, commissionAmount: 50,
        status: 'CONFIRMED',
        startDatetime: futureStart, endDatetime: new Date(futureStart.getTime() + 3600_000),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
        paymentId: payment.id,
      },
    });

    const { vendor } = makeServices();
    const elig: any = await vendor.getPayoutEligibility(seed.vendorUser.id);
    expect(elig.ok).toBe(false);
    expect(elig.code).toBe('NO_BALANCE'); // future activity excluded → available 0
    expect(elig.available).toBe(0);
  });

  test('BELOW_MINIMUM fires when unlocked balance < MIN_PAYOUT_AMOUNT (env override)', async () => {
    const original = process.env.MIN_PAYOUT_AMOUNT;
    process.env.MIN_PAYOUT_AMOUNT = '500';
    try {
      const seed = await seedReference(ctx.prisma);
      await ctx.prisma.vendor.update({
        where: { id: seed.vendor.id },
        data: { bankDetails: { iban: 'QA00..' } as any },
      });
      // Net balance is 100 (well under 500).
      await seedEligibleBooking(seed.vendor.id, seed.customer.id, seed.activity.id, 110, 10);

      const { vendor } = makeServices();
      const elig: any = await vendor.getPayoutEligibility(seed.vendorUser.id);
      expect(elig.ok).toBe(false);
      expect(elig.code).toBe('BELOW_MINIMUM');
      expect(elig.minimum).toBe(500);
      expect(elig.available).toBe(100);
    } finally {
      if (original === undefined) delete process.env.MIN_PAYOUT_AMOUNT;
      else process.env.MIN_PAYOUT_AMOUNT = original;
    }
  });

  test('ok:true returns currency from vendor country (seed is QA → QAR)', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: { bankDetails: { iban: 'QA00..' } as any },
    });
    await seedEligibleBooking(seed.vendor.id, seed.customer.id, seed.activity.id, 200, 20);

    const { vendor } = makeServices();
    const elig: any = await vendor.getPayoutEligibility(seed.vendorUser.id);
    expect(elig.ok).toBe(true);
    expect(elig.currency).toBe('QAR');
    expect(elig.available).toBe(180);
  });
});
