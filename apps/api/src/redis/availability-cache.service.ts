import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { RedisService } from './redis.service';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
// Cap on cacheable unitNumber — guards Redis against pollution from callers
// probing arbitrary integers. Legitimate activities never have more than a
// couple hundred units; anything beyond MAX_CACHEABLE_UNIT still computes
// correctly via the DB path, it just bypasses the cache.
const MAX_CACHEABLE_UNIT = 1000;

@Injectable()
export class AvailabilityCacheService implements OnModuleInit {
  private readonly logger = new Logger(AvailabilityCacheService.name);
  private redis!: Redis;
  private readonly enabled: boolean;
  private readonly ttlSec: number;
  private readonly maxPayloadBytes: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly config: ConfigService,
  ) {
    this.enabled = this.config.get('AVAILABILITY_CACHE_ENABLED', 'true') === 'true';
    const rawTtl = Number(this.config.get('AVAILABILITY_CACHE_TTL_SEC', '180'));
    this.ttlSec = Number.isFinite(rawTtl) && rawTtl > 0 && rawTtl <= 3600 ? Math.floor(rawTtl) : 180;
    this.maxPayloadBytes = 256 * 1024;
  }

  onModuleInit() {
    this.redis = this.redisService.getClient();
  }

  // Keys accept only uuid activityIds and YYYY-MM months. Anything else is treated
  // as a cache miss and never touches Redis — guards against injection of control
  // characters or wildcard patterns into keys. unitNumber (when present) must
  // be a positive integer below MAX_CACHEABLE_UNIT to bound cache cardinality.
  private isSafe(activityId: string, month: string, unitNumber?: number): boolean {
    if (!UUID_RE.test(activityId) || !MONTH_RE.test(month)) return false;
    if (unitNumber === undefined || unitNumber === null) return true;
    return (
      Number.isFinite(unitNumber) &&
      Number.isInteger(unitNumber) &&
      unitNumber >= 1 &&
      unitNumber <= MAX_CACHEABLE_UNIT
    );
  }

  private versionKey(activityId: string): string {
    return `avail:ver:${activityId}`;
  }

  private dataKey(activityId: string, version: number, month: string, unitNumber?: number): string {
    const unit = unitNumber === undefined || unitNumber === null ? 'all' : `u${Math.floor(unitNumber)}`;
    return `avail:${activityId}:v${version}:${month}:${unit}`;
  }

  private async getVersion(activityId: string): Promise<number> {
    const v = await this.redis.get(this.versionKey(activityId));
    if (!v) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  async get<T>(activityId: string, month: string, unitNumber?: number): Promise<T | null> {
    if (!this.enabled) return null;
    if (!this.isSafe(activityId, month, unitNumber)) return null;
    try {
      const version = await this.getVersion(activityId);
      const key = this.dataKey(activityId, version, month, unitNumber);
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      // Fail-open — caller falls through to DB on any cache error.
      const name = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`availability cache get failed (${name}) — falling back to DB`);
      return null;
    }
  }

  async set(activityId: string, month: string, data: unknown, unitNumber?: number): Promise<void> {
    if (!this.enabled) return;
    if (!this.isSafe(activityId, month, unitNumber)) return;
    try {
      const payload = JSON.stringify(data);
      if (payload.length > this.maxPayloadBytes) {
        this.logger.warn(`availability payload ${payload.length}B exceeds cap — skipping cache set`);
        return;
      }
      const version = await this.getVersion(activityId);
      const key = this.dataKey(activityId, version, month, unitNumber);
      await this.redis.set(key, payload, 'EX', this.ttlSec);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`availability cache set failed (${name})`);
    }
  }

  async invalidate(activityId: string): Promise<void> {
    if (!this.enabled) return;
    if (!UUID_RE.test(activityId)) return;
    try {
      await this.redis.incr(this.versionKey(activityId));
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`availability cache invalidate failed (${name})`);
    }
  }

  async invalidateMany(activityIds: ReadonlyArray<string>): Promise<void> {
    if (!this.enabled) return;
    const unique = [...new Set(activityIds.filter((id) => UUID_RE.test(id)))];
    if (unique.length === 0) return;
    try {
      const pipeline = this.redis.pipeline();
      for (const id of unique) pipeline.incr(this.versionKey(id));
      await pipeline.exec();
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`availability cache invalidateMany failed (${name})`);
    }
  }
}
