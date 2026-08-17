import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service';
import type Redis from 'ioredis';

/**
 * Redis-backed ThrottlerStorage for @nestjs/throttler v6.
 *
 * Uses a Lua script for atomic increment + TTL set + block check.
 * All counters are scoped per pod by default (key includes throttlerName).
 * With Redis, counters are shared across ALL pods — correct for K8s/ECS.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleInit {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private redis!: Redis;

  // Lua script: atomic increment with TTL and block detection
  // KEYS[1] = hit counter key
  // KEYS[2] = block key
  // ARGV[1] = ttl in milliseconds
  // ARGV[2] = limit (max hits)
  // ARGV[3] = blockDuration in milliseconds
  private static readonly LUA_SCRIPT = `
    local hitKey   = KEYS[1]
    local blockKey = KEYS[2]
    local ttlMs    = tonumber(ARGV[1])
    local limit    = tonumber(ARGV[2])
    local blockMs  = tonumber(ARGV[3])

    -- Check if already blocked
    local blocked = redis.call('EXISTS', blockKey)
    if blocked == 1 then
      local blockTtl = redis.call('PTTL', blockKey)
      local hits = tonumber(redis.call('GET', hitKey) or '0')
      return { hits, 0, 1, blockTtl }
    end

    -- Increment hit counter
    local hits = redis.call('INCR', hitKey)

    -- Set TTL on first hit
    if hits == 1 then
      redis.call('PEXPIRE', hitKey, ttlMs)
    end

    local ttlRemaining = redis.call('PTTL', hitKey)
    if ttlRemaining < 0 then ttlRemaining = 0 end

    -- Check if we just exceeded the limit — set block key
    if hits > limit then
      redis.call('SET', blockKey, '1', 'PX', blockMs)
      local blockTtl = blockMs
      return { hits, ttlRemaining, 1, blockTtl }
    end

    return { hits, ttlRemaining, 0, 0 }
  `;

  constructor(private redisService: RedisService) {}

  onModuleInit() {
    this.redis = this.redisService.getClient();
  }

  async increment(
    key: string,
    ttl: number,          // ms
    limit: number,
    blockDuration: number, // ms
    throttlerName: string,
  ): Promise<{ totalHits: number; timeToExpire: number; isBlocked: boolean; timeToBlockExpire: number }> {
    const hitKey   = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:${throttlerName}:${key}:blocked`;

    // Short-circuit on a known-closed connection. Without this the
    // ioredis retry loop fires MaxRetriesPerRequestError + logs an ERROR
    // during app shutdown / integration-test teardown even though the
    // behaviour is identical to the catch below (fail open). ioredis
    // statuses: 'wait' | 'connecting' | 'connect' | 'ready' | 'close' |
    // 'end' | 'reconnecting'. Any non-live status means real commands
    // won't succeed — exit quietly.
    const status = this.redis.status;
    if (status === 'end' || status === 'close') {
      return { totalHits: 0, timeToExpire: ttl, isBlocked: false, timeToBlockExpire: 0 };
    }

    try {
      const result = await this.redis.eval(
        RedisThrottlerStorage.LUA_SCRIPT,
        2,
        hitKey,
        blockKey,
        ttl.toString(),
        limit.toString(),
        blockDuration.toString(),
      ) as [number, number, number, number];

      return {
        totalHits:        result[0],
        timeToExpire:     result[1],
        isBlocked:        result[2] === 1,
        timeToBlockExpire: result[3],
      };
    } catch (err: unknown) {
      // Log only the error class — err.message may contain ElastiCache
      // hostnames or auth state that shouldn't land in log aggregators.
      // MaxRetriesPerRequestError + ClusterAllFailedError during teardown
      // are downgraded to warn so the prod "Redis actually down" signal
      // stays at ERROR and isn't diluted by shutdown noise.
      const name = err instanceof Error ? err.name : 'UnknownError';
      const isShutdownRace = name === 'MaxRetriesPerRequestError' || name === 'ClusterAllFailedError';
      if (isShutdownRace) {
        this.logger.warn(`Redis throttler unavailable (${name}) — failing open`);
      } else {
        // Structured + stable token so this is ALARMABLE, not just readable.
        // Failing open is the right availability trade (a Redis blip must not
        // take the API down), but while it lasts EVERY rate limit is inert —
        // including /auth/login, OTP send and password reset. That window has
        // to be visible, so `event: RATE_LIMIT_FAIL_OPEN` is the token a
        // CloudWatch metric filter + alarm keys on. Error class only: err.message
        // can carry ElastiCache hostnames or auth state.
        this.logger.error({ event: 'RATE_LIMIT_FAIL_OPEN', errorClass: name });
      }
      // Fail open — do not block requests when Redis is down
      return { totalHits: 0, timeToExpire: ttl, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
