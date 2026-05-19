import {
  Controller, Post, Get, Param, Body, Query,
  UseGuards, ForbiddenException, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { RATE_LIMIT_INTERACTION, RATE_LIMIT_VENDOR, RATE_LIMIT_AUTH } from '../common/throttle-config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../common/services/notification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/request-user.interface';
import { CreateReviewDto } from './dto/create-review.dto';
import { ToggleLikeDto } from './dto/toggle-like.dto';

/**
 * Customer interactions — authenticated endpoints for likes, reviews.
 * Base URL: /customer
 */
@Controller('customer')
@UseGuards(JwtAuthGuard)
export class CustomerInteractionController {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  // ─── Likes ─────────────────────────────────────────────────

  /** Toggle like on an activity — creates if not exists, deletes if exists */
  @Post('likes/toggle')
  @Throttle(RATE_LIMIT_INTERACTION)
  async toggleLike(
    @CurrentUser() user: RequestUser,
    @Body() dto: ToggleLikeDto,
  ) {
    if (user.role !== 'CUSTOMER') throw new ForbiddenException('Only customers can like activities');

    // Verify activity exists, is active, and not soft-deleted (§B9)
    const activity = await this.prisma.client.activity.findFirst({
      where: { id: dto.activityId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!activity || activity.status !== 'ACTIVE') throw new NotFoundException('Activity not found');

    const existing = await this.prisma.client.like.findUnique({
      where: { activityId_userId: { activityId: dto.activityId, userId: user.id } },
    });

    if (existing) {
      await this.prisma.client.like.delete({ where: { id: existing.id } });
      return { liked: false };
    }

    await this.prisma.client.like.create({
      data: { activityId: dto.activityId, userId: user.id },
    });
    return { liked: true };
  }

  /** Get like status + count for a specific activity */
  @Get('likes/:activityId')
  @Throttle(RATE_LIMIT_VENDOR)
  async getLikeStatus(
    @CurrentUser() user: RequestUser,
    @Param('activityId') activityId: string,
  ) {
    const [count, myLike] = await Promise.all([
      this.prisma.client.like.count({ where: { activityId } }),
      this.prisma.client.like.findUnique({
        where: { activityId_userId: { activityId, userId: user.id } },
        select: { id: true },
      }),
    ]);
    return { count, liked: !!myLike };
  }

  /** Get all activities the current user has liked */
  @Get('likes')
  @Throttle(RATE_LIMIT_INTERACTION)
  async getMyLikes(@CurrentUser() user: RequestUser) {
    const likes = await this.prisma.client.like.findMany({
      where: { userId: user.id },
      select: {
        activityId: true,
        activity: {
          select: {
            id: true,
            titleEn: true,
            titleAr: true,
            slug: true,
            coverImage: true,
            pricePerPerson: true,
            pricingModel: true,
            city: { select: { nameEn: true, nameAr: true } },
            country: { select: { currencyCode: true, nameEn: true, nameAr: true } },
            _count: { select: { reviews: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return likes.map((l) => l.activity);
  }

  // ─── Reviews ───────────────────────────────────────────────

  /** Submit a review — customer must have a completed booking for this activity */
  @Post('reviews')
  @Throttle(RATE_LIMIT_AUTH)
  async createReview(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateReviewDto,
  ) {
    if (user.role !== 'CUSTOMER') throw new ForbiddenException('Only customers can write reviews');

    // §B9 — exclude soft-deleted activities (a deleted activity can't
    // accept new reviews even if the customer's old completed booking
    // would otherwise authorise it).
    const activity = await this.prisma.client.activity.findFirst({
      where: { id: dto.activityId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!activity || activity.status !== 'ACTIVE') throw new NotFoundException('Activity not found');

    // Check the customer has a completed booking for this activity
    const hasBooking = await this.prisma.client.booking.findFirst({
      where: {
        customerId: user.id,
        activityId: dto.activityId,
        status: { in: ['CONFIRMED', 'COMPLETED'] },
      },
      select: { id: true },
    });
    if (!hasBooking) throw new BadRequestException('You can only review activities you have booked');

    // Check they haven't already reviewed this activity. This is the fast
    // path / friendly message; the @@unique([activityId, customerId]) DB
    // constraint is the real backstop — two near-simultaneous submits both
    // pass this read, so the constraint (caught below) is what actually
    // prevents the duplicate row.
    const existingReview = await this.prisma.client.review.findFirst({
      where: { customerId: user.id, activityId: dto.activityId },
      select: { id: true },
    });
    if (existingReview) throw new BadRequestException('You have already reviewed this activity');

    let review;
    try {
      review = await this.prisma.client.review.create({
        data: {
          activityId: dto.activityId,
          customerId: user.id,
          rating: dto.rating,
          text: dto.text?.trim() || null,
        },
        include: {
          customer: { select: { fullName: true } },
          activity: { select: { titleEn: true, vendor: { select: { userId: true } } } },
        },
      });
    } catch (err) {
      // P2002 = unique-constraint violation → a concurrent request won the
      // race and created the review first. Same response as the pre-check.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('You have already reviewed this activity');
      }
      throw err;
    }

    // Notify vendor: new review received
    if (review.activity?.vendor) {
      this.notificationService.send({
        userId: review.activity.vendor.userId,
        type: 'REVIEW_RECEIVED',
        title: 'New Review',
        message: `${dto.rating}-star review on "${review.activity.titleEn}"`,
      });
    }

    return review;
  }
}
