import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as webpush from 'web-push';

/**
 * Web Push Service — sends browser push notifications via VAPID protocol.
 *
 * Security:
 * - VAPID private key never logged or returned to frontend
 * - Subscription endpoint validated as HTTPS URL
 * - Max 5 subscriptions per user (prevents subscription bombing)
 * - Failed/expired subscriptions auto-cleaned on 410 Gone response
 * - Payload never contains sensitive data (no tokens, no PII)
 */
@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
  private readonly enabled: boolean;
  private readonly maxSubscriptionsPerUser: number;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    const publicKey = this.config.get('VAPID_PUBLIC_KEY', '');
    const privateKey = this.config.get('VAPID_PRIVATE_KEY', '');
    const subject = this.config.get('VAPID_SUBJECT', 'mailto:jadwalit@gmail.com');
    this.maxSubscriptionsPerUser = 5;

    this.enabled = !!(publicKey && privateKey);

    // Defence-in-depth: production must have VAPID configured (main.ts also guards this)
    if (!this.enabled && process.env.NODE_ENV === 'production') {
      throw new Error('[FATAL] VAPID keys must be configured in production');
    }

    if (this.enabled) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    }
  }

  /**
   * Subscribe a user's browser to push notifications.
   * Validates endpoint is HTTPS, enforces max subscriptions per user.
   */
  async subscribe(userId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    if (!this.enabled) return { subscribed: false, reason: 'Push notifications not configured' };

    // Validate endpoint is a real HTTPS push URL
    if (!subscription.endpoint || !subscription.endpoint.startsWith('https://')) {
      throw new BadRequestException('Invalid push subscription endpoint');
    }
    if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new BadRequestException('Invalid push subscription keys');
    }

    const db = this.prisma.client;

    // Upsert by endpoint (same browser re-subscribing gets updated, not duplicated)
    await db.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userId, // reassign if endpoint moved to different user
      },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });

    // Enforce the per-user cap by trimming AFTER the upsert (prevent
    // subscription bombing). A count → find-oldest → delete sequence races
    // with a concurrent subscribe (both see count == max, both delete the
    // same row → one throws P2025). Trimming to the newest N with a single
    // deleteMany is idempotent and self-correcting under concurrency.
    const subs = await db.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (subs.length > this.maxSubscriptionsPerUser) {
      const staleIds = subs.slice(this.maxSubscriptionsPerUser).map((s) => s.id);
      await db.pushSubscription.deleteMany({ where: { id: { in: staleIds } } });
    }

    return { subscribed: true };
  }

  /**
   * Unsubscribe a specific endpoint for a user.
   */
  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.client.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
    return { unsubscribed: true };
  }

  /**
   * Send push notification to all of a user's subscribed browsers.
   * Fire-and-forget — errors are logged but never thrown.
   * Auto-cleans expired subscriptions (410 Gone).
   *
   * SECURITY: payload must NEVER contain sensitive data (tokens, PII, links with tokens).
   */
  async sendToUser(userId: string, payload: { title: string; body: string; url?: string }) {
    if (!this.enabled) return;

    const subscriptions = await this.prisma.client.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });

    if (subscriptions.length === 0) return;

    // Safe payload — no sensitive data, just title + body + optional relative URL
    const safePayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url?.startsWith('/') ? payload.url : undefined, // Only relative URLs
      icon: '/icon-192.png',
      badge: '/icon-72.png',
    });

    const staleIds: string[] = [];

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            safePayload,
            { TTL: 60 * 60 }, // 1 hour TTL
          );
        } catch (err: any) {
          // 410 Gone = subscription expired, browser unsubscribed
          // 404 Not Found = endpoint no longer valid
          if (err.statusCode === 410 || err.statusCode === 404) {
            staleIds.push(sub.id);
          } else {
            // Log status code when available, else error class. Avoid raw
            // err.message — web-push bodies can echo the push subscription
            // endpoint (FCM / APNS) which is a user-device-identifier.
            const kind = err.statusCode ?? (err?.name ?? 'UnknownError');
            this.logger.warn(`Push failed for subscription ${sub.id} (${kind})`);
          }
        }
      }),
    );

    // Clean up expired subscriptions
    if (staleIds.length > 0) {
      await this.prisma.client.pushSubscription.deleteMany({
        where: { id: { in: staleIds } },
      });
    }
  }
}
