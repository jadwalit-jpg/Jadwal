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

  /**
   * Cron leader-election lock. Differs from acquire() in two ways:
   *
   * 1. Fail-CLOSED on Redis errors. Cron leader-election needs guaranteed
   *    deduplication: if Redis is unreachable we MUST NOT run the cron on
   *    every pod (the whole point of the lock). Skipping an iteration is
   *    safe because the cron runs again at the next interval. Contrast with
   *    booking-slot acquire() which is fail-OPEN — Postgres Serializable is
   *    the authoritative guard there, so a Redis outage is allowed to
   *    degrade lock-as-optimization gracefully.
   *
   * 2. Returns boolean (acquired or not), since cron callers don't need the
   *    lock token — withLeaderLock manages release internally.
   */
  private async tryAcquireForLeader(key: string, ttlMs: number): Promise<string | null> {
    const token = crypto.randomUUID();
    try {
      const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
      return result === 'OK' ? token : null;
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(`Redis leader-lock acquire failed (${name}) — skipping cron iteration`);
      return null;
    }
  }

  /**
   * Run `fn` only if this pod wins the leader-election for `lockKey`.
   *
   * When auto-scaling lifts the API service to N tasks, every task hits the
   * same @Cron() trigger. Without leader-election the work runs N times,
   * duplicating audit logs / loyalty points / coupon refunds. This helper
   * wraps the cron body so exactly one task wins each iteration.
   *
   * Returns the function's result on the winning pod, or null on losers.
   *
   * TTL guidance: pick max(2× cron interval, expected longest-run × 2). The
   * lock auto-expires before the next scheduled iteration so a crashed
   * leader doesn't permanently silence the cron. Releasing in finally
   * means a happy-path completion frees the lock immediately.
   *
   * Failure modes:
   *   - Redis unreachable     → acquire returns null → cron skipped this iteration
   *     (will retry next interval). This is the WHOLE point of fail-closed —
   *     better to miss one cron tick than run it on every pod.
   *   - fn throws             → lock released in finally → next pod can take
   *     over after the cron's interval (or sooner if TTL is short).
   *   - Pod crashes mid-cron  → lock auto-expires after ttlMs → another pod
   *     can take over at the next iteration.
   */
  async withLeaderLock<T>(
    lockKey: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    const token = await this.tryAcquireForLeader(lockKey, ttlMs);
    if (token === null) {
      // Another pod won, or Redis is down. Either way: silently skip.
      // Don't log per-skip — at scale this fires every 5 min on every
      // non-leader pod and would flood CloudWatch.
      return null;
    }
    try {
      return await fn();
    } finally {
      await this.release(lockKey, token);
    }
  }
}
