/**
 * Admin markPayoutUnpaid — DB-backed.
 *
 * Invariants:
 *   - PAID → UNPAID flips atomically + clears paidAt
 *   - Blocked when the payment sits inside an APPROVED or COMPLETED
 *     payout request's paymentIds[]
 *   - Concurrent callers: optimistic updateMany means exactly one winner
 *   - Audit row resolves admin.fullName from DB (not hardcoded 'Admin')
 *   - markPayoutsPaid in-flight guard blocks when vendor has a PENDING request
 *
 * Uses the same testbed pattern as payout-flow.int.spec.ts.
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
    send:         jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany:   jest.fn().mockResolvedValue(undefined),
  } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const availabilityCache = {
    invalidate:     jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const admin  = new AdminService(prismaSvc, notificationService, loyalty, availabilityCache, { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any, makeSessionDenylistMock() as any);
  const vendor = new VendorService(prismaSvc, notificationService, loyalty, availabilityCache, makeSessionDenylistMock() as any);
  return { admin, vendor, notificationService };
}

async function seedPaidBooking(
  vendorId: string, customerId: string, activityId: string,
  opts: { total: number; commission: number; payoutStatus?: 'UNPAID' | 'PAID' } = { total: 200, commission: 20 },
) {
  const payment = await ctx.prisma.payment.create({
    data: {
      amount: opts.total,
      currency: 'QAR',
      status: 'SUCCESS',
      method: 'PAY2M',
      paidAt: new Date(),
      payoutStatus: opts.payoutStatus ?? 'PAID',
    },
  });
  const start = new Date(Date.now() - 86_400_000);
  await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-MPU-${crypto.randomUUID().slice(0, 6)}`,
      currencyCode: 'QAR', guests: 1,
      bookingPhone: '+97455123456',
      totalPrice: opts.total, serviceFee: 0, commissionAmount: opts.commission,
      status: 'COMPLETED',
      startDatetime: start, endDatetime: new Date(start.getTime() + 3600_000),
      activityId, customerId, vendorId,
      paymentId: payment.id,
    },
  });
  return payment.id;
}

async function seedAdmin(fullName = 'Finance Admin') {
  return ctx.prisma.user.create({
    data: {
      fullName, email: `${fullName.replace(/\s+/g, '-').toLowerCase()}@jadwal.test`,
      password: '$2b$10$dummy.hash',
      role: 'ADMIN', emailVerified: true,
    },
  });
}

describe('AdminService.markPayoutUnpaid — DB-backed', () => {
  test('flips PAID → UNPAID and clears paidAt when payment not locked in any request', async () => {
    const seed = await seedReference(ctx.prisma);
    const paymentId = await seedPaidBooking(seed.vendor.id, seed.customer.id, seed.activity.id);
    const admin = await seedAdmin();
    const { admin: svc } = makeServices();

    await svc.markPayoutUnpaid(paymentId, admin.id);

    const row = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(row?.payoutStatus).toBe('UNPAID');
    expect(row?.paidAt).toBeNull();
  });

  test('blocks when payment.id is in an APPROVED request.paymentIds[]', async () => {
    const seed = await seedReference(ctx.prisma);
    const paymentId = await seedPaidBooking(seed.vendor.id, seed.customer.id, seed.activity.id);
    const adminUser = await seedAdmin();
    // Manually stage an APPROVED request with this paymentId locked in —
    // simulating the state where admin already approved via the request flow.
    await ctx.prisma.payoutRequest.create({
      data: {
        vendorId: seed.vendor.id,
        amount: 180,
        currency: 'QAR',
        status: 'APPROVED',
        paymentIds: [paymentId],
        processedAt: new Date(),
      },
    });
    const { admin: svc } = makeServices();

    await expect(svc.markPayoutUnpaid(paymentId, adminUser.id))
      .rejects.toThrow(/approved payout request.*Payout Requests page/i);

    // DB state must be unchanged.
    const row = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(row?.payoutStatus).toBe('PAID');
  });

  test('blocks when payment.id is in a COMPLETED request.paymentIds[]', async () => {
    const seed = await seedReference(ctx.prisma);
    const paymentId = await seedPaidBooking(seed.vendor.id, seed.customer.id, seed.activity.id);
    const adminUser = await seedAdmin();
    await ctx.prisma.payoutRequest.create({
      data: {
        vendorId: seed.vendor.id,
        amount: 180,
        currency: 'QAR',
        status: 'COMPLETED',
        paymentIds: [paymentId],
        processedAt: new Date(),
      },
    });
    const { admin: svc } = makeServices();

    await expect(svc.markPayoutUnpaid(paymentId, adminUser.id))
      .rejects.toThrow(/completed payout request/i);
  });

  test('concurrent revert: exactly one caller wins (optimistic lock)', async () => {
    const seed = await seedReference(ctx.prisma);
    const paymentId = await seedPaidBooking(seed.vendor.id, seed.customer.id, seed.activity.id);
    const adminUser = await seedAdmin();
    const { admin: svc } = makeServices();

    const results = await Promise.allSettled([
      svc.markPayoutUnpaid(paymentId, adminUser.id),
      svc.markPayoutUnpaid(paymentId, adminUser.id),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected  = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/state changed|already unpaid/i);
  });

  test('writes audit log with the admin user fullName (not a placeholder)', async () => {
    const seed = await seedReference(ctx.prisma);
    const paymentId = await seedPaidBooking(seed.vendor.id, seed.customer.id, seed.activity.id);
    const adminUser = await seedAdmin('Ops Manager');
    const { admin: svc } = makeServices();

    await svc.markPayoutUnpaid(paymentId, adminUser.id);

    const log = await ctx.prisma.auditLog.findFirst({
      where: { action: 'REVERT_PAYOUT_TO_UNPAID', entityId: paymentId },
    });
    expect(log).not.toBeNull();
    expect(log?.actorName).toBe('Ops Manager');
    const details = JSON.parse(log?.details ?? '{}');
    expect(details.reason).toBe('Reverted mistaken payout marking');
    expect(details.vendorName).toBe('Test Biz');
  });
});

describe('AdminService.markPayoutsPaid — in-flight guard (DB-backed)', () => {
  test('blocks bulk mark-paid when vendor has a PENDING payout request', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id },
      data: { bankDetails: { iban: 'QA00..' } as any },
    });
    const paymentId = await seedPaidBooking(seed.vendor.id, seed.customer.id, seed.activity.id, {
      total: 300, commission: 30, payoutStatus: 'UNPAID',
    });
    const { admin: svc, vendor } = makeServices();
    // Vendor requests payout → PENDING. Now bulk mark-paid must refuse.
    await vendor.requestPayout(seed.vendorUser.id);

    await expect(svc.markPayoutsPaid([paymentId], 'TEST-WIRE-REF'))
      .rejects.toThrow(/in-flight payout request.*Payout Requests page/i);

    const row = await ctx.prisma.payment.findUnique({ where: { id: paymentId } });
    expect(row?.payoutStatus).toBe('UNPAID'); // unchanged
  });
});
