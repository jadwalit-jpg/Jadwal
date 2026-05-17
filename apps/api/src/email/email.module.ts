import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email.service';
import { EmailQuotaService } from './email-quota.service';
import { EmailSuppressionService } from './email-suppression.service';
import { EmailUnsubscribeTokenService } from './email-unsubscribe-token.service';
import { EmailUnsubscribeController } from './email-unsubscribe.controller';
import { ResendEventsController } from './resend-events.controller';
import { OutboxDrainService } from './outbox-drain.service';
import { RedisModule } from '../redis/redis.module';
// SecurityLoggerService now provided globally by CommonModule.

@Global()
@Module({
  imports: [ConfigModule, RedisModule],
  controllers: [ResendEventsController, EmailUnsubscribeController],
  providers: [
    EmailService,
    EmailQuotaService,
    EmailSuppressionService,
    EmailUnsubscribeTokenService,
    // R4 — cron worker that drains the EmailOutbox (leader-locked). PrismaService
    // + RedisLockService come from the global Prisma/Redis modules; EmailService
    // is in this module. @Cron works via ScheduleModule.forRoot() in CommonModule.
    OutboxDrainService,
  ],
  exports: [
    EmailService,
    EmailQuotaService,
    EmailSuppressionService,
    EmailUnsubscribeTokenService,
  ],
})
export class EmailModule {}
