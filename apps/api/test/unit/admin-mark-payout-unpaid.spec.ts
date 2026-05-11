/**
 * AdminService.markPayoutUnpaid — admin escape hatch for the "Mark Paid by
 * mistake" scenario. Destructive: flips a settled PAID payment back to
 * UNPAID, notifies the vendor, and writes a structured audit row.
 *
 * Test surface:
 *   - Existence + status guards (SUCCESS+PAID required)
 *   - Payment-request lock-out (APPROVED/COMPLETED payoutRequest blocks revert)
 *   - Optimistic-lock race (updateMany.count===0 throws)
 *   - Audit row resolves admin fullName; falls back to `admin:<shortId>`
 *   - Reason is system-stamped ("Reverted mistaken payout marking")
 *   - Vendor notification uses slug-scoped link (/vendor/<slug>/earnings)
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminService } from '../../src/admin/admin.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationService } from '../../src/common/services/notification.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { AvailabilityCacheService } from '../../src/redis/availability-cache.service';
import { ReferenceDataCacheService } from '../../src/redis/reference-data-cache.service';
import { makePrismaMock } from '../mocks/prisma.mock';
import {
  makeNotificationMock, makeLoyaltyMock, makeAvailabilityCacheMock, makeReferenceDataCacheMock,
} from '../mocks/bookings-deps.mock';

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
    ],
  }).compile();

  return { sut: mod.get(AdminService), prisma, notif };
}

// Convenience: a well-formed payment row that would legitimately pass every
// guard (SUCCESS + PAID + slug-bearing vendor). Tests mutate fields as needed.
const validPayment = {
  id: 'p1',
  status: 'SUCCESS' as const,
  payoutStatus: 'PAID' as const,
  amount: 180,
  booking: {
    ref: 'JDWL-ABCD1234',
    vendor: { id: 'v1', userId: 'u-vendor-1', slug: 'acme-tours', businessNameEn: 'Acme Tours' },
  },
};

describe('AdminService.markPayoutUnpaid — existence + status guards', () => {
  test('404 when payment not found', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.markPayoutUnpaid('p1', 'admin-1'))
      .rejects.toThrow(NotFoundException);
  });

  test('400 when payment.status !== SUCCESS', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({ ...validPayment, status: 'PENDING' });
    await expect(ctx.sut.markPayoutUnpaid('p1', 'admin-1'))
      .rejects.toThrow(/only success.*reverted/i);
  });

  test('400 when payment.payoutStatus !== PAID (already UNPAID)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce({ ...validPayment, payoutStatus: 'UNPAID' });
    await expect(ctx.sut.markPayoutUnpaid('p1', 'admin-1'))
      .rejects.toThrow(/already unpaid.*nothing to revert/i);
  });
});

describe('AdminService.markPayoutUnpaid — payout-request lockout', () => {
  test('400 when payment is locked in an APPROVED request', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce(validPayment);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce({ id: 'req1', status: 'APPROVED' });
    await expect(ctx.sut.markPayoutUnpaid('p1', 'admin-1'))
      .rejects.toThrow(/approved payout request/i);
    // Must not touch the payment row
    expect(ctx.prisma._client.payment.updateMany).not.toHaveBeenCalled();
  });

  test('400 when payment is locked in a COMPLETED request', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce(validPayment);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce({ id: 'req1', status: 'COMPLETED' });
    await expect(ctx.sut.markPayoutUnpaid('p1', 'admin-1'))
      .rejects.toThrow(/completed payout request/i);
  });

  test('lockout query filters to APPROVED + COMPLETED (not PENDING/REJECTED)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce(validPayment);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payment.updateMany.mockResolvedValueOnce({ count: 1 });

    await ctx.sut.markPayoutUnpaid('p1', 'admin-1');

    expect(ctx.prisma._client.payoutRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['APPROVED', 'COMPLETED'] },
          paymentIds: { has: 'p1' },
        }),
      }),
    );
  });
});

describe('AdminService.markPayoutUnpaid — optimistic lock + update', () => {
  test('400 when updateMany.count===0 (concurrent flip by another writer)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce(validPayment);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payment.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(ctx.sut.markPayoutUnpaid('p1', 'admin-1'))
      .rejects.toThrow(/state changed concurrently/i);
  });

  test('success: flips payoutStatus to UNPAID + clears paidAt with SUCCESS+PAID guard', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce(validPayment);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payment.updateMany.mockResolvedValueOnce({ count: 1 });
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ fullName: 'Jane Doe' });

    const result = await ctx.sut.markPayoutUnpaid('p1', 'admin-1');

    expect(ctx.prisma._client.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'SUCCESS', payoutStatus: 'PAID' },
      data: { payoutStatus: 'UNPAID', paidAt: null },
    });
    expect(result).toEqual({ reverted: true, paymentId: 'p1' });
  });
});

describe('AdminService.markPayoutUnpaid — audit row', () => {
  test('writes REVERT_PAYOUT_TO_UNPAID with admin.fullName + business context JSON', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce(validPayment);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payment.updateMany.mockResolvedValueOnce({ count: 1 });
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ fullName: 'Jane Doe' });

    await ctx.sut.markPayoutUnpaid('p1', 'admin-1');

    const call = ctx.prisma._client.auditLog.create.mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    expect(call.data.actorType).toBe('ADMIN');
    expect(call.data.actorId).toBe('admin-1');
    expect(call.data.actorName).toBe('Jane Doe');
    expect(call.data.action).toBe('REVERT_PAYOUT_TO_UNPAID');
    expect(call.data.entity).toBe('Payment');
    expect(call.data.entityId).toBe('p1');

    const details = JSON.parse(call.data.details);
    expect(details).toMatchObject({
      bookingRef: 'JDWL-ABCD1234',
      vendorId: 'v1',
      vendorName: 'Acme Tours',
      amount: 180,
      // System-stamped motive — no user-supplied reason on this flow.
      reason: 'Reverted mistaken payout marking',
    });
  });

  test('audit actorName falls back to admin:<shortId> when fullName missing', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce(validPayment);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payment.updateMany.mockResolvedValueOnce({ count: 1 });
    // Simulate deleted/nameless admin account
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);

    await ctx.sut.markPayoutUnpaid('p1', 'abcdef012-xxxx-xxxx-xxxx-xxxxxxxxxxxx');

    const call = ctx.prisma._client.auditLog.create.mock.calls[0]?.[0];
    expect(call.data.actorName).toBe('admin:abcdef01');
  });
});

describe('AdminService.markPayoutUnpaid — vendor notification', () => {
  test('notifies vendor with slug-scoped /vendor/<slug>/earnings link', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce(validPayment);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payment.updateMany.mockResolvedValueOnce({ count: 1 });
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ fullName: 'Admin' });

    await ctx.sut.markPayoutUnpaid('p1', 'admin-1');

    expect(ctx.notif.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-vendor-1',
        title: 'Payout reversed',
        link: '/vendor/acme-tours/earnings',
      }),
    );
    // Pin that the link is NEVER the slug-less /vendor/earnings (which 404s).
    const lastCall = ctx.notif.send.mock.calls.at(-1)?.[0];
    expect(lastCall.link).not.toBe('/vendor/earnings');
  });

  test('skips notification defensively when vendor has no slug', async () => {
    const ctx = await buildSut();
    const paymentMissingSlug = {
      ...validPayment,
      booking: {
        ...validPayment.booking,
        vendor: { ...validPayment.booking.vendor, slug: null },
      },
    };
    ctx.prisma._client.payment.findUnique.mockResolvedValueOnce(paymentMissingSlug);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payment.updateMany.mockResolvedValueOnce({ count: 1 });
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ fullName: 'Admin' });

    await ctx.sut.markPayoutUnpaid('p1', 'admin-1');

    expect(ctx.notif.send).not.toHaveBeenCalled();
  });
});
