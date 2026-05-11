/**
 * AdminService.getDashboardCharts — topActivities gained a `revenue` field
 * and CANCELLED bookings are excluded from the counts.
 *
 * Verifies:
 *   - topActivities includes `revenue` (totalPrice - commissionAmount) per activity
 *   - activity.findMany filters bookings by status != CANCELLED at count level
 *   - booking.groupBy filter uses { status: { not: 'CANCELLED' } }
 *   - When no activities match, booking.groupBy is NOT called (no empty IN)
 *   - Revenue falls back to 0 when no groupBy row matches an activity
 */

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
  const mod = await Test.createTestingModule({
    providers: [
      AdminService,
      { provide: PrismaService,             useValue: prisma },
      { provide: NotificationService,       useValue: makeNotificationMock() },
      { provide: LoyaltyService,            useValue: makeLoyaltyMock() },
      { provide: AvailabilityCacheService,  useValue: makeAvailabilityCacheMock() },
      { provide: ReferenceDataCacheService, useValue: makeReferenceDataCacheMock() },
    ],
  }).compile();
  return { sut: mod.get(AdminService), prisma };
}

describe('AdminService.getDashboardCharts', () => {
  function primeBase(ctx: Awaited<ReturnType<typeof buildSut>>, activities: any[]) {
    // Promise.all order: [payment.findMany, activity.findMany, vendor.findMany]
    ctx.prisma._client.payment.findMany.mockResolvedValueOnce([]);       // revenueData (empty is fine)
    ctx.prisma._client.activity.findMany.mockResolvedValueOnce(activities);
    ctx.prisma._client.vendor.findMany.mockResolvedValueOnce([]);        // vendorGrowth
  }

  test('returns revenue per activity (totalPrice - commission) from groupBy', async () => {
    const ctx = await buildSut();
    primeBase(ctx, [
      { id: 'a1', titleEn: 'Desert Safari', category: { nameEn: 'Adventure' }, _count: { bookings: 3 } },
      { id: 'a2', titleEn: 'Dhow Cruise',   category: { nameEn: 'Leisure' },   _count: { bookings: 1 } },
    ]);
    ctx.prisma._client.booking.groupBy.mockResolvedValueOnce([
      { activityId: 'a1', _sum: { totalPrice: 900, commissionAmount: 90 } },  // net 810
      { activityId: 'a2', _sum: { totalPrice: 300, commissionAmount: 30 } },  // net 270
    ]);

    const res = await ctx.sut.getDashboardCharts();

    expect(res.topActivities).toEqual([
      expect.objectContaining({ name: 'Desert Safari', category: 'Adventure', bookings: 3, revenue: 810 }),
      expect.objectContaining({ name: 'Dhow Cruise',   category: 'Leisure',   bookings: 1, revenue: 270 }),
    ]);
  });

  test('activity.findMany filters bookings by status != CANCELLED at count level', async () => {
    const ctx = await buildSut();
    primeBase(ctx, []);
    await ctx.sut.getDashboardCharts();

    const findCall = ctx.prisma._client.activity.findMany.mock.calls[0]?.[0];
    // Top-level where excludes activities with only cancelled bookings
    expect(findCall.where).toEqual(
      expect.objectContaining({
        bookings: { some: { status: { not: 'CANCELLED' } } },
      }),
    );
    // _count also filters — admin's tile should match the dashboard stat
    expect(findCall.select._count.select.bookings).toEqual({
      where: { status: { not: 'CANCELLED' } },
    });
  });

  test('booking.groupBy excludes CANCELLED + filters to SUCCESS payments', async () => {
    const ctx = await buildSut();
    primeBase(ctx, [
      { id: 'a1', titleEn: 'X', category: { nameEn: 'C' }, _count: { bookings: 1 } },
    ]);
    ctx.prisma._client.booking.groupBy.mockResolvedValueOnce([]);

    await ctx.sut.getDashboardCharts();

    const groupCall = ctx.prisma._client.booking.groupBy.mock.calls[0]?.[0];
    expect(groupCall.where).toEqual(
      expect.objectContaining({
        status: { not: 'CANCELLED' },
        payment: { status: 'SUCCESS' },
      }),
    );
  });

  test('no activities → booking.groupBy is NEVER called (avoids empty-IN query)', async () => {
    const ctx = await buildSut();
    primeBase(ctx, []); // no activities at all

    const res = await ctx.sut.getDashboardCharts();

    expect(ctx.prisma._client.booking.groupBy).not.toHaveBeenCalled();
    expect(res.topActivities).toEqual([]);
  });

  test('revenue falls back to 0 when groupBy has no row for an activity', async () => {
    const ctx = await buildSut();
    primeBase(ctx, [
      { id: 'a1', titleEn: 'Has revenue', category: { nameEn: 'C' }, _count: { bookings: 2 } },
      { id: 'a2', titleEn: 'No matching', category: { nameEn: 'C' }, _count: { bookings: 1 } },
    ]);
    ctx.prisma._client.booking.groupBy.mockResolvedValueOnce([
      { activityId: 'a1', _sum: { totalPrice: 500, commissionAmount: 50 } },
      // No row for a2 — eg. the 1 booking is cancelled so groupBy skips it.
    ]);

    const res = await ctx.sut.getDashboardCharts();
    expect(res.topActivities[0]).toMatchObject({ name: 'Has revenue', revenue: 450 });
    expect(res.topActivities[1]).toMatchObject({ name: 'No matching', revenue: 0 });
  });
});
