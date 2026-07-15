/**
 * AdminService.revertPayoutRequest — admin escape hatch for approve/complete/
 * reject clicked by mistake. Hard-whitelisted transition matrix plus a handful
 * of safety invariants.
 *
 * Transition matrix (allowed):
 *   APPROVED  → PENDING   (clears paymentIds + processedAt)
 *   COMPLETED → APPROVED  (keeps paymentIds, no processedAt clear)
 *   COMPLETED → PENDING   (clears paymentIds + processedAt)
 *   REJECTED  → PENDING   (re-opens the request)
 *
 * Transition matrix (blocked):
 *   REJECTED  → APPROVED  (eligibility must be re-checked via PENDING)
 *   PENDING   → *         (nothing to revert; use Reject instead)
 *   APPROVED  → APPROVED  (no-op)
 *
 * Safety invariants tested:
 *   - 404 when request missing
 *   - "at most one in-flight per vendor" guard (blocks revert to PENDING/APPROVED
 *     when another PENDING/APPROVED exists for the same vendor)
 *   - COMPLETED → * blocked when any locked payment has since been marked PAID
 *   - Optimistic lock on source status (updateMany.count === 0)
 *   - Audit row + slug-scoped vendor notification
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminService } from '../../src/admin/admin.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationService } from '../../src/common/services/notification.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { AvailabilityCacheService } from '../../src/redis/availability-cache.service';
import { ReferenceDataCacheService } from '../../src/redis/reference-data-cache.service';
import { SessionDenylistService } from '../../src/redis/session-denylist.service';
import { makePrismaMock } from '../mocks/prisma.mock';
import {
  makeNotificationMock, makeLoyaltyMock, makeAvailabilityCacheMock, makeReferenceDataCacheMock,
} from '../mocks/bookings-deps.mock';
import { makeSessionDenylistMock } from '../mocks/auth-deps.mock';

async function buildSut() {
  const prisma = makePrismaMock();
  const notif = makeNotificationMock();
  const loyalty = { ...makeLoyaltyMock(), adjust: jest.fn().mockResolvedValue({ appliedDelta: 0 }) };
  const cache = makeAvailabilityCacheMock();
  const refCache = makeReferenceDataCacheMock();
  const mod = await Test.createTestingModule({
    providers: [
      AdminService,
      { provide: PrismaService,             useValue: prisma },
      { provide: NotificationService,       useValue: notif },
      { provide: LoyaltyService,            useValue: loyalty },
      { provide: AvailabilityCacheService,  useValue: cache },
      { provide: ReferenceDataCacheService, useValue: refCache },
      { provide: SessionDenylistService,    useValue: makeSessionDenylistMock() },
    ],
  }).compile();
  return { sut: mod.get(AdminService), prisma, notif };
}

// Helper: seed the common happy-path mocks for a given source status + paymentIds.
// Tests override specific calls via mockResolvedValueOnce after calling this.
async function primeRequest(
  ctx: Awaited<ReturnType<typeof buildSut>>,
  source: 'PENDING' | 'APPROVED' | 'COMPLETED' | 'REJECTED',
  paymentIds: string[] = [],
) {
  ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
    id: 'req-1',
    status: source,
    vendorId: 'v1',
    amount: 500,
    currency: 'QAR',
    paymentIds,
    vendor: { id: 'v1', userId: 'u-vendor-1', slug: 'acme-tours', businessNameEn: 'Acme Tours' },
  });
  ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null); // no other inflight
  if (source === 'COMPLETED' && paymentIds.length > 0) {
    // Payments still UNPAID — happy path
    ctx.prisma._client.payment.count.mockResolvedValueOnce(paymentIds.length);
  }
  ctx.prisma._client.payoutRequest.updateMany.mockResolvedValueOnce({ count: 1 });
  ctx.prisma._client.payoutRequest.findUniqueOrThrow.mockResolvedValueOnce({
    id: 'req-1',
    status: 'PENDING',
    vendorId: 'v1',
    amount: 500,
    currency: 'QAR',
    paymentIds: [],
  });
  ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ fullName: 'Jane Admin' });
}

describe('AdminService.revertPayoutRequest — transition matrix (allowed)', () => {
  test('APPROVED → PENDING: clears paymentIds + processedAt', async () => {
    const ctx = await buildSut();
    await primeRequest(ctx, 'APPROVED', ['p1', 'p2']);
    await ctx.sut.revertPayoutRequest('req-1', 'PENDING', 'admin-1');

    const call = ctx.prisma._client.payoutRequest.updateMany.mock.calls[0]?.[0];
    expect(call.where).toEqual({ id: 'req-1', status: 'APPROVED' });
    expect(call.data.status).toBe('PENDING');
    expect(call.data.paymentIds).toEqual([]);
    expect(call.data.processedAt).toBeNull();
  });

  test('COMPLETED → APPROVED: keeps paymentIds, does NOT clear processedAt', async () => {
    const ctx = await buildSut();
    await primeRequest(ctx, 'COMPLETED', ['p1', 'p2']);
    await ctx.sut.revertPayoutRequest('req-1', 'APPROVED', 'admin-1');

    const call = ctx.prisma._client.payoutRequest.updateMany.mock.calls[0]?.[0];
    expect(call.where).toEqual({ id: 'req-1', status: 'COMPLETED' });
    expect(call.data.status).toBe('APPROVED');
    // Neither key should be present on the update payload for an APPROVED target.
    expect(call.data).not.toHaveProperty('paymentIds');
    expect(call.data).not.toHaveProperty('processedAt');
  });

  test('COMPLETED → PENDING: clears paymentIds + processedAt', async () => {
    const ctx = await buildSut();
    await primeRequest(ctx, 'COMPLETED', ['p1']);
    await ctx.sut.revertPayoutRequest('req-1', 'PENDING', 'admin-1');

    const call = ctx.prisma._client.payoutRequest.updateMany.mock.calls[0]?.[0];
    expect(call.data.paymentIds).toEqual([]);
    expect(call.data.processedAt).toBeNull();
  });

  test('REJECTED → PENDING: allowed', async () => {
    const ctx = await buildSut();
    await primeRequest(ctx, 'REJECTED');
    await ctx.sut.revertPayoutRequest('req-1', 'PENDING', 'admin-1');
    expect(ctx.prisma._client.payoutRequest.updateMany).toHaveBeenCalled();
  });
});

describe('AdminService.revertPayoutRequest — transition matrix (blocked)', () => {
  test('REJECTED → APPROVED: BLOCKED (must go through PENDING for eligibility re-check)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', status: 'REJECTED', vendorId: 'v1', amount: 500, currency: 'QAR',
      paymentIds: [], vendor: { id: 'v1', userId: 'u1', slug: 's', businessNameEn: 'Biz' },
    });
    await expect(ctx.sut.revertPayoutRequest('req-1', 'APPROVED', 'admin-1'))
      .rejects.toThrow(/cannot revert a rejected.*to approved.*allowed.*pending/i);
    expect(ctx.prisma._client.payoutRequest.updateMany).not.toHaveBeenCalled();
  });

  test.each([
    ['PENDING', 'PENDING'],
    ['PENDING', 'APPROVED'],
    ['APPROVED', 'APPROVED'],
  ])('%s → %s: BLOCKED', async (source, target) => {
    const ctx = await buildSut();
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', status: source, vendorId: 'v1', amount: 500, currency: 'QAR',
      paymentIds: [], vendor: { id: 'v1', userId: 'u1', slug: 's', businessNameEn: 'Biz' },
    });
    await expect(ctx.sut.revertPayoutRequest('req-1', target as any, 'admin-1'))
      .rejects.toThrow(/cannot revert/i);
  });
});

describe('AdminService.revertPayoutRequest — invariants', () => {
  test('404 when request not found', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.revertPayoutRequest('nope', 'PENDING', 'admin-1'))
      .rejects.toThrow(NotFoundException);
  });

  test('blocks revert when another PENDING request exists for the same vendor', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', status: 'REJECTED', vendorId: 'v1', amount: 300, currency: 'QAR',
      paymentIds: [], vendor: { id: 'v1', userId: 'u1', slug: 's', businessNameEn: 'Acme' },
    });
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce({ id: 'req-2', status: 'PENDING' });
    await expect(ctx.sut.revertPayoutRequest('req-1', 'PENDING', 'admin-1'))
      .rejects.toThrow(/acme.*already has.*pending.*resolve/i);
  });

  test('blocks revert when another APPROVED request exists for same vendor', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', status: 'COMPLETED', vendorId: 'v1', amount: 300, currency: 'QAR',
      paymentIds: [], vendor: { id: 'v1', userId: 'u1', slug: 's', businessNameEn: 'Acme' },
    });
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce({ id: 'req-3', status: 'APPROVED' });
    await expect(ctx.sut.revertPayoutRequest('req-1', 'APPROVED', 'admin-1'))
      .rejects.toThrow(/already has.*approved/i);
  });

  test('COMPLETED → * blocked when any locked payment went PAID since completion', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', status: 'COMPLETED', vendorId: 'v1', amount: 500, currency: 'QAR',
      paymentIds: ['p1', 'p2'],
      vendor: { id: 'v1', userId: 'u1', slug: 's', businessNameEn: 'Biz' },
    });
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null); // no other inflight
    // Only 1 of 2 payments still UNPAID → admin clicked Mark Paid on the other
    ctx.prisma._client.payment.count.mockResolvedValueOnce(1);
    await expect(ctx.sut.revertPayoutRequest('req-1', 'PENDING', 'admin-1'))
      .rejects.toThrow(/marked as paid.*Payments tab/i);
    expect(ctx.prisma._client.payoutRequest.updateMany).not.toHaveBeenCalled();
  });

  test('COMPLETED → APPROVED skips the payment-still-unpaid check when paymentIds is empty', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', status: 'COMPLETED', vendorId: 'v1', amount: 0, currency: 'QAR',
      paymentIds: [],
      vendor: { id: 'v1', userId: 'u1', slug: 's', businessNameEn: 'Biz' },
    });
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payoutRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    ctx.prisma._client.payoutRequest.findUniqueOrThrow.mockResolvedValueOnce({ id: 'req-1' });
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ fullName: 'Admin' });

    await expect(ctx.sut.revertPayoutRequest('req-1', 'APPROVED', 'admin-1')).resolves.toBeTruthy();
    // payment.count should NOT have been called because paymentIds is empty
    expect(ctx.prisma._client.payment.count).not.toHaveBeenCalled();
  });

  test('400 when optimistic lock misses (updateMany.count===0)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', status: 'REJECTED', vendorId: 'v1', amount: 300, currency: 'QAR',
      paymentIds: [], vendor: { id: 'v1', userId: 'u1', slug: 's', businessNameEn: 'Biz' },
    });
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payoutRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(ctx.sut.revertPayoutRequest('req-1', 'PENDING', 'admin-1'))
      .rejects.toThrow(/state changed concurrently/i);
  });
});

describe('AdminService.revertPayoutRequest — audit + notification', () => {
  test('writes REVERT_PAYOUT_REQUEST audit row with fromStatus/toStatus/amount/vendor', async () => {
    const ctx = await buildSut();
    await primeRequest(ctx, 'APPROVED', ['p1']);
    await ctx.sut.revertPayoutRequest('req-1', 'PENDING', 'admin-1');

    const call = ctx.prisma._client.auditLog.create.mock.calls[0]?.[0];
    expect(call.data.action).toBe('REVERT_PAYOUT_REQUEST');
    expect(call.data.entity).toBe('PayoutRequest');
    expect(call.data.entityId).toBe('req-1');
    expect(call.data.actorName).toBe('Jane Admin');
    const details = JSON.parse(call.data.details);
    expect(details).toMatchObject({
      vendorId: 'v1',
      vendorName: 'Acme Tours',
      fromStatus: 'APPROVED',
      toStatus: 'PENDING',
      amount: 500,
    });
  });

  test('notifies vendor with slug-scoped link and reopened title', async () => {
    const ctx = await buildSut();
    await primeRequest(ctx, 'REJECTED');
    await ctx.sut.revertPayoutRequest('req-1', 'PENDING', 'admin-1');

    expect(ctx.notif.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-vendor-1',
        title: 'Payout request reopened',
        link: '/vendor/acme-tours/earnings',
      }),
    );
  });

  test('skips notification when vendor.slug is missing', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', status: 'REJECTED', vendorId: 'v1', amount: 300, currency: 'QAR',
      paymentIds: [],
      vendor: { id: 'v1', userId: 'u1', slug: null, businessNameEn: 'Biz' },
    });
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payoutRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    ctx.prisma._client.payoutRequest.findUniqueOrThrow.mockResolvedValueOnce({ id: 'req-1' });
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ fullName: 'Admin' });

    await ctx.sut.revertPayoutRequest('req-1', 'PENDING', 'admin-1');
    expect(ctx.notif.send).not.toHaveBeenCalled();
  });
});
