import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { RedisLockService } from './redis-lock.service';
import { AvailabilityCacheService } from './availability-cache.service';

@Global()
@Module({
  providers: [RedisService, RedisThrottlerStorage, RedisLockService, AvailabilityCacheService],
  exports: [RedisService, RedisThrottlerStorage, RedisLockService, AvailabilityCacheService],
})
export class RedisModule {}
