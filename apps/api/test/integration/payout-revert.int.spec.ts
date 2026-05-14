/**
 * Admin revertPayoutRequest — DB-backed transitions.
 *
 * Pins the safety invariants that only show up when the whole state
 * machine hits real Postgres:
 *   - APPROVED → PENDING releases paymentIds so the vendor's eligibility
 *     re-includes those payments.
 *   - COMPLETED → APPROVED keeps paymentIds so Complete can be retried.
 *   - REJECTED  → PENDING re-opens the request.
 *   - REJECTED  → APPROVED is blocked at the matrix (not just DTO) level.
 *   - Blocked when a newer PENDING/APPROVED request exists on the same vendor.
 *   - Audit row written with fromStatus/toStatus/amount/vendor name.
 *
 * Matches the style of payout-flow.int.spec.ts (makeServices, seedPaidBookingsFor).
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

async function seedPaidBookingsFor(
  vendorId: string, customerId: string, activityId: string,
  entries: Array<{ total: number; commission: number; status?: 'SUCCESS' | 'PENDING'; payoutStatus?: 'UNPAID' | 'PAID' }>,
) {
  const ids: string[] = [];
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
    const start = new Date(Date.now() - (i + 10) * 86_400_000);
    await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-REV-${i}-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR', guests: 1,
      bookingPhone: '+97455123456',
        totalPrice: e.total, serviceFee: 0, commissionAmount: e.commission,
        status: 'COMPLETED',
        startDatetime: start, endDatetime: new Date(start.getTime() + 3600_000),
        activityId, customerId, vendorId,
        paymentId: payment.id,
      },
    });
    ids.push(payment.id);
  }
  return ids;
}

// Shared "give vendor bank details + seed an admin user for audit lookups".
async function primeVendorAndAdmin() {
  const seed = await seedReference(ctx.prisma);
  await ctx.prisma.vendor.update({
    where: { id: seed.vendor.id },
    data: { bankDetails: { iban: 'QA00..' } as any },
  });
  const admin = await ctx.prisma.user.create({
    data: {
      fullName: 'Finance Admin', email: 'finance@jadwal.test',
      password: '$2b$10$dummy.hash.for.tests',
      role: 'ADMIN', emailVerified: true,
    },
  });
  return { seed, adminId: admin.id };
}

describe('AdminService.revertPayoutRequest — DB-backed transitions', () => {
  test('APPROVED → PENDING releases paymentIds + processedAt, vendor sees INFLIGHT_PENDING again', async () => {
    const { seed, adminId } = await primeVendorAndAdmin();
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 300, commission: 30 },
    ]);
    const { admin, vendor } = makeServices();

    // Drive through Request → Approve. The Approve step persists paymentIds.
    const req = await vendor.requestPayout(seed.vendorUser.id);
    await admin.processPayoutRequest(req.id, 'APPROVED', 'OK');
    const approved = await ctx.prisma.payoutRequest.findUnique({ where: { id: req.id } });
    expect(approved?.status).toBe('APPROVED');
    expect((approved?.paymentIds ?? []).length).toBeGreaterThan(0);

    // Revert to PENDING. paymentIds must clear; processedAt must null.
    await admin.revertPayoutRequest(req.id, 'PENDING', adminId);

    const reverted = await ctx.prisma.payoutRequest.findUnique({ where: { id: req.id } });
    expect(reverted?.status).toBe('PENDING');
    expect(reverted?.paymentIds ?? []).toEqual([]);
    expect(reverted?.processedAt).toBeNull();

    // Vendor's eligibility now returns INFLIGHT_PENDING (the request is in queue again).
    const elig: any = await vendor.getPayoutEligibility(seed.vendorUser.id);
    expect(elig.ok).toBe(false);
    expect(elig.code).toBe('INFLIGHT_PENDING');
  });

  test('COMPLETED → APPROVED keeps paymentIds so Complete can be retried', async () => {
    const { seed, adminId } = await primeVendorAndAdmin();
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 500, commission: 50 },
    ]);
    const { admin, vendor } = makeServices();

    const req = await vendor.requestPayout(seed.vendorUser.id);
    await admin.processPayoutRequest(req.id, 'APPROVED', 'ok');
    await admin.processPayoutRequest(req.id, 'COMPLETED', 'closed');

    const pre = await ctx.prisma.payoutRequest.findUnique({ where: { id: req.id } });
    expect(pre?.status).toBe('COMPLETED');
    const lockedIds = pre?.paymentIds ?? [];
    expect(lockedIds.length).toBeGreaterThan(0);

    // Revert to APPROVED. paymentIds must stay intact so the Complete step
    // still has its lock. processedAt must stay non-null (still a processed
    // decision, just rolled back one step).
    await admin.revertPayoutRequest(req.id, 'APPROVED', adminId);

    const post = await ctx.prisma.payoutRequest.findUnique({ where: { id: req.id } });
    expect(post?.status).toBe('APPROVED');
    expect(post?.paymentIds).toEqual(lockedIds);
    expect(post?.processedAt).not.toBeNull();

    // Complete must work again on this reopened request.
    await admin.processPayoutRequest(req.id, 'COMPLETED');
    const final = await ctx.prisma.payoutRequest.findUnique({ where: { id: req.id } });
    expect(final?.status).toBe('COMPLETED');
  });

  test('REJECTED → PENDING re-opens the request', async () => {
    const { seed, adminId } = await primeVendorAndAdmin();
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 200, commission: 20 },
    ]);
    const { admin, vendor } = makeServices();

    const req = await vendor.requestPayout(seed.vendorUser.id);
    await admin.processPayoutRequest(req.id, 'REJECTED', 'docs missing');
    expect((await ctx.prisma.payoutRequest.findUnique({ where: { id: req.id } }))?.status).toBe('REJECTED');

    await admin.revertPayoutRequest(req.id, 'PENDING', adminId);
    expect((await ctx.prisma.payoutRequest.findUnique({ where: { id: req.id } }))?.status).toBe('PENDING');
  });

  test('REJECTED → APPROVED is BLOCKED by the transition matrix (not just the DTO)', async () => {
    const { seed, adminId } = await primeVendorAndAdmin();
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 200, commission: 20 },
    ]);
    const { admin, vendor } = makeServices();

    const req = await vendor.requestPayout(seed.vendorUser.id);
    await admin.processPayoutRequest(req.id, 'REJECTED', 'no');
    await expect(admin.revertPayoutRequest(req.id, 'APPROVED', adminId))
      .rejects.toThrow(/cannot revert a rejected.*to approved/i);
  });

  test('blocks revert when vendor already has a newer PENDING request', async () => {
    // Scenario: vendor filed req-1 → admin REJECTED. Vendor filed req-2 which
    // is now PENDING. Admin tries to revert req-1 → PENDING. Must refuse
    // since the invariant is "at most one in-flight per vendor".
    const { seed, adminId } = await primeVendorAndAdmin();
    const { admin, vendor } = makeServices();

    // Two separate eligible bookings (so req-2 can actually succeed after
    // req-1 is terminal rejected).
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 300, commission: 30 },
    ]);
    const req1 = await vendor.requestPayout(seed.vendorUser.id);
    await admin.processPayoutRequest(req1.id, 'REJECTED', 'try again');

    // New booking → eligibility now positive again → vendor files req-2.
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 400, commission: 40 },
    ]);
    const req2 = await vendor.requestPayout(seed.vendorUser.id);
    expect(req2.status).toBe('PENDING');

    // Revert of req-1 must fail because req-2 is in-flight.
    await expect(admin.revertPayoutRequest(req1.id, 'PENDING', adminId))
      .rejects.toThrow(/already has.*pending.*resolve/i);
  });

  test('writes REVERT_PAYOUT_REQUEST audit row with fromStatus/toStatus/amount/vendor', async () => {
    const { seed, adminId } = await primeVendorAndAdmin();
    await seedPaidBookingsFor(seed.vendor.id, seed.customer.id, seed.activity.id, [
      { total: 250, commission: 25 },
    ]);
    const { admin, vendor } = makeServices();

    const req = await vendor.requestPayout(seed.vendorUser.id);
    await admin.processPayoutRequest(req.id, 'APPROVED', 'ok');
    await admin.revertPayoutRequest(req.id, 'PENDING', adminId);

    const log = await ctx.prisma.auditLog.findFirst({
      where: { action: 'REVERT_PAYOUT_REQUEST', entityId: req.id },
    });
    expect(log).not.toBeNull();
    expect(log?.actorName).toBe('Finance Admin');
    const details = JSON.parse(log?.details ?? '{}');
    expect(details).toMatchObject({
      vendorId: seed.vendor.id,
      vendorName: 'Test Biz',
      fromStatus: 'APPROVED',
      toStatus: 'PENDING',
    });
  });
});
