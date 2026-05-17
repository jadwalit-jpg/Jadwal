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
 * Delivery is at-least-once: if the pod crashes after Resend accepts the
 * message but before we mark the row SENT, the next drain re-sends. A
 * duplicate confirmation email is harmless; exactly-once would need a 2-phase
 * commit with the email provider, which isn't worth it here.
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
      let skipped = 0; // row was already moved off PENDING by another drainer (rare — only if the leader lock expired mid-run)
      // Sequential — EmailService has its own circuit breaker + timeout; we
      // don't want a thundering batch hammering Resend (and a transient
      // provider blip would otherwise burn the whole batch's attempt
      // counters at once).
      for (const row of due) {
        try {
          const result = await this.dispatch(row);
          if (result === 'sent') {
            // Optimistic lock: only commit SENT if the row is still in the
            // state we picked it up in. If a concurrent drainer already moved
            // it (SENT/FAILED/another attempt), count==0 → leave it alone
            // rather than clobber a newer state with a stale snapshot.
            const { count } = await this.prisma.client.emailOutbox.updateMany({
              where: { id: row.id, status: 'PENDING', attempts: row.attempts },
              data: { status: 'SENT', sentAt: new Date(), attempts: row.attempts + 1, lastError: null },
            });
            if (count === 0) { skipped++; continue; }
            // NOTE: at-least-once — if Resend accepted the message but this
            // UPDATE raced/failed and the row stays PENDING, the next drain
            // re-sends. A duplicate confirmation email is harmless.
            sent++;
            continue;
          }
          // Preserve the real failure kind: a misconfigured email type lands as
          // EMAIL_OUTBOX_UNKNOWN_TYPE (a poison row, not a transient blip) so it
          // doesn't masquerade as a provider outage in lastError / EMAIL_OUTBOX_GAVE_UP.
          const errKind = result === 'unknown_type' ? 'EMAIL_OUTBOX_UNKNOWN_TYPE' : 'EMAIL_SEND_FAILED';
          const outcome = await this.scheduleRetryOrGiveUp(row, errKind);
          if (outcome === 'gaveup') gaveUp++; else if (outcome === 'retried') retried++; else skipped++;
        } catch (err: unknown) {
          // Never persist the raw error — provider errors can echo the
          // recipient, request IDs, hostnames. Error class only.
          const kind = err instanceof Error ? err.name : 'UnknownError';
          const outcome = await this.scheduleRetryOrGiveUp(row, kind);
          if (outcome === 'gaveup') gaveUp++; else if (outcome === 'retried') retried++; else skipped++;
        }
      }
      this.logger.log({ event: 'EMAIL_OUTBOX_DRAIN', picked: due.length, sent, retried, gaveUp, skipped });
    });
  }

  /** Route a row to the right EmailService call. Distinguishes a transient
   *  send failure (`'send_failed'`) from a poison row (`'unknown_type'`) so the
   *  caller can record an honest `lastError` — an unknown type still gives up
   *  after MAX_ATTEMPTS rather than looping. */
  private async dispatch(
    row: { emailType: string; recipient: string; payload: unknown },
  ): Promise<'sent' | 'send_failed' | 'unknown_type'> {
    switch (row.emailType) {
      case 'BOOKING_CONFIRMATION': {
        const ok = await this.emailService.sendBookingConfirmation(
          row.recipient,
          row.payload as Parameters<EmailService['sendBookingConfirmation']>[1],
        );
        return ok ? 'sent' : 'send_failed';
      }
      default:
        this.logger.error({ event: 'EMAIL_OUTBOX_UNKNOWN_TYPE', emailType: row.emailType });
        return 'unknown_type';
    }
  }

  /** Bump the attempt counter; either schedule the next retry (jittered
   *  exponential backoff: ~1m, ~4m, ~16m, ~1h cap) or, if we've hit
   *  MAX_ATTEMPTS, mark the row FAILED. All writes are optimistically locked
   *  on `(status: 'PENDING', attempts: <picked>)` so a concurrent drainer's
   *  stale snapshot can't clobber a newer state — count==0 ⇒ 'skipped'. */
  private async scheduleRetryOrGiveUp(
    row: { id: string; attempts: number; emailType: string },
    errKind: string,
  ): Promise<'gaveup' | 'retried' | 'skipped'> {
    const attempts = row.attempts + 1;
    const lastError = errKind.slice(0, 300);
    if (attempts >= OutboxDrainService.MAX_ATTEMPTS) {
      const { count } = await this.prisma.client.emailOutbox.updateMany({
        where: { id: row.id, status: 'PENDING', attempts: row.attempts },
        data: { status: 'FAILED', failedAt: new Date(), attempts, lastError },
      });
      if (count === 0) return 'skipped';
      this.logger.error({ event: 'EMAIL_OUTBOX_GAVE_UP', outboxId: row.id, emailType: row.emailType, attempts, lastError });
      return 'gaveup';
    }
    const base = Math.min(60_000 * 4 ** (attempts - 1), 60 * 60_000);
    const delay = base + Math.floor(Math.random() * Math.min(base * 0.2, 30_000));
    const { count } = await this.prisma.client.emailOutbox.updateMany({
      where: { id: row.id, status: 'PENDING', attempts: row.attempts },
      data: { attempts, lastError, nextAttemptAt: new Date(Date.now() + delay) },
    });
    return count === 0 ? 'skipped' : 'retried';
  }
}
