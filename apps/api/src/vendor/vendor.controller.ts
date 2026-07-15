import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  ParseUUIDPipe,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VendorService } from './vendor.service';
import { BookingsService } from '../bookings/bookings.service';
import { UploadService } from '../common/services/upload.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TermsAcceptedGuard } from '../auth/guards/terms-accepted.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/request-user.interface';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { CreateActivityBlockDto } from './dto/create-activity-block.dto';
import { BulkDeleteBlocksDto } from './dto/bulk-delete-blocks.dto';
import { CreateSpecialPriceDto } from './dto/create-special-price.dto';
import { BulkSpecialPriceDto } from './dto/bulk-special-price.dto';
import { VendorPaginationDto } from './dto/vendor-query.dto';
import { UpdateVendorSettingsDto } from './dto/update-settings.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateVendorCouponDto } from './dto/create-coupon.dto';
import { VendorUpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { ReplyReviewDto } from './dto/reply-review.dto';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { RATE_LIMIT_VENDOR, RATE_LIMIT_WRITE, RATE_LIMIT_CALLBACK, RATE_LIMIT_STRICT, RATE_LIMIT_READ } from '../common/throttle-config';
import { VendorAuditInterceptor } from './interceptors/vendor-audit.interceptor';

@Controller('vendor')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(VendorAuditInterceptor)
@Roles('VENDOR' as any)
// Skip the global `long` (100/10min) + `availability` (30/min) named tiers so the
// intended 60/min VENDOR limit applies — otherwise the 30/min availability floor
// (for PUBLIC endpoints) silently caps authenticated vendor dashboard reads to
// ~30/min. Per-method @Throttle overrides on mutations (WRITE/STRICT) still apply.
@SkipThrottle({ long: true, availability: true })
@Throttle(RATE_LIMIT_VENDOR)
export class VendorController {
  constructor(
    private readonly vendorService: VendorService,
    private readonly bookingsService: BookingsService,
    private readonly uploadService: UploadService,
  ) {}

  // ─── Dashboard ────────────────────────────────────────────
  @Get('dashboard/stats')
  getDashboardStats(@CurrentUser() user: RequestUser) {
    return this.vendorService.getDashboardStats(user.id);
  }

  // ─── Activities CRUD ──────────────────────────────────────
  @Get('activities')
  getActivities(@CurrentUser() user: RequestUser, @Query() query: VendorPaginationDto) {
    return this.vendorService.getActivities(user.id, query);
  }

  @Get('activities/by-slug/:slug')
  getActivityBySlug(@CurrentUser() user: RequestUser, @Param('slug') slug: string) {
    return this.vendorService.getActivityBySlug(user.id, slug);
  }

  @Get('activities/:id')
  getActivity(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendorService.getActivity(user.id, id);
  }

  @Post('activities')
  @Throttle(RATE_LIMIT_WRITE)
  @UseGuards(TermsAcceptedGuard) // consent required to publish a listing (anti-bypass)
  createActivity(@CurrentUser() user: RequestUser, @Body() dto: CreateActivityDto) {
    return this.vendorService.createActivity(user.id, dto);
  }

  @Patch('activities/:id')
  @Throttle(RATE_LIMIT_WRITE)
  updateActivity(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.vendorService.updateActivity(user.id, id, dto);
  }

  @Delete('activities/:id')
  @Throttle(RATE_LIMIT_WRITE)
  deleteActivity(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendorService.deleteActivity(user.id, id);
  }

  @Patch('activities/:id/toggle')
  @Throttle(RATE_LIMIT_CALLBACK)
  toggleActivityStatus(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendorService.toggleActivityStatus(user.id, id);
  }

  // ─── Activity Blocks (availability locks) ─────────────────
  // List inherits the class RATE_LIMIT_VENDOR (60/min); mutations use
  // RATE_LIMIT_WRITE (10/min) like the other vendor writes. Ownership is
  // enforced in the service (activity scoped by vendorId).
  @Get('activities/:id/blocks')
  getActivityBlocks(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendorService.getActivityBlocks(user.id, id);
  }

  @Post('activities/:id/blocks')
  @Throttle(RATE_LIMIT_WRITE)
  createActivityBlock(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateActivityBlockDto,
  ) {
    return this.vendorService.createActivityBlock(user.id, id, dto);
  }

  @Delete('activities/:id/blocks/:blockId')
  @Throttle(RATE_LIMIT_WRITE)
  deleteActivityBlock(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('blockId', ParseUUIDPipe) blockId: string,
  ) {
    return this.vendorService.deleteActivityBlock(user.id, id, blockId);
  }

  @Post('activities/:id/blocks/bulk-delete')
  @Throttle(RATE_LIMIT_WRITE)
  deleteActivityBlocksBulk(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkDeleteBlocksDto,
  ) {
    return this.vendorService.deleteActivityBlocksBulk(user.id, id, dto.ids);
  }

  // ─── Special prices (per-date price overrides) ────────────
  // Same tiers as blocks: list inherits class RATE_LIMIT_VENDOR; mutations use
  // RATE_LIMIT_WRITE. Ownership enforced in the service (activity scoped by vendor).
  @Get('activities/:id/special-prices')
  getActivitySpecialPrices(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendorService.getActivitySpecialPrices(user.id, id);
  }

  @Post('activities/:id/special-prices')
  @Throttle(RATE_LIMIT_WRITE)
  createActivitySpecialPrice(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSpecialPriceDto,
  ) {
    return this.vendorService.createActivitySpecialPrice(user.id, id, dto);
  }

  @Post('activities/:id/special-prices/bulk')
  @Throttle(RATE_LIMIT_WRITE)
  bulkCreateActivitySpecialPrices(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkSpecialPriceDto,
  ) {
    return this.vendorService.bulkCreateActivitySpecialPrices(user.id, id, dto);
  }

  @Delete('activities/:id/special-prices/:priceId')
  @Throttle(RATE_LIMIT_WRITE)
  deleteActivitySpecialPrice(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('priceId', ParseUUIDPipe) priceId: string,
  ) {
    return this.vendorService.deleteActivitySpecialPrice(user.id, id, priceId);
  }

  // ─── Bookings ─────────────────────────────────────────────
  @Get('bookings')
  getBookings(@CurrentUser() user: RequestUser, @Query() query: VendorPaginationDto) {
    return this.vendorService.getBookings(user.id, query);
  }

  @Patch('bookings/:id/status')
  @Throttle(RATE_LIMIT_CALLBACK)
  updateBookingStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VendorUpdateBookingStatusDto,
  ) {
    return this.vendorService.updateBookingStatus(user.id, id, dto.status);
  }

  // ─── Refund Requests ─────────────────────────────────────
  // Queue of customer-cancelled bookings awaiting this vendor's refund decision.
  // Sits at the class-level RATE_LIMIT_VENDOR (60/min) — kept in line with the
  // rest of the vendor dashboard reads. The previous RATE_LIMIT_READ override
  // (15/min) was too tight for a busy vendor checking the queue during a
  // refund spike.
  @Get('refund-requests')
  getRefundRequests(@CurrentUser() user: RequestUser) {
    return this.bookingsService.getVendorRefundRequests(user.id);
  }

  // ─── Reviews ──────────────────────────────────────────────
  @Get('reviews')
  getReviews(@CurrentUser() user: RequestUser, @Query() query: VendorPaginationDto) {
    return this.vendorService.getReviews(user.id, query);
  }

  @Patch('reviews/:id/reply')
  @Throttle(RATE_LIMIT_WRITE)
  replyToReview(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyReviewDto,
  ) {
    return this.vendorService.replyToReview(user.id, id, dto.reply);
  }

  // ─── Earnings ─────────────────────────────────────────────
  @Get('earnings')
  getEarnings(@CurrentUser() user: RequestUser) {
    return this.vendorService.getEarnings(user.id);
  }

  // ─── Dashboard Revenue Chart ──────────────────────────────
  @Get('dashboard/revenue-chart')
  getRevenueChart(@CurrentUser() user: RequestUser) {
    return this.vendorService.getRevenueChart(user.id);
  }

  // ─── Settings ─────────────────────────────────────────────
  @Get('settings')
  getSettings(@CurrentUser() user: RequestUser) {
    return this.vendorService.getSettings(user.id);
  }

  @Patch('settings')
  @Throttle(RATE_LIMIT_STRICT)
  updateSettings(@CurrentUser() user: RequestUser, @Body() dto: UpdateVendorSettingsDto) {
    return this.vendorService.updateSettings(user.id, dto);
  }

  @Patch('settings/password')
  @Throttle(RATE_LIMIT_STRICT)
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) {
    return this.vendorService.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  // ─── Image Upload ─────────────────────────────────────────
  // Allow ADMIN here (overriding the class-level @Roles('VENDOR')) so the
  // admin panel can upload activity images when moderating / editing a
  // vendor's activity. No privilege escalation risk: the endpoint only
  // returns the S3 URL; the admin still has to set it on a specific
  // activity via the existing /admin/activities/:id PATCH endpoint which
  // is itself admin-gated. Method-level @Roles overrides class-level via
  // RolesGuard.getAllAndOverride().
  @Post('upload-image')
  @Throttle(RATE_LIMIT_CALLBACK)
  @Roles('VENDOR' as any, 'ADMIN' as any)
  @UseInterceptors(FileInterceptor('file', UploadService.diskStorageConfig('activities')))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    this.uploadService.validateFile(file);
    const url = await this.uploadService.upload(file, 'activities');
    return { url };
  }

  // ─── Coupons ──────────────────────────────────────────────
  @Get('coupons')
  getCoupons(@CurrentUser() user: RequestUser, @Query() query: VendorPaginationDto) {
    return this.vendorService.getCoupons(user.id, query);
  }

  @Post('coupons')
  @Throttle(RATE_LIMIT_WRITE)
  createCoupon(@CurrentUser() user: RequestUser, @Body() dto: CreateVendorCouponDto) {
    return this.vendorService.createCoupon(user.id, dto);
  }

  // ─── Payout Requests ─────────────────────────────────────
  @Get('payout-requests')
  getPayoutRequests(@CurrentUser() user: RequestUser, @Query() query: VendorPaginationDto) {
    return this.vendorService.getPayoutRequests(user.id, query);
  }

  // Exposes WHY the vendor can/can't request a payout right now so the
  // frontend can show the real reason next to a disabled button instead
  // of learning only via a failed POST.
  @Get('payout-requests/eligibility')
  @Throttle(RATE_LIMIT_READ)
  getPayoutEligibility(@CurrentUser() user: RequestUser) {
    return this.vendorService.getPayoutEligibility(user.id);
  }

  @Post('payout-requests')
  @Throttle(RATE_LIMIT_STRICT)
  requestPayout(@CurrentUser() user: RequestUser) {
    return this.vendorService.requestPayout(user.id);
  }

  // Clear a REJECTED payout request from the vendor's history. Service
  // rejects any other status + enforces ownership so a vendor cannot delete
  // another vendor's row even by guessing the id.
  @Delete('payout-requests/:id')
  @Throttle(RATE_LIMIT_WRITE)
  deletePayoutRequest(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendorService.deletePayoutRequest(user.id, id);
  }

  // ─── Per-Activity Analytics ──────────────────────────────
  @Get('analytics/activities')
  getActivityAnalytics(@CurrentUser() user: RequestUser) {
    return this.vendorService.getActivityAnalytics(user.id);
  }
}
