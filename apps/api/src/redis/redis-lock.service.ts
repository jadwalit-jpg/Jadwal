import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisService } from './redis.service';
import * as crypto from 'crypto';
import type Redis from 'ioredis';

/**
 * Distributed lock service using Redis SET NX PX.
 *
 * Used for booking slot locks: prevents multiple pods from simultaneously
 * attempting to book the same slot, reducing serialization errors under load.
 *
 * Lock ownership is tracked with a random token — only the lock holder can
 * release it (prevents accidental release of another pod's lock on timeout).
 */
@Injectable()
export class RedisLockService implements OnModuleInit {
  private readonly logger = new Logger(RedisLockService.name);
  private redis!: Redis;

  // Lua: release lock only if token matches (atomic check + delete)
  private static readonly RELEASE_SCRIPT = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    else
      return 0
    end
  `;

  constructor(private redisService: RedisService) {}

  onModuleInit() {
    this.redis = this.redisService.getClient();
  }

  /**
   * Acquire a lock for the given key.
   *
   * @param key      - Lock key (e.g. "booking_lock:activityId:2026-03-24:14:00")
   * @param ttlMs    - Lock TTL in milliseconds (default: 30s)
   * @returns        The lock token (hold this to release), or null if lock is taken
   */
  async acquire(key: string, ttlMs = 30_000): Promise<string | null> {
    const token = crypto.randomUUID();
    try {
      const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
      return result === 'OK' ? token : null;
    } catch (err: unknown) {
      // Log only the error class name — never err.message or the lock key.
      // ioredis messages can contain ElastiCache hostnames, auth state
      // (WRONGPASS/NOAUTH), or internal IPs; the key would reveal activityId.
      const name = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(`Redis lock acquire failed (${name})`);
      // Deliberate fail-open. Postgres Serializable isolation + the active-
      // booking row check in bookings.service.ts are the authoritative conflict
      // guard; the Redis lock is only an optimization to reduce P2034 retries
      // under normal load. Flipping to fail-closed would make Redis a hard
      // dependency for the entire booking flow — trading a rare UX improvement
      // (slightly fewer 409 "slot busy" responses during a Redis outage) for a
      // critical new SPOF. Do not "fix" this without reading ADR-0001.
      return token;
    }
  }

  /**
   * Release a lock. No-op if the token doesn't match (lock already expired or
   * taken by another pod after TTL).
   */
  async release(key: string, token: string): Promise<void> {
    try {
      await this.redis.eval(RedisLockService.RELEASE_SCRIPT, 1, key, token);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`Redis lock release failed (${name})`);
    }
  }

  /**
   * Build a canonical lock key for a booking slot.
   *
   * Format: booking_lock:{activityId}:{date}:{slot}:{unitNumber}
   */
  static buildSlotKey(params: {
    activityId: string;
    date: string;
    slot: string;      // "HH:MM" for hourly, "daily" for daily
    unitNumber?: number | null;
  }): string {
    const unit = params.unitNumber ?? 'all';
    return `booking_lock:${params.activityId}:${params.date}:${params.slot}:${unit}`;
  }
}
