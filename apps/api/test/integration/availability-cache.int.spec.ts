/**
 * AvailabilityCacheService — version-based invalidation against a real Redis.
 *
 * Proves the behaviour that only real Redis can verify:
 *   - get / set roundtrip with TTL
 *   - UUID + YYYY-MM + unitNumber input guards (injection-proof)
 *   - Payload size cap enforced
 *   - INCR-based invalidation causes old cache entries to become unreachable
 *     (they live on under a dead version key until TTL)
 *   - invalidateMany uses pipeline + deduplicates
 */

import { getTestContext } from './_setup';
import { AvailabilityCacheService } from '../../src/redis/availability-cache.service';
import { randomUUID } from 'crypto';

const ctx = getTestContext();

function makeCache(configOverrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    AVAILABILITY_CACHE_ENABLED: 'true',
    AVAILABILITY_CACHE_TTL_SEC: '180',
  };
  const merged = { ...defaults, ...configOverrides };
  const config = {
    get: (k: string, fallback?: string) => merged[k] ?? fallback,
    getOrThrow: (k: string) => {
      const v = merged[k];
      if (v === undefined) throw new Error(`Missing config: ${k}`);
      return v;
    },
  } as any;

  const redisSvc = { getClient: () => ctx.redis } as any;
  const cache = new AvailabilityCacheService(redisSvc, config);
  cache.onModuleInit();
  return cache;
}

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

const VALID_UUID = randomUUID();

// ═══════════════════════════════════════════════════════════════════════════
// get / set roundtrip
// ═══════════════════════════════════════════════════════════════════════════

describe('AvailabilityCacheService — get / set roundtrip', () => {
  test('set then get returns the same payload', async () => {
    const cache = makeCache();
    const payload = { days: [{ date: '2030-06-01', available: 5 }] };

    await cache.set(VALID_UUID, '2030-06', payload);
    const got = await cache.get<typeof payload>(VALID_UUID, '2030-06');

    expect(got).toEqual(payload);
  });

  test('get returns null when nothing was set', async () => {
    const cache = makeCache();
    const got = await cache.get(VALID_UUID, '2030-06');
    expect(got).toBeNull();
  });

  test('unitNumber partitions the cache (cached for unit 1 is NOT visible to unit 2)', async () => {
    const cache = makeCache();
    await cache.set(VALID_UUID, '2030-06', { unit: 1 }, 1);
    await cache.set(VALID_UUID, '2030-06', { unit: 2 }, 2);

    expect(await cache.get(VALID_UUID, '2030-06', 1)).toEqual({ unit: 1 });
    expect(await cache.get(VALID_UUID, '2030-06', 2)).toEqual({ unit: 2 });
    // Without unitNumber → queries the 'all' key, which was NEVER set
    expect(await cache.get(VALID_UUID, '2030-06')).toBeNull();
  });

  test('TTL is applied (key expires in EX seconds)', async () => {
    const cache = makeCache({ AVAILABILITY_CACHE_TTL_SEC: '1' });
    await cache.set(VALID_UUID, '2030-06', { x: 1 });
    // Still there instantly
    expect(await cache.get(VALID_UUID, '2030-06')).toEqual({ x: 1 });
    // After 1.2s, expired
    await new Promise(r => setTimeout(r, 1200));
    expect(await cache.get(VALID_UUID, '2030-06')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Input guards — injection-proof
// ═══════════════════════════════════════════════════════════════════════════

describe('AvailabilityCacheService — key-injection guards', () => {
  test('non-UUID activityId → treated as miss (no Redis call)', async () => {
    const cache = makeCache();
    await cache.set('not-a-uuid', '2030-06', { x: 1 });
    // The set should have been skipped — no key in Redis
    const keys = await ctx.redis.keys('avail:*');
    expect(keys).toHaveLength(0);

    // get also returns null for the same bad input
    expect(await cache.get('not-a-uuid', '2030-06')).toBeNull();
  });

  test('malformed month (13, wrong pattern) → treated as miss', async () => {
    const cache = makeCache();
    await cache.set(VALID_UUID, '2030-13', { x: 1 });
    await cache.set(VALID_UUID, '20-06', { x: 1 });
    await cache.set(VALID_UUID, '2030/06', { x: 1 });

    const keys = await ctx.redis.keys('avail:*');
    expect(keys).toHaveLength(0);
  });

  test('unitNumber above MAX_CACHEABLE_UNIT (1000) → treated as miss', async () => {
    const cache = makeCache();
    await cache.set(VALID_UUID, '2030-06', { x: 1 }, 5000);
    await cache.set(VALID_UUID, '2030-06', { x: 1 }, 0);
    await cache.set(VALID_UUID, '2030-06', { x: 1 }, -1);

    const keys = await ctx.redis.keys('avail:*');
    expect(keys).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Payload size cap
// ═══════════════════════════════════════════════════════════════════════════

describe('AvailabilityCacheService — payload size cap (256 KB)', () => {
  test('oversized payload is silently skipped (cache miss on subsequent get)', async () => {
    const cache = makeCache();
    const huge = { bloat: 'x'.repeat(300 * 1024) }; // 300 KB > 256 KB cap

    await cache.set(VALID_UUID, '2030-06', huge);
    const got = await cache.get(VALID_UUID, '2030-06');
    expect(got).toBeNull(); // Skipped; never written
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Version-based invalidation
// ═══════════════════════════════════════════════════════════════════════════

describe('AvailabilityCacheService — INCR-based invalidation', () => {
  test('invalidate() bumps version; old cached data becomes unreachable via get()', async () => {
    const cache = makeCache();
    await cache.set(VALID_UUID, '2030-06', { v: 'old' });
    expect(await cache.get(VALID_UUID, '2030-06')).toEqual({ v: 'old' });

    await cache.invalidate(VALID_UUID);

    // After invalidation, get resolves the NEW version → fresh miss
    expect(await cache.get(VALID_UUID, '2030-06')).toBeNull();

    // Old data may still physically exist in Redis under v0 key — that's OK,
    // it ages out on TTL. What matters is it's unreachable via this service.
    const versionKey = `avail:ver:${VALID_UUID}`;
    expect(await ctx.redis.get(versionKey)).toBe('1');
  });

  test('write after invalidate lands under the new version', async () => {
    const cache = makeCache();
    await cache.set(VALID_UUID, '2030-06', { v: 'old' });
    await cache.invalidate(VALID_UUID);
    await cache.set(VALID_UUID, '2030-06', { v: 'new' });

    expect(await cache.get(VALID_UUID, '2030-06')).toEqual({ v: 'new' });
  });

  test('invalidate with non-UUID → no-op (never touches Redis)', async () => {
    const cache = makeCache();
    await cache.invalidate('not-a-uuid');
    const v = await ctx.redis.get('avail:ver:not-a-uuid');
    expect(v).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// invalidateMany — pipeline + dedupe
// ═══════════════════════════════════════════════════════════════════════════

describe('AvailabilityCacheService.invalidateMany', () => {
  test('bumps version for every provided UUID', async () => {
    const cache = makeCache();
    const id1 = randomUUID();
    const id2 = randomUUID();
    await cache.invalidateMany([id1, id2]);

    expect(await ctx.redis.get(`avail:ver:${id1}`)).toBe('1');
    expect(await ctx.redis.get(`avail:ver:${id2}`)).toBe('1');
  });

  test('deduplicates repeated IDs (only one INCR per unique UUID)', async () => {
    const cache = makeCache();
    const id = randomUUID();
    await cache.invalidateMany([id, id, id, id]); // 4 repeats → 1 INCR

    expect(await ctx.redis.get(`avail:ver:${id}`)).toBe('1');
  });

  test('filters out non-UUID entries (bad + good mixed)', async () => {
    const cache = makeCache();
    const good = randomUUID();
    await cache.invalidateMany(['not-a-uuid', good, 'also-bad']);
    expect(await ctx.redis.get(`avail:ver:${good}`)).toBe('1');
    expect(await ctx.redis.get('avail:ver:not-a-uuid')).toBeNull();
  });

  test('empty list → no-op', async () => {
    const cache = makeCache();
    await cache.invalidateMany([]);
    const keys = await ctx.redis.keys('avail:ver:*');
    expect(keys).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Disabled mode — fail-closed against stampede
// ═══════════════════════════════════════════════════════════════════════════

describe('AvailabilityCacheService — disabled mode', () => {
  test('AVAILABILITY_CACHE_ENABLED=false → get returns null, set is no-op', async () => {
    const cache = makeCache({ AVAILABILITY_CACHE_ENABLED: 'false' });
    await cache.set(VALID_UUID, '2030-06', { x: 1 });
    const keys = await ctx.redis.keys('avail:*');
    expect(keys).toHaveLength(0);
    expect(await cache.get(VALID_UUID, '2030-06')).toBeNull();
  });
});
