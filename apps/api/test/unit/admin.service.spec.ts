/**
 * AdminService unit tests — critical paths only.
 *
 * Focused on: loyalty config, adjustUserPoints, hard-delete guards (user +
 * vendor), updateVendorStatus suspend cascade, changeAdminPassword, coupon
 * validation. Straight CRUD reads are thin wrappers over Prisma and are
 * deferred to integration.
 */

import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
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
  // LoyaltyService needs extra methods for admin; extend
  const loyalty = { ...makeLoyaltyMock(), adjust: jest.fn().mockResolvedValue({ appliedDelta: 100 }) };
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

  return { sut: mod.get(AdminService), prisma, notif, loyalty, cache, refCache };
}

// ═══════════════════════════════════════════════════════════════════════════
// changeAdminPassword — requires current password + revokes all sessions
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.changeAdminPassword', () => {
  test('404 when admin user not found', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.changeAdminPassword('u1', 'old', 'New123!@#'))
      .rejects.toThrow(NotFoundException);
  });

  test('403 for Google-only admin (no password)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ id: 'u1', password: null });
    await expect(ctx.sut.changeAdminPassword('u1', 'old', 'New123!@#'))
      .rejects.toThrow(/Google sign-in/i);
  });

  test('403 when current password wrong', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', password: await bcrypt.hash('correct', 4),
    });
    await expect(ctx.sut.changeAdminPassword('u1', 'wrong', 'New123!@#'))
      .rejects.toThrow(/current password is incorrect/i);
  });

  test('success hashes new password + revokes ALL refresh tokens (force re-login)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', password: await bcrypt.hash('oldpw', 4),
    });
    await ctx.sut.changeAdminPassword('u1', 'oldpw', 'NewPw123!@#');

    // Transaction used — password update + refreshToken.deleteMany
    expect(ctx.prisma.$transaction).toHaveBeenCalled();
    expect(ctx.prisma._client.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ password: expect.any(String) }) }),
    );
    expect(ctx.prisma._client.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Loyalty config + user points
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.getLoyaltyConfig — auto-creates singleton', () => {
  test('creates singleton row on first call', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.loyaltyConfig.findUnique.mockResolvedValueOnce(null);
    ctx.prisma._client.loyaltyConfig.create.mockResolvedValueOnce({ id: 'singleton', pointsPerQar: 1 });
    const r = await ctx.sut.getLoyaltyConfig();
    expect(ctx.prisma._client.loyaltyConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { id: 'singleton' } }),
    );
    expect((r as any).id).toBe('singleton');
  });

  test('returns existing row on subsequent calls (no double-create)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.loyaltyConfig.findUnique.mockResolvedValueOnce({ id: 'singleton', pointsPerQar: 2 });
    await ctx.sut.getLoyaltyConfig();
    expect(ctx.prisma._client.loyaltyConfig.create).not.toHaveBeenCalled();
  });
});

describe('AdminService.updateLoyaltyConfig', () => {
  test('upserts against id=singleton (never creates a second row)', async () => {
    const ctx = await buildSut();
    await ctx.sut.updateLoyaltyConfig({ pointsPerQar: 2, qarPerPoint: 0.05 });
    expect(ctx.prisma._client.loyaltyConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'singleton' } }),
    );
  });
});

describe('AdminService.adjustUserPoints', () => {
  test('404 when target user missing', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.adjustUserPoints('u-missing', 100, 'gift', 'admin-1'))
      .rejects.toThrow(NotFoundException);
    expect(ctx.loyalty.adjust).not.toHaveBeenCalled();
  });

  test('delegates to LoyaltyService.adjust with actorType=ADMIN + actorId', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ id: 'u1' });
    ctx.prisma._client.user.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'u1', fullName: 'A', loyaltyPoints: 200,
    });

    const r = await ctx.sut.adjustUserPoints('u1', 100, 'welcome bonus', 'admin-1');

    expect(ctx.loyalty.adjust).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'u1',
        delta: 100,
        actorType: 'ADMIN',
        actorId: 'admin-1',
        reason: 'welcome bonus',
      }),
    );
    expect(r).toMatchObject({ id: 'u1', loyaltyPoints: 200, appliedDelta: 100 });
  });

  test('wraps everything in $transaction (atomicity)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ id: 'u1' });
    ctx.prisma._client.user.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'u1', fullName: 'A', loyaltyPoints: 0,
    });

    await ctx.sut.adjustUserPoints('u1', 10, 'fix', 'admin-1');
    expect(ctx.prisma.$transaction).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// deleteUser — hard-delete guard + cascades
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.deleteUser', () => {
  test('404 when user does not exist', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.deleteUser('u-missing'))
      .rejects.toThrow(NotFoundException);
  });

  test('403 when target is ADMIN role', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ id: 'u1', fullName: 'A', role: 'ADMIN' });
    await expect(ctx.sut.deleteUser('u1'))
      .rejects.toThrow(/Cannot delete admin/i);
  });

  test('403 when user has unresolved customer bookings (PENDING/CONFIRMED)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ id: 'u1', fullName: 'A', role: 'CUSTOMER' });
    ctx.prisma._client.booking.count.mockResolvedValueOnce(3); // asCustomer
    ctx.prisma._client.booking.count.mockResolvedValueOnce(0); // asVendor

    await expect(ctx.sut.deleteUser('u1'))
      .rejects.toThrow(/unresolved booking/i);
    // No transaction ran
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  test('403 when user is a vendor with unresolved bookings as vendor', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ id: 'u1', fullName: 'V', role: 'VENDOR' });
    ctx.prisma._client.booking.count.mockResolvedValueOnce(0); // asCustomer
    ctx.prisma._client.booking.count.mockResolvedValueOnce(5); // asVendor

    const err = await ctx.sut.deleteUser('u1').catch(e => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toMatch(/5 as vendor/i);
  });

  test('guard message suggests cancel/suspend BEFORE destructive delete', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ id: 'u1', fullName: 'V', role: 'VENDOR' });
    ctx.prisma._client.booking.count.mockResolvedValueOnce(1);
    ctx.prisma._client.booking.count.mockResolvedValueOnce(1);

    const err = await ctx.sut.deleteUser('u1').catch(e => e);
    expect(err.message).toMatch(/Cancel or refund them first/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// deleteVendor — hard-delete guard
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.deleteVendor', () => {
  test('404 when vendor missing', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.deleteVendor('ven-missing'))
      .rejects.toThrow(NotFoundException);
  });

  test('403 when vendor has unresolved bookings (customers would lose money)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({
      id: 'v1', userId: 'u1', businessNameEn: 'Biz',
    });
    ctx.prisma._client.booking.count.mockResolvedValueOnce(2);

    const err = await ctx.sut.deleteVendor('v1').catch(e => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toMatch(/Suspend the vendor first/i);
  });

  test('happy path: zero bookings → runs cascade $transaction', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({
      id: 'v1', userId: 'u1', businessNameEn: 'Biz',
    });
    ctx.prisma._client.booking.count.mockResolvedValueOnce(0);

    await ctx.sut.deleteVendor('v1');
    expect(ctx.prisma.$transaction).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// updateVendorStatus — suspend cascade + notification
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.updateVendorStatus', () => {
  test('ACTIVE status → notifies vendor with VENDOR_APPROVED + slug-scoped dashboard link', async () => {
    const ctx = await buildSut();
    // `slug` must travel through the returned vendor so the notification
    // link resolves to a real route — vendor portal lives under
    // /vendor/[slug]/*, so the bare `/vendor/dashboard` it used to emit
    // would 404 for the recipient.
    ctx.prisma._client.vendor.update.mockResolvedValueOnce({
      id: 'v1', status: 'ACTIVE', slug: 'acme-tours',
      user: { id: 'u1', fullName: 'V', email: 'v@b.com' },
    });

    await ctx.sut.updateVendorStatus('v1', 'ACTIVE');

    expect(ctx.notif.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        type: 'VENDOR_APPROVED',
        link: '/vendor/acme-tours/dashboard',
      }),
    );
  });

  test('SUSPENDED status → kills all refresh tokens + notifies VENDOR_SUSPENDED', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.update.mockResolvedValueOnce({
      id: 'v1', status: 'SUSPENDED', user: { id: 'u1', fullName: 'V', email: 'v@b.com' },
    });

    await ctx.sut.updateVendorStatus('v1', 'SUSPENDED');

    expect(ctx.prisma._client.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(ctx.notif.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'VENDOR_SUSPENDED' }),
    );
  });

  test('SUSPENDED without adminUserId → skips cascade (old callers)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.update.mockResolvedValueOnce({
      id: 'v1', status: 'SUSPENDED', user: { id: 'u1', fullName: 'V', email: 'v@b.com' },
    });

    await ctx.sut.updateVendorStatus('v1', 'SUSPENDED'); // no adminUserId

    // activity.findMany for cascade should NOT be called
    expect(ctx.prisma._client.activity.findMany).not.toHaveBeenCalled();
  });

  test('SUSPENDED + adminUserId → runs cascade (yanks activities + cancels future bookings)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.update.mockResolvedValueOnce({
      id: 'v1', status: 'SUSPENDED', user: { id: 'u1', fullName: 'V', email: 'v@b.com' },
    });
    // Two active activities
    ctx.prisma._client.activity.findMany.mockResolvedValueOnce([
      { id: 'a1', titleEn: 'Tour 1' },
      { id: 'a2', titleEn: 'Tour 2' },
    ]);
    // cascadeCancelFutureBookings queries: booking.findMany (future), then per-booking tx ops
    ctx.prisma._client.booking.findMany.mockResolvedValue([]); // no future bookings

    await ctx.sut.updateVendorStatus('v1', 'SUSPENDED', 'admin-1');

    // Activities marked INACTIVE — two update calls
    expect(ctx.prisma._client.activity.update).toHaveBeenCalledTimes(2);
    expect(ctx.prisma._client.activity.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1' }, data: { status: 'INACTIVE' } }),
    );
  });

  test('status change to neutral (e.g. PENDING) sends no notification', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.update.mockResolvedValueOnce({
      id: 'v1', status: 'PENDING', user: { id: 'u1', fullName: 'V', email: 'v@b.com' },
    });

    await ctx.sut.updateVendorStatus('v1', 'PENDING');
    expect(ctx.notif.send).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// updateVendorTrust / Commission — pure writes
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.updateVendorCommission', () => {
  test('null/undefined → stored as null (not kept as undefined)', async () => {
    const ctx = await buildSut();
    await ctx.sut.updateVendorCommission('v1', null);
    expect(ctx.prisma._client.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { commissionPct: null } }),
    );
  });

  test('numeric value → stored as-is', async () => {
    const ctx = await buildSut();
    await ctx.sut.updateVendorCommission('v1', 12);
    expect(ctx.prisma._client.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { commissionPct: 12 } }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// createCoupon — DTO guards
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.createCoupon', () => {
  const baseDto = {
    code: 'save10',
    discountType: 'PERCENTAGE' as const,
    discountValue: 10,
    validFrom: new Date(Date.now() - 1000).toISOString(),
    validTo: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };

  test('400 when PERCENTAGE discount > 100', async () => {
    const ctx = await buildSut();
    await expect(ctx.sut.createCoupon({ ...baseDto, discountValue: 150 } as any))
      .rejects.toThrow(/cannot exceed 100/i);
  });

  test('400 when validTo <= validFrom', async () => {
    const ctx = await buildSut();
    await expect(ctx.sut.createCoupon({
      ...baseDto,
      validFrom: new Date(Date.now() + 1000).toISOString(),
      validTo: new Date(Date.now()).toISOString(),
    } as any)).rejects.toThrow(/after the start date/i);
  });

  test('400 when code already exists (case-insensitive)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.coupon.findUnique.mockResolvedValueOnce({ id: 'existing' });
    await expect(ctx.sut.createCoupon(baseDto as any))
      .rejects.toThrow(/already exists/i);
    // Check was done on uppercased code
    expect(ctx.prisma._client.coupon.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: 'SAVE10' } }),
    );
  });

  test('happy path → creates with uppercased code + APPROVED status + optional nulls', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.coupon.findUnique.mockResolvedValueOnce(null);

    await ctx.sut.createCoupon(baseDto as any);

    expect(ctx.prisma._client.coupon.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'SAVE10',         // upper-cased
          status: 'APPROVED',
          usageLimit: null,
          minOrderAmount: null,
          maxDiscount: null,
        }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getLoyaltyUsers — sort DTO whitelist (desc/asc) + default
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.getLoyaltyUsers — sort param', () => {
  test('defaults to desc when sort omitted', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findMany.mockResolvedValueOnce([]);
    ctx.prisma._client.user.count.mockResolvedValueOnce(0);

    await ctx.sut.getLoyaltyUsers({} as any);

    const findCall = ctx.prisma._client.user.findMany.mock.calls[0]?.[0];
    expect(findCall.orderBy).toEqual({ loyaltyPoints: 'desc' });
  });

  test('honours sort="asc" from the DTO', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findMany.mockResolvedValueOnce([]);
    ctx.prisma._client.user.count.mockResolvedValueOnce(0);

    await ctx.sut.getLoyaltyUsers({ sort: 'asc' } as any);

    const findCall = ctx.prisma._client.user.findMany.mock.calls[0]?.[0];
    expect(findCall.orderBy).toEqual({ loyaltyPoints: 'asc' });
  });

  test('honours sort="desc" explicitly', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findMany.mockResolvedValueOnce([]);
    ctx.prisma._client.user.count.mockResolvedValueOnce(0);

    await ctx.sut.getLoyaltyUsers({ sort: 'desc' } as any);

    const findCall = ctx.prisma._client.user.findMany.mock.calls[0]?.[0];
    expect(findCall.orderBy).toEqual({ loyaltyPoints: 'desc' });
  });

  test('always filters by role=CUSTOMER (vendor/admin accounts excluded from loyalty list)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.user.findMany.mockResolvedValueOnce([]);
    ctx.prisma._client.user.count.mockResolvedValueOnce(0);

    await ctx.sut.getLoyaltyUsers({} as any);

    const findCall = ctx.prisma._client.user.findMany.mock.calls[0]?.[0];
    expect(findCall.where).toEqual(expect.objectContaining({ role: 'CUSTOMER' }));
  });
});
