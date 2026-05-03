import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email.service';
import { EmailQuotaService } from './email-quota.service';
import { RedisModule } from '../redis/redis.module';

@Global()
@Module({
  imports: [ConfigModule, RedisModule],
  providers: [EmailService, EmailQuotaService],
  exports: [EmailService, EmailQuotaService],
})
export class EmailModule {}
