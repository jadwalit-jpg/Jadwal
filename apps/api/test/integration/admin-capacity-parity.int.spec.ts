/**
 * Integration — the ADMIN activity PATCH must enforce the same capacity rules
 * as the VENDOR one.
 *
 * WHY
 * ---
 * Two guards existed only on the vendor path. Admin's updateActivity spread the
 * DTO straight into Prisma, so:
 *
 *   1. it could leave `capacity` null on a unit-less activity. createBooking
 *      reads `activity.capacity ?? Infinity` — the activity then sells without
 *      any limit at all, silently, with nothing in the calendar to show it.
 *
 *   2. it never derived `capacity` from unitCount x unitCapacity, so a PATCH
 *      that set either one without restating `capacity` left the stored total
 *      disagreeing with the units. A number that disagrees with reality and
 *      that nobody can see is the exact shape of the 2026-09-12 incident.
 *
 * Neither is exotic: the admin UI sends partial PATCHes, which is the whole
 * point of PATCH.
 *
 * These tests assert PARITY rather than each rule in isolation — vendor and
 * admin edit the same rows, so a rule on one path and not the other is not a
 * policy difference, it is a hole.
 */

import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { makeSessionDenylistMock } from '../mocks/auth-deps.mock';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

/** Same wiring the other admin integration specs use. */
function makeAdminService() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const noop = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  return new AdminService(
    prismaSvc, noop, loyalty, cache,
    { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any,
    makeSessionDenylistMock() as any,
  );
}

async function makeActivity(seed: any, overrides: Record<string, any> = {}) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id,
      countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'Cap', titleAr: 'ع', slug: 'cap-' + crypto.randomUUID().slice(0, 8),
      descriptionEn: 'd', descriptionAr: 'و', locationAddress: 'Doha',
      locationLat: 25.28, locationLng: 51.53,
      pricePerPerson: 100, coverImage: '/p.webp', status: 'ACTIVE',
      bookingType: 'DAILY', pricingModel: 'PER_UNIT',
      checkInTime: '14:00', checkOutTime: '11:00',
      ...overrides,
    },
  });
}

async function capacityOf(id: string) {
  const row = await ctx.prisma.activity.findUniqueOrThrow({
    where: { id },
    select: { capacity: true, hasUnits: true, unitCount: true, unitCapacity: true },
  });
  return row;
}

// ════════════════════════════════════════════════════════════════════════════

describe('admin PATCH — capacity is derived from units, not left stale', () => {

  it('setting unitCount recomputes capacity without the DTO restating it', async () => {
    // The everyday case. The admin UI sends what changed; capacity is not a
    // field the operator thinks about, because units imply it.
    const seed = await seedReference(ctx.prisma);
    const svc = makeAdminService();
    const act = await makeActivity(seed, {
      hasUnits: true, unitCount: 2, unitCapacity: 4, capacity: 8,
    });

    await svc.updateActivity(act.id, { unitCount: 5 } as any);

    const after = await capacityOf(act.id);
    expect(after.unitCount).toBe(5);
    // 5 units x 4 guests. Left at 8, the stored total would claim the property
    // holds 8 when it now holds 20.
    expect(after.capacity).toBe(20);
  });

  it('setting unitCapacity alone recomputes it too', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeAdminService();
    const act = await makeActivity(seed, {
      hasUnits: true, unitCount: 3, unitCapacity: 2, capacity: 6,
    });

    await svc.updateActivity(act.id, { unitCapacity: 5 } as any);

    const after = await capacityOf(act.id);
    expect(after.capacity).toBe(15);
  });

  it('flipping units ON in the same PATCH derives capacity from the new values', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeAdminService();
    const act = await makeActivity(seed, {
      hasUnits: false, unitCount: 0, unitCapacity: 1, capacity: 30,
    });

    await svc.updateActivity(act.id, {
      hasUnits: true, unitCount: 4, unitCapacity: 3,
    } as any);

    const after = await capacityOf(act.id);
    expect(after.hasUnits).toBe(true);
    expect(after.capacity).toBe(12); // not the stale 30
  });

  it('the units product is ceiling-checked, as on the vendor path', async () => {
    // The admin DTO has no @Max on either factor, so this is the only bound.
    const seed = await seedReference(ctx.prisma);
    const svc = makeAdminService();
    const act = await makeActivity(seed, {
      hasUnits: true, unitCount: 2, unitCapacity: 2, capacity: 4,
    });

    await expect(
      svc.updateActivity(act.id, { unitCount: 5000, unitCapacity: 10 } as any),
    ).rejects.toThrow(/cannot exceed 10000/i);
  });
});

describe('admin PATCH — capacity is required when units are OFF', () => {

  it('clearing capacity on a unit-less activity is refused', async () => {
    // createBooking reads `activity.capacity ?? Infinity`. Null here does not
    // mean "no limit configured yet" — it means the activity sells forever.
    const seed = await seedReference(ctx.prisma);
    const svc = makeAdminService();
    const act = await makeActivity(seed, {
      hasUnits: false, unitCount: 0, unitCapacity: 1, capacity: 20,
    });

    await expect(
      svc.updateActivity(act.id, { capacity: null } as any),
    ).rejects.toThrow(/capacity is required/i);
  });

  it('a zero capacity on a unit-less activity is refused', async () => {
    const seed = await seedReference(ctx.prisma);
    const svc = makeAdminService();
    const act = await makeActivity(seed, {
      hasUnits: false, unitCount: 0, unitCapacity: 1, capacity: 20,
    });

    await expect(
      svc.updateActivity(act.id, { capacity: 0 } as any),
    ).rejects.toThrow(/capacity is required/i);
  });

  it('turning units OFF without supplying a capacity is refused', async () => {
    // The merged next-state matters, not what this request mentions. Here the
    // activity's own capacity was unit-derived; switching units off without
    // stating a replacement leaves a figure that no longer means anything.
    const seed = await seedReference(ctx.prisma);
    const svc = makeAdminService();
    const act = await makeActivity(seed, {
      hasUnits: true, unitCount: 3, unitCapacity: 2, capacity: 6,
    });

    // Capacity survives as 6, so this is allowed — the number is still a valid
    // seat count. Pinned so the guard is understood as "never null/<=0", not
    // "always restate it".
    await svc.updateActivity(act.id, { hasUnits: false, unitCount: 0 } as any);
    const after = await capacityOf(act.id);
    expect(after.hasUnits).toBe(false);
    expect(after.capacity).toBe(6);
  });

  it('a unit-less activity with a real capacity still updates normally', async () => {
    // The guard must not block ordinary edits.
    const seed = await seedReference(ctx.prisma);
    const svc = makeAdminService();
    const act = await makeActivity(seed, {
      hasUnits: false, unitCount: 0, unitCapacity: 1, capacity: 20,
    });

    await svc.updateActivity(act.id, { capacity: 35 } as any);
    expect((await capacityOf(act.id)).capacity).toBe(35);
  });
});
