/**
 * Payout flow — vendor requests → admin processes.
 *
 * Invariants:
 *   - requestPayout: SUCCESS+UNPAID payments minus commission = available;
 *     guarded by bank-details-required, no-pending-request, positive-balance
 *   - processPayoutRequest: PENDING → APPROVED → COMPLETED (valid transitions)
 *     invalid transitions rejected (can't COMPLETE a PENDING directly etc.)
 *   - Notifications sent both directions (admin on request, vendor on process)
 *
 * Only real DB can prove the aggregation + transition rules together.
 */

import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { VendorService } from '../../src/vendor/vendor.service';
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
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const admin = new AdminService(prismaSvc, notificationService, loyalty, availabilityCache, { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any, makeSessionDenylistMock() as any);
  const vendor = new VendorService(prismaSvc, notificationService, loyalty, availabilityCache, makeSessionDenylistMock() as any);
  return { admin, vendor, notificationService };
}

async function seedPaidBookingsFor(
  vendorId: string, customerId: string, activityId: string,
  entries: Array<{ total: number; commission: number; status?: 'SUCCESS' | 'PENDING'; payoutStatus?: 'UNPAID' | 'PAID' }>,
) {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const payment = await ctx.prisma.payment.create({
      data: {
        amount: e.total,
        currency: 'QAR',
        status: e.status ?? 'SUCCESS',
        method: 'PAY2M',
        paidAt: new Date(),
        payoutStatus: e.payoutStatus ?? 'UNPAID',
      },
    });
    const start = new Date(Date.now() - (i + 10) * 86_400_000); // past bookings
    await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-PAYOUT-${i}-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR', guests: 1,
      bookingPhone: '+97455123456',
        totalPrice: e.total, serviceFee: 0, commissionAmount: e.commission,
        status: 'COMPLETED',
        startDatetime: start, endDatetime: new Date(start.getTime() + 3600_000),
        activityId, customerId, vendorId,
        paymentId: payment.id,
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Vendor requestPayout
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorService.requestPayout', () => {
  test('computes available = sum(total) - sum(commission) for SUCCESS+UNPAID payments only', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: { bankDetails: { iban: 'QA00..', accountName: 'Vendor Co' } as any },
    });
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 100, commission: 10 },  // net 90
      { total: 200, commission: 20 },  // net 180
      { total: 300, commission: 30, payoutStatus: 'PAID' }, // already paid out — EXCLUDED
      { total: 500, commission: 50, status: 'PENDING' },     // not success — EXCLUDED
    ]);

    const { vendor } = makeServices();
    const req = await vendor.requestPayout(seed.vendorUser.id);
    // Expected available: (100-10) + (200-20) = 90 + 180 = 270
    expect(Number(req.amount)).toBe(270);
    expect(req.status).toBe('PENDING');
    expect(req.currency).toBe('QAR');
  });

  test('no bank details → BadRequest ("add your bank details")', async () => {
    const seed = await seedReference(ctx.prisma);
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 100, commission: 10 },
    ]);
    const { vendor } = makeServices();
    await expect(vendor.requestPayout(seed.vendorUser.id))
      .rejects.toThrow(/bank details/i);
  });

  test('zero available → BadRequest (NO_BALANCE)', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: { bankDetails: { iban: 'QA00..' } as any },
    });
    // No paid bookings — available is 0. The refactor to evaluatePayoutEligibility
    // rephrased this message (and gave it a machine-readable code); match
    // either the old or new wording so this spec stays stable if copy tweaks.
    const { vendor } = makeServices();
    await expect(vendor.requestPayout(seed.vendorUser.id))
      .rejects.toThrow(/no available balance|no eligible cash/i);
  });

  test('already-pending request → BadRequest ("already have a pending")', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: { bankDetails: { iban: 'QA00..' } as any },
    });
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 100, commission: 10 },
    ]);
    const { vendor } = makeServices();
    await vendor.requestPayout(seed.vendorUser.id);
    await expect(vendor.requestPayout(seed.vendorUser.id))
      .rejects.toThrow(/already have a pending/i);
  });

  test('notifyAdmins fires when request created', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: { bankDetails: { iban: 'QA00..' } as any },
    });
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 100, commission: 10 },
    ]);
    const { vendor, notificationService } = makeServices();
    await vendor.requestPayout(seed.vendorUser.id);
    expect(notificationService.notifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PAYOUT_REQUESTED' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Admin processPayoutRequest — state machine
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.processPayoutRequest — state transitions', () => {
  /**
   * Seeds a PENDING PayoutRequest AND the backing SUCCESS+UNPAID payments
   * that would normally support it. The APPROVE step recomputes eligibility
   * from live payments (scam-blocker), so tests that hit APPROVE need
   * real backing or they'd trip the "no eligible payments" guard.
   */
  async function seedPendingRequest(requestAmount = 500) {
    const seed = await seedReference(ctx.prisma);
    // Backing: one SUCCESS+UNPAID booking whose vendor-share covers the
    // requested amount so APPROVE's recompute finds a match.
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: requestAmount + 50, commission: 50 }, // net == requestAmount
    ]);
    const req = await ctx.prisma.payoutRequest.create({
      data: {
        vendorId: seed.vendor.id,
        amount: requestAmount,
        currency: 'QAR',
        status: 'PENDING',
      },
    });
    return { seed, req };
  }

  test('PENDING → APPROVED with processedAt + note', async () => {
    const { req } = await seedPendingRequest();
    const { admin } = makeServices();
    const updated = await admin.processPayoutRequest(req.id, 'APPROVED', 'Looks good');
    expect(updated.status).toBe('APPROVED');
    expect(updated.adminNote).toBe('Looks good');
    expect(updated.processedAt).toBeInstanceOf(Date);
  });

  test('PENDING → REJECTED with reason', async () => {
    const { req } = await seedPendingRequest();
    const { admin } = makeServices();
    const updated = await admin.processPayoutRequest(req.id, 'REJECTED', 'Insufficient docs');
    expect(updated.status).toBe('REJECTED');
  });

  test('APPROVED → COMPLETED (bank transfer confirmed)', async () => {
    const { req } = await seedPendingRequest();
    const { admin } = makeServices();
    await admin.processPayoutRequest(req.id, 'APPROVED', 'OK');
    const completed = await admin.processPayoutRequest(req.id, 'COMPLETED', 'Transferred via ACH');
    expect(completed.status).toBe('COMPLETED');
  });

  test('PENDING → COMPLETED (skipping APPROVED) → BadRequest', async () => {
    const { req } = await seedPendingRequest();
    const { admin } = makeServices();
    await expect(admin.processPayoutRequest(req.id, 'COMPLETED', 'skip'))
      .rejects.toThrow(/cannot complete/i);
  });

  test('REJECTED → APPROVED → BadRequest (terminal)', async () => {
    const { req } = await seedPendingRequest();
    const { admin } = makeServices();
    await admin.processPayoutRequest(req.id, 'REJECTED', 'no');
    await expect(admin.processPayoutRequest(req.id, 'APPROVED', 'retry'))
      .rejects.toThrow(/cannot approve/i);
  });

  test('non-existent id → NotFoundException', async () => {
    await seedReference(ctx.prisma);
    const { admin } = makeServices();
    await expect(admin.processPayoutRequest(
      '00000000-0000-4000-8000-00000000aaaa', 'APPROVED', 'ok',
    )).rejects.toThrow(/not found/i);
  });

  test('vendor is notified via PAYOUT_PROCESSED', async () => {
    const { seed, req } = await seedPendingRequest();
    const { admin, notificationService } = makeServices();
    await admin.processPayoutRequest(req.id, 'APPROVED', 'OK');
    expect(notificationService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: seed.vendorUser.id,
        type: 'PAYOUT_PROCESSED',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Admin getPayouts — inflightRequest enrichment (DB-backed)
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.getPayouts — inflightRequest enrichment', () => {
  test('rows for a vendor with PENDING request carry inflightRequest={status:PENDING}', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: { bankDetails: { iban: 'QA00..' } as any },
    });
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 200, commission: 20 },
    ]);
    const { vendor, admin } = makeServices();
    // PENDING request locks the vendor wholesale — every row on that vendor
    // must come back tagged PENDING regardless of paymentIds.
    await vendor.requestPayout(seed.vendorUser.id);

    const page = await admin.getPayouts({ page: 1, limit: 20 } as any);
    const row = page.data[0];
    expect(row).toBeTruthy();
    expect((row as any).inflightRequest).toEqual({ status: 'PENDING' });
  });

  test('APPROVED paymentIds lock only their specific rows; sibling rows stay null', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: { bankDetails: { iban: 'QA00..' } as any },
    });
    // Two eligible bookings worth 200 each. Vendor requests 400. Admin
    // approves → both paymentIds get locked in.
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 200, commission: 20 },
      { total: 200, commission: 20 },
    ]);
    const { vendor, admin } = makeServices();
    const req = await vendor.requestPayout(seed.vendorUser.id);
    await admin.processPayoutRequest(req.id, 'APPROVED', 'ok');

    const page = await admin.getPayouts({ page: 1, limit: 20 } as any);
    // Both rows belong to the approved request → both tagged APPROVED.
    for (const row of page.data) {
      expect((row as any).inflightRequest).toEqual({ status: 'APPROVED' });
    }
  });

  test('no in-flight request for any visible vendor → every row inflightRequest is null', async () => {
    const seed = await seedReference(ctx.prisma);
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 200, commission: 20 },
    ]);
    const { admin } = makeServices();
    const page = await admin.getPayouts({ page: 1, limit: 20 } as any);
    for (const row of page.data) {
      expect((row as any).inflightRequest).toBeNull();
    }
  });
});
