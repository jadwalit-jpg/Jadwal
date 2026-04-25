/**
 * RedisThrottlerStorage — atomic Lua-script increment + TTL + block detection.
 *
 * Proves the behaviour that only a real Redis can verify:
 *   - INCR + PEXPIRE on first hit is atomic via Lua
 *   - Counter is shared across two "instances" (distinct storage objects with
 *     the same Redis backend) — critical for multi-pod rate limiting
 *   - Block key prevents subsequent hits during blockDuration
 *   - Fail-open on Redis unavailability (covered in unit; re-verified here
 *     by pointing at an unreachable Redis port)
 */

import { getTestContext } from './_setup';
import { RedisThrottlerStorage } from '../../src/redis/redis-throttler.storage';
import Redis from 'ioredis';

const ctx = getTestContext();

// The throttler storage expects a RedisService — we build a minimal shim
// that returns the integration context's Redis client.
function makeStorage() {
  const stub = { getClient: () => ctx.redis } as any;
  const storage = new RedisThrottlerStorage(stub);
  storage.onModuleInit();
  return storage;
}

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

// ═══════════════════════════════════════════════════════════════════════════
// Atomic increment + TTL
// ═══════════════════════════════════════════════════════════════════════════

describe('RedisThrottlerStorage — atomic Lua increment', () => {
  test('first hit → totalHits=1, TTL set to requested value', async () => {
    const storage = makeStorage();
    const r = await storage.increment('user-1', 60_000, 5, 30_000, 'default');

    expect(r.totalHits).toBe(1);
    expect(r.isBlocked).toBe(false);
    // TTL recorded in ms; should be close to 60_000 (allow some drift)
    expect(r.timeToExpire).toBeGreaterThan(50_000);
    expect(r.timeToExpire).toBeLessThanOrEqual(60_000);
  });

  test('consecutive hits accumulate under the same key', async () => {
    const storage = makeStorage();
    for (let i = 1; i <= 4; i++) {
      const r = await storage.increment('user-2', 60_000, 10, 30_000, 'default');
      expect(r.totalHits).toBe(i);
      expect(r.isBlocked).toBe(false);
    }
  });

  test('TTL is only set on first hit, subsequent hits preserve the original window', async () => {
    const storage = makeStorage();
    const first  = await storage.increment('user-3', 60_000, 10, 30_000, 'default');
    // Wait a tick so clock advances
    await new Promise(r => setTimeout(r, 50));
    const second = await storage.increment('user-3', 60_000, 10, 30_000, 'default');
    // Second TTL should be LESS than first (window counting down, not reset)
    expect(second.timeToExpire).toBeLessThan(first.timeToExpire);
    expect(second.totalHits).toBe(2);
  });

  test('different throttlerName → separate counter (no interference)', async () => {
    const storage = makeStorage();
    await storage.increment('user-4', 60_000, 5, 30_000, 'default');
    await storage.increment('user-4', 60_000, 5, 30_000, 'default');
    const otherFirst = await storage.increment('user-4', 60_000, 5, 30_000, 'auth');
    // 'auth' throttler starts fresh at 1, not 3
    expect(otherFirst.totalHits).toBe(1);
  });

  test('different keys under same throttler → separate counters', async () => {
    const storage = makeStorage();
    await storage.increment('user-A', 60_000, 5, 30_000, 'default');
    const userB = await storage.increment('user-B', 60_000, 5, 30_000, 'default');
    expect(userB.totalHits).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Block threshold + blockDuration
// ═══════════════════════════════════════════════════════════════════════════

describe('RedisThrottlerStorage — block key on limit exceed', () => {
  test('hit N+1 exceeds limit N → sets block key + isBlocked=true', async () => {
    const storage = makeStorage();
    const LIMIT = 3;

    // Hits 1..3 stay under the limit
    for (let i = 1; i <= LIMIT; i++) {
      const r = await storage.increment('user-5', 60_000, LIMIT, 30_000, 'default');
      expect(r.isBlocked).toBe(false);
    }
    // Hit 4 crosses the limit → block triggered
    const over = await storage.increment('user-5', 60_000, LIMIT, 30_000, 'default');
    expect(over.totalHits).toBe(4);
    expect(over.isBlocked).toBe(true);
    expect(over.timeToBlockExpire).toBeGreaterThan(0);
    expect(over.timeToBlockExpire).toBeLessThanOrEqual(30_000);
  });

  test('further hits while blocked → keep returning isBlocked=true (no counter churn)', async () => {
    const storage = makeStorage();
    const LIMIT = 2;
    // Overflow to block
    await storage.increment('user-6', 60_000, LIMIT, 30_000, 'default');
    await storage.increment('user-6', 60_000, LIMIT, 30_000, 'default');
    await storage.increment('user-6', 60_000, LIMIT, 30_000, 'default'); // Block triggered

    // Subsequent hits during the block should short-circuit to isBlocked=true.
    const r = await storage.increment('user-6', 60_000, LIMIT, 30_000, 'default');
    expect(r.isBlocked).toBe(true);
    // Lua script returns the *current* hits without incrementing when blocked
    expect(r.totalHits).toBe(3); // not 4
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-instance shared counter — THE critical multi-pod property
// ═══════════════════════════════════════════════════════════════════════════

describe('RedisThrottlerStorage — cross-instance sharing (multi-pod)', () => {
  test('two separate storage objects share the same Redis counter', async () => {
    const pod1 = makeStorage();
    const pod2 = makeStorage();

    // Pod 1 hits 3 times
    await pod1.increment('shared-user', 60_000, 10, 30_000, 'default');
    await pod1.increment('shared-user', 60_000, 10, 30_000, 'default');
    await pod1.increment('shared-user', 60_000, 10, 30_000, 'default');

    // Pod 2 hits once — should see totalHits=4 (shared counter)
    const r = await pod2.increment('shared-user', 60_000, 10, 30_000, 'default');
    expect(r.totalHits).toBe(4);
  });

  test('block key on pod-1 is visible to pod-2 (consistent blocking across pods)', async () => {
    const pod1 = makeStorage();
    const pod2 = makeStorage();
    const LIMIT = 2;

    // Pod 1 drives over the limit → block set
    await pod1.increment('cross-block', 60_000, LIMIT, 30_000, 'default');
    await pod1.increment('cross-block', 60_000, LIMIT, 30_000, 'default');
    const p1Over = await pod1.increment('cross-block', 60_000, LIMIT, 30_000, 'default');
    expect(p1Over.isBlocked).toBe(true);

    // Pod 2 IMMEDIATELY sees the block (same Redis key)
    const p2Try = await pod2.increment('cross-block', 60_000, LIMIT, 30_000, 'default');
    expect(p2Try.isBlocked).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Parallel race — Lua INCR is atomic
// ═══════════════════════════════════════════════════════════════════════════

describe('RedisThrottlerStorage — race safety', () => {
  test('100 parallel hits → final counter is exactly 100 (atomic INCR)', async () => {
    const storage = makeStorage();
    const runs = Array.from({ length: 100 }, () =>
      storage.increment('race-user', 60_000, 1_000_000, 30_000, 'default'),
    );
    const results = await Promise.all(runs);
    const max = Math.max(...results.map(r => r.totalHits));
    expect(max).toBe(100);

    // Direct Redis read also confirms
    const raw = await ctx.redis.get('throttle:default:race-user');
    expect(Number(raw)).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fail-open when Redis unreachable
// ═══════════════════════════════════════════════════════════════════════════

describe('RedisThrottlerStorage — fail-open on Redis unavailability', () => {
  test('Redis unreachable → returns {totalHits:0, isBlocked:false} (do not drop traffic)', async () => {
    // Point at a port that will refuse the connection.
    const dead = new Redis({ host: '127.0.0.1', port: 6, lazyConnect: true, maxRetriesPerRequest: 1 });
    const stub = { getClient: () => dead } as any;
    const storage = new RedisThrottlerStorage(stub);
    storage.onModuleInit();

    const r = await storage.increment('dead', 60_000, 5, 30_000, 'default');
    // Fail-open: no block, counter stays at 0
    expect(r.isBlocked).toBe(false);
    expect(r.totalHits).toBe(0);

    dead.disconnect();
  });
});
