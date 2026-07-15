import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { RedisLockService } from './redis-lock.service';
import { AvailabilityCacheService } from './availability-cache.service';
import { ReferenceDataCacheService } from './reference-data-cache.service';
import { SessionDenylistService } from './session-denylist.service';

@Global()
@Module({
  providers: [
    RedisService,
    RedisThrottlerStorage,
    RedisLockService,
    AvailabilityCacheService,
    ReferenceDataCacheService,
    SessionDenylistService,
  ],
  exports: [
    RedisService,
    RedisThrottlerStorage,
    RedisLockService,
    AvailabilityCacheService,
    ReferenceDataCacheService,
    SessionDenylistService,
  ],
})
export class RedisModule {}
