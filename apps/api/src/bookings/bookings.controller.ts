import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_WRITE, RATE_LIMIT_AUTH, RATE_LIMIT_READ } from '../common/throttle-config';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { RefundDecisionDto } from './dto/refund-decision.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Bookings — authenticated customer endpoints.
 * Customers must be logged in to create, view, or cancel bookings.
 *
 * POST   /bookings            — create a new booking
 * GET    /bookings/my         — list my bookings (paginated)
 * GET    /bookings/my/:id     — single booking detail
 * DELETE /bookings/:id/cancel — cancel a booking (restores seats automatically)
 */
@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(
    private bookingsService: BookingsService,
    private prisma: PrismaService,
  ) {}

  @Post()
  @Throttle(RATE_LIMIT_WRITE)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBookingDto) {
    if (user.role === 'ADMIN' || user.role === 'VENDOR') {
      throw new ForbiddenException('Only customers can create bookings');
    }
    return this.bookingsService.createBooking(user.id, dto);
  }

  @Get('my')
  @Throttle(RATE_LIMIT_READ)
  getMyBookings(
    @CurrentUser() user: RequestUser,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
  ) {
    const VALID_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];
    const safeStatus = status && VALID_STATUSES.includes(status.toUpperCase())
      ? (status.toUpperCase() as 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED')
      : undefined;
    return this.bookingsService.getMyBookings(
      user.id,
      Math.max(1, parseInt(page, 10) || 1),
      Math.max(1, parseInt(limit, 10) || 20),
      safeStatus,
    );
  }

  @Get('my/:id')
  @Throttle(RATE_LIMIT_READ)
  getOne(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.getBookingById(user.id, id);
  }

  @Delete(':id/cancel')
  @Throttle(RATE_LIMIT_AUTH)
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.cancelBooking(user.id, id);
  }

  /**
   * Record the vendor's or admin's decision on a pending refund request.
   * Guarded by JwtAuthGuard on the class + by service-layer RBAC (the
   * service verifies that the caller is either the owning vendor or admin).
   *
   * Rate-limited with RATE_LIMIT_AUTH so a compromised vendor session can't
   * spam decisions across many bookings quickly.
   */
  @Post(':id/refund-decision')
  @Throttle(RATE_LIMIT_AUTH)
  recordRefundDecision(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundDecisionDto,
  ) {
    if (user.role === 'CUSTOMER') {
      throw new ForbiddenException('Customers cannot decide their own refund requests');
    }
    return this.bookingsService.recordRefundDecision(
      user.id,
      user.role,
      id,
      dto.action,
      dto.amount,
      dto.note,
    );
  }

  /**
   * Validate a coupon code before booking — returns discount info or error.
   * Does NOT consume the coupon (that happens in createBooking).
   */
  @Get('validate-coupon')
  @Throttle(RATE_LIMIT_READ)
  async validateCoupon(
    @Query('code') code: string,
    @Query('activityId') activityId: string,
    @Query('amount') amount: string,
  ) {
    if (!code || !activityId) {
      throw new BadRequestException('Coupon code and activity ID are required');
    }

    const codeUpper = code.toUpperCase().trim();
    if (!/^[A-Z0-9_-]+$/.test(codeUpper)) {
      throw new BadRequestException('Invalid coupon code format');
    }

    const db = this.prisma.client;
    const coupon = await db.coupon.findUnique({
      where: { code: codeUpper },
      select: {
        id: true,
        code: true,
        discountType: true,
        discountValue: true,
        validFrom: true,
        validTo: true,
        usageLimit: true,
        usedCount: true,
        minOrderAmount: true,
        maxDiscount: true,
        status: true,
        vendorId: true,
      },
    });

    if (!coupon) throw new BadRequestException('Invalid coupon code');
    if (coupon.status !== 'APPROVED') throw new BadRequestException('This coupon is not active');

    const now = new Date();
    if (now < coupon.validFrom) throw new BadRequestException('This coupon is not yet valid');
    if (now > coupon.validTo) throw new BadRequestException('This coupon has expired');
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException('This coupon has reached its usage limit');
    }

    // Verify coupon belongs to the activity's vendor (vendor-specific coupons)
    if (coupon.vendorId) {
      const activity = await db.activity.findUnique({
        where: { id: activityId },
        select: { vendorId: true },
      });
      if (!activity) throw new BadRequestException('Activity not found');
      if (activity.vendorId !== coupon.vendorId) {
        throw new BadRequestException('This coupon is not valid for this activity');
      }
    }

    // Check minimum order amount
    const orderAmount = Number(amount) || 0;
    if (coupon.minOrderAmount && orderAmount < Number(coupon.minOrderAmount)) {
      throw new BadRequestException(`Minimum order amount is ${Number(coupon.minOrderAmount)}`);
    }

    // Calculate discount preview
    let discount = 0;
    if (coupon.discountType === 'PERCENTAGE') {
      discount = orderAmount * Number(coupon.discountValue) / 100;
      if (coupon.maxDiscount) discount = Math.min(discount, Number(coupon.maxDiscount));
    } else {
      discount = Math.min(Number(coupon.discountValue), orderAmount);
    }
    discount = Math.round(discount * 100) / 100;

    return {
      valid: true,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: Number(coupon.discountValue),
      maxDiscount: coupon.maxDiscount ? Number(coupon.maxDiscount) : null,
      discount,
    };
  }
}
