/**
 * Admin processPayoutRequest — APPROVED → COMPLETED two-step settle.
 *
 * The COMPLETED branch closes the payout-request workflow but does NOT
 * flip the underlying payments to PAID. Admin still has to click Mark Paid
 * on the Payments tab separately. This spec pins that invariant against
 * real Postgres so a future refactor can't silently re-introduce the old
 * one-step flow and double-pay vendors.
 */

import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { VendorService } from '../../src/vendor/vendor.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import * as crypto from 'crypto';

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
  const admin  = new AdminService(prismaSvc, notificationService, loyalty, availabilityCache);
  const vendor = new VendorService(prismaSvc, notificationService, loyalty, availabilityCache);
  return { admin, vendor, notificationService };
}

async function seedEligible(seed: Awaited<ReturnType<typeof seedReference>>) {
  await ctx.prisma.vendor.update({
    where: { id: seed.vendor.id },
    data: { bankDetails: { iban: 'QA00..' } as any },
  });
  const payment = await ctx.prisma.payment.create({
    data: {
      amount: 300, currency: 'QAR', status: 'SUCCESS',
      method: 'PAY2M', paidAt: new Date(), payoutStatus: 'UNPAID',
    },
  });
  const start = new Date(Date.now() - 86_400_000);
  await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-TWO-${crypto.randomUUID().slice(0, 6)}`,
      currencyCode: 'QAR', guests: 1,
      totalPrice: 300, serviceFee: 0, commissionAmount: 30,
      status: 'COMPLETED',
      startDatetime: start, endDatetime: new Date(start.getTime() + 3600_000),
      activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      paymentId: payment.id,
    },
  });
  return payment.id;
}

describe('AdminService.processPayoutRequest — two-step settlement', () => {
  test('COMPLETING the request does NOT mark any payment PAID (payments stay UNPAID)', async () => {
    const seed = await seedReference(ctx.prisma);
    const paymentId = await seedEligible(seed);
    const { admin, vendor } = makeServices();

    const req = await vendor.requestPayout(seed.vendorUser.id);
    await admin.processPayoutRequest(req.id, 'APPROVED', 'OK');
    await admin.processPayoutRequest(req.id, 'COMPLETED', 'transfer done');

    const post = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    // Payment STILL unpaid — that's the whole point of the split.
    expect(post?.payoutStatus).toBe('UNPAID');
    expect(post?.paidAt).not.toBeNull(); // paidAt is the original payment timestamp, not the payout time

    const request = await ctx.prisma.payoutRequest.findUnique({ where: { id: req.id } });
    expect(request?.status).toBe('COMPLETED');
  });

  test('COMPLETING aborts if any locked payment has since been marked PAID on the Payments tab', async () => {
    const seed = await seedReference(ctx.prisma);
    const paymentId = await seedEligible(seed);
    const { admin, vendor } = makeServices();

    const req = await vendor.requestPayout(seed.vendorUser.id);
    await admin.processPayoutRequest(req.id, 'APPROVED', 'OK');

    // Simulate: admin went to Payments tab and manually marked this payment
    // PAID before completing the request. (In practice the markPayoutsPaid
    // in-flight guard would stop them — but if the DB ends up in that state
    // through some other path, the Complete step must not be fooled into
    // accepting a drifted lock.)
    await ctx.prisma.payment.update({
      where: { id: paymentId },
      data: { payoutStatus: 'PAID' },
    });

    await expect(admin.processPayoutRequest(req.id, 'COMPLETED'))
      .rejects.toThrow(/no longer eligible/i);
  });

  test('after COMPLETE, admin.getPayouts marks those rows as actionable again (inflightRequest=null)', async () => {
    // COMPLETED requests must NOT block bulk-mark-paid on the Payments tab.
    // The UI enrichment on getPayouts scopes its lookup to PENDING/APPROVED —
    // this test pins that so a refactor can't accidentally widen the status
    // filter and leave payments permanently locked.
    const seed = await seedReference(ctx.prisma);
    const paymentId = await seedEligible(seed);
    const { admin, vendor } = makeServices();

    const req = await vendor.requestPayout(seed.vendorUser.id);
    await admin.processPayoutRequest(req.id, 'APPROVED', 'OK');
    await admin.processPayoutRequest(req.id, 'COMPLETED');

    const page = await admin.getPayouts({ page: 1, limit: 20 } as any);
    const row = page.data.find((p: any) => p.id === paymentId);
    expect(row).toBeTruthy();
    // After COMPLETED, the row is actionable — no inflight request blocks it.
    expect((row as any).inflightRequest).toBeNull();
  });
});
