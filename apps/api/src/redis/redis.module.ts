import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { RedisLockService } from './redis-lock.service';
import { AvailabilityCacheService } from './availability-cache.service';
import { ReferenceDataCacheService } from './reference-data-cache.service';

@Global()
@Module({
  providers: [
    RedisService,
    RedisThrottlerStorage,
    RedisLockService,
    AvailabilityCacheService,
    ReferenceDataCacheService,
  ],
  exports: [
    RedisService,
    RedisThrottlerStorage,
    RedisLockService,
    AvailabilityCacheService,
    ReferenceDataCacheService,
  ],
})
export class RedisModule {}
