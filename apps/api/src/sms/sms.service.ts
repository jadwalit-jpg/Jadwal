import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

/**
 * SMS Service — AWS SNS integration.
 *
 * When SMS_ENABLED=false (dev): logs to console, never sends.
 * When SMS_ENABLED=true (production): sends via AWS SNS.
 *
 * All callers already use this service — no refactoring needed.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly enabled: boolean;
  private readonly snsClient: SNSClient | null;

  constructor(private config: ConfigService) {
    this.enabled = this.config.get('SMS_ENABLED', 'false') === 'true';

    // Defence-in-depth: never let production boot with SMS in log-only mode
    if (!this.enabled && process.env.NODE_ENV === 'production') {
      throw new Error('[FATAL] SMS_ENABLED must be true in production');
    }

    // Only initialize SNS client when SMS is enabled (avoids credential errors in dev)
    this.snsClient = this.enabled
      ? new SNSClient({ region: this.config.get('AWS_REGION', 'me-central-1') })
      : null;
  }

  async sendOtp(to: string, data: { code: string }): Promise<boolean> {
    if (!/^[0-9]{6}$/.test(data.code)) {
      this.logger.error('Invalid OTP format passed to sendOtp');
      return false;
    }
    const message = `Your Jadwal verification code is: ${data.code}. It expires in 5 minutes.`;
    return this.send(to, message);
  }

  /** Mask phone for safe logging: +97412345678 → +974***5678 */
  private maskPhone(phone: string): string {
    return `${phone.slice(0, 4)}***${phone.slice(-4)}`;
  }

  private async send(to: string, message: string): Promise<boolean> {
    const masked = this.maskPhone(to);

    if (!this.enabled || !this.snsClient) {
      this.logger.debug(`[DEV] SMS OTP sent to ${masked}`);
      return true;
    }

    try {
      const command = new PublishCommand({
        PhoneNumber: to,
        Message: message,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
        },
      });
      await this.snsClient.send(command);

      this.logger.log(`SMS sent to ${masked}`);
      return true;
    } catch (error: unknown) {
      // Log error class only. SNS error.message leaks AWS request IDs and
      // sometimes the full MessageId. For diagnostics, use CloudWatch metrics
      // or the SNS delivery-status dashboard.
      const kind = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(`SMS failed to ${masked} (${kind})`);
      return false;
    }
  }
}
