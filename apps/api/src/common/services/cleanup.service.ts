import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLoggerService } from './audit-logger.service';
import { LoyaltyService } from './loyalty.service';
import { AvailabilityCacheService } from '../../redis/availability-cache.service';
import { refundCouponUsage } from '../../bookings/bookings.service';

/**
 * Scheduled jobs for data hygiene + business logic automation.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ Job                        │ Schedule       │ What it does      │
 * ├────────────────────────────┼────────────────┼───────────────────┤
 * │ Daily Cleanup              │ 3:00 AM        │ Purge stale data  │
 * │ Auto-cancel Pending        │ Every 30 min   │ Cancel unpaid     │
 * │ Auto-complete Past         │ 1:00 AM        │ Mark COMPLETED    │
 * │ Auto-expire Coupons        │ 2:00 AM        │ Set EXPIRED       │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Payments and bookings are NEVER hard-deleted (accounting/legal).
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  // Retention periods (in days) — configurable via env for compliance tuning
  private readonly REFRESH_TOKEN_RETENTION: number;
  private readonly SECURITY_LOG_RETENTION: number;
  private readonly AUDIT_LOG_RETENTION: number;
  private readonly EXPIRED_COUPON_RETENTION: number;

  // Business rules — all read from env so ops can tune without a code deploy
  private readonly PENDING_BOOKING_FALLBACK_HOURS: number;

  constructor(
    private prisma: PrismaService,
    private auditLogger: AuditLoggerService,
    private configService: ConfigService,
    private loyalty: LoyaltyService,
    private availabilityCache: AvailabilityCacheService,
  ) {
    this.REFRESH_TOKEN_RETENTION = Number(this.configService.get('RETENTION_REFRESH_TOKEN_DAYS', '0'));
    this.SECURITY_LOG_RETENTION = Number(this.configService.get('RETENTION_SECURITY_LOG_DAYS', '90'));
    this.AUDIT_LOG_RETENTION = Number(this.configService.get('RETENTION_AUDIT_LOG_DAYS', '180'));
    this.EXPIRED_COUPON_RETENTION = Number(this.configService.get('RETENTION_EXPIRED_COUPON_DAYS', '30'));

    // Primary: cancel PENDING bookings whose reservedUntil has passed (set at booking creation)
    // Fallback: cancel PENDING bookings with no reservedUntil after N hours (legacy / safety net)
    this.PENDING_BOOKING_FALLBACK_HOURS = Number(
      this.configService.get('PENDING_BOOKING_FALLBACK_HOURS', '4'),
    );
  }

  // ─── Daily Cleanup (3 AM) — purge stale data ─────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDailyCleanup() {
    this.logger.log('Starting daily cleanup...');

    const results = await Promise.allSettled([
      this.cleanExpiredRefreshTokens(),
      this.cleanOldSecurityLogs(),
      this.cleanOldAuditLogs(),
      this.cleanOldExpiredCoupons(),
    ]);

    const names = ['RefreshTokens', 'SecurityLogs', 'AuditLogs', 'Coupons'];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        this.logger.log(`  ${names[i]}: ${result.value} rows deleted`);
      } else {
        // Don't interpolate the raw rejection reason — Prisma errors can
        // include query fragments, column values, and connection strings.
        const reasonName =
          result.reason instanceof Error ? result.reason.name : 'UnknownError';
        this.logger.error(`  ${names[i]}: failed (${reasonName})`);
      }
    });

    this.logger.log('Daily cleanup complete.');
  }

  // ─── Auto-cancel Expired Reservations (every 5 min) ──────────────────────
  // Two cases:
  //   1. reservedUntil is set and has passed → reservation window expired
  //   2. reservedUntil is null and createdAt > 4 hours ago → legacy / safety net

  @Cron('*/5 * * * *')
  async autoCancelStalePendingBookings() {
    const now = new Date();
    const fallbackCutoff = new Date(now.getTime() - this.PENDING_BOOKING_FALLBACK_HOURS * 60 * 60 * 1000);

    // PAY2M checkout sessions last ~15-20 min max. 30 min is safe buffer.
    const paymentInitiatedCutoff = new Date(now.getTime() - 30 * 60 * 1000);

    const staleBookings = await this.prisma.client.booking.findMany({
      where: {
        status: 'PENDING',
        OR: [
          // Case 1: No payment initiated — reservation timer expired
          { paymentId: null, reservedUntil: { lt: now } },

          // Case 2: Payment created but never sent to PAY2M (no basket ID) — reservation expired
          {
            payment: { gatewayBasketId: null },
            reservedUntil: { lt: now },
          },

          // Case 3: Payment sent to PAY2M (has basket ID) but no callback after 30 min
          // Customer closed PAY2M tab or lost internet — PAY2M callback never arrived.
          // Cutoff uses paymentFirstInitiatedAt (immutable, stamped once on
          // first /payment/initiate) so a customer cannot indefinitely
          // extend their PENDING reservation by hammering /payment/initiate
          // from a stale tab — each retry only updates paymentInitiatedAt
          // (forensics), never paymentFirstInitiatedAt (cutoff anchor).
          //
          // Backward-compat: rows that predate the paymentFirstInitiatedAt
          // column may have a NULL value. The migration backfills from
          // paymentInitiatedAt; this OR is the runtime fallback for
          // edge-case rows still in flight during the deploy window.
          {
            payment: {
              gatewayBasketId: { not: null },
              OR: [
                { paymentFirstInitiatedAt: { lt: paymentInitiatedCutoff } },
                {
                  paymentFirstInitiatedAt: null,
                  paymentInitiatedAt: { lt: paymentInitiatedCutoff },
                },
              ],
            },
          },

          // Case 4: Legacy safety net — any PENDING booking older than 4 hours
          { createdAt: { lt: fallbackCutoff } },
        ],
      },
      select: { id: true, paymentId: true, activityId: true, customerId: true, couponCode: true },
    });

    if (staleBookings.length === 0) return;

    // Hard-delete stale PENDING bookings — customer never paid, these are
    // abandoned reservation attempts, not real bookings. Keeping them would
    // clutter vendor/admin/customer views with ghost entries.
    //
    // Pool-level statement_timeout (15s, see prisma.service.ts) is the
    // safety net here. The per-row refundCouponUsage loop is bounded
    // ("usually < 20 stale reservations" — comment below) and each
    // iteration is a small UPDATE on an indexed coupon row, so the whole
    // transaction comfortably finishes inside 15s. If a busy spike ever
    // blows past, Postgres rolls back cleanly and the next cron run
    // (5 min later) picks up the same set and retries. No per-tx SET
    // LOCAL override — repo enforces a hard no-raw-SQL gate.
    await this.prisma.client.$transaction(async (tx) => {
      const bookingIds = staleBookings.map(b => b.id);
      const paymentIds = staleBookings.map(b => b.paymentId).filter(Boolean) as string[];

      // Refund coupon usage before delete — createBooking incremented
      // usedCount at reservation time; bookings that never paid must return
      // that increment so coupons stay accurate. Per-booking loop is fine
      // because this cron runs every 5 min and batch sizes are small
      // (usually < 20 stale reservations).
      for (const b of staleBookings) {
        if (b.couponCode) {
          await refundCouponUsage(tx, b.couponCode, b.customerId);
        }
      }

      // Detach payment FKs before deleting
      await tx.booking.updateMany({
        where: { id: { in: bookingIds } },
        data: { paymentId: null },
      });

      // Delete PENDING payments (mark FAILED ones are handled by PAY2M callback)
      if (paymentIds.length > 0) {
        await tx.payment.deleteMany({
          where: { id: { in: paymentIds }, status: 'PENDING' },
        });
      }

      // Delete the bookings themselves
      await tx.booking.deleteMany({
        where: { id: { in: bookingIds } },
      });
    });

    this.logger.log(`Deleted ${staleBookings.length} expired reservation(s)`);

    // Batch-invalidate availability for every affected activity. Dedup happens
    // inside invalidateMany; pipelined INCRs keep Redis round-trips bounded.
    void this.availabilityCache.invalidateMany(staleBookings.map((b) => b.activityId));

    this.auditLogger.log({
      actorType: 'SYSTEM',
      actorId: 'cron',
      actorName: 'System Cron',
      action: 'AUTO_CANCEL_STALE_BOOKINGS',
      entity: 'Booking',
      details: JSON.stringify({ count: staleBookings.length, bookingIds: staleBookings.map(b => b.id).slice(0, 20) }),
    });
  }

  // ─── Auto-complete Past Bookings (1 AM daily) ────────────────────────────
  // CONFIRMED bookings whose activity date has passed → COMPLETED
  // Also awards loyalty points for each newly completed booking.

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async autoCompletePastBookings() {
    const now = new Date();

    // Fetch individual bookings so we can award points per-booking
    const bookingsToComplete = await this.prisma.client.booking.findMany({
      where: {
        status: 'CONFIRMED',
        endDatetime: { lt: now },
      },
      select: {
        id: true,
        ref: true,
        customerId: true,
        totalPrice: true,
        pointsAwarded: true,
      },
    });

    if (bookingsToComplete.length === 0) return;

    // Mark all as COMPLETED in bulk
    await this.prisma.client.booking.updateMany({
      where: { id: { in: bookingsToComplete.map(b => b.id) } },
      data: { status: 'COMPLETED' },
    });

    // Award loyalty points for each booking that hasn't been awarded yet
    const eligibleBookings = bookingsToComplete.filter(b => !b.pointsAwarded);
    if (eligibleBookings.length > 0) {
      let config = await this.prisma.client.loyaltyConfig.findUnique({ where: { id: 'singleton' } });
      if (!config) {
        config = await this.prisma.client.loyaltyConfig.create({ data: { id: 'singleton' } });
      }

      let totalPointsAwarded = 0;
      const pointsPerQar = config.pointsPerQar.toNumber();
      for (const booking of eligibleBookings) {
        const points = Math.floor(Number(booking.totalPrice) * pointsPerQar);
        if (points <= 0) continue;

        try {
          await this.prisma.client.$transaction(async (tx) => {
            // Double-check to prevent race conditions
            const fresh = await tx.booking.findUnique({
              where: { id: booking.id },
              select: { pointsAwarded: true, ref: true, totalPrice: true },
            });
            if (fresh?.pointsAwarded) return;

            await tx.booking.update({
              where: { id: booking.id },
              data: { pointsAwarded: true },
            });
            await this.loyalty.earn(tx, {
              userId: booking.customerId,
              amount: points,
              bookingId: booking.id,
              note: `Earned on booking ${fresh?.ref ?? booking.id} (${Number(fresh?.totalPrice ?? 0)})`,
            });
          });
          totalPointsAwarded += points;
        } catch (err: unknown) {
          // Don't stringify the whole err — it serialises stack + internal
          // Prisma query context. Log class name + booking ID only; the
          // transaction has already rolled back by this point.
          const kind = err instanceof Error ? err.name : 'UnknownError';
          this.logger.error(`Failed to award points for booking ${booking.id} (${kind})`);
        }
      }

      if (totalPointsAwarded > 0) {
        this.logger.log(`Awarded ${totalPointsAwarded} loyalty points across ${eligibleBookings.length} booking(s)`);
      }
    }

    this.logger.log(`Auto-completed ${bookingsToComplete.length} past booking(s)`);
    this.auditLogger.log({
      actorType: 'SYSTEM',
      actorId: 'cron',
      actorName: 'System Cron',
      action: 'AUTO_COMPLETE_PAST_BOOKINGS',
      entity: 'Booking',
      details: JSON.stringify({ count: bookingsToComplete.length }),
    });
  }

  // ─── Auto-expire Coupons (2 AM daily) ────────────────────────────────────
  // Coupons past their validTo date → set status to EXPIRED

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async autoExpireCoupons() {
    const now = new Date();

    const { count } = await this.prisma.client.coupon.updateMany({
      where: {
        status: 'APPROVED',
        validTo: { lt: now },
      },
      data: { status: 'EXPIRED' },
    });

    if (count > 0) {
      this.logger.log(`Auto-expired ${count} coupon(s) past validTo`);
      this.auditLogger.log({
        actorType: 'SYSTEM',
        actorId: 'cron',
        actorName: 'System Cron',
        action: 'AUTO_EXPIRE_COUPONS',
        entity: 'Coupon',
        details: JSON.stringify({ count }),
      });
    }
  }

  // ─── Individual cleanup methods ───────────────────────────────────────────

  async cleanExpiredRefreshTokens(): Promise<number> {
    const { count } = await this.prisma.client.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return count;
  }

  async cleanOldSecurityLogs(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.SECURITY_LOG_RETENTION);
    const { count } = await this.prisma.client.securityLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  }

  async cleanOldAuditLogs(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.AUDIT_LOG_RETENTION);
    const { count } = await this.prisma.client.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  }

  async cleanOldExpiredCoupons(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.EXPIRED_COUPON_RETENTION);
    const { count } = await this.prisma.client.coupon.deleteMany({
      where: { status: 'EXPIRED', validTo: { lt: cutoff } },
    });
    return count;
  }
}
