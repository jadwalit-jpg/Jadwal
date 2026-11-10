/**
 * GET /catalog/activities — only featured=true follows the admin-chosen order.
 *
 * The sort decision is the pure helper `catalogActivitiesOrderBy`; the
 * controller test over a mocked Prisma pins that getActivities passes it to
 * findMany: the two-key order (featuredOrder asc, nulls last, then newest)
 * for featured=true, and the unchanged newest-first order for every other
 * call, whatever other filters are set.
 */
jest.mock('../../src/common/services/upload.service', () => ({
  UploadService: class {},
  ALLOWED_MIME: [], MIME_TO_EXT: {}, ALLOWED_EXT: [],
}));

import { ConfigService } from '@nestjs/config';
import { CatalogController, catalogActivitiesOrderBy } from '../../src/catalog/catalog.controller';
import { makePrismaMock } from '../mocks/prisma.mock';

const FEATURED_ORDER = [{ featuredOrder: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];
const DEFAULT_ORDER = [{ createdAt: 'desc' }];

describe('catalogActivitiesOrderBy', () => {
  test('featured=true: featuredOrder ascending, nulls last, then newest first', () => {
    expect(catalogActivitiesOrderBy(true)).toEqual(FEATURED_ORDER);
  });
  test('anything else: newest first, exactly as before', () => {
    expect(catalogActivitiesOrderBy(false)).toEqual(DEFAULT_ORDER);
  });
});

describe('CatalogController.getActivities orderBy', () => {
  function make() {
    const prisma = makePrismaMock();
    const refCache = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) } as any;
    const config = { get: (_k: string, fb?: string) => fb } as unknown as ConfigService;
    const controller = new CatalogController(prisma as any, refCache, config);
    return { prisma, controller };
  }
  const call = (controller: CatalogController, featured?: string, extra: Partial<{ countryId: string; cityId: string; search: string; bookingType: string }> = {}) =>
    controller.getActivities('1', '20', extra.countryId, undefined, undefined, extra.cityId, extra.search, featured, undefined, undefined, undefined, undefined, extra.bookingType);

  test('featured=true passes the featured order and keeps the featured filter', async () => {
    const { prisma, controller } = make();
    await call(controller, 'true', { countryId: 'qa' });
    const args = prisma._client.activity.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual(FEATURED_ORDER);
    expect(args.where).toMatchObject({ isFeatured: true, countryId: 'qa', status: 'ACTIVE' });
    expect(args.take).toBe(20);
  });

  test.each([
    ['no filters', undefined, {}],
    ['featured=false', 'false', {}],
    ['a city and a search', undefined, { cityId: 'doha', search: 'tour' }],
    ['a booking type', undefined, { bookingType: 'DAILY' }],
  ])('without featured=true (%s) the order stays newest first', async (_n, featured, extra) => {
    const { prisma, controller } = make();
    await call(controller, featured, extra);
    const args = prisma._client.activity.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual(DEFAULT_ORDER);
    expect(args.where.isFeatured).toBeUndefined();
  });
});
