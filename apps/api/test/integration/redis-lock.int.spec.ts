/**
 * RedisLockService — SET NX PX + token-scoped DEL via Lua.
 *
 * Proves the distributed-lock contract that only a real Redis can verify:
 *   - Mutual exclusion across parallel acquire() calls
 *   - Token ownership prevents stale-holder accidentally unlocking a new one
 *   - TTL auto-expiry releases the lock even if holder crashes
 *   - buildSlotKey produces a canonical key format
 */

import { getTestContext } from './_setup';
import { RedisLockService } from '../../src/redis/redis-lock.service';

const ctx = getTestContext();

function makeLock() {
  const stub = { getClient: () => ctx.redis } as any;
  const lock = new RedisLockService(stub);
  lock.onModuleInit();
  return lock;
}

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

// ═══════════════════════════════════════════════════════════════════════════
// Basic acquire / release
// ═══════════════════════════════════════════════════════════════════════════

describe('RedisLockService — basic acquire / release', () => {
  test('first acquire returns a UUID token; key is set in Redis', async () => {
    const lock = makeLock();
    const token = await lock.acquire('booking_lock:activity-1:slot-a', 10_000);
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const raw = await ctx.redis.get('booking_lock:activity-1:slot-a');
    expect(raw).toBe(token);
  });

  test('second acquire on the same key while held → returns null (contention)', async () => {
    const lock = makeLock();
    const t1 = await lock.acquire('same-key', 10_000);
    expect(t1).not.toBeNull();

    const t2 = await lock.acquire('same-key', 10_000);
    expect(t2).toBeNull();
  });

  test('release clears the key, allowing a follow-up acquire', async () => {
    const lock = makeLock();
    const t1 = (await lock.acquire('rel-key', 10_000))!;
    await lock.release('rel-key', t1);

    const raw = await ctx.redis.get('rel-key');
    expect(raw).toBeNull();

    // A fresh acquire now succeeds
    const t2 = await lock.acquire('rel-key', 10_000);
    expect(t2).not.toBeNull();
    expect(t2).not.toBe(t1); // fresh token
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Token ownership — stale holder must NOT unlock a new owner
// ═══════════════════════════════════════════════════════════════════════════

describe('RedisLockService — token ownership guard', () => {
  test('release with wrong token is a no-op (lock stays held)', async () => {
    const lock = makeLock();
    const realToken = (await lock.acquire('owned-key', 10_000))!;

    // Attempt release with a made-up token
    await lock.release('owned-key', 'not-the-real-token');

    const raw = await ctx.redis.get('owned-key');
    expect(raw).toBe(realToken); // Still held by the rightful owner
  });

  test('stale holder (after TTL + new acquire) cannot release the new owner\'s lock', async () => {
    const lock = makeLock();

    // Holder 1: acquires with very short TTL
    const staleToken = (await lock.acquire('stale-key', 50))!;

    // Wait for TTL expiry
    await new Promise(r => setTimeout(r, 120));

    // Holder 2: now acquires the key (old one auto-expired)
    const freshToken = (await lock.acquire('stale-key', 10_000))!;
    expect(freshToken).not.toBe(staleToken);

    // Stale holder 1 thinks it still owns the lock and tries to release.
    // The Lua DEL must be guarded by token match — stale release must NOT
    // delete holder 2's active lock.
    await lock.release('stale-key', staleToken);

    const raw = await ctx.redis.get('stale-key');
    expect(raw).toBe(freshToken); // Fresh owner intact
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TTL auto-release
// ═══════════════════════════════════════════════════════════════════════════

describe('RedisLockService — TTL auto-release', () => {
  test('lock expires on its own after ttlMs even if never released', async () => {
    const lock = makeLock();
    const t = await lock.acquire('ttl-key', 100);
    expect(t).not.toBeNull();

    // Before expiry, second acquire fails
    expect(await lock.acquire('ttl-key', 100)).toBeNull();

    // After expiry
    await new Promise(r => setTimeout(r, 160));
    const retry = await lock.acquire('ttl-key', 10_000);
    expect(retry).not.toBeNull(); // Auto-expired → fresh acquire succeeds
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Parallel race — SET NX is atomic
// ═══════════════════════════════════════════════════════════════════════════

describe('RedisLockService — race safety', () => {
  test('50 parallel acquires on one key → exactly ONE wins', async () => {
    const lock = makeLock();
    const attempts = Array.from({ length: 50 }, () => lock.acquire('race-key', 30_000));
    const tokens = await Promise.all(attempts);

    const winners = tokens.filter(t => t !== null);
    const losers = tokens.filter(t => t === null);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(49);
  });

  test('same key across two RedisLockService instances still mutually excludes', async () => {
    const pod1 = makeLock();
    const pod2 = makeLock();
    const [t1, t2] = await Promise.all([
      pod1.acquire('pod-key', 30_000),
      pod2.acquire('pod-key', 30_000),
    ]);
    const winners = [t1, t2].filter(t => t !== null);
    expect(winners).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildSlotKey — canonical key format
// ═══════════════════════════════════════════════════════════════════════════

describe('RedisLockService.buildSlotKey', () => {
  test('includes all components with "all" fallback for null unitNumber', () => {
    const key = RedisLockService.buildSlotKey({
      activityId: 'act-123', date: '2030-06-15', slot: '10:00', unitNumber: null,
    });
    expect(key).toBe('booking_lock:act-123:2030-06-15:10:00:all');
  });

  test('uses numeric unit when provided', () => {
    const key = RedisLockService.buildSlotKey({
      activityId: 'act-123', date: '2030-06-15', slot: '10:00', unitNumber: 3,
    });
    expect(key).toBe('booking_lock:act-123:2030-06-15:10:00:3');
  });

  test('daily slot uses "daily" literal instead of HH:MM', () => {
    const key = RedisLockService.buildSlotKey({
      activityId: 'act-456', date: '2030-07-01', slot: 'daily', unitNumber: null,
    });
    expect(key).toBe('booking_lock:act-456:2030-07-01:daily:all');
  });
});
