import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminPaymentsController } from './admin-payments.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAuditInterceptor } from './interceptors/audit.interceptor';

@Module({
  imports: [PrismaModule],
  controllers: [AdminController, AdminPaymentsController],
  providers: [AdminService, AdminAuditInterceptor],
})
export class AdminModule {}
