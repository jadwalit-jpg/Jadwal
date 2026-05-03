import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email.service';
import { EmailQuotaService } from './email-quota.service';
import { EmailSuppressionService } from './email-suppression.service';
import { SesEventsController } from './ses-events.controller';
import { RedisModule } from '../redis/redis.module';

@Global()
@Module({
  imports: [ConfigModule, RedisModule],
  controllers: [SesEventsController],
  providers: [EmailService, EmailQuotaService, EmailSuppressionService],
  exports: [EmailService, EmailQuotaService, EmailSuppressionService],
})
export class EmailModule {}
