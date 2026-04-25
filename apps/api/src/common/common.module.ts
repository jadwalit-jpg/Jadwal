import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { UploadService } from './services/upload.service';
import { CleanupService } from './services/cleanup.service';
import { AuditLoggerService } from './services/audit-logger.service';
import { NotificationService } from './services/notification.service';
import { WebPushService } from './services/web-push.service';
import { LoyaltyService } from './services/loyalty.service';
import { NotificationController } from './controllers/notification.controller';
import { PushController } from './controllers/push.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule],
  controllers: [NotificationController, PushController],
  providers: [UploadService, CleanupService, AuditLoggerService, NotificationService, WebPushService, LoyaltyService],
  exports: [UploadService, CleanupService, AuditLoggerService, NotificationService, WebPushService, LoyaltyService],
})
export class CommonModule {}
