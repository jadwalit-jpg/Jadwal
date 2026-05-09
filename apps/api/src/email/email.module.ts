import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email.service';
import { EmailQuotaService } from './email-quota.service';
import { EmailSuppressionService } from './email-suppression.service';
import { EmailUnsubscribeTokenService } from './email-unsubscribe-token.service';
import { EmailUnsubscribeController } from './email-unsubscribe.controller';
import { SesEventsController } from './ses-events.controller';
import { SnsSignatureValidator } from './sns-signature-validator.service';
import { RedisModule } from '../redis/redis.module';
import { SecurityLoggerService } from '../common/services/security-logger.service';

@Global()
@Module({
  imports: [ConfigModule, RedisModule],
  controllers: [SesEventsController, EmailUnsubscribeController],
  providers: [
    EmailService,
    EmailQuotaService,
    EmailSuppressionService,
    EmailUnsubscribeTokenService,
    SecurityLoggerService,
    SnsSignatureValidator,
  ],
  exports: [
    EmailService,
    EmailQuotaService,
    EmailSuppressionService,
    EmailUnsubscribeTokenService,
  ],
})
export class EmailModule {}
