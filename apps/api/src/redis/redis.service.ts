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
