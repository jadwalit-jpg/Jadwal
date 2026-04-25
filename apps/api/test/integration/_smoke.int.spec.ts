/**
 * Harness smoke test — proves connection + truncation + seed work before we
 * build the real integration suites on top.
 */

import { getTestContext, seedReference } from './_setup';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

describe('Integration harness smoke', () => {
  test('connects to test DB + empty after reset', async () => {
    const n = await ctx.prisma.user.count();
    expect(n).toBe(0);
  });

  test('seedReference creates minimal graph (country, city, vendor, activity, customer)', async () => {
    const seed = await seedReference(ctx.prisma);
    expect(seed.country.isoCode).toBe('QA');
    expect(seed.city.nameEn).toBe('Doha');
    expect(seed.vendor.status).toBe('ACTIVE');
    expect(seed.activity.capacity).toBe(10);
    expect(seed.activity.bookingType).toBe('HOURLY');
    expect(seed.customer.role).toBe('CUSTOMER');

    // Row counts
    expect(await ctx.prisma.country.count()).toBe(1);
    expect(await ctx.prisma.vendor.count()).toBe(1);
    expect(await ctx.prisma.activity.count()).toBe(1);
  });

  test('reset wipes everything between tests', async () => {
    await seedReference(ctx.prisma);
    expect(await ctx.prisma.country.count()).toBe(1);
    // no explicit reset call — beforeEach will run before the next test
  });

  test('previous test\'s data is gone (beforeEach truncation works)', async () => {
    expect(await ctx.prisma.country.count()).toBe(0);
    expect(await ctx.prisma.activity.count()).toBe(0);
  });

  test('redis test DB (15) is isolated + flushed between tests', async () => {
    await ctx.redis.set('test-key', 'v1');
    expect(await ctx.redis.get('test-key')).toBe('v1');
    // beforeEach will flush before next test — verify in the next test
  });

  test('redis key from previous test is gone', async () => {
    expect(await ctx.redis.get('test-key')).toBeNull();
  });
});
