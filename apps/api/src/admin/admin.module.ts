import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAuditInterceptor } from './interceptors/audit.interceptor';
import { AdminBookingsController } from './admin-bookings.controller';
import { BookingRescheduleService } from './booking-reschedule.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminController, AdminBookingsController],
  providers: [AdminService, BookingRescheduleService, AdminAuditInterceptor],
})
export class AdminModule {}
