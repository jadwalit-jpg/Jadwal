/**
 * Integration — admin-chosen order of the homepage "Featured" row (real
 * Postgres, through the real CatalogController and AdminService).
 *
 * Pins:
 *   • featured=true returns listings in featuredOrder, unnumbered ones last,
 *     newest first; the catalog's visibility rule still applies.
 *   • without featured=true the list keeps its newest-first order even when
 *     positions are set.
 *   • toggleFeatured appends at max+1, unfeaturing clears the position, and
 *     featuring again appends at the new end; two simultaneous stars get
 *     distinct positions (the advisory lock).
 *   • setFeaturedOrder writes 1..n in one go, and refuses (409) a list that
 *     is missing a featured listing, carries an unknown id, or is stale
 *     because a listing was featured in the meantime.
 *   • getFeaturedActivities lists every featured, non-deleted listing with
 *     the right "not shown on homepage" reason.
 *   • the migration's backfill numbers today's featured listings in the
 *     order the homepage showed them (newest first), skipping deleted rows.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { CatalogController } from '../../src/catalog/catalog.controller';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { makeSessionDenylistMock } from '../mocks/auth-deps.mock';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeServices() {
  const prismaSvc = { client: ctx.prisma } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const noop = { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn().mockResolvedValue(undefined), sendToMany: jest.fn().mockResolvedValue(undefined) } as any;
  const cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any;
  const admin = new AdminService(
    prismaSvc, noop, loyalty, cache,
    { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any,
    makeSessionDenylistMock() as any,
  );
  const refCache = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) } as any;
  const catalog = new CatalogController(prismaSvc, refCache, { get: (_k: string, fb?: string) => fb } as unknown as ConfigService);
  return { admin, catalog };
}

/** Another ACTIVE listing on the seed vendor. `daysAgo` fixes createdAt so "newest first" is deterministic. */
async function makeActivity(seed: any, titleEn: string, daysAgo: number, extra: Record<string, unknown> = {}) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id, countryId: seed.country.id, cityId: seed.city.id,
      titleEn, titleAr: `${titleEn} AR`,
      slug: `${titleEn.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 8)}`,
      descriptionEn: 'desc', descriptionAr: 'وصف', locationAddress: 'Doha', locationLat: 25.28, locationLng: 51.53,
      bookingType: 'HOURLY', pricingModel: 'PER_PERSON', pricePerPerson: 100, capacity: 10, durationValue: 2,
      checkInTime: '09:00', checkOutTime: '21:00', coverImage: '/p.webp', status: 'ACTIVE',
      createdAt: new Date(Date.now() - daysAgo * 86_400_000),
      ...extra,
    },
  });
}

/** Ids as the public catalog returns them for the homepage row (featured=true). */
async function homepageIds(catalog: CatalogController, countryId: string): Promise<string[]> {
  const res: any = await catalog.getActivities('1', '20', countryId, undefined, undefined, undefined, undefined, 'true');
  return res.data.map((a: any) => a.id);
}
/** Ids as the public catalog returns them for every other list (no featured flag). */
async function exploreIds(catalog: CatalogController, countryId: string): Promise<string[]> {
  const res: any = await catalog.getActivities('1', '20', countryId);
  return res.data.map((a: any) => a.id);
}
const orderOf = async (id: string) => (await ctx.prisma.activity.findUniqueOrThrow({ where: { id }, select: { featuredOrder: true, isFeatured: true } }));

describe('GET /catalog/activities', () => {
  test('featured=true: featuredOrder ascending, never-ordered ones last (newest first), hidden listings excluded', async () => {
    const seed = await seedReference(ctx.prisma);
    const { catalog } = makeServices();
    const second = await makeActivity(seed, 'Second', 10, { isFeatured: true, featuredOrder: 2 });
    const first = await makeActivity(seed, 'First', 30, { isFeatured: true, featuredOrder: 1 }); // oldest, yet first
    const unorderedNew = await makeActivity(seed, 'Unordered New', 1, { isFeatured: true });
    const unorderedOld = await makeActivity(seed, 'Unordered Old', 20, { isFeatured: true });
    await makeActivity(seed, 'Not Featured', 0);
    await makeActivity(seed, 'Inactive Featured', 0, { isFeatured: true, featuredOrder: 0, status: 'INACTIVE' });

    expect(await homepageIds(catalog, seed.country.id)).toEqual([first.id, second.id, unorderedNew.id, unorderedOld.id]);
  });

  test('without featured=true the order is newest first, whatever the positions say', async () => {
    const seed = await seedReference(ctx.prisma);
    const { catalog } = makeServices();
    // seed.activity was created "now" by seedReference → newest.
    const a = await makeActivity(seed, 'A', 3, { isFeatured: true, featuredOrder: 1 });
    const b = await makeActivity(seed, 'B', 2, { isFeatured: true, featuredOrder: 2 });
    const c = await makeActivity(seed, 'C', 1);

    expect(await exploreIds(catalog, seed.country.id)).toEqual([seed.activity.id, c.id, b.id, a.id]);
    const res: any = await catalog.getActivities('1', '20', seed.country.id, undefined, undefined, undefined, 'B');
    expect(res.data.map((x: any) => x.id)).toEqual([b.id]); // other filters untouched
  });
});

describe('AdminService.toggleFeatured', () => {
  test('featuring appends at max + 1; unfeaturing clears; featuring again appends at the new end', async () => {
    const seed = await seedReference(ctx.prisma);
    const { admin, catalog } = makeServices();
    const one = await makeActivity(seed, 'One', 5, { isFeatured: true, featuredOrder: 1 });
    const two = await makeActivity(seed, 'Two', 4, { isFeatured: true, featuredOrder: 2 });
    const unordered = await makeActivity(seed, 'Unordered', 3, { isFeatured: true });

    // seed.activity is not featured: star it → position 3 (max of the numbered ones + 1).
    const starred = await admin.toggleFeatured(seed.activity.id);
    expect(starred).toMatchObject({ isFeatured: true, featuredOrder: 3 });
    expect(await homepageIds(catalog, seed.country.id)).toEqual([one.id, two.id, seed.activity.id, unordered.id]);

    // Unstar "one" → leaves the order entirely.
    expect(await admin.toggleFeatured(one.id)).toMatchObject({ isFeatured: false, featuredOrder: null });
    expect(await homepageIds(catalog, seed.country.id)).toEqual([two.id, seed.activity.id, unordered.id]);

    // Star "one" again → the end again (max is now 3 → 4), not its old slot.
    expect(await admin.toggleFeatured(one.id)).toMatchObject({ isFeatured: true, featuredOrder: 4 });
    expect(await homepageIds(catalog, seed.country.id)).toEqual([two.id, seed.activity.id, one.id, unordered.id]);
  });

  test('two stars at the same time get distinct positions', async () => {
    const seed = await seedReference(ctx.prisma);
    const { admin } = makeServices();
    await makeActivity(seed, 'Base', 5, { isFeatured: true, featuredOrder: 7 });
    const x = await makeActivity(seed, 'X', 2);
    const y = await makeActivity(seed, 'Y', 1);
    const [rx, ry] = await Promise.all([admin.toggleFeatured(x.id), admin.toggleFeatured(y.id)]);
    expect(new Set([rx.featuredOrder, ry.featuredOrder])).toEqual(new Set([8, 9]));
  });
});

describe('AdminService.setFeaturedOrder', () => {
  test('saves the whole order in one go and the homepage follows it', async () => {
    const seed = await seedReference(ctx.prisma);
    const { admin, catalog } = makeServices();
    const a = await makeActivity(seed, 'A', 3, { isFeatured: true, featuredOrder: 1 });
    const b = await makeActivity(seed, 'B', 2, { isFeatured: true, featuredOrder: 2 });
    const c = await makeActivity(seed, 'C', 1, { isFeatured: true }); // never ordered

    expect(await admin.setFeaturedOrder([c.id, a.id, b.id])).toEqual({ updated: 3 });
    expect((await orderOf(c.id)).featuredOrder).toBe(1);
    expect((await orderOf(a.id)).featuredOrder).toBe(2);
    expect((await orderOf(b.id)).featuredOrder).toBe(3);
    expect(await homepageIds(catalog, seed.country.id)).toEqual([c.id, a.id, b.id]);
    expect((await admin.getFeaturedActivities()).data.map((x) => x.id)).toEqual([c.id, a.id, b.id]);
    // Explore is untouched by the save.
    expect(await exploreIds(catalog, seed.country.id)).toEqual([seed.activity.id, c.id, b.id, a.id]);
  });

  test.each([
    ['a featured listing is missing', (ids: string[]) => ids.slice(1)],
    ['an unknown id is included', (ids: string[]) => [...ids, '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f']],
    ['a non-featured listing is included', (ids: string[], extra: string) => [...ids, extra]],
  ])('refuses with 409 when %s, and changes nothing', async (_name, mutate) => {
    const seed = await seedReference(ctx.prisma);
    const { admin } = makeServices();
    const a = await makeActivity(seed, 'A', 3, { isFeatured: true, featuredOrder: 1 });
    const b = await makeActivity(seed, 'B', 2, { isFeatured: true, featuredOrder: 2 });
    const ids = mutate([b.id, a.id], seed.activity.id);
    await expect(admin.setFeaturedOrder(ids)).rejects.toThrow(ConflictException);
    await expect(admin.setFeaturedOrder(ids)).rejects.toThrow('The featured list changed. Reload and try again.');
    expect((await orderOf(a.id)).featuredOrder).toBe(1);
    expect((await orderOf(b.id)).featuredOrder).toBe(2);
  });

  test('a list loaded before someone starred another listing is stale: 409, then saving the fresh list works', async () => {
    const seed = await seedReference(ctx.prisma);
    const { admin } = makeServices();
    const a = await makeActivity(seed, 'A', 3, { isFeatured: true, featuredOrder: 1 });
    const b = await makeActivity(seed, 'B', 2, { isFeatured: true, featuredOrder: 2 });
    const loaded = (await admin.getFeaturedActivities()).data.map((x) => x.id);
    await admin.toggleFeatured(seed.activity.id); // another admin stars one meanwhile
    await expect(admin.setFeaturedOrder([...loaded].reverse())).rejects.toThrow(ConflictException);
    const fresh = (await admin.getFeaturedActivities()).data.map((x) => x.id);
    expect(fresh).toEqual([a.id, b.id, seed.activity.id]);
    expect(await admin.setFeaturedOrder([seed.activity.id, b.id, a.id])).toEqual({ updated: 3 });
    expect((await orderOf(seed.activity.id)).featuredOrder).toBe(1);
  });

  test('soft-deleted featured listings are outside the set on both sides', async () => {
    const seed = await seedReference(ctx.prisma);
    const { admin } = makeServices();
    const a = await makeActivity(seed, 'A', 3, { isFeatured: true, featuredOrder: 1 });
    const gone = await makeActivity(seed, 'Gone', 2, { isFeatured: true, featuredOrder: 2, deletedAt: new Date() });
    expect((await admin.getFeaturedActivities()).data.map((x) => x.id)).toEqual([a.id]);
    await expect(admin.setFeaturedOrder([a.id, gone.id])).rejects.toThrow(ConflictException);
    expect(await admin.setFeaturedOrder([a.id])).toEqual({ updated: 1 });
  });
});

describe('AdminService.getFeaturedActivities — what the homepage will not show', () => {
  test('inactive listing, non-active vendor and deleted vendor are listed with the reason; the catalog hides them', async () => {
    const seed = await seedReference(ctx.prisma);
    const { admin, catalog } = makeServices();
    const shown = await makeActivity(seed, 'Shown', 4, { isFeatured: true, featuredOrder: 1 });
    const inactive = await makeActivity(seed, 'Inactive', 3, { isFeatured: true, featuredOrder: 2, status: 'INACTIVE' });

    const suspendedUser = await ctx.prisma.user.create({ data: { fullName: 'S', email: 's@test.com', password: 'x', role: 'VENDOR', emailVerified: true } });
    const suspended = await ctx.prisma.vendor.create({ data: { userId: suspendedUser.id, businessNameEn: 'Suspended Biz', businessNameAr: 'م', businessId: 'BIZ-SUSP', slug: 'suspended-biz', countryId: seed.country.id, status: 'SUSPENDED' } });
    const bySuspended = await makeActivity({ ...seed, vendor: suspended }, 'By Suspended', 2, { isFeatured: true, featuredOrder: 3 });

    const deletedUser = await ctx.prisma.user.create({ data: { fullName: 'D', email: 'd@test.com', password: 'x', role: 'VENDOR', emailVerified: true } });
    const deletedVendor = await ctx.prisma.vendor.create({ data: { userId: deletedUser.id, businessNameEn: 'Deleted Biz', businessNameAr: 'م', businessId: 'BIZ-DEL', slug: 'deleted-biz', countryId: seed.country.id, status: 'ACTIVE', deletedAt: new Date() } });
    const byDeleted = await makeActivity({ ...seed, vendor: deletedVendor }, 'By Deleted', 1, { isFeatured: true, featuredOrder: 4 });

    const list = await admin.getFeaturedActivities();
    expect(list.total).toBe(4);
    expect(list.homepageLimit).toBe(20);
    const byId = new Map(list.data.map((x) => [x.id, x]));
    expect(byId.get(shown.id)).toMatchObject({ showsOnHomepage: true, hiddenReason: null, vendor: { businessNameEn: 'Test Biz', status: 'ACTIVE', deleted: false }, city: { nameEn: seed.city.nameEn }, country: { nameEn: seed.country.nameEn } });
    expect(byId.get(inactive.id)).toMatchObject({ showsOnHomepage: false, hiddenReason: 'INACTIVE', status: 'INACTIVE' });
    expect(byId.get(bySuspended.id)).toMatchObject({ showsOnHomepage: false, hiddenReason: 'VENDOR_NOT_ACTIVE', vendor: { status: 'SUSPENDED' } });
    expect(byId.get(byDeleted.id)).toMatchObject({ showsOnHomepage: false, hiddenReason: 'VENDOR_DELETED', vendor: { deleted: true } });
    expect(list.data.map((x) => x.id)).toEqual([shown.id, inactive.id, bySuspended.id, byDeleted.id]);
    expect(list.data[0]).toEqual(expect.objectContaining({ titleEn: 'Shown', titleAr: 'Shown AR', slug: expect.any(String), coverImage: '/p.webp', featuredOrder: 1 }));

    expect(await homepageIds(catalog, seed.country.id)).toEqual([shown.id]);
  });
});

describe('migration 20261110000000_add_activity_featured_order — backfill', () => {
  const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261110000000_add_activity_featured_order/migration.sql'), 'utf8');
  const backfill = sql.slice(sql.indexOf('UPDATE "activities"'));

  test('numbers today\'s featured listings newest first (the order the homepage showed), skips deleted and non-featured rows', async () => {
    expect(backfill.trim().endsWith(';')).toBe(true);
    const seed = await seedReference(ctx.prisma);
    const { catalog } = makeServices();
    const newest = await makeActivity(seed, 'Newest', 1, { isFeatured: true });
    const middle = await makeActivity(seed, 'Middle', 5, { isFeatured: true });
    const oldest = await makeActivity(seed, 'Oldest', 9, { isFeatured: true });
    const deleted = await makeActivity(seed, 'Deleted', 2, { isFeatured: true, deletedAt: new Date() });
    const plain = await makeActivity(seed, 'Plain', 3);

    // Before the backfill the catalog falls back to newest first: that is the order to preserve.
    expect(await homepageIds(catalog, seed.country.id)).toEqual([newest.id, middle.id, oldest.id]);

    await ctx.prisma.$executeRawUnsafe(backfill);

    expect((await orderOf(newest.id)).featuredOrder).toBe(1);
    expect((await orderOf(middle.id)).featuredOrder).toBe(2);
    expect((await orderOf(oldest.id)).featuredOrder).toBe(3);
    expect((await orderOf(deleted.id)).featuredOrder).toBeNull();
    expect((await orderOf(plain.id)).featuredOrder).toBeNull();
    expect(await homepageIds(catalog, seed.country.id)).toEqual([newest.id, middle.id, oldest.id]); // unchanged
  });
});
