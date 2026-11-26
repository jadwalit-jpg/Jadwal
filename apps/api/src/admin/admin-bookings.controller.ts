import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/request-user.interface';
import { RATE_LIMIT_ADMIN, RATE_LIMIT_WRITE } from '../common/throttle-config';
import { AdminAuditInterceptor } from './interceptors/audit.interceptor';
import { BookingRescheduleService } from './booking-reschedule.service';
import { RescheduleBookingDto, ReschedulePreviewQueryDto } from './dto/reschedule-booking.dto';

/**
 * Admin booking actions that are not a status change. Same guards and audit
 * interceptor as AdminController; `admin/bookings` stays the route prefix the
 * list and the status endpoint already use.
 */
@Controller('admin/bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@UseInterceptors(AdminAuditInterceptor)
@Throttle(RATE_LIMIT_ADMIN)
export class AdminBookingsController {
  constructor(private readonly reschedules: BookingRescheduleService) {}

  /** New dates, new price and difference for a date change. Writes nothing. */
  @Get(':id/reschedule-preview')
  previewReschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ReschedulePreviewQueryDto,
  ) {
    return this.reschedules.preview(id, query);
  }

  /** Move the booking. Audited as RESCHEDULE_BOOKING (FINANCIAL) plus a detailed BOOKING_RESCHEDULED row. */
  @Post(':id/reschedule')
  @Throttle(RATE_LIMIT_WRITE)
  reschedule(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleBookingDto,
  ) {
    return this.reschedules.reschedule(id, { id: user.id, name: user.fullName || user.email }, dto);
  }
}
