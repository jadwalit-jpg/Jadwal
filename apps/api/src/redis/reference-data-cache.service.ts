import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { RedisService } from './redis.service';

/**
 * Origin-side cache for slow-changing reference data — countries,
 * categories, cities, platform-info. Cloudflare CDN handles edge caching;
 * this service eliminates the DB hit on every CDN cache miss.
 *
 * Why versioned keys + INCR invalidation (mirrors AvailabilityCacheService):
 *   - Bumping `ref:<ns>:ver` implicitly invalidates ALL keys in the
 *     namespace without enumerating + deleting. Atomic, O(1).
 *   - Stale keys eventually expire by TTL — no cleanup cron needed.
 *
 * Fail-open semantics:
 *   - Any Redis error → returns null on get, no-ops on set/invalidate
 *   - Caller falls back to the DB; cache failure NEVER fails a request
 *   - Aligns with the C2 "cache invalidation must not fail writes" rule
 */
export type ReferenceNamespace =
  | 'countries'
  | 'categories'
  | 'cities'
  | 'platform-info';

// Allowlist on namespace + key bound — guards against control characters
// or unbounded growth. Real keys are short slugs / fixed identifiers.
const KEY_PART_RE = /^[A-Za-z0-9_-]{1,64}$/;

@Injectable()
export class ReferenceDataCacheService implements OnModuleInit {
  private readonly logger = new Logger(ReferenceDataCacheService.name);
  private redis!: Redis;
  private readonly enabled: boolean;
  private readonly ttlSec: number;
  private readonly maxPayloadBytes: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly config: ConfigService,
  ) {
    this.enabled = this.config.get('REFERENCE_CACHE_ENABLED', 'true') === 'true';
    // Default 1 h. Bounded [60, 86400] so a typo can't leave items either
    // un-cached (TTL too low) or stuck for days (TTL too high).
    const rawTtl = Number(this.config.get('REFERENCE_CACHE_TTL_SEC', '3600'));
    this.ttlSec =
      Number.isFinite(rawTtl) && rawTtl >= 60 && rawTtl <= 86_400 ? Math.floor(rawTtl) : 3600;
    // 256 KiB cap — countries (~6 rows × ~150 B = <2 KB) and full city
    // list (max scenario: ~500 cities globally × ~80 B = ~40 KB) fit
    // comfortably. Larger payloads bypass cache and go straight to DB.
    this.maxPayloadBytes = 256 * 1024;
  }

  onModuleInit() {
    this.redis = this.redisService.getClient();
  }

  private isSafeKey(key: string): boolean {
    return KEY_PART_RE.test(key);
  }

  private versionKey(namespace: ReferenceNamespace): string {
    return `ref:${namespace}:ver`;
  }

  private dataKey(namespace: ReferenceNamespace, version: number, key: string): string {
    return `ref:${namespace}:v${version}:${key}`;
  }

  private async getVersion(namespace: ReferenceNamespace): Promise<number> {
    const v = await this.redis.get(this.versionKey(namespace));
    if (!v) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  async get<T>(namespace: ReferenceNamespace, key: string): Promise<T | null> {
    if (!this.enabled) return null;
    if (!this.isSafeKey(key)) return null;
    try {
      const version = await this.getVersion(namespace);
      const raw = await this.redis.get(this.dataKey(namespace, version, key));
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      // Fail-open — caller falls through to DB on any cache error.
      const name = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`reference cache get failed (${name}) — falling back to DB`);
      return null;
    }
  }

  async set<T>(namespace: ReferenceNamespace, key: string, data: T): Promise<void> {
    if (!this.enabled) return;
    if (!this.isSafeKey(key)) return;
    try {
      const payload = JSON.stringify(data);
      if (payload.length > this.maxPayloadBytes) {
        this.logger.warn(
          `reference cache payload ${payload.length}B for ${namespace}:${key} exceeds cap — skipping`,
        );
        return;
      }
      const version = await this.getVersion(namespace);
      await this.redis.set(this.dataKey(namespace, version, key), payload, 'EX', this.ttlSec);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`reference cache set failed (${name})`);
    }
  }

  /**
   * Invalidate every key in a namespace by bumping the version counter.
   * Stale keys still exist in Redis under the old version prefix but are
   * unreachable and will expire naturally by TTL.
   */
  async invalidate(namespace: ReferenceNamespace): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.redis.incr(this.versionKey(namespace));
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`reference cache invalidate ${namespace} failed (${name})`);
    }
  }
}
