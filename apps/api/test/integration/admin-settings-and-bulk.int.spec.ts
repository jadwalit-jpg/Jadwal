/**
 * Integration — admin settings + trending events + loyalty config + bulk ops.
 *
 * Covered items from the gap list:
 *   #33 Platform settings upsert + commission override
 *   #34 Loyalty config update (admin PATCH)
 *   #35 Trending events CRUD
 *   #36 Admin bulk operations — bulk vendor status, bulk activity status, bulk user delete
 */

import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';
import { makeSessionDenylistMock } from '../mocks/auth-deps.mock';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeAdmin() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  return new AdminService(
    prismaSvc,
    { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn(), sendToMany: jest.fn() } as any,
    loyalty,
    { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any,
    { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any,
    makeSessionDenylistMock() as any,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Platform settings
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService platform settings', () => {
  test('updatePlatformSettings upserts the singleton with new defaultCommissionPct', async () => {
    await seedReference(ctx.prisma);
    const admin = makeAdmin();

    const first = await admin.updatePlatformSettings({ defaultCommissionPct: 12.5 } as any);
    expect(first.id).toBe('default');
    expect(Number(first.defaultCommissionPct)).toBe(12.5);

    // Second call updates existing row, not create
    const second = await admin.updatePlatformSettings({ defaultCommissionPct: 15 } as any);
    expect(Number(second.defaultCommissionPct)).toBe(15);

    // Only one row in the table
    const count = await ctx.prisma.platformSettings.count();
    expect(count).toBe(1);
  });

  test('updateCommissionSettings convenience method hits the same singleton', async () => {
    await seedReference(ctx.prisma);
    const admin = makeAdmin();
    await admin.updateCommissionSettings(8);
    const stored = await admin.getCommissionSettings();
    expect(Number(stored.defaultCommissionPct)).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Loyalty config
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService loyalty config', () => {
  test('getLoyaltyConfig lazily creates the singleton row when missing', async () => {
    await seedReference(ctx.prisma);
    const admin = makeAdmin();

    expect(await ctx.prisma.loyaltyConfig.count()).toBe(0);
    const cfg = await admin.getLoyaltyConfig();
    expect(cfg.id).toBe('singleton');
    expect(await ctx.prisma.loyaltyConfig.count()).toBe(1);
  });

  test('updateLoyaltyConfig modifies qarPerPoint and pointsPerQar', async () => {
    await seedReference(ctx.prisma);
    const admin = makeAdmin();
    await admin.updateLoyaltyConfig({ qarPerPoint: 0.02, pointsPerQar: 2 });
    const cfg = await ctx.prisma.loyaltyConfig.findUniqueOrThrow({ where: { id: 'singleton' } });
    // Decimal fields come back as Prisma.Decimal (or string in pg-driver
    // mode) — coerce via Number() so the equality check works in both
    // Prisma 6 (Decimal.js) and Prisma 7 + pg adapter (string).
    expect(Number(cfg.qarPerPoint)).toBe(0.02);
    expect(Number(cfg.pointsPerQar)).toBe(2);
  });

  test('updateLoyaltyConfig is idempotent upsert — doesn\'t create duplicate rows', async () => {
    await seedReference(ctx.prisma);
    const admin = makeAdmin();
    await admin.updateLoyaltyConfig({ qarPerPoint: 0.01 });
    await admin.updateLoyaltyConfig({ qarPerPoint: 0.03 });
    await admin.updateLoyaltyConfig({ pointsPerQar: 5 });
    expect(await ctx.prisma.loyaltyConfig.count()).toBe(1);
    const cfg = await ctx.prisma.loyaltyConfig.findUniqueOrThrow({ where: { id: 'singleton' } });
    expect(Number(cfg.qarPerPoint)).toBe(0.03);
    expect(Number(cfg.pointsPerQar)).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Trending events CRUD
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService trending events — CRUD', () => {
  test('create → list → update → delete round-trip', async () => {
    const seed = await seedReference(ctx.prisma);
    const admin = makeAdmin();

    // CREATE — schema: titleEn, titleAr, description (single), image?, eventDate?, countryId?, isActive
    const created = await admin.createTrendingEvent({
      titleEn: 'National Day',
      titleAr: 'العيد الوطني',
      description: 'Celebrate the national day',
      eventDate: new Date('2030-12-18'),
      countryId: seed.country.id,
      isActive: true,
    } as any);
    expect(created.id).toBeDefined();
    expect(created.titleEn).toBe('National Day');

    // LIST
    const list = await admin.getTrendingEvents();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);

    // UPDATE
    const updated = await admin.updateTrendingEvent(created.id, {
      titleEn: 'National Day 2030',
    } as any);
    expect(updated.titleEn).toBe('National Day 2030');

    // DELETE
    await admin.deleteTrendingEvent(created.id);
    expect(await ctx.prisma.trendingEvent.count()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bulk ops
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService bulk operations', () => {
  test('bulkUpdateVendorStatus flips many vendors in one call', async () => {
    const seed = await seedReference(ctx.prisma);
    // Seed 3 extra vendor users + vendors
    const extraVendorIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const u = await ctx.prisma.user.create({
        data: {
          fullName: `V${i}`, email: `v${i}-${crypto.randomUUID().slice(0, 6)}@t.com`,
          password: '$2b$10$dummy', role: 'VENDOR', emailVerified: true,
        },
      });
      const v = await ctx.prisma.vendor.create({
        data: {
          userId: u.id, businessNameEn: `Biz${i}`, businessNameAr: `ب${i}`,
          businessId: `BIZ-B${i}-${crypto.randomUUID().slice(0, 6)}`,
          slug: `biz-${i}-${crypto.randomUUID().slice(0, 6)}`,
          countryId: seed.country.id, status: 'ACTIVE',
        },
      });
      extraVendorIds.push(v.id);
    }

    const admin = makeAdmin();
    const { updated } = await admin.bulkUpdateVendorStatus(extraVendorIds, 'SUSPENDED');
    expect(updated).toBe(3);

    for (const id of extraVendorIds) {
      const v = await ctx.prisma.vendor.findUniqueOrThrow({ where: { id } });
      expect(v.status).toBe('SUSPENDED');
    }
    // Seed vendor unchanged
    const stillActive = await ctx.prisma.vendor.findUniqueOrThrow({ where: { id: seed.vendor.id } });
    expect(stillActive.status).toBe('ACTIVE');
  });

  test('bulkUpdateActivityStatus flips many activities', async () => {
    const seed = await seedReference(ctx.prisma);
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const a = await ctx.prisma.activity.create({
        data: {
          vendorId: seed.vendor.id, categoryId: seed.category.id,
          countryId: seed.country.id, cityId: seed.city.id,
          titleEn: `A${i}`, titleAr: `ن${i}`,
          slug: `a-${i}-${crypto.randomUUID().slice(0, 6)}`,
          descriptionEn: 'd', descriptionAr: 'د', locationAddress: 'x',
          locationLat: 25, locationLng: 51,
          bookingType: 'HOURLY', pricingModel: 'PER_PERSON',
          pricePerPerson: 50, capacity: 5, durationValue: 2,
          checkInTime: '09:00', checkOutTime: '21:00',
          coverImage: '/p.webp', status: 'ACTIVE',
        },
      });
      ids.push(a.id);
    }
    const admin = makeAdmin();
    const { updated } = await admin.bulkUpdateActivityStatus(ids, 'INACTIVE');
    expect(updated).toBe(2);
  });

  test('bulkDeleteUsers removes non-admin users and rejects when any admin is in the set', async () => {
    await seedReference(ctx.prisma);
    // Create 2 customers + 1 admin
    const customers: string[] = [];
    for (let i = 0; i < 2; i++) {
      const u = await ctx.prisma.user.create({
        data: {
          fullName: `C${i}`, email: `bc${i}-${crypto.randomUUID().slice(0, 6)}@t.com`,
          password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
        },
      });
      customers.push(u.id);
    }
    const adminUser = await ctx.prisma.user.create({
      data: {
        fullName: 'A', email: `a-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'ADMIN', emailVerified: true,
      },
    });

    const admin = makeAdmin();

    // Happy path: delete 2 customers
    const r1 = await admin.bulkDeleteUsers(customers);
    expect(r1.deleted).toBe(2);

    // Fail path: include admin → ForbiddenException
    await expect(
      admin.bulkDeleteUsers([adminUser.id]),
    ).rejects.toThrow(ForbiddenException);
  });
});
