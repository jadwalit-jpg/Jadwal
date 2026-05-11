import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminService } from './admin.service';
import { UploadService } from '../common/services/upload.service';
import { CleanupService } from '../common/services/cleanup.service';
import { EmailSuppressionService } from '../email/email-suppression.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestUser } from '../auth/interfaces/request-user.interface';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaginationDto } from './dto/query-params.dto';
import { ExportPaginationDto } from '../common/dto/pagination.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { DeactivateUserDto } from './dto/deactivate-user.dto';
import { UpdateVendorStatusDto } from './dto/update-vendor-status.dto';
import { UpdateVendorTrustDto } from './dto/update-vendor-trust.dto';
import { UpdateActivityStatusDto } from './dto/update-activity-status.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { CreateCountryDto, UpdateCountryDto } from './dto/country.dto';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { CreateCityDto, UpdateCityDto } from './dto/city.dto';
import { UpdateCouponStatusDto } from './dto/coupon-status.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCommissionDto, UpdateVendorCommissionDto } from './dto/commission.dto';
import { CreateTrendingEventDto, UpdateTrendingEventDto } from './dto/trending-event.dto';
import { UpdatePlatformSettingsDto } from './dto/platform-settings.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { MarkPayoutPaidDto, MarkPayoutUnpaidDto } from './dto/payout.dto';
import { ProcessPayoutRequestDto } from './dto/process-payout-request.dto';
import { RevertPayoutRequestDto } from './dto/revert-payout-request.dto';
import { BulkVendorStatusDto, BulkActivityStatusDto, BulkDeleteUsersDto } from './dto/bulk-action.dto';
import { UpdateAdminProfileDto, ChangeAdminPasswordDto } from './dto/admin-profile.dto';
import { UpdateLoyaltyConfigDto, AdjustUserPointsDto } from './dto/loyalty.dto';
import { LoyaltyUserQueryDto } from './dto/loyalty-user-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_ADMIN, RATE_LIMIT_WRITE, RATE_LIMIT_CALLBACK, RATE_LIMIT_AUTH, RATE_LIMIT_STRICT, RATE_LIMIT_MINIMAL, RATE_LIMIT_READ } from '../common/throttle-config';
import { AdminAuditInterceptor } from './interceptors/audit.interceptor';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@UseInterceptors(AdminAuditInterceptor)
@Throttle(RATE_LIMIT_ADMIN) // generous for admin reads, overridden on mutations
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly uploadService: UploadService,
    private readonly cleanupService: CleanupService,
    private readonly suppressions: EmailSuppressionService,
  ) {}

  // ─── Diagnostic: real-IP verification ───────────────────────
  //
  // Returns what Express sees vs what Cloudflare set. Used ONCE post-deploy
  // to verify the trust-proxy + RealIpThrottlerGuard wiring. Gated behind
  // env flag DIAG_IP_CHECK so it returns 404 when the flag is anything
  // other than 'true' — keeps the endpoint dormant in production by default.
  //
  // Use:
  //   1. Set DIAG_IP_CHECK=true in ECS task definition env (separate revision).
  //   2. curl from your laptop (admin auth required):
  //        curl -H 'Cookie: Authentication=...' https://jadwal.qa/api/admin/diag/whoami
  //   3. Verify reqIp === cfConnectingIp === your real IP (e.g. ifconfig.me).
  //   4. Set DIAG_IP_CHECK=false (or unset) and roll a new task revision.
  @Get('diag/whoami')
  @Throttle(RATE_LIMIT_STRICT)
  diagWhoAmI(@Req() req: Request) {
    if (process.env.DIAG_IP_CHECK !== 'true') {
      // Hide the endpoint completely when disabled — same response as a
      // route that doesn't exist, no "feature not enabled" hint.
      throw new NotFoundException();
    }
    return {
      reqIp: req.ip ?? null,
      reqIps: req.ips ?? [],
      cfConnectingIp: req.headers['cf-connecting-ip'] ?? null,
      xForwardedFor: req.headers['x-forwarded-for'] ?? null,
      xForwardedProto: req.headers['x-forwarded-proto'] ?? null,
      socketRemote: req.socket?.remoteAddress ?? null,
      trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 0),
    };
  }

  // ─── Admin Profile ──────────────────────────────────────────
  @Get('profile')
  getAdminProfile(@CurrentUser() user: RequestUser) {
    return this.adminService.getAdminProfile(user.id);
  }

  @Patch('profile')
  @Throttle(RATE_LIMIT_WRITE)
  updateAdminProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdateAdminProfileDto) {
    return this.adminService.updateAdminProfile(user.id, dto);
  }

  // Password change is auth-sensitive — tight limiter to frustrate brute
  // force against the "current password" check and credential stuffing.
  @Patch('profile/password')
  @Throttle(RATE_LIMIT_STRICT)
  changeAdminPassword(@CurrentUser() user: RequestUser, @Body() dto: ChangeAdminPasswordDto) {
    return this.adminService.changeAdminPassword(user.id, dto.currentPassword, dto.newPassword);
  }

  // ─── Loyalty (WANASA) ───────────────────────────────────────
  @Get('loyalty/config')
  getLoyaltyConfig() { return this.adminService.getLoyaltyConfig(); }

  @Patch('loyalty/config')
  @Throttle(RATE_LIMIT_WRITE)
  updateLoyaltyConfig(@Body() dto: UpdateLoyaltyConfigDto) {
    return this.adminService.updateLoyaltyConfig(dto);
  }

  @Get('loyalty/users')
  getLoyaltyUsers(@Query() query: LoyaltyUserQueryDto) { return this.adminService.getLoyaltyUsers(query); }

  @Patch('loyalty/users/:id/points')
  @Throttle(RATE_LIMIT_WRITE)
  adjustUserPoints(
    @Param('id') id: string,
    @Body() dto: AdjustUserPointsDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.adminService.adjustUserPoints(id, dto.delta, dto.reason, actor.id);
  }

  // ─── Dashboard ──────────────────────────────────────────────
  @Get('dashboard/stats')
  getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  // ─── Users ──────────────────────────────────────────────────
  @Get('users')
  getUsers(@Query() query: PaginationDto) {
    return this.adminService.getUsers(query);
  }

  // Role escalation — tighter rate limit than ordinary writes because a
  // wave of automated role flips can compromise the whole platform fast.
  @Patch('users/:id/role')
  @Throttle(RATE_LIMIT_STRICT)
  updateUserRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    return this.adminService.updateUserRole(id, dto.role);
  }

  // Deactivate revokes sessions + hides data — destructive, use STRICT.
  @Patch('users/:id/deactivate')
  @Throttle(RATE_LIMIT_STRICT)
  deactivateUser(@Param('id') id: string, @Body() dto: DeactivateUserDto) {
    return this.adminService.deactivateUser(id, dto.isDeactivated);
  }

  @Delete('users/:id')
  @Throttle(RATE_LIMIT_WRITE)
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  // ─── Vendors ────────────────────────────────────────────────
  @Get('vendors/stats')
  getVendorStats() {
    return this.adminService.getVendorStats();
  }

  @Get('vendors')
  getVendors(@Query() query: PaginationDto) {
    return this.adminService.getVendors(query);
  }

  @Patch('vendors/:id/status')
  @Throttle(RATE_LIMIT_WRITE)
  updateVendorStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateVendorStatusDto,
  ) {
    return this.adminService.updateVendorStatus(id, dto.status, user.id);
  }

  @Patch('vendors/:id/trust')
  @Throttle(RATE_LIMIT_WRITE)
  updateVendorTrust(@Param('id') id: string, @Body() dto: UpdateVendorTrustDto) {
    return this.adminService.updateVendorTrust(id, dto.trustLevel);
  }

  // Commission affects every future payout — STRICT so a rogue script can't
  // sweep the whole vendor table at 120/min.
  @Patch('vendors/:id/commission')
  @Throttle(RATE_LIMIT_STRICT)
  updateVendorCommission(@Param('id') id: string, @Body() dto: UpdateVendorCommissionDto) {
    return this.adminService.updateVendorCommission(id, dto.commissionPct);
  }

  @Delete('vendors/:id')
  @Throttle(RATE_LIMIT_WRITE)
  deleteVendor(@Param('id') id: string) {
    return this.adminService.deleteVendor(id);
  }

  // ─── Activities ─────────────────────────────────────────────
  @Get('activities')
  getActivities(@Query() query: PaginationDto) {
    return this.adminService.getActivities(query);
  }

  @Get('activities/:id')
  getActivity(@Param('id') id: string) {
    return this.adminService.getActivity(id);
  }

  @Patch('activities/:id/status')
  @Throttle(RATE_LIMIT_WRITE)
  updateActivityStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateActivityStatusDto,
  ) {
    return this.adminService.updateActivityStatus(id, dto.status, user.id, dto.reason);
  }

  @Patch('activities/:id')
  @Throttle(RATE_LIMIT_WRITE)
  updateActivity(@Param('id') id: string, @Body() dto: UpdateActivityDto) {
    return this.adminService.updateActivity(id, dto);
  }

  @Patch('activities/:id/feature')
  @Throttle(RATE_LIMIT_WRITE)
  toggleFeatured(@Param('id') id: string) {
    return this.adminService.toggleFeatured(id);
  }

  // ─── Bookings ───────────────────────────────────────────────
  @Get('bookings')
  getBookings(@Query() query: PaginationDto) {
    return this.adminService.getBookings(query);
  }

  @Patch('bookings/:id/status')
  @Throttle(RATE_LIMIT_CALLBACK)
  updateBookingStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.adminService.updateBookingStatus(user.id, id, dto.status);
  }

  // ─── Payouts ────────────────────────────────────────────────
  @Get('payouts')
  getPayouts(@Query() query: PaginationDto) {
    return this.adminService.getPayouts(query);
  }

  @Post('payouts/mark-paid')
  @Throttle(RATE_LIMIT_WRITE)
  markPayoutsPaid(@Body() dto: MarkPayoutPaidDto) {
    return this.adminService.markPayoutsPaid(dto.paymentIds, dto.bankTransferRef);
  }

  // Revert a single PAID payment back to UNPAID. Destructive financial action
  // (reverses a vendor's settled balance), so gated at RATE_LIMIT_STRICT and
  // requires a typed reason at the DTO level.
  @Post('payouts/mark-unpaid')
  @Throttle(RATE_LIMIT_STRICT)
  markPayoutUnpaid(@Body() dto: MarkPayoutUnpaidDto, @CurrentUser() actor: RequestUser) {
    return this.adminService.markPayoutUnpaid(dto.paymentId, actor.id);
  }

  @Get('payout-requests')
  getPayoutRequests(@Query() query: PaginationDto) {
    return this.adminService.getPayoutRequests(query);
  }

  @Patch('payout-requests/:id')
  @Throttle(RATE_LIMIT_WRITE)
  processPayoutRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProcessPayoutRequestDto,
  ) {
    return this.adminService.processPayoutRequest(id, dto.action, dto.adminNote);
  }

  // Admin escape hatch to undo an approve / complete / reject click. Gated at
  // the same STRICT rate limit as mark-unpaid because it re-opens a settled
  // record; DTO whitelists the target status.
  @Post('payout-requests/:id/revert')
  @Throttle(RATE_LIMIT_STRICT)
  revertPayoutRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevertPayoutRequestDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.adminService.revertPayoutRequest(id, dto.targetStatus, actor.id);
  }

  @Get('payouts/export')
  exportPayouts(@Query() query: ExportPaginationDto) {
    return this.adminService.exportPayouts(query);
  }

  // ─── Countries CRUD ─────────────────────────────────────────
  @Get('settings/countries')
  getCountries(@Query() query: PaginationDto) {
    return this.adminService.getCountries(query);
  }

  @Post('settings/countries')
  @Throttle(RATE_LIMIT_WRITE)
  createCountry(@Body() dto: CreateCountryDto) {
    return this.adminService.createCountry(dto);
  }

  @Patch('settings/countries/:id')
  @Throttle(RATE_LIMIT_WRITE)
  updateCountry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCountryDto) {
    return this.adminService.updateCountry(id, dto);
  }

  @Delete('settings/countries/:id')
  @Throttle(RATE_LIMIT_WRITE)
  deleteCountry(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteCountry(id);
  }

  // ─── Categories CRUD ────────────────────────────────────────
  @Get('settings/categories')
  getCategories(@Query() query: PaginationDto) {
    return this.adminService.getCategories(query);
  }

  @Post('settings/categories')
  @Throttle(RATE_LIMIT_WRITE)
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.adminService.createCategory(dto);
  }

  @Patch('settings/categories/:id')
  @Throttle(RATE_LIMIT_WRITE)
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.adminService.updateCategory(id, dto);
  }

  @Delete('settings/categories/:id')
  @Throttle(RATE_LIMIT_WRITE)
  deleteCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteCategory(id);
  }

  // ─── Category Image Upload ─────────────────────────────────
  @Post('upload-category-image')
  @Throttle(RATE_LIMIT_CALLBACK)
  @UseInterceptors(FileInterceptor('file', UploadService.diskStorageConfig('categories')))
  async uploadCategoryImage(@UploadedFile() file: Express.Multer.File) {
    this.uploadService.validateFile(file);
    const url = await this.uploadService.upload(file, 'categories');
    return { url };
  }

  // ─── Cities CRUD ────────────────────────────────────────────
  @Get('settings/cities')
  getCities() {
    return this.adminService.getCities();
  }

  @Post('settings/cities')
  @Throttle(RATE_LIMIT_WRITE)
  createCity(@Body() dto: CreateCityDto) {
    return this.adminService.createCity(dto);
  }

  @Patch('settings/cities/:id')
  @Throttle(RATE_LIMIT_WRITE)
  updateCity(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCityDto) {
    return this.adminService.updateCity(id, dto);
  }

  @Delete('settings/cities/:id')
  @Throttle(RATE_LIMIT_WRITE)
  deleteCity(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteCity(id);
  }

  // ─── Coupons ────────────────────────────────────────────────
  @Get('coupons')
  getCoupons(@Query() query: PaginationDto) {
    return this.adminService.getCoupons(query);
  }

  @Post('coupons')
  @Throttle(RATE_LIMIT_WRITE)
  createCoupon(@Body() dto: CreateCouponDto) {
    return this.adminService.createCoupon(dto);
  }

  @Patch('coupons/:id/status')
  @Throttle(RATE_LIMIT_CALLBACK)
  updateCouponStatus(@Param('id') id: string, @Body() dto: UpdateCouponStatusDto) {
    return this.adminService.updateCouponStatus(id, dto.status);
  }

  @Delete('coupons/:id')
  @Throttle(RATE_LIMIT_WRITE)
  deleteCoupon(@Param('id') id: string) {
    return this.adminService.deleteCoupon(id);
  }

  // ─── Platform Settings (Commission + Platform Info) ─────────
  @Get('settings/commission')
  getCommissionSettings() {
    return this.adminService.getCommissionSettings();
  }

  @Patch('settings/commission')
  @Throttle(RATE_LIMIT_STRICT)
  updateCommissionSettings(@Body() dto: UpdateCommissionDto) {
    return this.adminService.updateCommissionSettings(dto.defaultCommissionPct);
  }

  @Get('settings/platform')
  getPlatformSettings() {
    return this.adminService.getPlatformSettings();
  }

  @Patch('settings/platform')
  @Throttle(RATE_LIMIT_STRICT)
  updatePlatformSettings(@Body() dto: UpdatePlatformSettingsDto) {
    return this.adminService.updatePlatformSettings(dto);
  }

  // ─── Trending Events CRUD ──────────────────────────────────
  @Post('settings/trending/upload-image')
  @Throttle(RATE_LIMIT_CALLBACK)
  @UseInterceptors(FileInterceptor('file', UploadService.diskStorageConfig('trending')))
  async uploadTrendingImage(@UploadedFile() file: Express.Multer.File) {
    this.uploadService.validateFile(file);
    const url = await this.uploadService.upload(file, 'trending');
    return { url };
  }

  @Get('settings/trending')
  getTrendingEvents(@Query() query: PaginationDto) {
    return this.adminService.getTrendingEvents(query);
  }

  @Post('settings/trending')
  @Throttle(RATE_LIMIT_WRITE)
  createTrendingEvent(@Body() dto: CreateTrendingEventDto) {
    return this.adminService.createTrendingEvent(dto);
  }

  @Patch('settings/trending/:id')
  @Throttle(RATE_LIMIT_WRITE)
  updateTrendingEvent(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTrendingEventDto) {
    return this.adminService.updateTrendingEvent(id, dto);
  }

  @Delete('settings/trending/:id')
  @Throttle(RATE_LIMIT_WRITE)
  deleteTrendingEvent(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteTrendingEvent(id);
  }

  // ─── Reviews Moderation ─────────────────────────────────────
  @Get('reviews')
  getReviews(@Query() query: PaginationDto) {
    return this.adminService.getReviews(query);
  }

  @Delete('reviews/:id')
  @Throttle(RATE_LIMIT_WRITE)
  deleteReview(@Param('id') id: string) {
    return this.adminService.deleteReview(id);
  }

  // ─── Vendor Analytics ─────────────────────────────────────────
  @Get('vendors/:id/analytics')
  getVendorAnalytics(@Param('id') id: string) {
    return this.adminService.getVendorAnalytics(id);
  }

  // ─── Audit Logs ───────────────────────────────────────────────
  @Get('audit-logs')
  @SkipThrottle({ default: false })
  @Throttle(RATE_LIMIT_READ)
  getAuditLogs(
    @Query() query: PaginationDto,
    @Query('actorType') actorType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminService.getAuditLogs({ ...query, actorType, from, to });
  }

  // ─── Dashboard Charts ─────────────────────────────────────────
  @Get('dashboard/charts')
  getDashboardCharts() {
    return this.adminService.getDashboardCharts();
  }

  // ─── Notifications ────────────────────────────────────────────
  @Get('notifications/counts')
  getNotificationCounts(@CurrentUser() user: RequestUser) {
    return this.adminService.getNotificationCounts(user.id);
  }

  // ─── Global Search ────────────────────────────────────────────
  @Get('search')
  globalSearch(@Query('q') q: string) {
    return this.adminService.globalSearch(q || '');
  }

  // ─── Bulk Actions ─────────────────────────────────────────────
  @Post('bulk/vendors/status')
  @Throttle(RATE_LIMIT_AUTH)
  bulkUpdateVendorStatus(@Body() dto: BulkVendorStatusDto) {
    return this.adminService.bulkUpdateVendorStatus(dto.vendorIds, dto.status);
  }

  @Post('bulk/activities/status')
  @Throttle(RATE_LIMIT_AUTH)
  bulkUpdateActivityStatus(@Body() dto: BulkActivityStatusDto) {
    return this.adminService.bulkUpdateActivityStatus(dto.activityIds, dto.status);
  }

  @Post('bulk/users/delete')
  @Throttle(RATE_LIMIT_STRICT)
  bulkDeleteUsers(@Body() dto: BulkDeleteUsersDto) {
    return this.adminService.bulkDeleteUsers(dto.userIds);
  }

  // ─── Export Data ──────────────────────────────────────────────
  @Get('export/users')
  exportUsers(@Query('role') role?: string) {
    return this.adminService.exportUsers(role);
  }

  @Get('export/vendors')
  exportVendors() {
    return this.adminService.exportVendors();
  }

  @Get('export/activities')
  exportActivities() {
    return this.adminService.exportActivities();
  }

  @Get('export/bookings')
  exportBookings() {
    return this.adminService.exportBookings();
  }

  // ─── System Maintenance ─────────────────────────────────────────────────────

  /** Manual trigger for data cleanup (same as the daily cron) */
  @Post('system/cleanup')
  @Throttle(RATE_LIMIT_MINIMAL)
  async triggerCleanup() {
    await this.cleanupService.handleDailyCleanup();
    return { message: 'Cleanup completed successfully' };
  }

  // ─── Email Suppression List ─────────────────────────────────────────────
  //
  // The SES bounce/complaint webhook (and manual admin actions) populate
  // EmailSuppression with SHA-256 hashes of recipient emails that should
  // never receive outbound mail. EmailService.send() short-circuits on
  // hash hit. These endpoints let support staff inspect and recover from
  // false-positive suppressions (e.g. a typo'd address that the user has
  // since fixed, or a temporary mailbox-full bounce that resolved).
  //
  // We do NOT expose the plaintext email — only the hash — because the
  // table never stores plaintext (PII discipline, see EmailSuppressionService).
  // The admin client computes SHA-256(email) locally to look up a specific
  // address.

  @Get('email-suppressions')
  @Throttle(RATE_LIMIT_READ)
  listEmailSuppressions(@Query() query: PaginationDto) {
    return this.adminService.listEmailSuppressions(query);
  }

  /**
   * Remove an email from the suppression list. Caller passes the SHA-256
   * hash of the lowercased+trimmed email (computed client-side or read
   * from the list endpoint). Idempotent — returns `removed:false` if the
   * hash wasn't present.
   */
  @Delete('email-suppressions/:hash')
  @Throttle(RATE_LIMIT_WRITE)
  async unsuppressEmail(@Param('hash') hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new NotFoundException();
    }
    const removed = await this.suppressions.unsuppress(hash);
    return { removed };
  }
}
