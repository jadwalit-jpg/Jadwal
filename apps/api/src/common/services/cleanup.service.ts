import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLoggerService } from './audit-logger.service';
import { LoyaltyService } from './loyalty.service';
import { AvailabilityCacheService } from '../../redis/availability-cache.service';
import { RedisLockService } from '../../redis/redis-lock.service';
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
  /// OPERATIONAL audit-log retention. FINANCIAL entries use the
  /// dedicated 7-year window below (§B8 — Qatar PDPL §14, GDPR Art.30,
  /// standard financial-records regulation).
  private readonly AUDIT_LOG_RETENTION: number;
  /// FINANCIAL audit-log retention. Default 2555 days = 7 years.
  /// Setting via env (RETENTION_AUDIT_LOG_FINANCIAL_DAYS) is allowed
  /// for jurisdictions with stricter rules but the default already
  /// satisfies the major regulatory regimes.
  private readonly AUDIT_LOG_FINANCIAL_RETENTION: number;
  private readonly EXPIRED_COUPON_RETENTION: number;
  /// Days to keep terminal (SENT/FAILED) EmailOutbox rows before pruning.
  /// PENDING rows are never pruned here — they're still being retried (or have
  /// given up to FAILED, which IS pruned after the window). Default 30 days.
  private readonly EMAIL_OUTBOX_RETENTION: number;

  // Business rules — all read from env so ops can tune without a code deploy
  private readonly PENDING_BOOKING_FALLBACK_HOURS: number;

  constructor(
    private prisma: PrismaService,
    private auditLogger: AuditLoggerService,
    private configService: ConfigService,
    private loyalty: LoyaltyService,
    private availabilityCache: AvailabilityCacheService,
    private lock: RedisLockService,
  ) {
    this.REFRESH_TOKEN_RETENTION = Number(this.configService.get('RETENTION_REFRESH_TOKEN_DAYS', '0'));
    this.SECURITY_LOG_RETENTION = Number(this.configService.get('RETENTION_SECURITY_LOG_DAYS', '90'));
    this.AUDIT_LOG_RETENTION = Number(this.configService.get('RETENTION_AUDIT_LOG_DAYS', '180'));
    this.AUDIT_LOG_FINANCIAL_RETENTION = Number(
      this.configService.get('RETENTION_AUDIT_LOG_FINANCIAL_DAYS', '2555'), // 7 years
    );
    this.EXPIRED_COUPON_RETENTION = Number(this.configService.get('RETENTION_EXPIRED_COUPON_DAYS', '30'));
    // Clamp to a positive integer — a typo in the SSM value (NaN / negative)
    // would otherwise turn the cutoff into an Invalid Date (cron fails every
    // run) or prune the wrong rows. Falls back to 30 days.
    const outboxRetention = Number(this.configService.get('RETENTION_EMAIL_OUTBOX_DAYS', '30'));
    this.EMAIL_OUTBOX_RETENTION = Number.isInteger(outboxRetention) && outboxRetention > 0 ? outboxRetention : 30;

    // Primary: cancel PENDING bookings whose reservedUntil has passed (set at booking creation)
    // Fallback: cancel PENDING bookings with no reservedUntil after N hours (legacy / safety net)
    this.PENDING_BOOKING_FALLBACK_HOURS = Number(
      this.configService.get('PENDING_BOOKING_FALLBACK_HOURS', '4'),
    );
  }

  // ─── Daily Cleanup (3 AM) — purge stale data ─────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDailyCleanup() {
    // Leader-election: when ECS auto-scaling lifts the API service to N
    // tasks, all N would otherwise fire this cron simultaneously and
    // race on the same DELETE FROM SecurityLog/AuditLog rows. The locks
    // collide cleanly (no double-delete), but each non-leader pod still
    // burns a connection for ~30s of redundant work. Leader-election
    // limits the work to exactly one pod per iteration. TTL = 60 min
    // (24× safety vs typical 30s run, but auto-expires before next
    // 24-hour iteration so a crashed leader doesn't permanently silence).
    await this.lock.withLeaderLock('cron:daily-cleanup', 60 * 60_000, async () => {
      this.logger.log({ event: 'CLEANUP_DAILY_START' });

      const results = await Promise.allSettled([
        this.cleanExpiredRefreshTokens(),
        this.cleanOldSecurityLogs(),
        this.cleanOldAuditLogs(),
        this.cleanOldExpiredCoupons(),
        this.cleanOldOutboxRows(),
      ]);

      const names = ['RefreshTokens', 'SecurityLogs', 'AuditLogs', 'Coupons', 'EmailOutbox'];
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          this.logger.log({ event: 'CLEANUP_TASK_DONE', task: names[i], deleted: result.value });
        } else {
          // Don't interpolate the raw rejection reason — Prisma errors can
          // include query fragments, column values, and connection strings.
          const reasonName =
            result.reason instanceof Error ? result.reason.name : 'UnknownError';
          this.logger.error({ event: 'CLEANUP_TASK_FAILED', task: names[i], kind: reasonName });
        }
      });

      this.logger.log({ event: 'CLEANUP_DAILY_DONE' });
    });
  }

  // ─── Auto-cancel Expired Reservations (every 5 min) ──────────────────────
  // Two cases:
  //   1. reservedUntil is set and has passed → reservation window expired
  //   2. reservedUntil is null and createdAt > 4 hours ago → legacy / safety net

  @Cron('*/5 * * * *')
  async autoCancelStalePendingBookings() {
    // Leader-election TTL = 10 min (2× the 5-min cron interval). If a leader
    // crashes mid-cron, the lock auto-expires by the NEXT iteration so a
    // surviving pod can take over. Without dedup, duplicate-delete races
    // would emit duplicate audit logs and refund the same coupon usage twice.
    await this.lock.withLeaderLock('cron:cancel-stale-pending', 10 * 60_000, async () => {
      await this.runAutoCancelStalePendingBookings();
    });
  }

  private async runAutoCancelStalePendingBookings() {
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
      select: { id: true, ref: true, paymentId: true, activityId: true, customerId: true, couponCode: true, pointsRedeemed: true },
      // Oldest-first so a backlog drains DETERMINISTICALLY across successive
      // runs — without an explicit order, Postgres could return the same 1000
      // rows each run (or skip the oldest), starving old abandoned bookings.
      orderBy: { createdAt: 'asc' },
      // Bound the batch: a large backlog (e.g. after an outage or a PAY2M
      // incident that strands many PENDING bookings) must not load unbounded
      // rows into one transaction (statement_timeout / memory blow-up). 1000 is
      // far above steady-state (<20/run); the next run (5 min) drains the rest.
      take: 1000,
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
        // Return any Wanasa points redeemed on this PENDING booking. Points are
        // debited at booking-create time (so the same points can't double-book),
        // so hard-deleting an abandoned booking without refunding them would
        // silently confiscate the customer's store credit. Mirrors the
        // customer-cancel-unpaid path (bookings.service.ts) — source
        // CANCEL_REFUND_UNPAID; the ledger row's bookingId is a soft pointer, so
        // the delete below doesn't invalidate it.
        if (b.pointsRedeemed > 0) {
          await this.loyalty.refund(tx, {
            userId: b.customerId,
            amount: b.pointsRedeemed,
            bookingId: b.id,
            source: 'CANCEL_REFUND_UNPAID',
            actorType: 'SYSTEM',
            actorId: 'cron',
            note: `Stale PENDING auto-cancel — returned ${b.pointsRedeemed} redeemed points, booking ${b.ref}`,
          });
        }
      }

      // Soft-FAIL the abandoned PENDING payments instead of deleting them.
      // The cron used to hard-delete the payment row, which destroyed the
      // gatewayBasketId + bookingSnapshot that the PAY2M success-callback
      // recovery (§B2 in payment.service.ts) depends on — so a genuine,
      // verified card success arriving AFTER this cron run (a delayed/retried
      // PAY2M callback past the 30-min cutoff) hit "Payment not found" and the
      // customer was charged with NO booking and NO refund (invisible even to
      // reconciliation). Marking the payment FAILED but KEEPING the row (with
      // its snapshot) lets that late success recover the booking from the
      // snapshot or queue a refund — and restores this file's stated invariant
      // that payments are never hard-deleted. Only flip rows still PENDING: a
      // payment a concurrent success-callback already moved to SUCCESS must be
      // left intact (its booking, now CONFIRMED, is protected by the guard below).
      if (paymentIds.length > 0) {
        await tx.payment.updateMany({
          where: { id: { in: paymentIds }, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
      }

      // Delete the abandoned bookings — but ONLY ones still PENDING. If a
      // success callback CONFIRMED one in the race window between the findMany
      // above and this tx, the status guard makes this a no-op for that row, so
      // a paid, confirmed booking is never destroyed. (Deleting the booking —
      // the FK-owning side — leaves the soft-failed payment intact for recovery.)
      await tx.booking.deleteMany({
        where: { id: { in: bookingIds }, status: 'PENDING' },
      });
    });

    this.logger.log({ event: 'CLEANUP_STALE_PENDING_CANCELLED', count: staleBookings.length });

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
    // Leader-election TTL = 60 min. The per-booking loyalty-points loop
    // can take a while if hundreds of bookings completed yesterday, but
    // duplicate execution would call loyalty.earn() twice for each booking
    // — pointsAwarded flag would prevent the double-credit, but the audit
    // log line would still be duplicated. Lock keeps the picture clean.
    await this.lock.withLeaderLock('cron:auto-complete-bookings', 60 * 60_000, async () => {
      await this.runAutoCompletePastBookings();
    });
  }

  private async runAutoCompletePastBookings() {
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
        pointsDiscount: true,
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
        // Cash-only earn basis — a points-paid booking earns 0 (no loop).
        const points = this.loyalty.computeEarnedPoints(
          Number(booking.totalPrice),
          Number(booking.pointsDiscount),
          pointsPerQar,
        );
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
          this.logger.error({ event: 'LOYALTY_AWARD_FAILED', bookingId: booking.id, kind });
        }
      }

      if (totalPointsAwarded > 0) {
        this.logger.log({ event: 'LOYALTY_AWARD_BATCH', pointsAwarded: totalPointsAwarded, bookings: eligibleBookings.length });
      }
    }

    this.logger.log({ event: 'BOOKINGS_AUTO_COMPLETED', count: bookingsToComplete.length });
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
    // Leader-election TTL = 30 min. updateMany is fast (single query),
    // so 30 min is generous; the lock just stops two pods both writing
    // the same audit log entry.
    await this.lock.withLeaderLock('cron:auto-expire-coupons', 30 * 60_000, async () => {
      await this.runAutoExpireCoupons();
    });
  }

  private async runAutoExpireCoupons() {
    const now = new Date();

    const { count } = await this.prisma.client.coupon.updateMany({
      where: {
        status: 'APPROVED',
        validTo: { lt: now },
      },
      data: { status: 'EXPIRED' },
    });

    if (count > 0) {
      this.logger.log({ event: 'COUPONS_AUTO_EXPIRED', count });
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
    // Soft-delete (set archivedAt) instead of physical DELETE — keeps
    // the audit trail append-only so compliance investigators can opt
    // to include archived rows. Two retention windows:
    //   - OPERATIONAL: AUDIT_LOG_RETENTION days (default 180)
    //   - FINANCIAL  : AUDIT_LOG_FINANCIAL_RETENTION days (default
    //     2555 = 7 yr) per Qatar PDPL §14, GDPR Art.30, standard
    //     financial-records regulation.
    // Skip rows already archived (idempotent).
    const now = new Date();
    const operationalCutoff = new Date(now);
    operationalCutoff.setDate(operationalCutoff.getDate() - this.AUDIT_LOG_RETENTION);
    const financialCutoff = new Date(now);
    financialCutoff.setDate(financialCutoff.getDate() - this.AUDIT_LOG_FINANCIAL_RETENTION);

    const [operational, financial] = await Promise.all([
      this.prisma.client.auditLog.updateMany({
        where: {
          actionCategory: 'OPERATIONAL',
          createdAt: { lt: operationalCutoff },
          archivedAt: null,
        },
        data: { archivedAt: now },
      }),
      this.prisma.client.auditLog.updateMany({
        where: {
          actionCategory: 'FINANCIAL',
          createdAt: { lt: financialCutoff },
          archivedAt: null,
        },
        data: { archivedAt: now },
      }),
    ]);

    return operational.count + financial.count;
  }

  async cleanOldExpiredCoupons(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.EXPIRED_COUPON_RETENTION);
    const { count } = await this.prisma.client.coupon.deleteMany({
      where: { status: 'EXPIRED', validTo: { lt: cutoff } },
    });
    return count;
  }

  /// R4 — prune terminal EmailOutbox rows older than the retention window,
  /// counted from when the row REACHED its terminal state (sentAt / failedAt),
  /// not from createdAt — so a row that retried for a while and only just
  /// succeeded isn't deleted prematurely. PENDING rows are untouched: they're
  /// still in the retry cycle (the drain worker moves them to FAILED once it
  /// gives up, and those then age out here). `where`-scoped — never a bare deleteMany.
  async cleanOldOutboxRows(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.EMAIL_OUTBOX_RETENTION);
    const { count } = await this.prisma.client.emailOutbox.deleteMany({
      where: {
        OR: [
          { status: 'SENT', sentAt: { lt: cutoff } },
          { status: 'FAILED', failedAt: { lt: cutoff } },
        ],
      },
    });
    return count;
  }
}
