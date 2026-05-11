import {
  Controller, Get, Post, Param, Query, UseGuards, ParseUUIDPipe, BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_READ, RATE_LIMIT_WRITE } from '../common/throttle-config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationDto } from '../common/dto/pagination.dto';

/**
 * Offers — platform vouchers (admin-created coupons, no vendorId).
 * Customers can view and claim them. Coupon code is NEVER exposed.
 */
@Controller('offers')
export class OffersController {
  constructor(private prisma: PrismaService) {}

  /**
   * List active platform vouchers (public — no auth required).
   * Only shows admin coupons (vendorId = null), APPROVED, not expired.
   * NEVER returns the coupon code.
   */
  @Get()
  @Throttle(RATE_LIMIT_READ)
  async listOffers(@Query() query: PaginationDto) {
    const now = new Date();
    // Default 50 / max 200 from PaginationDto. Today's offer table is small
    // (<20 active platform coupons) so default-50 covers every realistic
    // view; the cap kicks in if the table grows past a few hundred.
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const offers = await this.prisma.client.coupon.findMany({
      where: {
        vendorId: null,
        status: 'APPROVED',
        validFrom: { lte: now },
        validTo: { gt: now },
      },
      select: {
        id: true,
        discountType: true,
        discountValue: true,
        maxDiscount: true,
        minOrderAmount: true,
        validTo: true,
        usageLimit: true,
        usedCount: true,
        _count: { select: { claimedBy: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
    });

    return offers.map((o) => ({
      id: o.id,
      discountType: o.discountType,
      discountValue: Number(o.discountValue),
      maxDiscount: o.maxDiscount ? Number(o.maxDiscount) : null,
      minOrderAmount: o.minOrderAmount ? Number(o.minOrderAmount) : null,
      expiresAt: o.validTo,
      claimedCount: o._count.claimedBy,
      isFull: o.usageLimit ? o.usedCount >= o.usageLimit : false,
    }));
  }

  /**
   * Claim a voucher (requires login, customer only).
   */
  @Post(':id/claim')
  @Throttle(RATE_LIMIT_WRITE)
  @UseGuards(JwtAuthGuard)
  async claimOffer(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) couponId: string,
  ) {
    if (user.role !== 'CUSTOMER') {
      throw new BadRequestException('Only customers can claim offers');
    }

    const db = this.prisma.client;
    const now = new Date();

    // Verify coupon is a valid platform voucher
    const coupon = await db.coupon.findUnique({
      where: { id: couponId },
      select: { id: true, vendorId: true, status: true, validFrom: true, validTo: true, usageLimit: true, usedCount: true },
    });

    if (!coupon) throw new BadRequestException('Offer not found');
    if (coupon.vendorId) throw new BadRequestException('This is not a platform offer');
    if (coupon.status !== 'APPROVED') throw new BadRequestException('This offer is not available');
    if (now < coupon.validFrom) throw new BadRequestException('This offer is not yet active');
    if (now > coupon.validTo) throw new BadRequestException('This offer has expired');
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException('This offer has reached its limit');
    }

    // Check if already claimed
    const existing = await db.claimedCoupon.findUnique({
      where: { userId_couponId: { userId: user.id, couponId } },
    });
    if (existing) throw new BadRequestException('You have already claimed this offer');

    await db.claimedCoupon.create({
      data: { userId: user.id, couponId },
    });

    return { message: 'Offer claimed successfully' };
  }

  /**
   * Get customer's claimed vouchers (unused only, not expired).
   */
  @Get('my-vouchers')
  @Throttle(RATE_LIMIT_READ)
  @UseGuards(JwtAuthGuard)
  async getMyVouchers(@CurrentUser() user: RequestUser) {
    const now = new Date();

    const claimed = await this.prisma.client.claimedCoupon.findMany({
      where: {
        userId: user.id,
        used: false,
        coupon: {
          status: 'APPROVED',
          validTo: { gt: now },
        },
      },
      select: {
        id: true,
        coupon: {
          select: {
            id: true,
            discountType: true,
            discountValue: true,
            maxDiscount: true,
            minOrderAmount: true,
            validTo: true,
          },
        },
        claimedAt: true,
      },
      orderBy: { claimedAt: 'desc' },
    });

    // NEVER return coupon code — customer doesn't need it
    return claimed.map((c) => ({
      claimId: c.id,
      couponId: c.coupon.id,
      discountType: c.coupon.discountType,
      discountValue: Number(c.coupon.discountValue),
      maxDiscount: c.coupon.maxDiscount ? Number(c.coupon.maxDiscount) : null,
      minOrderAmount: c.coupon.minOrderAmount ? Number(c.coupon.minOrderAmount) : null,
      expiresAt: c.coupon.validTo,
      claimedAt: c.claimedAt,
    }));
  }
}
