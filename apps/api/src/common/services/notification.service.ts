import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WebPushService } from './web-push.service';

type NotificationType =
  | 'BOOKING_NEW' | 'BOOKING_CANCELLED' | 'BOOKING_CONFIRMED' | 'BOOKING_COMPLETED'
  | 'PAYMENT_SUCCESS' | 'PAYMENT_FAILED'
  | 'REVIEW_RECEIVED' | 'PAYOUT_PROCESSED'
  | 'COUPON_APPROVED' | 'COUPON_REJECTED'
  | 'VENDOR_APPROVED' | 'VENDOR_SUSPENDED'
  | 'ACTIVITY_APPROVED' | 'ACTIVITY_REJECTED'
  | 'PAYOUT_REQUESTED'
  | 'REFUND_REQUESTED' | 'REFUND_DECIDED'
  | 'SYSTEM';

/**
 * Unified notification service — creates in-app notifications for all actors.
 * All methods are fire-and-forget (never break the calling flow).
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => WebPushService)) private webPush: WebPushService,
  ) {}

  /** Validate link is a safe relative path — no absolute URLs, no javascript: */
  private safeLink(link?: string): string | null {
    if (!link) return null;
    const trimmed = link.slice(0, 300);
    if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes(':')) return null;
    return trimmed;
  }

  /** Send a notification to a single user */
  async send(params: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
  }): Promise<void> {
    await this.prisma.client.notification.create({
      data: {
        userId: params.userId,
        type: params.type as any,
        title: params.title.slice(0, 200),
        message: params.message.slice(0, 500),
        link: this.safeLink(params.link),
      },
    }).catch(() => {
      this.logger.error(`Failed to send notification: ${params.type}`);
    });

    // Also send browser push notification (fire-and-forget)
    this.webPush.sendToUser(params.userId, {
      title: params.title.slice(0, 100),
      body: params.message.slice(0, 200),
      url: this.safeLink(params.link) ?? undefined,
    }).catch(() => { /* silent — push is best-effort */ });
  }

  /** Send the same notification to multiple users */
  async sendToMany(params: {
    userIds: string[];
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
  }): Promise<void> {
    if (params.userIds.length === 0) return;

    const safeLink = this.safeLink(params.link);
    const data = params.userIds.map((userId) => ({
      userId,
      type: params.type as any,
      title: params.title.slice(0, 200),
      message: params.message.slice(0, 500),
      link: safeLink,
    }));

    await this.prisma.client.notification.createMany({ data }).catch(() => {
      this.logger.error(`Failed to send bulk notifications: ${params.type}`);
    });

    // Also send browser push to each user (fire-and-forget)
    for (const userId of params.userIds) {
      this.webPush.sendToUser(userId, {
        title: params.title.slice(0, 100),
        body: params.message.slice(0, 200),
        url: safeLink ?? undefined,
      }).catch(() => { /* silent */ });
    }
  }

  /** Send notification to all admins */
  async notifyAdmins(params: {
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
  }): Promise<void> {
    const admins = await this.prisma.client.user.findMany({
      where: { role: 'ADMIN', isDeactivated: false },
      select: { id: true },
    });
    if (admins.length === 0) return;
    await this.sendToMany({ ...params, userIds: admins.map((a) => a.id) });
  }

  /** Get paginated notifications for a user */
  async getNotifications(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.client.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          link: true,
          read: true,
          createdAt: true,
        },
      }),
      this.prisma.client.notification.count({ where: { userId } }),
      this.prisma.client.notification.count({ where: { userId, read: false } }),
    ]);

    return { data: notifications, total, unreadCount, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Get unread count only */
  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.client.notification.count({ where: { userId, read: false } });
  }

  /** Mark a single notification as read */
  async markAsRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.client.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });
  }

  /** Mark all notifications as read for a user */
  async markAllAsRead(userId: string): Promise<void> {
    await this.prisma.client.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  /** Delete all notifications for a user */
  async clearAll(userId: string): Promise<{ deleted: number }> {
    const result = await this.prisma.client.notification.deleteMany({
      where: { userId },
    });
    return { deleted: result.count };
  }
}
