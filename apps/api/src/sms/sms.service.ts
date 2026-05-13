import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { CircuitBreaker, withTimeout } from '../common/utils/circuit-breaker';

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
  // Per-call timeout for SNS publish + circuit breaker around it. See
  // `EmailService` for the long-form rationale — same resilience layering.
  // Paranoid defaults: must sustain `failureThreshold` consecutive failures
  // before the breaker opens (so a single throttled OTP doesn't trip it).
  private readonly publishTimeoutMs: number;
  private readonly breaker: CircuitBreaker;

  constructor(private config: ConfigService) {
    this.enabled = this.config.get('SMS_ENABLED', 'false') === 'true';

    // Defence-in-depth: never let production boot with SMS in log-only mode
    if (!this.enabled && process.env.NODE_ENV === 'production') {
      throw new Error('[FATAL] SMS_ENABLED must be true in production');
    }

    // Only initialize SNS client when SMS is enabled (avoids credential errors in dev)
    // Adaptive retry (3 attempts) — SDK only retries network errors before
    // the request reaches AWS + throttle responses, never application 4xx,
    // so transient AWS edge blips don't surface as customer-facing OTP
    // delivery failures. Won't double-publish on a real error.
    this.snsClient = this.enabled
      ? new SNSClient({
          region: this.config.get('AWS_REGION', 'eu-central-1'),
          maxAttempts: 3,
          retryMode: 'adaptive',
        })
      : null;

    // Resilience knobs (env overridable). `EXTERNAL_BREAKER_DISABLED=true`
    // is the SSM kill switch — flips both SES + SNS breakers off without a
    // code change.
    this.publishTimeoutMs = Number(this.config.get('SNS_PUBLISH_TIMEOUT_MS', '10000'));
    this.breaker = new CircuitBreaker({
      name: 'sns-publish',
      failureThreshold: Number(this.config.get('SNS_BREAKER_FAILURE_THRESHOLD', '10')),
      openTimeoutMs: Number(this.config.get('SNS_BREAKER_OPEN_MS', '30000')),
      disabled: this.config.get('EXTERNAL_BREAKER_DISABLED', 'false') === 'true',
      onStateChange: (e) =>
        this.logger.warn(
          `CIRCUIT_BREAKER_STATE_CHANGE breaker=${e.name} from=${e.from} to=${e.to} consecutiveFailures=${e.consecutiveFailures}`,
        ),
    });
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
      // Resilience layering — see EmailService.send for the long-form
      // rationale. Same three layers: breaker (fail-fast on sustained
      // outage), withTimeout (abort hung connections), SDK adaptive retry.
      await this.breaker.run(() =>
        withTimeout(
          (signal) => this.snsClient!.send(command, { abortSignal: signal }),
          this.publishTimeoutMs,
        ),
      );

      this.logger.log(`SMS sent to ${masked}`);
      return true;
    } catch (error: unknown) {
      // Log error class only. SNS error.message leaks AWS request IDs and
      // sometimes the full MessageId. For diagnostics, use CloudWatch metrics
      // or the SNS delivery-status dashboard. `kind` will surface
      // 'CircuitBreakerOpenError' when the breaker is OPEN — observable in
      // CloudWatch as a distinct signal from a regular SNS failure.
      const kind = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(`SMS failed to ${masked} (${kind})`);
      return false;
    }
  }
}
