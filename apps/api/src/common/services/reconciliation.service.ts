import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLoggerService } from './audit-logger.service';
import { NotificationService } from './notification.service';
import { RedisLockService } from '../../redis/redis-lock.service';

/**
 * Daily money-flow reconciliation cron (plan §B10).
 *
 * Compares platform-wide totals across the four money "buckets":
 *
 *   totalPayments  = SUM(payment.amount WHERE status = SUCCESS)
 *   vendorEarnings = SUM(booking.totalPrice - booking.commissionAmount)
 *                    WHERE payment.status = SUCCESS
 *   platformFees   = SUM(booking.commissionAmount)
 *                    WHERE payment.status = SUCCESS
 *   totalRefunded  = SUM(payment.refundAmount WHERE status = REFUNDED)
 *
 *   drift = totalPayments - (vendorEarnings + platformFees + totalRefunded)
 *
 * Under correct accounting drift should always be exactly 0 — every QAR
 * a customer paid is either earmarked for a vendor, kept as platform
 * commission, or refunded. Any non-zero drift means a payment record
 * was lost, a refund was double-counted, a manual SQL edit happened,
 * or a code path was added that mints money outside this triangle.
 *
 * The cron writes one row per UTC day to `reconciliation_logs` and
 * fires an admin alert (in-app notification + financial audit row)
 * if |drift| > 0.01 QAR.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  /** Tolerance in QAR for accounting drift — covers Decimal rounding only. */
  private static readonly DRIFT_TOLERANCE = 0.01;

  constructor(
    private prisma: PrismaService,
    private auditLogger: AuditLoggerService,
    private notifications: NotificationService,
    private lock: RedisLockService,
  ) {}

  /** Daily 5 AM cron — runs after the 1 AM auto-complete + 2 AM coupon-expire jobs. */
  @Cron('0 5 * * *')
  async handleDailyReconciliation(): Promise<void> {
    // Leader-election: with >1 ECS task this @Cron fires on EVERY task. Without
    // a lock the reconciliation ran N times concurrently — wasted work, and on
    // a drift day a DUPLICATED FINANCIAL audit row + duplicate admin alert. Only
    // the lock winner runs it; the others no-op. ttl > worst-case runtime.
    await this.lock.withLeaderLock('cron:daily-reconciliation', 10 * 60_000, async () => {
      this.logger.log('Starting daily reconciliation...');
      try {
        const result = await this.runReconciliation();
        if (result.passed) {
          this.logger.log(`Reconciliation passed (drift = ${result.drift.toFixed(2)} QAR).`);
        } else {
          this.logger.error(
            `Reconciliation FAILED — drift = ${result.drift.toFixed(2)} QAR. ` +
              `payments=${result.totalPayments.toFixed(2)} ` +
              `vendor=${result.vendorEarnings.toFixed(2)} ` +
              `fees=${result.platformFees.toFixed(2)} ` +
              `refunded=${result.totalRefunded.toFixed(2)}`,
          );
        }
      } catch (err) {
        const kind = err instanceof Error ? err.name : 'UnknownError';
        this.logger.error(`Reconciliation cron failed (${kind}) — admin alert NOT fired.`);
      }
    });
  }

  /**
   * The actual computation + persistence path. Public so admin tooling
   * (manual "run now" button) and integration tests can invoke it.
   */
  async runReconciliation(now: Date = new Date()): Promise<{
    runDate: Date;
    totalPayments: number;
    vendorEarnings: number;
    platformFees: number;
    totalRefunded: number;
    drift: number;
    passed: boolean;
  }> {
    const db = this.prisma.client;
    // Snap to 00:00 UTC of the run day. One row per day; subsequent
    // runs (e.g. manual re-trigger) update the existing row.
    const runDate = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    ));

    const [paymentsAgg, bookingsAgg, refundedAgg] = await Promise.all([
      db.payment.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      // For SUCCESS-paid bookings, vendor's share = totalPrice - commissionAmount.
      // We need both sums — totalPrice for vendorEarnings derivation and
      // commissionAmount for platformFees — across the same row set, so a
      // single aggregate is cheaper than two scans.
      db.booking.aggregate({
        where: { payment: { status: 'SUCCESS' } },
        _sum: { totalPrice: true, commissionAmount: true },
      }),
      db.payment.aggregate({
        where: { status: 'REFUNDED' },
        _sum: { refundAmount: true },
      }),
    ]);

    const totalPayments = decimalToNumber(paymentsAgg._sum.amount);
    const totalPriceSum = decimalToNumber(bookingsAgg._sum.totalPrice);
    const platformFees = decimalToNumber(bookingsAgg._sum.commissionAmount);
    const vendorEarnings = round2(totalPriceSum - platformFees);
    const totalRefunded = decimalToNumber(refundedAgg._sum.refundAmount);

    const drift = round2(
      totalPayments - (vendorEarnings + platformFees + totalRefunded),
    );
    const passed = Math.abs(drift) <= ReconciliationService.DRIFT_TOLERANCE;

    // upsert: on manual re-runs of the same day, refresh the snapshot.
    await db.reconciliationLog.upsert({
      where: { runDate },
      create: {
        runDate,
        totalPayments: new Prisma.Decimal(totalPayments),
        vendorEarnings: new Prisma.Decimal(vendorEarnings),
        platformFees: new Prisma.Decimal(platformFees),
        totalRefunded: new Prisma.Decimal(totalRefunded),
        drift: new Prisma.Decimal(drift),
        passed,
      },
      update: {
        totalPayments: new Prisma.Decimal(totalPayments),
        vendorEarnings: new Prisma.Decimal(vendorEarnings),
        platformFees: new Prisma.Decimal(platformFees),
        totalRefunded: new Prisma.Decimal(totalRefunded),
        drift: new Prisma.Decimal(drift),
        passed,
      },
    });

    if (!passed) {
      await this.fireAdminAlert({
        runDate,
        drift,
        totalPayments,
        vendorEarnings,
        platformFees,
        totalRefunded,
      });
    }

    return {
      runDate,
      totalPayments,
      vendorEarnings,
      platformFees,
      totalRefunded,
      drift,
      passed,
    };
  }

  private async fireAdminAlert(params: {
    runDate: Date;
    drift: number;
    totalPayments: number;
    vendorEarnings: number;
    platformFees: number;
    totalRefunded: number;
  }): Promise<void> {
    const dayLabel = params.runDate.toISOString().slice(0, 10);
    const driftLabel = `${params.drift >= 0 ? '+' : ''}${params.drift.toFixed(2)} QAR`;

    // In-app notification — landed on every active admin's notification
    // tray. notifyAdmins is fire-and-forget internally, so a failure
    // here only logs (it does not break the ledger row above).
    await this.notifications.notifyAdmins({
      type: 'SYSTEM',
      title: 'Reconciliation drift detected',
      message: `Daily reconciliation for ${dayLabel} failed: drift = ${driftLabel}. Check /admin/reconciliation.`,
      link: '/admin',
    });

    // FINANCIAL audit row — kept for 7 years per §B8 retention rules so
    // a regulator / auditor / forensic investigation can always trace
    // which day(s) drifted and by how much.
    await this.auditLogger.log({
      actorType: 'SYSTEM',
      actorId: 'system',
      actorName: 'reconciliation-cron',
      action: 'RECONCILIATION_DRIFT_DETECTED',
      entity: 'ReconciliationLog',
      entityId: dayLabel,
      actionCategory: 'FINANCIAL',
      details: JSON.stringify({
        drift: params.drift,
        totalPayments: params.totalPayments,
        vendorEarnings: params.vendorEarnings,
        platformFees: params.platformFees,
        totalRefunded: params.totalRefunded,
      }),
    });
  }
}

function decimalToNumber(d: Prisma.Decimal | null | undefined): number {
  if (d == null) return 0;
  return round2(d.toNumber());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
