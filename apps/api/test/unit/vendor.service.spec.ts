/**
 * VendorService unit tests — critical paths.
 *
 * Focused on: resolveVendor gate, createCoupon conflict, createActivity guards,
 * changePassword + session revoke, requestPayout (balance, bank details),
 * updateBookingStatus notification, toggleActivityStatus admin-notify.
 */

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { VendorService } from '../../src/vendor/vendor.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationService } from '../../src/common/services/notification.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { AvailabilityCacheService } from '../../src/redis/availability-cache.service';
import { makePrismaMock, mockDecimal } from '../mocks/prisma.mock';
import {
  makeNotificationMock, makeLoyaltyMock, makeAvailabilityCacheMock,
} from '../mocks/bookings-deps.mock';

async function buildSut() {
  const prisma = makePrismaMock();
  const notif = makeNotificationMock();
  const loyalty = makeLoyaltyMock();
  const cache = makeAvailabilityCacheMock();

  const mod = await Test.createTestingModule({
    providers: [
      VendorService,
      { provide: PrismaService,             useValue: prisma },
      { provide: NotificationService,       useValue: notif },
      { provide: LoyaltyService,            useValue: loyalty },
      { provide: AvailabilityCacheService,  useValue: cache },
    ],
  }).compile();
  return { sut: mod.get(VendorService), prisma, notif, loyalty, cache };
}

// ═══════════════════════════════════════════════════════════════════════════
// resolveVendor — every vendor-scoped method calls this first
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorService.resolveVendor', () => {
  test('404 when user has no vendor profile', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.resolveVendor('u1'))
      .rejects.toThrow(NotFoundException);
  });

  test('403 when vendor is SUSPENDED (session still valid but blocked here)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({
      id: 'v1', status: 'SUSPENDED', countryId: 'QA', businessNameEn: 'Biz',
    });
    await expect(ctx.sut.resolveVendor('u1'))
      .rejects.toThrow(/suspended/i);
  });

  test('returns vendor row for ACTIVE vendor', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({
      id: 'v1', status: 'ACTIVE', countryId: 'QA', businessNameEn: 'Biz',
    });
    const r = await ctx.sut.resolveVendor('u1');
    expect(r.id).toBe('v1');
  });

  test('PENDING vendor passes through (resolveVendor only blocks SUSPENDED)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({
      id: 'v1', status: 'PENDING', countryId: 'QA', businessNameEn: 'Biz',
    });
    const r = await ctx.sut.resolveVendor('u1');
    expect(r.status).toBe('PENDING');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// changePassword — mirror of AdminService
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorService.changePassword', () => {
  test('404 when user missing', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.changePassword('u1', 'old', 'NewPw123'))
      .rejects.toThrow(NotFoundException);
  });

  test('403 for Google-only account (null password)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ id: 'u1', password: null });
    await expect(ctx.sut.changePassword('u1', 'old', 'NewPw123'))
      .rejects.toThrow(/Google sign-in/i);
  });

  test('403 when current password wrong', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', password: await bcrypt.hash('correct', 4),
    });
    await expect(ctx.sut.changePassword('u1', 'wrong', 'NewPw123'))
      .rejects.toThrow(/incorrect/i);
  });

  test('success revokes ALL refresh tokens (force re-login everywhere)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', password: await bcrypt.hash('oldpw', 4),
    });
    await ctx.sut.changePassword('u1', 'oldpw', 'NewPw123');
    expect(ctx.prisma._client.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// createCoupon — conflict detection + vendor scoping
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorService.createCoupon', () => {
  const baseDto = {
    code: 'MYCODE10', discountType: 'PERCENTAGE' as const, discountValue: 10,
    validFrom: '2026-01-01', validTo: '2026-12-31',
  };

  test('409 when code already exists globally', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({
      id: 'v1', status: 'ACTIVE', countryId: 'QA', businessNameEn: 'Biz',
    });
    ctx.prisma._client.coupon.findUnique.mockResolvedValueOnce({ id: 'existing' });

    await expect(ctx.sut.createCoupon('u1', baseDto))
      .rejects.toThrow(ConflictException);
  });

  test('creates with vendorId scoped + status=PENDING (admin approves separately)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({
      id: 'v1', status: 'ACTIVE', countryId: 'QA', businessNameEn: 'Biz',
    });
    ctx.prisma._client.coupon.findUnique.mockResolvedValueOnce(null);

    await ctx.sut.createCoupon('u1', baseDto);

    expect(ctx.prisma._client.coupon.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vendorId: 'v1',
          status: 'PENDING', // Vendor coupons require admin approval
        }),
      }),
    );
  });

  test('suspended vendor cannot create coupon (resolveVendor gate)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({
      id: 'v1', status: 'SUSPENDED', countryId: 'QA', businessNameEn: 'Biz',
    });
    await expect(ctx.sut.createCoupon('u1', baseDto))
      .rejects.toThrow(/suspended/i);
    expect(ctx.prisma._client.coupon.create).not.toHaveBeenCalled();
  });

  test('optional numeric fields default to null (not undefined)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({
      id: 'v1', status: 'ACTIVE', countryId: 'QA', businessNameEn: 'Biz',
    });
    ctx.prisma._client.coupon.findUnique.mockResolvedValueOnce(null);

    await ctx.sut.createCoupon('u1', baseDto);

    expect(ctx.prisma._client.coupon.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          usageLimit: null, minOrderAmount: null, maxDiscount: null,
        }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// requestPayout — balance + bank details + pending dedup
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorService.requestPayout', () => {
  const vendorRow = { id: 'v1', status: 'ACTIVE' as const, countryId: 'QA', businessNameEn: 'Biz' };
  // evaluatePayoutEligibility fetches status + bank + country in one read.
  // Provide a default that downstream tests can override per-scenario.
  const eligibleVendorRow = { status: 'ACTIVE' as const, bankDetails: { iban: 'QA123' }, country: { currencyCode: 'QAR' } };

  test('400 when a pending request already exists (dedup)', async () => {
    const ctx = await buildSut();
    // 1st findUnique — resolveVendor
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    // 2nd findUnique — inside evaluatePayoutEligibility
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(eligibleVendorRow);
    // Inflight check returns PENDING → block.
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce({ id: 'pending1', status: 'PENDING' });

    await expect(ctx.sut.requestPayout('u1'))
      .rejects.toThrow(/already have a pending/i);
    // No aggregate call made — short-circuit
    expect(ctx.prisma._client.booking.aggregate).not.toHaveBeenCalled();
  });

  test('400 when balance <= 0 (nothing to payout)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(eligibleVendorRow);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([]);
    ctx.prisma._client.booking.aggregate.mockResolvedValueOnce({
      _sum: { totalPrice: 0, commissionAmount: 0 },
    });

    await expect(ctx.sut.requestPayout('u1'))
      .rejects.toThrow(/no eligible cash|no available balance/i);
  });

  test('400 when vendor has no bank details (blocks before creating request)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    // bankDetails=null surfaces the NO_BANK_DETAILS branch before balance.
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({ ...eligibleVendorRow, bankDetails: null });
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);

    await expect(ctx.sut.requestPayout('u1'))
      .rejects.toThrow(/bank details/i);
    expect(ctx.prisma._client.payoutRequest.create).not.toHaveBeenCalled();
  });

  test('success: creates request with net balance + notifies admins', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(eligibleVendorRow);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([]);
    ctx.prisma._client.booking.aggregate.mockResolvedValueOnce({
      _sum: { totalPrice: 1000, commissionAmount: 100 },
    });

    await ctx.sut.requestPayout('u1');

    // Net = totalPrice - commission = 900
    expect(ctx.prisma._client.payoutRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 900, currency: 'QAR', status: 'PENDING' }),
      }),
    );
    expect(ctx.notif.notifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PAYOUT_REQUESTED' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// toggleActivityStatus — admin notification on deactivate
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorService.toggleActivityStatus', () => {
  const vendorRow = { id: 'v1', status: 'ACTIVE' as const, countryId: 'QA', businessNameEn: 'Biz' };

  test('404 when activity does not exist', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    ctx.prisma._client.activity.findFirst.mockResolvedValueOnce(null);

    await expect(ctx.sut.toggleActivityStatus('u1', 'a-missing'))
      .rejects.toThrow(NotFoundException);
  });

  test('404 when activity belongs to another vendor (IDOR collapsed to 404)', async () => {
    // Ownership baked into where → cross-vendor activities never returned.
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    ctx.prisma._client.activity.findFirst.mockResolvedValueOnce(null);

    await expect(ctx.sut.toggleActivityStatus('u1', 'a1'))
      .rejects.toThrow(NotFoundException);
    expect(ctx.prisma._client.activity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'a1', vendorId: 'v1' }) }),
    );
  });

  test('ACTIVE → INACTIVE triggers admin notification', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    ctx.prisma._client.activity.findFirst.mockResolvedValueOnce({
      id: 'a1', vendorId: 'v1', status: 'ACTIVE', titleEn: 'Tour',
    });
    ctx.prisma._client.activity.update.mockResolvedValueOnce({
      id: 'a1', status: 'INACTIVE', titleEn: 'Tour',
    });

    await ctx.sut.toggleActivityStatus('u1', 'a1');

    expect(ctx.notif.notifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Activity Deactivated' }),
    );
  });

  test('INACTIVE → ACTIVE does NOT trigger admin notification', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    ctx.prisma._client.activity.findFirst.mockResolvedValueOnce({
      id: 'a1', vendorId: 'v1', status: 'INACTIVE', titleEn: 'Tour',
    });
    ctx.prisma._client.activity.update.mockResolvedValueOnce({
      id: 'a1', status: 'ACTIVE', titleEn: 'Tour',
    });

    await ctx.sut.toggleActivityStatus('u1', 'a1');
    expect(ctx.notif.notifyAdmins).not.toHaveBeenCalled();
  });

  test('deactivation blocked when future bookings exist (no data loss)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    ctx.prisma._client.activity.findFirst.mockResolvedValueOnce({
      id: 'a1', vendorId: 'v1', status: 'ACTIVE', titleEn: 'Tour',
    });
    ctx.prisma._client.booking.count.mockResolvedValueOnce(3);

    await expect(ctx.sut.toggleActivityStatus('u1', 'a1'))
      .rejects.toThrow(/upcoming booking/i);
    expect(ctx.prisma._client.activity.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// replyToReview — ownership + length
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorService.replyToReview', () => {
  const vendorRow = { id: 'v1', status: 'ACTIVE' as const, countryId: 'QA', businessNameEn: 'Biz' };

  test('404 when review does not exist', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    ctx.prisma._client.review.findFirst.mockResolvedValueOnce(null);

    await expect(ctx.sut.replyToReview('u1', 'rv-missing', 'Thanks!'))
      .rejects.toThrow(NotFoundException);
  });

  test('404 when review is on another vendor\'s activity (IDOR collapsed to 404)', async () => {
    // Ownership scope is `activity.vendorId` baked into the where clause —
    // foreign-vendor reviews never reach the service body.
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    ctx.prisma._client.review.findFirst.mockResolvedValueOnce(null);

    await expect(ctx.sut.replyToReview('u1', 'rv1', 'Thanks!'))
      .rejects.toThrow(NotFoundException);
    expect(ctx.prisma._client.review.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'rv1', activity: { vendorId: 'v1' } }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getSettings — privacy-scoped select
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorService.getSettings', () => {
  test('queries vendor row directly by userId (no resolveVendor gate)', async () => {
    // Note: getSettings does NOT go through resolveVendor — a suspended vendor
    // can still view their settings (read-only). updateSettings DOES gate.
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({
      businessNameEn: 'Biz', bankDetails: {},
    });

    await ctx.sut.getSettings('u1');
    expect(ctx.prisma._client.vendor.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
  });

  test('updateSettings DOES go through resolveVendor (SUSPENDED vendor blocked)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({
      id: 'v1', status: 'SUSPENDED', countryId: 'QA', businessNameEn: 'Biz',
    });
    await expect(ctx.sut.updateSettings('u1', { businessNameEn: 'Hacker' }))
      .rejects.toThrow(/suspended/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// updateBookingStatus — Complete guard (no early completion)
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorService.updateBookingStatus — Complete guard', () => {
  const vendorRow = { id: 'v1', status: 'ACTIVE' as const, countryId: 'QA', businessNameEn: 'Biz' };

  test('rejects COMPLETED when booking.endDatetime is in the future', async () => {
    const ctx = await buildSut();
    // Real LoyaltyService method is `earn` — shared mock doesn't expose it yet,
    // so we attach a spy locally to assert it was NOT called by the guard path.
    (ctx.loyalty as any).earn = jest.fn().mockResolvedValue(undefined);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', ref: 'JDWL-FUT', vendorId: 'v1', activityId: 'a1',
      customerId: 'c1', status: 'CONFIRMED',
      totalPrice: 100, pointsRedeemed: 0, pointsAwarded: false,
      // 1 hour from now → guard must fire
      endDatetime: new Date(Date.now() + 60 * 60 * 1000),
      activity: { titleEn: 'Tour' },
      payment: { id: 'p1', status: 'SUCCESS', amount: 100 },
    });

    await expect(ctx.sut.updateBookingStatus('u1', 'b1', 'COMPLETED'))
      .rejects.toThrow(ForbiddenException);

    // No update attempted — nothing should have been mutated.
    expect(ctx.prisma._client.booking.update).not.toHaveBeenCalled();
    expect(ctx.prisma._client.payment.update).not.toHaveBeenCalled();
    expect((ctx.loyalty as any).earn).not.toHaveBeenCalled();
  });

  test('allows COMPLETED when booking.endDatetime has passed', async () => {
    const ctx = await buildSut();
    (ctx.loyalty as any).earn = jest.fn().mockResolvedValue(undefined);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', ref: 'JDWL-PAST', vendorId: 'v1', activityId: 'a1',
      customerId: 'c1', status: 'CONFIRMED',
      totalPrice: 100, pointsRedeemed: 0, pointsAwarded: false,
      // 1 minute ago → transition allowed
      endDatetime: new Date(Date.now() - 60_000),
      activity: { titleEn: 'Tour' },
      payment: { id: 'p1', status: 'SUCCESS', amount: 100 },
    });
    ctx.prisma._client.booking.update.mockResolvedValueOnce({ id: 'b1', status: 'COMPLETED' });
    ctx.prisma._client.loyaltyConfig.findUnique.mockResolvedValueOnce({ pointsPerQar: mockDecimal(1), qarPerPoint: mockDecimal(1) });

    const res = await ctx.sut.updateBookingStatus('u1', 'b1', 'COMPLETED');
    expect(res).toMatchObject({ status: 'COMPLETED' });
    expect(ctx.prisma._client.booking.update).toHaveBeenCalled();
  });

  test('CANCELLED is NOT gated by endDatetime (vendor can cancel future bookings)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(vendorRow);
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', ref: 'JDWL-FUT', vendorId: 'v1', activityId: 'a1',
      customerId: 'c1', status: 'CONFIRMED',
      totalPrice: 100, pointsRedeemed: 0, pointsAwarded: false,
      endDatetime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days out
      activity: { titleEn: 'Tour' },
      payment: null,
    });
    ctx.prisma._client.booking.update.mockResolvedValueOnce({ id: 'b1', status: 'CANCELLED' });

    // Future booking — but CANCELLED must succeed (customer no-show, etc.)
    const res = await ctx.sut.updateBookingStatus('u1', 'b1', 'CANCELLED');
    expect(res).toMatchObject({ status: 'CANCELLED' });
  });
});
