import { Controller, Get, Patch, Delete, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_READ, RATE_LIMIT_WRITE, RATE_LIMIT_AUTH } from '../throttle-config';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequestUser } from '../../auth/interfaces/request-user.interface';
import { NotificationService } from '../services/notification.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  @Get()
  @Throttle(RATE_LIMIT_READ)
  getNotifications(
    @CurrentUser() user: RequestUser,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.notificationService.getNotifications(
      user.id,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(50, Math.max(1, parseInt(limit, 10) || 20)),
    );
  }

  @Get('unread-count')
  @Throttle(RATE_LIMIT_READ)
  async getUnreadCount(@CurrentUser() user: RequestUser) {
    const count = await this.notificationService.getUnreadCount(user.id);
    return { unreadCount: count };
  }

  @Patch(':id/read')
  @Throttle(RATE_LIMIT_WRITE)
  markAsRead(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationService.markAsRead(user.id, id);
  }

  @Patch('read-all')
  @Throttle(RATE_LIMIT_WRITE)
  markAllAsRead(@CurrentUser() user: RequestUser) {
    return this.notificationService.markAllAsRead(user.id);
  }

  @Delete('clear-all')
  @Throttle(RATE_LIMIT_AUTH)
  clearAll(@CurrentUser() user: RequestUser) {
    return this.notificationService.clearAll(user.id);
  }

  // Per-notification delete — same shape as `markAsRead`: ownership is
  // enforced through the WHERE clause in `deleteOne`, so a user can only
  // ever delete their own rows even if they guess another user's UUID.
  // RATE_LIMIT_WRITE (not the stricter RATE_LIMIT_AUTH used by clear-all)
  // because deleting one row is far less destructive than wiping every
  // notification at once — matches the markAsRead tier.
  @Delete(':id')
  @Throttle(RATE_LIMIT_WRITE)
  deleteOne(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationService.deleteOne(user.id, id);
  }
}
