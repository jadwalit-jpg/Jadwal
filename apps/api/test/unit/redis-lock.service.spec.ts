/**
 * RedisLockService unit tests.
 *
 * Covers:
 *   - acquire(): SET NX returns OK → token, NIL → null, error → fail-OPEN (token returned)
 *   - release(): runs the Lua script, swallows errors
 *   - withLeaderLock: fail-CLOSED on Redis error (skip cron), runs fn on win,
 *     releases on success AND on throw, no-op on lose
 *   - tryAcquireForLeader (private but exercised via withLeaderLock):
 *     fail-CLOSED returns null on Redis throw
 *
 * The contrast between acquire() (fail-open) and withLeaderLock (fail-closed)
 * is the load-bearing invariant — it's what lets booking lock degrade
 * gracefully under Redis outage while cron leader-election skips cleanly.
 */

import { RedisLockService } from '../../src/redis/redis-lock.service';

type MockRedis = {
  set: jest.Mock;
  eval: jest.Mock;
};

function makeService(redis: MockRedis): RedisLockService {
  const svc = new RedisLockService({ getClient: () => redis } as any);
  // onModuleInit is normally called by Nest's lifecycle; call it manually here.
  svc.onModuleInit();
  return svc;
}

describe('RedisLockService.acquire (fail-OPEN for booking locks)', () => {
  test('returns the random token when SET NX succeeds (returned OK)', async () => {
    const redis = { set: jest.fn().mockResolvedValue('OK'), eval: jest.fn() };
    const svc = makeService(redis);
    const token = await svc.acquire('k', 5000);
    expect(token).toMatch(/^[0-9a-f-]{36}$/i);
    // Verify SET NX PX ms key/token contract
    expect(redis.set).toHaveBeenCalledWith('k', token, 'PX', 5000, 'NX');
  });

  test('returns null when SET NX returns nil (lock already held)', async () => {
    const redis = { set: jest.fn().mockResolvedValue(null), eval: jest.fn() };
    const svc = makeService(redis);
    const token = await svc.acquire('k', 5000);
    expect(token).toBeNull();
  });

  test('FAIL-OPEN: returns a token even if Redis throws (booking-lock semantics)', async () => {
    const redis = {
      set: jest.fn().mockRejectedValue(new Error('CONNECTION_BROKEN')),
      eval: jest.fn(),
    };
    const svc = makeService(redis);
    const token = await svc.acquire('k', 5000);
    expect(token).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe('RedisLockService.release', () => {
  test('runs the release Lua script with key + token', async () => {
    const redis = { set: jest.fn(), eval: jest.fn().mockResolvedValue(1) };
    const svc = makeService(redis);
    await svc.release('k', 'tok');
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'k', 'tok');
    const luaScript = redis.eval.mock.calls[0][0] as string;
    expect(luaScript).toContain("redis.call('GET'");
    expect(luaScript).toContain("redis.call('DEL'");
  });

  test('swallows redis errors (warn-only)', async () => {
    const redis = {
      set: jest.fn(),
      eval: jest.fn().mockRejectedValue(new Error('NETWORK')),
    };
    const svc = makeService(redis);
    await expect(svc.release('k', 'tok')).resolves.toBeUndefined();
  });
});

describe('RedisLockService.withLeaderLock (fail-CLOSED for crons)', () => {
  test('runs fn + releases lock on the winning pod', async () => {
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),  // we win
      eval: jest.fn().mockResolvedValue(1),
    };
    const svc = makeService(redis);
    const fn = jest.fn().mockResolvedValue('done');

    const out = await svc.withLeaderLock('cron:foo', 10_000, fn);

    expect(out).toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('cron:foo', expect.any(String), 'PX', 10_000, 'NX');
    // Release was called with the same token that was set
    const setToken = redis.set.mock.calls[0][1];
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'cron:foo', setToken);
  });

  test('skips fn + returns null when another pod holds the lock', async () => {
    const redis = {
      set: jest.fn().mockResolvedValue(null),  // we lose
      eval: jest.fn(),
    };
    const svc = makeService(redis);
    const fn = jest.fn();

    const out = await svc.withLeaderLock('cron:foo', 10_000, fn);

    expect(out).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    // No release call — we never acquired
    expect(redis.eval).not.toHaveBeenCalled();
  });

  test('FAIL-CLOSED: skips fn when Redis is unreachable (does NOT run on every pod)', async () => {
    const redis = {
      set: jest.fn().mockRejectedValue(new Error('CONNECTION_BROKEN')),
      eval: jest.fn(),
    };
    const svc = makeService(redis);
    const fn = jest.fn();

    const out = await svc.withLeaderLock('cron:foo', 10_000, fn);

    expect(out).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  test('releases the lock even if fn throws', async () => {
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      eval: jest.fn().mockResolvedValue(1),
    };
    const svc = makeService(redis);
    const fn = jest.fn().mockRejectedValue(new Error('cron blew up'));

    await expect(svc.withLeaderLock('cron:foo', 10_000, fn)).rejects.toThrow('cron blew up');

    // Lock was still released
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'cron:foo', expect.any(String));
  });

  test('TTL is honoured (passes correct PX value to Redis)', async () => {
    const redis = { set: jest.fn().mockResolvedValue('OK'), eval: jest.fn() };
    const svc = makeService(redis);
    await svc.withLeaderLock('cron:bar', 60 * 60_000, async () => 'ok');
    expect(redis.set).toHaveBeenCalledWith(
      'cron:bar', expect.any(String), 'PX', 3_600_000, 'NX',
    );
  });
});

describe('RedisLockService.buildSlotKey', () => {
  test('builds canonical key with all parts', () => {
    expect(
      RedisLockService.buildSlotKey({
        activityId: 'abc',
        date: '2026-05-02',
        slot: '14:00',
        unitNumber: 3,
      }),
    ).toBe('booking_lock:abc:2026-05-02:14:00:3');
  });

  test('uses "all" sentinel when unitNumber is null/undefined', () => {
    expect(
      RedisLockService.buildSlotKey({ activityId: 'abc', date: '2026-05-02', slot: 'daily' }),
    ).toBe('booking_lock:abc:2026-05-02:daily:all');
  });
});
