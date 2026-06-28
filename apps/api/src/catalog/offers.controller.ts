import {
  Controller, Get, Post, Param, Query, UseGuards, ParseUUIDPipe, BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_READ, RATE_LIMIT_WRITE } from '../common/throttle-config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
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
  @Public()
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
      // Stable pagination — id tie-breaker on createdAt so two coupons
      // created in the same second don't shuffle across pages.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      skip: (page - 1) * limit,
    });

    return offers
      // Hide fully-claimed vouchers entirely — once the claim count hits the
      // usage limit there's nothing left to grab, so it shouldn't appear on the
      // offers page at all. (Claim count is the cap now, not redemptions; the
      // offers table is small — <~50 rows — so filtering post-fetch is fine.)
      .filter((o) => !(o.usageLimit && o._count.claimedBy >= o.usageLimit))
      .map((o) => ({
        id: o.id,
        discountType: o.discountType,
        discountValue: Number(o.discountValue),
        maxDiscount: o.maxDiscount ? Number(o.maxDiscount) : null,
        minOrderAmount: o.minOrderAmount ? Number(o.minOrderAmount) : null,
        expiresAt: o.validTo,
        claimedCount: o._count.claimedBy,
        isFull: false, // fully-claimed coupons are filtered out above
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

    // Atomically cap the number of CLAIMS at usageLimit so a limited voucher
    // can't be added to more wallets than it can ever serve (previously the
    // claim only checked usedCount — redemptions — so unlimited users could
    // claim a 1-use voucher and all but one were rejected at checkout). The
    // redemption-time conditional updateMany remains the hard cap on actual
    // uses. Serializable so two users can't both grab the last slot via a
    // stale count.
    await db.$transaction(async (tx) => {
      const existing = await tx.claimedCoupon.findUnique({
        where: { userId_couponId: { userId: user.id, couponId } },
      });
      if (existing) throw new BadRequestException('You have already claimed this offer');
      if (coupon.usageLimit) {
        const claimCount = await tx.claimedCoupon.count({ where: { couponId } });
        if (claimCount >= coupon.usageLimit) {
          throw new BadRequestException('This offer has reached its limit');
        }
      }
      await tx.claimedCoupon.create({ data: { userId: user.id, couponId } });
    }, { isolationLevel: 'Serializable' });

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
