/**
 * Unit tests for SessionDenylistService (M5/M6) — the security-critical, hot-path
 * denylist. Pure unit (no live Redis/Postgres): config/redis/prisma are stubbed.
 *
 * These lock in the audit-hardened invariants:
 *   - isDenied FAILS OPEN (returns false) on a rejected read, a hanging read
 *     (bounded by the timeout), an empty family id, and a sync client throw.
 *   - denylistSession / denylistAllUserSessions FAIL SAFE (swallow errors) and
 *     write per-family markers with the access-token-bounded TTL.
 */

import { SessionDenylistService } from '../../src/redis/session-denylist.service';

type GetImpl = (key: string) => Promise<string | null>;

function make(getImpl: GetImpl, setImpl: jest.Mock = jest.fn().mockResolvedValue('OK')) {
  const client = { get: jest.fn(getImpl), set: setImpl };
  const redis = { getClient: () => client } as any;
  const config = {
    get: (k: string, d?: string) =>
      (({ JWT_EXPIRATION: '900', DENYLIST_READ_TIMEOUT_MS: '20' }) as Record<string, string>)[k] ?? d,
  } as any;
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { client: { refreshToken: { findMany } } } as any;
  const svc = new SessionDenylistService(config, redis, prisma);
  return { svc, client, findMany };
}

describe('SessionDenylistService.isDenied', () => {
  test('true when the family is marked', async () => {
    const { svc } = make(async () => '1');
    expect(await svc.isDenied('fam')).toBe(true);
  });

  test('false when there is no marker', async () => {
    const { svc } = make(async () => null);
    expect(await svc.isDenied('fam')).toBe(false);
  });

  test('empty / undefined family id → false, without hitting Redis', async () => {
    const { svc, client } = make(async () => '1');
    expect(await svc.isDenied(undefined)).toBe(false);
    expect(await svc.isDenied(null)).toBe(false);
    expect(await svc.isDenied('')).toBe(false);
    expect(client.get).not.toHaveBeenCalled();
  });

  test('FAIL-OPEN: a rejected read (Redis down) resolves false', async () => {
    const { svc } = make(async () => {
      throw new Error('Connection is closed');
    });
    expect(await svc.isDenied('fam')).toBe(false);
  });

  test('BOUNDED FAIL-OPEN: a hanging read resolves false via the timeout (does not stall auth)', async () => {
    const { svc } = make(() => new Promise<string | null>(() => {})); // never settles
    const start = Date.now();
    const result = await svc.isDenied('fam');
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    // Resolved by the ~20ms test timeout, NOT hung on the never-settling read.
    expect(elapsed).toBeLessThan(500);
  });

  test('getClient() throwing synchronously → false (fail open)', async () => {
    const config = {
      get: (k: string, d?: string) =>
        (({ JWT_EXPIRATION: '900', DENYLIST_READ_TIMEOUT_MS: '20' }) as Record<string, string>)[k] ?? d,
    } as any;
    const redis = {
      getClient: () => {
        throw new Error('no client');
      },
    } as any;
    const prisma = { client: { refreshToken: { findMany: jest.fn() } } } as any;
    const svc = new SessionDenylistService(config, redis, prisma);
    expect(await svc.isDenied('fam')).toBe(false);
  });
});

describe('SessionDenylistService.denylistSession', () => {
  test('no-op for null / undefined / empty family id', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const { svc, client } = make(async () => null, set);
    await svc.denylistSession(null);
    await svc.denylistSession(undefined);
    await svc.denylistSession('');
    expect(client.set).not.toHaveBeenCalled();
  });

  test('writes a per-family marker with the access-token-bounded TTL (900+60s)', async () => {
    const { svc, client } = make(async () => null);
    await svc.denylistSession('fam-1');
    expect(client.set).toHaveBeenCalledWith('denylist:sess:fam-1', '1', 'PX', (900 + 60) * 1000);
  });

  test('FAIL-SAFE: swallows a Redis write error', async () => {
    const set = jest.fn().mockRejectedValue(new Error('down'));
    const { svc } = make(async () => null, set);
    await expect(svc.denylistSession('fam-1')).resolves.toBeUndefined();
  });
});

describe('SessionDenylistService.denylistAllUserSessions', () => {
  test('denylists each DISTINCT active family read from the DB', async () => {
    const { svc, client, findMany } = make(async () => null);
    findMany.mockResolvedValueOnce([{ familyId: 'a' }, { familyId: 'b' }]);
    await svc.denylistAllUserSessions('u1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', rotatedAt: null }, distinct: ['familyId'] }),
    );
    expect(client.set).toHaveBeenCalledWith('denylist:sess:a', '1', 'PX', expect.any(Number));
    expect(client.set).toHaveBeenCalledWith('denylist:sess:b', '1', 'PX', expect.any(Number));
  });

  test('FAIL-SAFE: swallows a DB read error', async () => {
    const { svc, findMany } = make(async () => null);
    findMany.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.denylistAllUserSessions('u1')).resolves.toBeUndefined();
  });
});

describe('SessionDenylistService.denylistUserSessionsExcept', () => {
  test('excludes the kept family from the DB query', async () => {
    const { svc, findMany } = make(async () => null);
    findMany.mockResolvedValueOnce([{ familyId: 'other' }]);
    await svc.denylistUserSessionsExcept('u1', 'keep-me');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', rotatedAt: null, familyId: { not: 'keep-me' } },
        distinct: ['familyId'],
      }),
    );
  });
});
