/**
 * Integration — an activity may not be saved with Units ON but unconfigured.
 *
 * REPORTED 2026-09-12
 * -------------------
 * A screenshot of the activity form showed the Units toggle ON with "Number of
 * Units" and "Capacity per Unit" both EMPTY, despite both being marked required.
 * The asterisks are client-side; the DTOs validate each field alone
 * (`@Min(0) @IsOptional()` on unitCount) and nothing ties them to `hasUnits`.
 *
 * The resulting state makes the two halves of the system disagree:
 *   calendar       capacity = unitCount = 0  -> every day reads fully booked
 *   createBooking  `hasUnits && unitCount > 0` is false -> keeps selling seats
 * Silent, contradictory, and invisible until a customer complains.
 *
 * These tests also pin the deliberate NON-behaviours, because each is a way a
 * well-meaning guard could make things worse:
 *   - it must not fire when Units is off (those fields are inert then)
 *   - it must not block an unrelated edit to a correctly-configured activity
 *   - a partial PATCH must be judged on the MERGED result, not on whichever
 *     fields this particular request happened to mention
 */

import { getTestContext, seedReference } from './_setup';
import { VendorService } from '../../src/vendor/vendor.service';
import { AdminService } from '../../src/admin/admin.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { makeSessionDenylistMock } from '../mocks/auth-deps.mock';

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
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const refCache = { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any;
  const vendor = new VendorService(prismaSvc, notificationService, loyalty, availabilityCache, makeSessionDenylistMock() as any);
  const admin = new AdminService(prismaSvc, notificationService, loyalty, availabilityCache, refCache, makeSessionDenylistMock() as any);
  return { vendor, admin };
}

/** Valid base payload for creating a DAILY activity. */
function baseCreateDto(seed: any, over: Record<string, unknown> = {}) {
  return {
    // createActivity checks slug uniqueness before any cross-field validation,
    // so it must be present and unique or every case fails on the wrong error.
    slug: 'chalet-' + crypto.randomUUID().slice(0, 8),
    titleEn: 'Chalet', titleAr: 'شاليه',
    descriptionEn: 'A private chalet', descriptionAr: 'شاليه خاص',
    categoryId: seed.category.id, cityId: seed.city.id,
    locationAddress: 'Doha', locationLat: 25.28, locationLng: 51.53,
    bookingType: 'DAILY', pricingModel: 'PER_UNIT',
    pricePerPerson: 2500,
    checkInTime: '15:00', checkOutTime: '12:00',
    coverImage: '/p.webp',
    capacity: 8,
    ...over,
  } as any;
}

async function makeActivity(seed: any, over: Record<string, unknown> = {}) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'Chalet', titleAr: 'شاليه',
      slug: 'chalet-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و',
      locationAddress: 'Doha', locationLat: 25.28, locationLng: 51.53,
      bookingType: 'DAILY', pricingModel: 'PER_UNIT',
      pricePerPerson: 2500,
      hasUnits: false, unitCount: 0, unitCapacity: 1, capacity: 8,
      durationValue: null, checkInTime: '15:00', checkOutTime: '12:00',
      coverImage: '/p.webp', status: 'ACTIVE',
    },
    ...(Object.keys(over).length ? {} : {}),
  }).then((a) =>
    Object.keys(over).length
      ? ctx.prisma.activity.update({ where: { id: a.id }, data: over as any })
      : a,
  );
}

// ═══════════════════════════════════════════════════════════════════════════

describe('CREATE — Units on requires unit values', () => {

  test('rejects Units ON with both boxes empty (the reported case)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();

    await expect(
      vendor.createActivity(seed.vendorUser.id, baseCreateDto(seed, { hasUnits: true })),
    ).rejects.toThrow(BadRequestException);
  });

  test('rejects Units ON with unitCount 0', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();

    await expect(
      vendor.createActivity(
        seed.vendorUser.id,
        baseCreateDto(seed, { hasUnits: true, unitCount: 0, unitCapacity: 4 }),
      ),
    ).rejects.toThrow(/Number of Units/i);
  });

  test('rejects Units ON with a count but no capacity per unit', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();

    await expect(
      vendor.createActivity(
        seed.vendorUser.id,
        baseCreateDto(seed, { hasUnits: true, unitCount: 3 }),
      ),
    ).rejects.toThrow(/Capacity per Unit/i);
  });

  test('accepts a properly configured units activity', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();

    const act = await vendor.createActivity(
      seed.vendorUser.id,
      baseCreateDto(seed, { hasUnits: true, unitCount: 1, unitCapacity: 8 }),
    );
    expect(act.hasUnits).toBe(true);
    expect(act.unitCount).toBe(1);
    expect(act.capacity).toBe(8); // derived from units x capacity
  });

  test('accepts Units OFF with no unit values at all', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();

    // Units off -> those fields are inert; the activity counts guests against
    // `capacity`. Demanding them here would block every normal activity.
    const act = await vendor.createActivity(seed.vendorUser.id, baseCreateDto(seed));
    expect(act.hasUnits).toBe(false);
  });
});

describe('UPDATE — the switch cannot be flipped on without values', () => {

  test('VENDOR: rejects flipping Units on alone', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const act = await makeActivity(seed); // units off, unitCount 0

    // This is exactly the screenshot: toggle on, boxes empty.
    await expect(
      vendor.updateActivity(seed.vendorUser.id, act.id, { hasUnits: true } as any),
    ).rejects.toThrow(/Number of Units/i);

    // and nothing was written
    const after = await ctx.prisma.activity.findUnique({
      where: { id: act.id }, select: { hasUnits: true, unitCount: true },
    });
    expect(after).toEqual({ hasUnits: false, unitCount: 0 });
  });

  test('VENDOR: accepts flipping Units on together with values', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const act = await makeActivity(seed);

    const updated = await vendor.updateActivity(seed.vendorUser.id, act.id, {
      hasUnits: true, unitCount: 1, unitCapacity: 8,
    } as any);
    expect(updated.hasUnits).toBe(true);
    expect(updated.unitCount).toBe(1);
  });

  test('ADMIN: rejects flipping Units on alone', async () => {
    const seed = await seedReference(ctx.prisma);
    const { admin } = makeServices();
    const act = await makeActivity(seed);

    await expect(
      admin.updateActivity(act.id, { hasUnits: true } as any),
    ).rejects.toThrow(/Number of Units/i);
  });

  test('ADMIN: accepts flipping Units on together with values', async () => {
    const seed = await seedReference(ctx.prisma);
    const { admin } = makeServices();
    const act = await makeActivity(seed);

    const updated = await admin.updateActivity(act.id, {
      hasUnits: true, unitCount: 2, unitCapacity: 5,
    } as any);
    expect(updated.hasUnits).toBe(true);
  });
});

describe('UPDATE — must not get in the way of legitimate edits', () => {

  test('a partial PATCH is judged on the MERGED result, not this request alone', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    // Already correctly configured.
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 3, unitCapacity: 6, capacity: 18 });

    // Sends ONLY unitCount. hasUnits and unitCapacity come from the stored row,
    // so this must pass — a request-only check would have rejected it.
    const updated = await vendor.updateActivity(seed.vendorUser.id, act.id, { unitCount: 4 } as any);
    expect(updated.unitCount).toBe(4);
  });

  test('an edit touching nothing about units still works', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 2, unitCapacity: 4, capacity: 8 });

    const updated = await vendor.updateActivity(seed.vendorUser.id, act.id, {
      titleEn: 'Renamed Chalet',
    } as any);
    expect(updated.titleEn).toBe('Renamed Chalet');
  });

  test('turning Units OFF is always allowed, whatever the unit values are', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 2, unitCapacity: 4, capacity: 8 });

    // Units off -> the fields stop being read at all, so there is nothing to
    // validate and no reason to stand in the way.
    const updated = await vendor.updateActivity(seed.vendorUser.id, act.id, { hasUnits: false } as any);
    expect(updated.hasUnits).toBe(false);
  });

  test('reducing unitCount to 0 while Units stays on is rejected', async () => {
    const seed = await seedReference(ctx.prisma);
    const { vendor } = makeServices();
    const act = await makeActivity(seed, { hasUnits: true, unitCount: 3, unitCapacity: 6, capacity: 18 });

    // Zero units with the switch on is the same broken state, reached by a
    // different route.
    await expect(
      vendor.updateActivity(seed.vendorUser.id, act.id, { unitCount: 0 } as any),
    ).rejects.toThrow(/Number of Units/i);
  });
});
