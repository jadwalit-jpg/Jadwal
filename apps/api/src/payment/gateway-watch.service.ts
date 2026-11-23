import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisLockService } from '../redis/redis-lock.service';
import { PaymentService } from './payment.service';

/** A held NAPS success that nothing confirmed for this long gets an admin alert. */
export const HELD_ALERT_AFTER_MS = 10 * 60_000;

/**
 * Watches debit-card (NAPS) payments that PAY2M reported as successful but that
 * the site is still holding (payment.napsHeldAt set, not SUCCESS). After ten
 * minutes without a confirmation it pages admins once per payment, through the
 * same in-app + push channel the site already uses for admin alerts, so the
 * payment can be checked in PAY2M and confirmed by hand ("Mark as paid").
 *
 * Reads and alerts only — it never confirms, fails or deletes anything.
 */
@Injectable()
export class GatewayWatchService {
  private readonly logger = new Logger(GatewayWatchService.name);

  constructor(
    private prisma: PrismaService,
    private lock: RedisLockService,
    private payments: PaymentService,
  ) {}

  @Cron('*/5 * * * *')
  async watchHeldPayments() {
    // Leader election: one API task per tick (same pattern as the other crons).
    await this.lock.withLeaderLock('cron:gateway-watch', 4 * 60_000, async () => {
      await this.run();
    });
  }

  /**
   * Alert admins once per payment whose NAPS hold is older than ten minutes
   * and still unconfirmed. The once-only guarantee is the conditional claim on
   * `gatewayAlertedAt` inside PaymentService.alertAdminsAboutGatewayPayment,
   * so a second run (or a second API task) sends nothing. Returns the number
   * of alerts this run sent.
   */
  async run(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - HELD_ALERT_AFTER_MS);
    const due = await this.prisma.client.payment.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        napsHeldAt: { lte: cutoff },
        gatewayAlertedAt: null,
      },
      select: { id: true, gatewayBasketId: true, bookingSnapshot: true, booking: { select: { ref: true } } },
      orderBy: { napsHeldAt: 'asc' },
      take: 100,
    });

    let sent = 0;
    for (const p of due) {
      const ref = p.booking?.ref ?? (p.bookingSnapshot as { ref?: string } | null)?.ref ?? 'unknown';
      const alerted = await this.payments.alertAdminsAboutGatewayPayment(p.id, {
        title: 'Debit card payment awaiting confirmation',
        message:
          `Booking ${ref}: a debit card payment (basket ${p.gatewayBasketId ?? 'unknown'}) was received by PAY2M ` +
          'over 10 minutes ago but is not confirmed. Check PAY2M and use "Mark as paid" if the money was taken.',
      }, now);
      if (alerted) sent += 1;
    }
    if (sent > 0) {
      this.logger.log({ event: 'PAY2M_HELD_PAYMENT_ALERTS', sent, scanned: due.length });
    }
    return sent;
  }
}
