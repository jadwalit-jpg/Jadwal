import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * SES bounce / complaint suppression list.
 *
 * Why we need it (sender-reputation defence):
 *
 *   AWS SES caps domain reputation: hard-bounce rate >5% or complaint
 *   rate >0.1% over a 7-day window flags the domain. Once flagged, *all*
 *   subsequent sends — including to legitimate recipients — get rate-
 *   limited, junked, or rejected by receiving MTAs. The cost of one bad
 *   address sent 5 times per day across 100 fake signups is real $$$ and
 *   weeks of recovery.
 *
 *   This service maintains a Postgres-backed list of recipients SES has
 *   reported as bounced or complained, populated by the SNS webhook at
 *   /webhooks/ses-events. Every outbound send checks the list first and
 *   silently drops if the recipient is suppressed.
 *
 * Storage choice — Postgres, not Redis:
 *
 *   - Suppression is permanent until manually unsuppressed (Redis TTL is
 *     wrong fit).
 *   - Survives Redis flushes / cluster failovers.
 *   - Admin UI can list + unsuppress entries (typo'd address recovery).
 *   - Volume is small (<100K rows expected year-1).
 *
 * PII discipline:
 *
 *   We store SHA-256(lowercased + trimmed email), never plaintext. A DB
 *   dump leaks no recipient list — same posture as EmailQuotaService.
 *
 * Failure mode:
 *
 *   isSuppressed() fails OPEN on Prisma error: a broken DB shouldn't
 *   freeze every email send platform-wide. Per-IP throttle and SES
 *   account quota still cap damage. Errors are logged for ops.
 */
@Injectable()
export class EmailSuppressionService {
  private readonly logger = new Logger(EmailSuppressionService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Returns true if this email should be blocked from receiving outbound
   * mail. Fail-OPEN on infra error (returns false so the send proceeds).
   */
  async isSuppressed(email: string): Promise<boolean> {
    const hash = this.hashEmail(email);
    try {
      const row = await (this.prisma.client as any).emailSuppression.findUnique({
        where: { emailHash: hash },
        select: { id: true },
      });
      return row !== null;
    } catch (err) {
      const kind = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(`suppression lookup failed (${kind}) — allowing send`);
      return false;
    }
  }

  /**
   * Idempotent insert — if the hash already exists we update the latest
   * reason/bounceType (a previously-soft-bounced address that later
   * lands on the complaint list should reflect the worst signal).
   */
  async suppress(
    email: string,
    reason: 'bounce' | 'complaint' | 'reject' | 'manual',
    bounceType?: string,
    notes?: string,
  ): Promise<void> {
    const hash = this.hashEmail(email);
    try {
      await (this.prisma.client as any).emailSuppression.upsert({
        where: { emailHash: hash },
        create: { emailHash: hash, reason, bounceType: bounceType ?? null, notes: notes ?? null },
        update: { reason, bounceType: bounceType ?? null, notes: notes ?? null },
      });
      // Mask half the hash in the log line — enough for forensic correlation,
      // not enough to derive the recipient.
      this.logger.warn(
        `email-suppression added reason=${reason} bounceType=${bounceType ?? 'n/a'} hash=${hash.slice(0, 8)}…`,
      );
    } catch (err) {
      const kind = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(`suppression upsert failed (${kind})`);
      // Re-throw — the SNS webhook caller should see this so AWS retries
      // the message. Otherwise we silently lose suppression events.
      throw err;
    }
  }

  /**
   * Manual un-suppression. Used by admin tooling when a typo'd address
   * gets fixed (user typed `gmial.com`, hard-bounce, then registers
   * properly). Returns true if a row was removed.
   */
  async unsuppress(emailHash: string): Promise<boolean> {
    try {
      await (this.prisma.client as any).emailSuppression.delete({
        where: { emailHash },
      });
      this.logger.log(`email-suppression removed hash=${emailHash.slice(0, 8)}…`);
      return true;
    } catch (err: any) {
      // Prisma P2025 = record not found. Idempotent — return false, not error.
      if (err?.code === 'P2025') return false;
      throw err;
    }
  }

  private hashEmail(email: string): string {
    return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  }
}
