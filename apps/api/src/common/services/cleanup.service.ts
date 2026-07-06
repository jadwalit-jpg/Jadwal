import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLoggerService } from './audit-logger.service';
import { LoyaltyService } from './loyalty.service';
import { AvailabilityCacheService } from '../../redis/availability-cache.service';
import { RedisLockService } from '../../redis/redis-lock.service';
import { refundCouponUsage } from '../../bookings/bookings.service';
import { nowInTimezone } from '../validators/timezone';

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
  // Grace before reaping a booking that DID reach PAY2M (has a basket id). The
  // slot is already freed the moment reservedUntil passes (availability ignores
  // expired-PENDING), so the cron gains nothing by reaping fast — and reaping at
  // ~30 min could race a slow/retried PAY2M success. A generous grace (default 2h,
  // well beyond PAY2M's ~15-20 min session + IPN delivery) makes that race
  // practically impossible without storing anything extra. Tunable via env.
  private readonly PAY2M_PENDING_GRACE_MINUTES: number;

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
    // Default 120 min (2h). Clamp to a sane positive integer (1..1440 min) so a bad
    // SSM value can't reap in-flight payments early, and an absurd one can't push
    // the cutoff past JS's Date range into an Invalid Date (cron would throw).
    const grace = Number(this.configService.get('PAY2M_PENDING_GRACE_MINUTES', '120'));
    this.PAY2M_PENDING_GRACE_MINUTES = Number.isInteger(grace) && grace > 0 && grace <= 1440 ? grace : 120;
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

    // PAY2M checkout sessions last ~15-20 min. We wait PAY2M_PENDING_GRACE_MINUTES
    // (default 120) — far beyond that + IPN delivery — before reaping a
    // basket-initiated booking, so a slow/retried success can't be raced. The slot
    // is already free (reservedUntil filter), so the extra wait costs nothing but a
    // ghost PENDING row lingering a bit longer (its points return when reaped).
    const paymentInitiatedCutoff = new Date(now.getTime() - this.PAY2M_PENDING_GRACE_MINUTES * 60 * 1000);

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
            // Never reap a booking whose reservation is still actively held in
            // the future: a verified NAPS-rail success extends `reservedUntil`
            // (holdNapsSuccess) to keep the slot while PAY2M's delayed capture
            // confirmation (IPN) is still expected. Without this AND, Case 3's
            // 30-min anchor reaped the held booking out from under its own
            // extension, dropping a paid customer into the §B2 recovery path.
            // An ordinary abandoned booking has its short original reservedUntil
            // (already < now by the 30-min mark) so it is still reaped here.
            reservedUntil: { lt: now },
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
    const claimedBookingIds = await this.prisma.client.$transaction(async (tx) => {
      const paymentIds = staleBookings.map(b => b.paymentId).filter(Boolean) as string[];
      const claimedIds: string[] = [];

      // Per-booking: CLAIM (hard-delete) each stale reservation, THEN refund what
      // the customer put in — but ONLY for a row we actually reaped. Claiming
      // before refunding is what closes a money-mint race: a delayed/retried PAY2M
      // success can CONFIRM a booking in the window between the findMany above and
      // this transaction. If that happened, the claim-delete matches 0 rows and we
      // skip the refund — otherwise the customer would keep a paid, CONFIRMED
      // booking AND get the redeemed points + coupon usage back (a mint).
      // (Previously the coupon/points refund ran UNCONDITIONALLY and only the
      // delete/payment-fail were PENDING-guarded, so the refund leaked on the race.)
      for (const b of staleBookings) {
        // Atomic claim: delete only if STILL PENDING. Deleting the booking — the
        // FK-owning side — leaves the soft-failed payment intact for §B2 recovery;
        // loyaltyLedger.bookingId is a soft pointer (no FK) so the refund ledger
        // written below stays valid after the row is gone.
        const del = await tx.booking.deleteMany({
          where: { id: b.id, status: 'PENDING' },
        });
        if (del.count === 0) continue; // a late success CONFIRMED it → leave it (and its points) alone
        claimedIds.push(b.id);

        // Refund coupon usage — createBooking incremented usedCount at reservation
        // time; an abandoned booking must return that increment so coupons stay accurate.
        if (b.couponCode) {
          await refundCouponUsage(tx, b.couponCode, b.customerId);
        }
        // Return any Wanasa points redeemed on this booking. Points are debited at
        // booking-create time (so the same points can't double-book), so dropping
        // an abandoned booking without refunding them would silently confiscate the
        // customer's store credit. Mirrors the customer-cancel-unpaid path
        // (bookings.service.ts) — source CANCEL_REFUND_UNPAID.
        const redeemed = Number(b.pointsRedeemed); // Decimal column (QAR-denominated) → number
        if (redeemed > 0) {
          await this.loyalty.refund(tx, {
            userId: b.customerId,
            amount: redeemed,
            bookingId: b.id,
            source: 'CANCEL_REFUND_UNPAID',
            actorType: 'SYSTEM',
            actorId: 'cron',
            note: `Stale PENDING auto-cancel — returned ${redeemed} redeemed points, booking ${b.ref}`,
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
      // left intact (its booking, now CONFIRMED, is protected by the claim above).
      if (paymentIds.length > 0) {
        await tx.payment.updateMany({
          where: { id: { in: paymentIds }, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
      }

      return claimedIds;
    });

    // Report only the bookings we ACTUALLY reaped. A row a late PAY2M success
    // confirmed between the scan and the transaction was skipped above, so counting
    // all staleBookings here would over-report cancellations in the log + audit.
    const claimedSet = new Set(claimedBookingIds);
    const claimedActivityIds = staleBookings.filter((b) => claimedSet.has(b.id)).map((b) => b.activityId);

    this.logger.log({ event: 'CLEANUP_STALE_PENDING_CANCELLED', count: claimedBookingIds.length, scanned: staleBookings.length });

    // Batch-invalidate availability only for activities we actually freed. Dedup
    // happens inside invalidateMany; pipelined INCRs keep Redis round-trips bounded.
    void this.availabilityCache.invalidateMany(claimedActivityIds);

    this.auditLogger.log({
      actorType: 'SYSTEM',
      actorId: 'cron',
      actorName: 'System Cron',
      action: 'AUTO_CANCEL_STALE_BOOKINGS',
      entity: 'Booking',
      details: JSON.stringify({ count: claimedBookingIds.length, bookingIds: claimedBookingIds.slice(0, 20) }),
    });
  }

  // ─── Auto-complete Past Bookings (every 10 min) ──────────────────────────
  // CONFIRMED bookings whose activity date has passed → COMPLETED, awarding
  // Wanasa loyalty points for each. Runs every 10 minutes (was 1 AM daily) so a
  // customer receives their points within ~10 min of the event ending instead
  // of up to ~24h later. Cheap + safe to run often: each pass only touches
  // bookings that ended since the last run, and it is idempotent (the
  // pointsAwarded flag + the unique (bookingId, source) ledger constraint
  // prevent any double-award even if two ticks overlap).

  @Cron(CronExpression.EVERY_10_MINUTES)
  async autoCompletePastBookings() {
    // Leader-election so only one API task runs it per tick (avoids duplicate
    // audit-log lines; double-credit is already impossible per the guards
    // above). TTL 15 min: longer than any run (each pass processes only
    // newly-ended bookings) yet short enough that a crashed leader is recovered
    // within a couple of ticks.
    await this.lock.withLeaderLock('cron:auto-complete-bookings', 15 * 60_000, async () => {
      await this.runAutoCompletePastBookings();
    });
  }

  private async runAutoCompletePastBookings() {
    const now = new Date();

    // endDatetime is stored as local-wall-clock tagged-UTC (buildDatetime), so a
    // booking has truly ended when NOW IN THE ACTIVITY'S TIMEZONE has passed it —
    // NOT when raw-UTC now has. A raw `endDatetime < now` compare fires an activity
    // country's UTC offset LATE (Qatar +3 → the tagged 18:00Z end isn't "past" in
    // UTC until 21:00 Qatar), which delayed both completion and the loyalty-points
    // award by ~3h. Fix: coarse-fetch by a widened window (tagged end can be up to
    // the max UTC offset ahead of raw now), then gate each booking EXACTLY with
    // nowInTimezone(its own tz). Mirrors the cancel guard in bookings.service.ts.
    const MAX_TZ_OFFSET_MS = 14 * 60 * 60 * 1000; // widest real IANA offset (+14)
    const coarseCutoff = new Date(now.getTime() + MAX_TZ_OFFSET_MS);

    const candidates = await this.prisma.client.booking.findMany({
      where: {
        status: 'CONFIRMED',
        endDatetime: { lt: coarseCutoff },
      },
      select: {
        id: true,
        ref: true,
        customerId: true,
        totalPrice: true,
        pointsDiscount: true,
        pointsAwarded: true,
        endDatetime: true,
        activity: { select: { country: { select: { defaultTimezone: true } } } },
      },
    });

    // Exact per-timezone gate: complete only bookings whose end has passed in
    // their OWN activity timezone. Everything the coarse window over-fetched
    // (ends still in the future locally) is filtered out here.
    const bookingsToComplete = candidates.filter((b) => {
      const tz = b.activity?.country?.defaultTimezone ?? 'UTC';
      return b.endDatetime.getTime() <= nowInTimezone(tz).getTime();
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
            // Atomic claim (replaces the old read-then-update TOCTOU): flip
            // pointsAwarded false→true only if it is still false. If a manual
            // vendor/admin complete — or a prior overlapping cron run — already
            // awarded this booking, count is 0 and we skip, so it can't earn twice.
            const claim = await tx.booking.updateMany({
              where: { id: booking.id, pointsAwarded: false },
              data: { pointsAwarded: true },
            });
            if (claim.count === 0) return;

            await this.loyalty.earn(tx, {
              userId: booking.customerId,
              amount: points,
              bookingId: booking.id,
              note: `Earned on booking ${booking.ref} (${Number(booking.totalPrice)})`,
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
