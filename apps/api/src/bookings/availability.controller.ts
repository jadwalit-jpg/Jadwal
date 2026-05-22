import { Controller, Get, Param, Query, BadRequestException } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { BookingsService } from './bookings.service';

/**
 * Availability — public, unauthenticated endpoints.
 * Uses the 'availability' throttler (THROTTLE_AVAILABILITY_LIMIT env var, default 30/min).
 * Skips the 'short' and 'long' global throttlers — those are for authenticated endpoints.
 */
@Controller('availability')
@Public()
@SkipThrottle({ short: true, long: true })
@Throttle({ availability: {} })
export class AvailabilityController {
  constructor(private bookingsService: BookingsService) {}

  @Get('hourly/:activityId')
  hourly(
    @Param('activityId') activityId: string,
    @Query('date') date: string,
  ) {
    return this.bookingsService.getHourlyAvailability(activityId, date);
  }

  @Get('daily/:activityId')
  daily(
    @Param('activityId') activityId: string,
    @Query('checkInDate') checkInDate: string,
    @Query('checkOutDate') checkOutDate: string,
    @Query('unitNumber') unitNumber?: string,
  ) {
    const parsedUnit = unitNumber !== undefined ? parseInt(unitNumber, 10) : undefined;
    if (parsedUnit !== undefined && (isNaN(parsedUnit) || parsedUnit < 1)) {
      throw new BadRequestException('unitNumber must be a positive integer');
    }
    return this.bookingsService.getDailyAvailability(
      activityId, checkInDate, checkOutDate, parsedUnit,
    );
  }

  /**
   * Monthly calendar availability — returns per-day capacity, bookings, and pricing.
   * Used by the customer-facing date picker to show available/blocked dates.
   * GET /availability/calendar/:activityId?month=2026-03
   */
  @Get('calendar/:activityId')
  calendar(
    @Param('activityId') activityId: string,
    @Query('month') month: string,
    @Query('unitNumber') unitNumber?: string,
  ) {
    const parsedUnit = unitNumber !== undefined ? parseInt(unitNumber, 10) : undefined;
    if (parsedUnit !== undefined && (isNaN(parsedUnit) || parsedUnit < 1)) {
      throw new BadRequestException('unitNumber must be a positive integer');
    }
    return this.bookingsService.getCalendarAvailability(
      activityId, month, parsedUnit,
    );
  }
}
