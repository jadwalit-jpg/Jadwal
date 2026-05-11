/**
 * ReferenceDataCacheService unit tests.
 *
 * Verifies the cache-aside contract used by the 5 public catalog endpoints
 * (countries / categories / cities / platform-info):
 *
 *   - Cache miss → returns null so caller hits DB
 *   - Cache hit  → returns parsed payload, no further Redis calls expected
 *   - Set        → writes JSON with SETEX
 *   - Invalidate → bumps version counter (cheap O(1), no key enumeration)
 *   - Fail-open  → any Redis error returns null on get / no-ops on set
 *   - Versioned keys → invalidate makes prior set unreachable
 */

import { ConfigService } from '@nestjs/config';
import { ReferenceDataCacheService } from '../../src/redis/reference-data-cache.service';

type MockClient = {
  get: jest.Mock;
  set: jest.Mock;
  incr: jest.Mock;
};

function makeMockClient(): MockClient {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue('OK'),
    incr: jest.fn().mockResolvedValue(1),
  };
}

function makeService(client: MockClient, ttl = 3600): ReferenceDataCacheService {
  const redisService = { getClient: () => client };
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'REFERENCE_CACHE_ENABLED') return 'true';
      if (key === 'REFERENCE_CACHE_TTL_SEC') return String(ttl);
      return fallback;
    }),
  } as unknown as ConfigService;
  const svc = new ReferenceDataCacheService(redisService as any, config);
  // Manually invoke onModuleInit (Nest does this in real DI lifecycle).
  svc.onModuleInit();
  return svc;
}

describe('ReferenceDataCacheService', () => {
  describe('get / set cache-aside', () => {
    test('cache miss returns null', async () => {
      const client = makeMockClient();
      client.get.mockResolvedValueOnce(null); // version lookup → 0
      client.get.mockResolvedValueOnce(null); // data lookup → miss
      const svc = makeService(client);

      const result = await svc.get('countries', 'active');

      expect(result).toBeNull();
    });

    test('cache hit returns parsed payload', async () => {
      const client = makeMockClient();
      client.get.mockResolvedValueOnce(null); // version → 0
      client.get.mockResolvedValueOnce(JSON.stringify([{ id: 'qa', nameEn: 'Qatar' }])); // data
      const svc = makeService(client);

      const result = await svc.get<unknown[]>('countries', 'active');

      expect(result).toEqual([{ id: 'qa', nameEn: 'Qatar' }]);
    });

    test('set stores with SETEX at configured TTL', async () => {
      const client = makeMockClient();
      client.get.mockResolvedValueOnce(null); // version lookup
      const svc = makeService(client, 3600);

      await svc.set('countries', 'active', [{ id: 'qa' }]);

      expect(client.set).toHaveBeenCalledWith(
        expect.stringContaining('ref:countries:'),
        JSON.stringify([{ id: 'qa' }]),
        'EX',
        3600,
      );
    });

    test('set silently skips when payload exceeds size cap', async () => {
      const client = makeMockClient();
      const svc = makeService(client);
      // 300 KiB payload — over the 256 KiB cap
      const huge = { data: 'x'.repeat(300 * 1024) };

      await svc.set('countries', 'active', huge);

      expect(client.set).not.toHaveBeenCalled();
    });
  });

  describe('invalidate (version-counter pattern)', () => {
    test('invalidate bumps the version key via INCR', async () => {
      const client = makeMockClient();
      const svc = makeService(client);

      await svc.invalidate('countries');

      expect(client.incr).toHaveBeenCalledWith('ref:countries:ver');
    });

    test('after invalidate, a prior set is unreachable (versioned namespace)', async () => {
      const client = makeMockClient();
      // Real-ish simulation: store keyed values, INCR bumps the version,
      // and any subsequent get uses the new version → original key missed.
      const store = new Map<string, string>();
      client.get.mockImplementation((key: string) => Promise.resolve(store.get(key) ?? null));
      client.set.mockImplementation((key: string, val: string) => {
        store.set(key, val);
        return Promise.resolve('OK');
      });
      let version = 0;
      client.incr.mockImplementation((key: string) => {
        if (key === 'ref:countries:ver') {
          version++;
          store.set(key, String(version));
        }
        return Promise.resolve(version);
      });

      const svc = makeService(client);

      // Initial set at version 0
      await svc.set('countries', 'active', [{ id: 'qa' }]);

      // First get hits the same version 0 → returns the data
      const first = await svc.get<unknown[]>('countries', 'active');
      expect(first).toEqual([{ id: 'qa' }]);

      // Invalidate bumps to version 1
      await svc.invalidate('countries');

      // Second get reads version 1 → no entry at that version → miss
      const second = await svc.get<unknown[]>('countries', 'active');
      expect(second).toBeNull();
    });
  });

  describe('fail-open semantics', () => {
    test('get returns null when Redis throws — caller falls through to DB', async () => {
      const client = makeMockClient();
      client.get.mockRejectedValueOnce(new Error('redis connection refused'));
      const svc = makeService(client);

      const result = await svc.get('countries', 'active');

      expect(result).toBeNull();
    });

    test('set no-ops when Redis throws — admin write succeeds anyway', async () => {
      const client = makeMockClient();
      client.get.mockResolvedValueOnce(null); // version
      client.set.mockRejectedValueOnce(new Error('OOM in Redis'));
      const svc = makeService(client);

      // Must not throw — fire-and-forget semantics required by C2 rule.
      await expect(svc.set('countries', 'active', [{ id: 'qa' }])).resolves.toBeUndefined();
    });

    test('invalidate no-ops when Redis throws — admin write completes', async () => {
      const client = makeMockClient();
      client.incr.mockRejectedValueOnce(new Error('redis down'));
      const svc = makeService(client);

      await expect(svc.invalidate('countries')).resolves.toBeUndefined();
    });
  });

  describe('key safety', () => {
    test('unsafe keys (control characters, oversize) no-op cleanly', async () => {
      const client = makeMockClient();
      const svc = makeService(client);

      // Newline / control char in key → KEY_PART_RE rejects → returns null
      const result = await svc.get('countries', "active\nDROP-TABLE");
      expect(result).toBeNull();
      // Should not have touched Redis at all.
      expect(client.get).not.toHaveBeenCalled();
    });

    test('UUID-shaped keys for cities-by-country are accepted', async () => {
      const client = makeMockClient();
      client.get.mockResolvedValueOnce(null); // version
      client.get.mockResolvedValueOnce(JSON.stringify([{ id: 'doha' }])); // data
      const svc = makeService(client);

      const result = await svc.get('cities', 'country-01234567-89ab-cdef-0123-456789abcdef');

      expect(result).toEqual([{ id: 'doha' }]);
    });
  });

  describe('disabled mode', () => {
    test('REFERENCE_CACHE_ENABLED=false returns null on get + no-ops on set/invalidate', async () => {
      const client = makeMockClient();
      const config = {
        get: jest.fn((key: string) => (key === 'REFERENCE_CACHE_ENABLED' ? 'false' : undefined)),
      } as unknown as ConfigService;
      const svc = new ReferenceDataCacheService({ getClient: () => client } as any, config);
      svc.onModuleInit();

      const result = await svc.get('countries', 'active');
      await svc.set('countries', 'active', [{ id: 'qa' }]);
      await svc.invalidate('countries');

      expect(result).toBeNull();
      expect(client.get).not.toHaveBeenCalled();
      expect(client.set).not.toHaveBeenCalled();
      expect(client.incr).not.toHaveBeenCalled();
    });
  });
});
