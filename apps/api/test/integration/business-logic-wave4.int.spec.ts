/**
 * Wave 4 business-logic remediation contracts.
 *
 *   §M2 — payout-completion auto-revert (request goes back to PENDING with a
 *         system note when locked payments drift, instead of getting stuck
 *         in APPROVED limbo)
 *   §M3 — mark-paid blocks suspended vendors so admin can't accidentally
 *         transfer money to a vendor under fraud / compliance hold
 *   §M4 — bank-transfer reference number captured on every mark-paid call,
 *         linking system-PAID rows to a real bank transaction for forensic
 *         and dispute resolution
 *
 * Tests are LOGIC contracts (no exception/HTTP shapes); a future refactor
 * cannot accidentally re-open one of these gaps without flipping a red dot.
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
    admin: new AdminService(prismaSvc, notificationService, loyalty, availabilityCache),
    vendor: new VendorService(prismaSvc, notificationService, loyalty, availabilityCache),
  };
}

async function seedEligibleBookings(
  vendorId: string, customerId: string, activityId: string, count: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: 100, currency: 'QAR', status: 'SUCCESS', method: 'PAY2M',
        paidAt: new Date(), payoutStatus: 'UNPAID',
      },
    });
    const start = new Date(Date.now() - (i + 10) * 86_400_000);
    await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-W4-${i}-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR', guests: 1,
        totalPrice: 100, serviceFee: 0, commissionAmount: 10,
        status: 'COMPLETED',
        startDatetime: start, endDatetime: new Date(start.getTime() + 3600_000),
        activityId, customerId, vendorId, paymentId: payment.id,
      },
    });
    ids.push(payment.id);
  }
  return ids;
}

// ═══════════════════════════════════════════════════════════════════════════
// §M2 — payout-completion auto-revert
// ═══════════════════════════════════════════════════════════════════════════

describe('§M2 — COMPLETE auto-reverts to PENDING when locked payments drift', () => {
  test('admin can complete the cycle: revert → re-approve → complete (with the still-eligible payments)', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: { bankDetails: { iban: 'QA00..', accountName: 'Vendor Co' } as any },
    });
    const paymentIds = await seedEligibleBookings(seed.vendor.id, seed.customer.id, seed.activity.id, 3);

    const { admin, vendor } = makeServices();

    // Vendor requests payout (3 × 90 = 270 QAR net)
    const req = await vendor.requestPayout(seed.vendorUser.id);
    await admin.processPayoutRequest(req.id, 'APPROVED', 'OK');

    // Drift: one payment refunded after approval
    await ctx.prisma.payment.update({
      where: { id: paymentIds[1] },
      data: { status: 'REFUND_PENDING' },
    });

    // Try to complete → auto-reverts
    await expect(admin.processPayoutRequest(req.id, 'COMPLETED'))
      .rejects.toThrow(/no longer eligible/i);

    const afterRevert = await ctx.prisma.payoutRequest.findUnique({ where: { id: req.id } });
    expect(afterRevert?.status).toBe('PENDING');
    expect(afterRevert?.paymentIds ?? []).toEqual([]);

    // Admin re-approves — eligibility now picks up only the 2 still-SUCCESS payments
    await admin.processPayoutRequest(req.id, 'APPROVED', 'Re-approved after refund');

    const reapproved = await ctx.prisma.payoutRequest.findUnique({ where: { id: req.id } });
    expect(reapproved?.status).toBe('APPROVED');
    expect(reapproved?.paymentIds).toHaveLength(2);

    // Complete now succeeds
    await admin.processPayoutRequest(req.id, 'COMPLETED');
    const completed = await ctx.prisma.payoutRequest.findUnique({ where: { id: req.id } });
    expect(completed?.status).toBe('COMPLETED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §M3 — mark-paid blocks suspended vendor
// ═══════════════════════════════════════════════════════════════════════════

describe('§M3 — markPayoutsPaid blocks suspended vendor', () => {
  test('vendor SUSPENDED → mark-paid throws, no rows flipped', async () => {
    const seed = await seedReference(ctx.prisma);
    const [paymentId] = await seedEligibleBookings(seed.vendor.id, seed.customer.id, seed.activity.id, 1);
    await ctx.prisma.vendor.update({ where: { id: seed.vendor.id }, data: { status: 'SUSPENDED' } });

    const { admin } = makeServices();
    await expect(admin.markPayoutsPaid([paymentId], 'WIRE-001'))
      .rejects.toThrow(/not currently ACTIVE/i);

    // Payment still UNPAID (no flip happened)
    const p = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(p?.payoutStatus).toBe('UNPAID');
    expect(p?.bankTransferRef).toBeNull();
  });

  test('vendor ACTIVE → mark-paid succeeds, payment flipped to PAID', async () => {
    const seed = await seedReference(ctx.prisma);
    const [paymentId] = await seedEligibleBookings(seed.vendor.id, seed.customer.id, seed.activity.id, 1);

    const { admin } = makeServices();
    const result = await admin.markPayoutsPaid([paymentId], 'WIRE-OK-001');
    expect(result.updated).toBe(1);

    const p = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(p?.payoutStatus).toBe('PAID');
    expect(p?.bankTransferRef).toBe('WIRE-OK-001');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §M4 — bank-transfer reference required + persisted
// ═══════════════════════════════════════════════════════════════════════════

describe('§M4 — bank-transfer reference required at mark-paid', () => {
  test('empty bankTransferRef → BadRequest, no rows flipped', async () => {
    const seed = await seedReference(ctx.prisma);
    const [paymentId] = await seedEligibleBookings(seed.vendor.id, seed.customer.id, seed.activity.id, 1);

    const { admin } = makeServices();
    await expect(admin.markPayoutsPaid([paymentId], '   '))
      .rejects.toThrow(/bankTransferRef is required/i);

    const p = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(p?.payoutStatus).toBe('UNPAID');
  });

  test('valid bankTransferRef trimmed + persisted onto every flipped row', async () => {
    const seed = await seedReference(ctx.prisma);
    const ids = await seedEligibleBookings(seed.vendor.id, seed.customer.id, seed.activity.id, 3);

    const { admin } = makeServices();
    await admin.markPayoutsPaid(ids, '  SWIFT-MT103-XYZ-0099  ');

    const payments = await ctx.prisma.payment.findMany({ where: { id: { in: ids } } });
    expect(payments).toHaveLength(3);
    for (const p of payments) {
      expect(p.payoutStatus).toBe('PAID');
      expect(p.bankTransferRef).toBe('SWIFT-MT103-XYZ-0099');
    }
  });
});
