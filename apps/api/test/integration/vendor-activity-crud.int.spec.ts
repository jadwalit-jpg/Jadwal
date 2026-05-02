/**
 * Integration — vendor.createActivity / updateActivity, vendor.replyToReview,
 * admin.deleteReview.
 *
 * Covered items:
 *   #31 Vendor activity CRUD — create, update (toggle already in prior spec)
 *   #32 Review flow — vendor responds, admin moderates (delete)
 */

import { getTestContext, seedReference } from './_setup';
import { VendorService } from '../../src/vendor/vendor.service';
import { AdminService } from '../../src/admin/admin.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { ForbiddenException, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeServices() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const notificationService = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const vendor = new VendorService(prismaSvc, notificationService, loyalty, availabilityCache);
  const admin = new AdminService(prismaSvc, notificationService, loyalty, availabilityCache);
  return { vendor, admin };
}

function baseActivityDto(seed: any, overrides: Record<string, any> = {}) {
  return {
    categoryId: seed.category.id,
    cityId: seed.city.id,
    titleEn: 'New Hourly Tour',
    titleAr: 'جولة جديدة',
    slug: 'new-hourly-tour-' + crypto.randomUUID().slice(0, 6),
    descriptionEn: 'desc',
    descriptionAr: 'وصف',
    locationAddress: 'Doha',
    locationLat: 25.28,
    locationLng: 51.53,
    bookingType: 'HOURLY',
    pricingModel: 'PER_PERSON',
    pricePerPerson: 100,
    capacity: 10,
    durationValue: 2,
    checkInTime: '09:00',
    checkOutTime: '21:00',
    coverImage: '/p.webp',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createActivity
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorService.createActivity', () => {
  test('happy path → creates activity with status=PENDING + correct vendorId/countryId', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();

    const created = await vendor.createActivity(seed.vendorUser.id, baseActivityDto(seed) as any);
    expect(created.status).toBe('PENDING'); // not ACTIVE — admin must approve
    expect(created.vendorId).toBe(seed.vendor.id);
    expect(created.countryId).toBe(seed.country.id);
  });

  test('duplicate slug → ConflictException', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const dto = baseActivityDto(seed, { slug: 'duplicate-me' }) as any;
    await vendor.createActivity(seed.vendorUser.id, dto);
    await expect(vendor.createActivity(seed.vendorUser.id, dto))
      .rejects.toThrow(ConflictException);
  });

  test('non-existent category → NotFoundException', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    await expect(vendor.createActivity(seed.vendorUser.id, baseActivityDto(seed, {
      categoryId: '00000000-0000-4000-8000-00000000aaaa',
    }) as any)).rejects.toThrow(NotFoundException);
  });

  test('city in a different country → ForbiddenException', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    // Create a second country + city in it
    const om = await ctx.prisma.country.create({
      data: {
        nameEn: 'Oman', nameAr: 'ع', isoCode: 'OM', currencyCode: 'OMR',
        defaultTimezone: 'Asia/Muscat', serviceFeeFixed: 5, status: 'ACTIVE',
      },
    });
    const omCity = await ctx.prisma.city.create({
      data: { countryId: om.id, nameEn: 'Muscat', nameAr: 'م', lat: 23, lng: 58 },
    });
    await expect(vendor.createActivity(seed.vendorUser.id, baseActivityDto(seed, {
      cityId: omCity.id,
    }) as any)).rejects.toThrow(/does not belong/i);
  });

  test('hasUnits=true computes capacity = unitCount × unitCapacity', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const created = await vendor.createActivity(seed.vendorUser.id, baseActivityDto(seed, {
      hasUnits: true, unitCount: 4, unitCapacity: 2, capacity: undefined,
    }) as any);
    // 4 × 2 = 8 effective capacity
    expect(created.capacity).toBe(8);
  });

  test('no units AND no capacity → BadRequest', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    await expect(vendor.createActivity(seed.vendorUser.id, baseActivityDto(seed, {
      hasUnits: false, capacity: 0,
    }) as any)).rejects.toThrow(BadRequestException);
  });

  test('suspended vendor cannot create activities', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({ where: { id: seed.vendor.id }, data: { status: 'SUSPENDED' } });
    const { vendor } = makeServices();
    await expect(vendor.createActivity(seed.vendorUser.id, baseActivityDto(seed) as any))
      .rejects.toThrow(/suspended/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// updateActivity — ownership + merge
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorService.updateActivity', () => {
  test('happy path updates pricePerPerson + titleEn', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();

    const updated = await vendor.updateActivity(seed.vendorUser.id, seed.activity.id, {
      titleEn: 'Updated Title',
      pricePerPerson: 150,
    } as any);
    expect(updated.titleEn).toBe('Updated Title');
    expect(Number(updated.pricePerPerson)).toBe(150);
  });

  test('other vendor cannot update → NotFoundException (IDOR-hardened, post-PR-#94)', async () => {
    // Updated 2026-05-02. Predates PR #94 (commit 101d018). Originally
    // expected "you do not own this activity"; the IDOR fix scopes
    // vendor lookups by `vendorId: vendor.id` in the `where` clause,
    // so a foreign activity is "not found" for this caller. Unifies
    // 404 and 403 responses to remove the activity-id enumeration
    // oracle. See check-security skill IDOR section.
    const seed = await seedReference(ctx.prisma);
    const otherUser = await ctx.prisma.user.create({
      data: {
        fullName: 'OV', email: `ov-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'VENDOR', emailVerified: true,
      },
    });
    await ctx.prisma.vendor.create({
      data: {
        userId: otherUser.id, businessNameEn: 'OV', businessNameAr: 'ع',
        businessId: 'BIZ-' + crypto.randomUUID().slice(0, 6),
        slug: 'ov-' + crypto.randomUUID().slice(0, 6),
        countryId: seed.country.id, status: 'ACTIVE',
      },
    });
    const { vendor } = makeServices();
    await expect(
      vendor.updateActivity(otherUser.id, seed.activity.id, { titleEn: 'X' } as any),
    ).rejects.toThrow(/not found/i);
  });

  test('unknown activity id → NotFoundException', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    await expect(
      vendor.updateActivity(seed.vendorUser.id, '00000000-0000-4000-8000-00000000aaaa', {
        titleEn: 'X',
      } as any),
    ).rejects.toThrow(NotFoundException);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Review reply + admin delete
// ═══════════════════════════════════════════════════════════════════════════

describe('Review flow — vendor reply + admin delete', () => {
  async function seedReview(seed: any) {
    return ctx.prisma.review.create({
      data: {
        customerId: seed.customer.id,
        activityId: seed.activity.id,
        rating: 4, text: 'Nice experience',
      },
    });
  }

  test('vendor can reply to a review on their own activity', async () => {
    const seed = await seedReference(ctx.prisma);
    const review = await seedReview(seed);
    const { vendor } = makeServices();

    const replied = await vendor.replyToReview(
      seed.vendorUser.id, review.id, 'Thanks for visiting!',
    );
    expect(replied.vendorReply).toBe('Thanks for visiting!');
  });

  test('other vendor cannot reply to someone else\'s review → NotFoundException (IDOR-hardened)', async () => {
    // Updated 2026-05-02. Same IDOR-fix story as the activity-update
    // test above (PR #94, commit 101d018) — the review lookup is now
    // scoped by `activity: { vendorId: vendor.id }` in the where, so
    // a foreign review returns "not found" instead of leaking via
    // "not your review". Collapses the 404/403 oracle.
    const seed = await seedReference(ctx.prisma);
    const review = await seedReview(seed);

    // Second vendor
    const ov = await ctx.prisma.user.create({
      data: {
        fullName: 'OV', email: `ov-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'VENDOR', emailVerified: true,
      },
    });
    await ctx.prisma.vendor.create({
      data: {
        userId: ov.id, businessNameEn: 'OV', businessNameAr: 'O',
        businessId: 'BIZ-' + crypto.randomUUID().slice(0, 6),
        slug: 'ov-' + crypto.randomUUID().slice(0, 6),
        countryId: seed.country.id, status: 'ACTIVE',
      },
    });

    const { vendor } = makeServices();
    await expect(vendor.replyToReview(ov.id, review.id, 'hi'))
      .rejects.toThrow(/not found/i);
  });

  test('admin deleteReview removes the row', async () => {
    const seed = await seedReference(ctx.prisma);
    const review = await seedReview(seed);
    const { admin } = makeServices();
    await admin.deleteReview(review.id);
    expect(await ctx.prisma.review.findUnique({ where: { id: review.id } })).toBeNull();
  });
});
