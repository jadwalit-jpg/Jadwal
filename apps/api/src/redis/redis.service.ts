import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.getOrThrow<string>('REDIS_URL');

    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      // Pin RESP2 across the ioredis 5 → 6 upgrade, which changed this default
      // to 3. Two independent reasons say RESP3 would probably have been fine:
      // our command surface is SET/GET/INCR/EVAL/pipeline with no pub-sub and
      // no map-returning commands (HGETALL/CONFIG), and v6's `replyMode`
      // defaults to "legacy", which keeps RESP2-shaped replies anyway.
      //
      // Pinning regardless, because of what this particular client backs: the
      // distributed LOCK that stops two customers booking the same slot, and
      // the rate-limiter storage, which is a security control. Both fail
      // silently when a reply is misread — a lock that never engages
      // double-books, a throttler that misreads its counter stops limiting.
      // Neither throws, and happy-path tests stay green through both.
      //
      // So the upgrade is reduced to a library version bump on a byte-identical
      // wire protocol, which is the whole point. Adopting RESP3 means deleting
      // this line as its own change, exercised against a real Redis.
      protocol: 2,
    });

    this.client.on('connect', () => this.logger.log('Redis connected'));
    // Log error class only — err.message from ioredis can include the full
    // connection URI (with password fragment) on misconfigured hosts.
    this.client.on('error', (err: Error) => this.logger.error(`Redis error (${err.name})`));
    this.client.on('reconnecting', () => this.logger.warn('Redis reconnecting…'));

    this.client.connect().catch((err: Error) => {
      this.logger.error(`Redis initial connection failed (${err.name})`);
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }
}
