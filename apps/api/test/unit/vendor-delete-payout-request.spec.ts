/**
 * VendorService.deletePayoutRequest — clears a REJECTED request from a
 * vendor's history. Everything else (PENDING/APPROVED/COMPLETED) is
 * immutable for audit purposes.
 *
 * Key safety property: cross-vendor access returns 404 (NotFoundException),
 * NOT 403, so a malicious vendor can't probe whether a request id exists
 * for someone else.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { VendorService } from '../../src/vendor/vendor.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationService } from '../../src/common/services/notification.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { AvailabilityCacheService } from '../../src/redis/availability-cache.service';
import { makePrismaMock } from '../mocks/prisma.mock';
import {
  makeNotificationMock, makeLoyaltyMock, makeAvailabilityCacheMock,
} from '../mocks/bookings-deps.mock';

async function buildSut() {
  const prisma = makePrismaMock();
  const mod = await Test.createTestingModule({
    providers: [
      VendorService,
      { provide: PrismaService,             useValue: prisma },
      { provide: NotificationService,       useValue: makeNotificationMock() },
      { provide: LoyaltyService,            useValue: makeLoyaltyMock() },
      { provide: AvailabilityCacheService,  useValue: makeAvailabilityCacheMock() },
    ],
  }).compile();
  return { sut: mod.get(VendorService), prisma };
}

const VENDOR_ROW = { id: 'v1', status: 'ACTIVE' as const, countryId: 'QA', businessNameEn: 'Biz' };

describe('VendorService.deletePayoutRequest', () => {
  test('404 when request not found', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(VENDOR_ROW);
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.deletePayoutRequest('u1', 'missing-id'))
      .rejects.toThrow(NotFoundException);
  });

  test('404 (NOT 403) when request belongs to a different vendor — no existence leak', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(VENDOR_ROW);
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', vendorId: 'OTHER_VENDOR', status: 'REJECTED',
    });
    // Must respond with the same 404 an unknown id would produce — otherwise
    // a malicious vendor can probe ids to learn whether they exist for
    // someone else.
    const promise = ctx.sut.deletePayoutRequest('u1', 'req-1');
    await expect(promise).rejects.toThrow(NotFoundException);
    await expect(promise).rejects.not.toThrow(/not your|forbid|permission/i);
  });

  test('400 when status is PENDING', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(VENDOR_ROW);
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', vendorId: 'v1', status: 'PENDING',
    });
    await expect(ctx.sut.deletePayoutRequest('u1', 'req-1'))
      .rejects.toThrow(/only rejected.*pending/i);
    expect(ctx.prisma._client.payoutRequest.deleteMany).not.toHaveBeenCalled();
  });

  test('400 when status is APPROVED', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(VENDOR_ROW);
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', vendorId: 'v1', status: 'APPROVED',
    });
    await expect(ctx.sut.deletePayoutRequest('u1', 'req-1'))
      .rejects.toThrow(/only rejected.*approved/i);
  });

  test('400 when status is COMPLETED', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(VENDOR_ROW);
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', vendorId: 'v1', status: 'COMPLETED',
    });
    await expect(ctx.sut.deletePayoutRequest('u1', 'req-1'))
      .rejects.toThrow(/only rejected.*completed/i);
  });

  test('success: deleteMany filtered by {id, vendorId, status:"REJECTED"} (optimistic)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(VENDOR_ROW);
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', vendorId: 'v1', status: 'REJECTED',
    });
    ctx.prisma._client.payoutRequest.deleteMany.mockResolvedValueOnce({ count: 1 });

    const result = await ctx.sut.deletePayoutRequest('u1', 'req-1');
    expect(result).toEqual({ deleted: true, id: 'req-1' });
    expect(ctx.prisma._client.payoutRequest.deleteMany).toHaveBeenCalledWith({
      where: { id: 'req-1', vendorId: 'v1', status: 'REJECTED' },
    });
  });

  test('400 on race: deleteMany.count===0 (admin re-opened the request in the gap)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(VENDOR_ROW);
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', vendorId: 'v1', status: 'REJECTED',
    });
    ctx.prisma._client.payoutRequest.deleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(ctx.sut.deletePayoutRequest('u1', 'req-1'))
      .rejects.toThrow(/state changed.*refresh/i);
  });
});
