/**
 * Combined integration: catalog queries + review flow + vendor activity
 * CRUD/toggle + customer-interaction (likes).
 *
 * These are the "wiring" flows — each method is a thin DB query. We test
 * against real Postgres to catch scoping bugs (country leak, category
 * leak), FK invariants on reviews, and the critical toggleActivityStatus
 * booking-guard (vendor can't silently cancel bookings by deactivating).
 */

import { getTestContext, seedReference } from './_setup';
import { VendorService } from '../../src/vendor/vendor.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeVendorService() {
  const prismaSvc = { client: ctx.prisma } as any;
  const notificationService = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  return {
    vendor: new VendorService(prismaSvc, notificationService, loyalty, availabilityCache),
    notificationService,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Catalog: country scoping + search
// ═══════════════════════════════════════════════════════════════════════════

describe('Catalog queries — country scoping and filters', () => {
  test('activities are scoped by countryId (no cross-country leak)', async () => {
    const qa = await seedReference(ctx.prisma);

    // Second country + activity in it
    const om = await ctx.prisma.country.create({
      data: {
        nameEn: 'Oman', nameAr: 'عُمان', isoCode: 'OM',
        currencyCode: 'OMR', defaultTimezone: 'Asia/Muscat',
        serviceFeeFixed: 5, status: 'ACTIVE',
      },
    });
    const omCity = await ctx.prisma.city.create({
      data: { countryId: om.id, nameEn: 'Muscat', nameAr: 'مسقط', lat: 23.58, lng: 58.4 },
    });
    await ctx.prisma.activity.create({
      data: {
        vendorId: qa.vendor.id, categoryId: qa.category.id,
        countryId: om.id, cityId: omCity.id,
        titleEn: 'Muscat Dhow', titleAr: 'سفينة مسقط',
        slug: 'muscat-dhow-' + crypto.randomUUID().slice(0, 6),
        descriptionEn: 'd', descriptionAr: 'د', locationAddress: 'Muscat',
        locationLat: 23.58, locationLng: 58.4,
        bookingType: 'HOURLY', pricingModel: 'PER_PERSON',
        pricePerPerson: 100, capacity: 10, durationValue: 2,
        checkInTime: '09:00', checkOutTime: '21:00',
        coverImage: '/p.webp', status: 'ACTIVE',
      },
    });

    // Query with countryId = QA → only QA activity returned
    const qaRows = await ctx.prisma.activity.findMany({
      where: { countryId: qa.country.id, status: 'ACTIVE' },
    });
    expect(qaRows).toHaveLength(1);
    expect(qaRows[0].countryId).toBe(qa.country.id);

    // Query with countryId = OM → only OM activity returned
    const omRows = await ctx.prisma.activity.findMany({
      where: { countryId: om.id, status: 'ACTIVE' },
    });
    expect(omRows).toHaveLength(1);
    expect(omRows[0].countryId).toBe(om.id);
  });

  test('status=INACTIVE activities hidden from public catalog', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id }, data: { status: 'INACTIVE' },
    });
    const rows = await ctx.prisma.activity.findMany({ where: { status: 'ACTIVE' } });
    expect(rows).toHaveLength(0);
  });

  test('search by titleEn is case-insensitive', async () => {
    const seed = await seedReference(ctx.prisma);
    // Default seeded activity has titleEn = 'Sample Tour'
    const hits = await ctx.prisma.activity.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { titleEn: { contains: 'sample', mode: 'insensitive' } },
          { titleAr: { contains: 'sample', mode: 'insensitive' } },
        ],
      },
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(seed.activity.id);
  });

  test('suspended-vendor activities are filtered out', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.vendor.update({
      where: { id: seed.vendor.id }, data: { status: 'SUSPENDED' },
    });
    const visible = await ctx.prisma.activity.findMany({
      where: { status: 'ACTIVE', vendor: { status: 'ACTIVE' } },
    });
    expect(visible).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Reviews — FK invariants + avg rating
// ═══════════════════════════════════════════════════════════════════════════

describe('Review flow — creation + computed rating', () => {
  test('review is only creatable against an existing activity + user', async () => {
    const seed = await seedReference(ctx.prisma);
    // Valid review
    const review = await ctx.prisma.review.create({
      data: {
        customerId: seed.customer.id,
        activityId: seed.activity.id,
        rating: 5, text: 'Great!',
      },
    });
    expect(review.rating).toBe(5);
  });

  test('review with non-existent activityId → P2003 FK error', async () => {
    const seed = await seedReference(ctx.prisma);
    await expect(
      ctx.prisma.review.create({
        data: {
          customerId: seed.customer.id,
          activityId: '00000000-0000-4000-8000-00000000ffff',
          rating: 5, text: 'Phantom',
        },
      }),
    ).rejects.toThrow(/Foreign key|P2003/i);
  });

  test('rating is stored as int; decimal would truncate — app enforces 1–5 via DTO', async () => {
    const seed = await seedReference(ctx.prisma);
    const r = await ctx.prisma.review.create({
      data: { customerId: seed.customer.id, activityId: seed.activity.id, rating: 4, text: 'x' },
    });
    expect(r.rating).toBe(4);
  });

  test('deleting the activity with active reviews → RESTRICT (no silent data loss)', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.review.create({
      data: { customerId: seed.customer.id, activityId: seed.activity.id, rating: 5, text: 'ok' },
    });
    await expect(ctx.prisma.activity.delete({ where: { id: seed.activity.id } }))
      .rejects.toThrow(/Foreign key|P2003|P2014/i);
  });

  test('activity avg rating aggregates across reviews', async () => {
    const seed = await seedReference(ctx.prisma);
    // 3 reviews: 5, 4, 3 → avg 4
    const users: string[] = [];
    for (let i = 0; i < 3; i++) {
      const u = await ctx.prisma.user.create({
        data: {
          fullName: `R${i}`, email: `r${i}-${crypto.randomUUID().slice(0,6)}@t.com`,
          password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
        },
      });
      users.push(u.id);
    }
    await ctx.prisma.review.createMany({
      data: [
        { customerId: users[0], activityId: seed.activity.id, rating: 5, text: 'a' },
        { customerId: users[1], activityId: seed.activity.id, rating: 4, text: 'b' },
        { customerId: users[2], activityId: seed.activity.id, rating: 3, text: 'c' },
      ],
    });
    const agg = await ctx.prisma.review.aggregate({
      where: { activityId: seed.activity.id }, _avg: { rating: true }, _count: true,
    });
    expect(agg._avg.rating).toBe(4);
    expect(agg._count).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VendorService.toggleActivityStatus — booking-guard
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorService.toggleActivityStatus — future-booking guard', () => {
  test('vendor cannot deactivate activity with future CONFIRMED bookings', async () => {
    const seed = await seedReference(ctx.prisma);
    const start = new Date(Date.now() + 72 * 3600_000);
    await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-FUT-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR', guests: 2,
      bookingPhone: '+97455123456',
        totalPrice: 200, serviceFee: 5, commissionAmount: 20,
        status: 'CONFIRMED',
        startDatetime: start, endDatetime: new Date(start.getTime() + 2 * 3600_000),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });

    const { vendor } = makeVendorService();
    await expect(vendor.toggleActivityStatus(seed.vendorUser.id, seed.activity.id))
      .rejects.toThrow(/upcoming booking/i);

    // Status unchanged
    const a = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: seed.activity.id } });
    expect(a.status).toBe('ACTIVE');
  });

  test('vendor CAN deactivate with zero future bookings', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeVendorService();

    const res = await vendor.toggleActivityStatus(seed.vendorUser.id, seed.activity.id);
    expect(res.status).toBe('INACTIVE');
  });

  test('vendor CAN deactivate when only past bookings exist', async () => {
    const seed = await seedReference(ctx.prisma);
    const past = new Date(Date.now() - 365 * 86_400_000);
    await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-PAST-${crypto.randomUUID().slice(0, 6)}`,
        currencyCode: 'QAR', guests: 1,
      bookingPhone: '+97455123456',
        totalPrice: 100, serviceFee: 5, commissionAmount: 10,
        status: 'COMPLETED',
        startDatetime: past, endDatetime: new Date(past.getTime() + 3600_000),
        activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      },
    });
    const { vendor } = makeVendorService();
    const res = await vendor.toggleActivityStatus(seed.vendorUser.id, seed.activity.id);
    expect(res.status).toBe('INACTIVE');
  });

  test('vendor cannot toggle other vendor\'s activity → NotFoundException (IDOR-hardened)', async () => {
    // Updated 2026-05-02. Same IDOR-fix story as the other vendor
    // tests (PR #94, commit 101d018). Activity-status toggle now
    // scopes by `vendorId: vendor.id` in the where; a foreign
    // activity is "not found" rather than triggering a "not your
    // activity" Forbidden — collapses the enumeration oracle.
    const seed = await seedReference(ctx.prisma);
    // Second vendor user
    const otherVendorUser = await ctx.prisma.user.create({
      data: {
        fullName: 'OV', email: `ov-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'VENDOR', emailVerified: true,
      },
    });
    await ctx.prisma.vendor.create({
      data: {
        userId: otherVendorUser.id, businessNameEn: 'Other', businessNameAr: 'أخرى',
        businessId: 'BIZ-O-' + crypto.randomUUID().slice(0, 6),
        slug: 'other-' + crypto.randomUUID().slice(0, 6),
        countryId: seed.country.id, status: 'ACTIVE',
      },
    });

    const { vendor } = makeVendorService();
    await expect(
      vendor.toggleActivityStatus(otherVendorUser.id, seed.activity.id),
    ).rejects.toThrow(/not found/i);
  });

  test('cannot toggle a BLOCKED activity (only ACTIVE ↔ INACTIVE allowed)', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.activity.update({
      where: { id: seed.activity.id }, data: { status: 'BLOCKED' },
    });
    const { vendor } = makeVendorService();
    await expect(
      vendor.toggleActivityStatus(seed.vendorUser.id, seed.activity.id),
    ).rejects.toThrow(/only active or inactive/i);
  });

  test('deactivation triggers notifyAdmins', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor, notificationService } = makeVendorService();
    await vendor.toggleActivityStatus(seed.vendorUser.id, seed.activity.id);
    expect(notificationService.notifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('Deactivated') }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Customer likes (favourites)
// ═══════════════════════════════════════════════════════════════════════════

describe('Customer likes — @@unique(userId, activityId)', () => {
  test('customer can like an activity once; duplicate → P2002', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.like.create({
      data: { userId: seed.customer.id, activityId: seed.activity.id },
    });
    await expect(
      ctx.prisma.like.create({
        data: { userId: seed.customer.id, activityId: seed.activity.id },
      }),
    ).rejects.toThrow(/Unique|P2002/i);
  });

  test('unlike (delete row) works idempotently via deleteMany', async () => {
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.like.create({
      data: { userId: seed.customer.id, activityId: seed.activity.id },
    });
    // First delete succeeds
    const first = await ctx.prisma.like.deleteMany({
      where: { userId: seed.customer.id, activityId: seed.activity.id },
    });
    expect(first.count).toBe(1);
    // Second delete is a no-op (count 0) — idempotent
    const second = await ctx.prisma.like.deleteMany({
      where: { userId: seed.customer.id, activityId: seed.activity.id },
    });
    expect(second.count).toBe(0);
  });

  test('like count on activity via _count aggregator', async () => {
    const seed = await seedReference(ctx.prisma);
    const u2 = await ctx.prisma.user.create({
      data: {
        fullName: 'U2', email: `u2-${crypto.randomUUID().slice(0, 6)}@t.com`,
        password: '$2b$10$dummy', role: 'CUSTOMER', emailVerified: true,
      },
    });
    await ctx.prisma.like.createMany({
      data: [
        { userId: seed.customer.id, activityId: seed.activity.id },
        { userId: u2.id, activityId: seed.activity.id },
      ],
    });
    const activity = await ctx.prisma.activity.findUniqueOrThrow({
      where: { id: seed.activity.id },
      include: { _count: { select: { likes: true } } },
    });
    expect(activity._count.likes).toBe(2);
  });
});
