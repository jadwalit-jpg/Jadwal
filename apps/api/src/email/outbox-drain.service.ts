import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisLockService } from '../redis/redis-lock.service';
import { EmailService } from './email.service';

/**
 * R4 — drains the EmailOutbox.
 *
 * The PAY2M success path enqueues an `email_outbox` row right after the
 * booking is confirmed (see PaymentService.handleCallback). This cron picks up
 * PENDING rows whose `nextAttemptAt` is due, sends them via EmailService, and
 * marks SENT — or, on failure, schedules a jittered exponential-backoff retry,
 * giving up (status=FAILED + EMAIL_OUTBOX_GAVE_UP log) after MAX_ATTEMPTS.
 *
 * Delivery is at-least-once: if the pod crashes after SES accepts the message
 * but before we mark the row SENT, the next drain re-sends. A duplicate
 * confirmation email is harmless; exactly-once would need a 2-phase commit with
 * SES, which isn't worth it here.
 *
 * EmailService.send() swallows its own errors and returns `false` on failure /
 * `true` on success OR on a deliberate no-op (recipient suppressed, daily quota
 * hit, email disabled). So `true` ⇒ done (never retry — the suppression/quota
 * is intentional); `false` ⇒ failed ⇒ retry. We also catch a thrown error
 * defensively.
 */
@Injectable()
export class OutboxDrainService {
  private readonly logger = new Logger(OutboxDrainService.name);

  /** Give up (status=FAILED) once this many send attempts have failed. */
  private static readonly MAX_ATTEMPTS = 5;
  /** Rows processed per tick — bounds each run's work + DB pressure. */
  private static readonly BATCH_SIZE = 50;

  constructor(
    private prisma: PrismaService,
    private lock: RedisLockService,
    private emailService: EmailService,
  ) {}

  // Every minute. Leader-locked (TTL = 2× the interval) so with N ECS tasks
  // only one pod drains; the lock auto-expires by the next tick if a leader
  // crashes mid-run. Mirrors CleanupService's cron pattern.
  @Cron('*/1 * * * *')
  async drain(): Promise<void> {
    await this.lock.withLeaderLock('cron:email-outbox-drain', 2 * 60_000, async () => {
      const due = await this.prisma.client.emailOutbox.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        orderBy: { nextAttemptAt: 'asc' },
        take: OutboxDrainService.BATCH_SIZE,
      });
      if (due.length === 0) return;

      let sent = 0;
      let retried = 0;
      let gaveUp = 0;
      // Sequential — SES has its own adaptive retry; we don't want a thundering
      // batch hammering it (and a transient SES blip would otherwise burn the
      // whole batch's attempt counters at once).
      for (const row of due) {
        try {
          const ok = await this.dispatch(row);
          if (ok) {
            await this.prisma.client.emailOutbox.update({
              where: { id: row.id },
              data: { status: 'SENT', sentAt: new Date(), attempts: row.attempts + 1, lastError: null },
            });
            sent++;
            continue;
          }
          if (await this.scheduleRetryOrGiveUp(row, 'SES_SEND_FAILED')) gaveUp++;
          else retried++;
        } catch (err: unknown) {
          // Never persist the raw error — SES errors can echo the recipient,
          // AWS request IDs, hostnames. Error class only.
          const kind = err instanceof Error ? err.name : 'UnknownError';
          if (await this.scheduleRetryOrGiveUp(row, kind)) gaveUp++;
          else retried++;
        }
      }
      this.logger.log({ event: 'EMAIL_OUTBOX_DRAIN', picked: due.length, sent, retried, gaveUp });
    });
  }

  /** Route a row to the right EmailService call. Returns `false` for an
   *  unknown type so it gives up after MAX_ATTEMPTS rather than looping. */
  private async dispatch(row: { emailType: string; recipient: string; payload: unknown }): Promise<boolean> {
    switch (row.emailType) {
      case 'BOOKING_CONFIRMATION':
        return this.emailService.sendBookingConfirmation(
          row.recipient,
          row.payload as Parameters<EmailService['sendBookingConfirmation']>[1],
        );
      default:
        this.logger.error({ event: 'EMAIL_OUTBOX_UNKNOWN_TYPE', emailType: row.emailType });
        return false;
    }
  }

  /** Bump the attempt counter; either schedule the next retry (jittered
   *  exponential backoff: ~1m, ~4m, ~16m, ~1h cap) or, if we've hit
   *  MAX_ATTEMPTS, mark the row FAILED. Returns true iff it gave up. */
  private async scheduleRetryOrGiveUp(
    row: { id: string; attempts: number; emailType: string },
    errKind: string,
  ): Promise<boolean> {
    const attempts = row.attempts + 1;
    const lastError = errKind.slice(0, 300);
    if (attempts >= OutboxDrainService.MAX_ATTEMPTS) {
      await this.prisma.client.emailOutbox.update({
        where: { id: row.id },
        data: { status: 'FAILED', failedAt: new Date(), attempts, lastError },
      });
      this.logger.error({ event: 'EMAIL_OUTBOX_GAVE_UP', outboxId: row.id, emailType: row.emailType, attempts, lastError });
      return true;
    }
    const base = Math.min(60_000 * 4 ** (attempts - 1), 60 * 60_000);
    const delay = base + Math.floor(Math.random() * Math.min(base * 0.2, 30_000));
    await this.prisma.client.emailOutbox.update({
      where: { id: row.id },
      data: { attempts, lastError, nextAttemptAt: new Date(Date.now() + delay) },
    });
    return false;
  }
}
