import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type AuditActionCategory = 'FINANCIAL' | 'OPERATIONAL';

/**
 * Shared audit logger — used by services that need to log events manually
 * (bookings, cron jobs, auth, payments). Interceptors handle admin/vendor
 * logging automatically.
 *
 * Categories drive retention. FINANCIAL events (payment-anything,
 * loyalty-anything, payout-anything, refund decisions, vendor commission
 * changes, role changes that affect money flow) are kept for 7 years
 * regardless of the OPERATIONAL retention window — see
 * `cleanup.service.ts` for the differentiated TTL logic.
 *
 * Set explicitly to FINANCIAL in callers when applicable (the default is
 * OPERATIONAL because most ad-hoc service-side audits are about state
 * transitions, not money).
 */
@Injectable()
export class AuditLoggerService {
  private readonly logger = new Logger(AuditLoggerService.name);

  constructor(private prisma: PrismaService) {}

  async log(params: {
    actorType: 'ADMIN' | 'VENDOR' | 'CUSTOMER' | 'SYSTEM';
    actorId: string;
    actorName: string;
    action: string;
    entity: string;
    entityId?: string;
    details?: string;
    actionCategory?: AuditActionCategory;
  }) {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          actorType: params.actorType,
          actorId: params.actorId,
          actorName: params.actorName,
          action: params.action,
          entity: params.entity,
          entityId: params.entityId,
          details: params.details?.slice(0, 1000),
          actionCategory: params.actionCategory ?? 'OPERATIONAL',
        },
      });
    } catch (err) {
      // Audit writes are async w.r.t. business flow — we deliberately
      // don't throw here, otherwise an audit-DB blip would break a
      // payment callback or a booking cancel for the customer. But we
      // refuse to silently swallow: surface it to CloudWatch with the
      // business-id context so an alert can fire and reconciliation
      // can run if drift is suspected.
      const kind = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(
        `Audit write failed for ${params.action} (${params.entity}/${params.entityId ?? '?'}, ${kind})`,
      );
    }
  }
}
