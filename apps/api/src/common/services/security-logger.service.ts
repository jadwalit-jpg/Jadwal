import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type SecurityEvent =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGIN_GLOBAL_RATE_EXCEEDED'
  | 'ACCOUNT_LOCKED'
  | 'LOGOUT'
  | 'TOKEN_REFRESH'
  | 'REFRESH_REUSE_DETECTED'
  | 'DEACTIVATED_ACCESS'
  | 'SUSPENDED_VENDOR_ACCESS'
  | 'PASSWORD_CHANGED'
  | 'ROLE_CHANGED'
  | 'ACCOUNT_DEACTIVATED'
  | 'PHONE_OTP_SENT'
  | 'PHONE_VERIFIED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'PASSWORD_RESET_FAILED'
  | 'PASSWORD_CHANGE_FAILED'
  | 'PASSWORD_CHANGE_COMPLETED'
  | 'EMAIL_UNSUBSCRIBE'
  | 'ACCOUNT_SELF_DELETED'
  | 'ACCOUNT_EXPORT_REQUESTED'
  | 'ACCOUNT_DELETE_FAILED'
  | 'BOOKING_EMAIL_OTP_SENT'
  | 'BOOKING_EMAIL_OTP_VERIFY_OK'
  | 'BOOKING_EMAIL_OTP_VERIFY_FAIL'
  | 'BOOKING_EMAIL_OTP_LOCKED';

interface LogParams {
  event: SecurityEvent;
  userId?: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  details?: string;
}

@Injectable()
export class SecurityLoggerService {
  private readonly logger = new Logger(SecurityLoggerService.name);

  constructor(private prisma: PrismaService) {}

  /** Mask email: john@example.com → j***@example.com */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***';
    return `${local[0]}***@${domain}`;
  }

  async log(params: LogParams): Promise<void> {
    try {
      await this.prisma.client.securityLog.create({
        data: {
          event: params.event,
          userId: params.userId ?? null,
          // Mask email — never store full email in security logs
          email: params.email ? this.maskEmail(params.email) : null,
          // Never store IP addresses — PII under GDPR/GCC privacy laws
          ip: null,
          userAgent: params.userAgent ? params.userAgent.slice(0, 500) : null,
          details: params.details ?? null,
        },
      });
    } catch {
      this.logger.error(`Failed to write security log: ${params.event}`);
    }
  }
}
