import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Shared audit logger — used by services that need to log events manually
 * (bookings, cron jobs, auth). Interceptors handle admin/vendor logging automatically.
 */
@Injectable()
export class AuditLoggerService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    actorType: 'ADMIN' | 'VENDOR' | 'CUSTOMER' | 'SYSTEM';
    actorId: string;
    actorName: string;
    action: string;
    entity: string;
    entityId?: string;
    details?: string;
  }) {
    await this.prisma.client.auditLog.create({
      data: {
        actorType: params.actorType,
        actorId: params.actorId,
        actorName: params.actorName,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        details: params.details?.slice(0, 1000),
      },
    }).catch(() => {
      // Fire-and-forget — never let audit logging break the main flow
    });
  }
}
