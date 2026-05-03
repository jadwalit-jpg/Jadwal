import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { bookingConfirmationTemplate } from './templates/booking-confirmation';
import { bookingCancellationTemplate } from './templates/booking-cancellation';
import { passwordResetTemplate } from './templates/password-reset';
import { passwordChangedTemplate } from './templates/password-changed';
import { emailVerificationTemplate } from './templates/email-verification';
import { vendorWelcomeTemplate } from './templates/vendor-welcome';
import { EmailSuppressionService } from './email-suppression.service';

/**
 * Email Service — AWS SES integration.
 *
 * When EMAIL_ENABLED=false (dev): logs to console, never sends.
 * When EMAIL_ENABLED=true (production): sends via AWS SES.
 *
 * All callers already use this service — no refactoring needed.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly from: string;
  private readonly enabled: boolean;
  private readonly appUrl: string;
  private readonly sesClient: SESClient | null;
  // Optional — when set, every SendEmailCommand carries this configuration
  // set name. The set is wired in AWS to publish Bounce/Complaint events
  // to two SNS topics; without it, the bounce/complaint feedback loop is
  // a no-op even though SES still sends the email.
  private readonly configSetName: string | undefined;

  constructor(
    private config: ConfigService,
    private suppressions: EmailSuppressionService,
  ) {
    this.from = this.config.get('EMAIL_FROM', 'noreply@jadwal.qa');
    this.enabled = this.config.get('EMAIL_ENABLED', 'false') === 'true';
    this.appUrl = this.config.getOrThrow<string>('APP_URL');
    this.configSetName = this.config.get<string>('SES_CONFIG_SET_NAME');

    // Defence-in-depth: never let production boot with email in log-only mode
    if (!this.enabled && process.env.NODE_ENV === 'production') {
      throw new Error('[FATAL] EMAIL_ENABLED must be true in production');
    }

    // Only initialize SES client when email is enabled (avoids credential errors in dev)
    this.sesClient = this.enabled
      ? new SESClient({ region: this.config.get('AWS_REGION', 'eu-central-1') })
      : null;
  }

  // ─── Booking Emails ──────────────────────────────────────────────────────

  async sendBookingConfirmation(to: string, data: {
    customerName: string;
    activityTitle: string;
    date: string;
    time?: string;
    guests: number;
    totalAmount: string;
    currency: string;
    bookingId: string;
    locationAddress?: string;
    mapsLink?: string;
  }) {
    return this.send(to, 'Booking Confirmed — Jadwal', 'booking-confirmation', data);
  }

  async sendBookingCancellation(to: string, data: {
    customerName: string;
    activityTitle: string;
    date: string;
    bookingId: string;
    refundAmount?: string;
    currency?: string;
  }) {
    return this.send(to, 'Booking Cancelled — Jadwal', 'booking-cancellation', data);
  }

  // ─── Payment Emails ──────────────────────────────────────────────────────

  async sendPaymentReceipt(to: string, data: {
    customerName: string;
    amount: string;
    currency: string;
    paymentId: string;
    method: string;
  }) {
    return this.send(to, 'Payment Receipt — Jadwal', 'payment-receipt', data);
  }

  async sendRefundConfirmation(to: string, data: {
    customerName: string;
    amount: string;
    currency: string;
    bookingId: string;
  }) {
    return this.send(to, 'Refund Processed — Jadwal', 'refund-confirmation', data);
  }

  // ─── Vendor Emails ───────────────────────────────────────────────────────

  async sendVendorApproval(to: string, data: {
    vendorName: string;
    businessName: string;
  }) {
    return this.send(to, 'Your Vendor Account is Approved — Jadwal', 'vendor-approved', data);
  }

  async sendVendorRejection(to: string, data: {
    vendorName: string;
    reason?: string;
  }) {
    return this.send(to, 'Vendor Application Update — Jadwal', 'vendor-rejected', data);
  }

  async sendNewBookingNotification(to: string, data: {
    vendorName: string;
    activityTitle: string;
    customerName: string;
    date: string;
    guests: number;
    bookingId: string;
  }) {
    return this.send(to, 'New Booking Received — Jadwal', 'vendor-new-booking', data);
  }

  // ─── Auth Emails ─────────────────────────────────────────────────────────

  async sendEmailVerification(to: string, data: {
    userName: string;
    verificationLink: string;
  }) {
    return this.send(to, 'Verify your email — Jadwal', 'email-verification', data);
  }

  async sendPasswordReset(to: string, data: {
    userName: string;
    resetLink: string;
    expiresIn: string;
  }) {
    return this.send(to, 'Reset Your Password — Jadwal', 'password-reset', data);
  }

  async sendPasswordChangedNotification(to: string, data: {
    customerName: string;
  }) {
    return this.send(to, 'Your password was changed — Jadwal', 'password-changed', data);
  }

  async sendWelcome(to: string, data: {
    userName: string;
  }) {
    return this.send(to, 'Welcome to Jadwal!', 'welcome', data);
  }

  // ─── Admin Notifications ─────────────────────────────────────────────────

  async sendAdminAlert(data: {
    subject: string;
    message: string;
  }) {
    const adminEmail = this.config.get('ADMIN_EMAIL', 'Jadwalqtr@gmail.com');
    return this.send(adminEmail, data.subject, 'admin-alert', data);
  }

  // ─── Template Rendering ───────────────────────────────────────────────────

  /**
   * Maps a template name to the correct template function and renders HTML.
   * The {{APP_URL}} placeholder in templates is replaced with the configured app URL.
   *
   * SECURITY: Never log the returned HTML — it may contain tokens embedded in links.
   */
  renderTemplate(template: string, data: Record<string, unknown>): string {
    let html: string;

    switch (template) {
      case 'booking-confirmation':
        html = bookingConfirmationTemplate(data as any);
        break;
      case 'booking-cancellation':
        html = bookingCancellationTemplate(data as any);
        break;
      case 'password-reset':
        html = passwordResetTemplate(data as any);
        break;
      case 'password-changed':
        html = passwordChangedTemplate(data as any);
        break;
      case 'email-verification':
        html = emailVerificationTemplate(data as any);
        break;
      case 'vendor-approved':
        html = vendorWelcomeTemplate(data as any);
        break;
      default:
        this.logger.warn(`No HTML template found for "${template}", using plain text fallback`);
        html = `<html><body><p>${template}</p></body></html>`;
        break;
    }

    // Replace {{APP_URL}} placeholder with the configured app URL
    html = html.replace(/\{\{APP_URL\}\}/g, this.appUrl);

    return html;
  }

  // ─── Core Send Method ────────────────────────────────────────────────────

  /** Mask email for safe logging: john@example.com → j***@example.com */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***';
    return `${local[0]}***@${domain}`;
  }

  private async send(to: string, subject: string, template: string, _data: any): Promise<boolean> {
    const masked = this.maskEmail(to);

    // Suppression check — short-circuit before rendering or hitting SES.
    // SES bounce/complaint events populate this list via the SNS webhook
    // at /api/webhooks/ses-events. Returns `true` (success-shaped) so
    // callers can't distinguish a suppressed recipient from a real send
    // — preserves anti-enumeration on /forgot-password and friends.
    // Fail-open inside the service if Prisma errors.
    //
    // Exception: admin-alert bypasses the suppression check. Operational
    // notifications must always go out — if ADMIN_EMAIL ever lands on
    // the suppression list (mailbox full → bounce; admin marks routine
    // alert as spam by mistake), silently swallowing the alert hides
    // production incidents from on-call. Worth the SES bounce-rate cost.
    if (template !== 'admin-alert') {
      const suppressed = await this.suppressions.isSuppressed(to);
      if (suppressed) {
        this.logger.warn(`Email to ${masked} dropped — recipient suppressed (${template})`);
        return true;
      }
    }

    // Render the HTML template (always, even in dev — ensures templates compile correctly)
    const html = this.renderTemplate(template, _data);
    // SECURITY — DO NOT LOG `html` UNDER ANY CIRCUMSTANCES.
    // Rendered HTML embeds verification links, password-reset links, OTP
    // codes, and one-time tokens directly in <a href="…?token=…"> tags.
    // Logging it pushes those tokens into CloudWatch / Sentry / stdout
    // pipelines, where they survive past their single-use window if any
    // sink retains data. Only `html.length` is safe to emit. If you need
    // to debug template output locally, use `EMAIL_ENABLED=false` + a
    // local file dump GUARDED by `process.env.NODE_ENV !== 'production'`.
    this.logger.debug(`Rendered template="${template}" | html_length=${html.length}`);

    if (!this.enabled || !this.sesClient) {
      // NEVER log `_data` — it carries verification tokens, reset links, OTP codes.
      this.logger.debug(`[DEV] Email to ${masked} | template=${template} | subject=${subject}`);
      return true;
    }

    try {
      const command = new SendEmailCommand({
        Source: this.from,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject },
          Body: { Html: { Data: html } },
        },
        // ConfigurationSetName is what causes SES to publish bounce /
        // complaint / reject events to the SNS topics that feed the
        // suppression list. Without this attribute, SES sends the email
        // but emits no feedback events — the loop is a no-op. Optional
        // (undefined) so dev / test environments without the set still
        // work.
        ...(this.configSetName ? { ConfigurationSetName: this.configSetName } : {}),
        // Tags surface in CloudWatch metrics so we can break down sends
        // by environment + template (e.g. spike on `password-reset` in
        // prod = telltale of a forgot-password attack).
        Tags: [
          { Name: 'env', Value: process.env.NODE_ENV ?? 'unknown' },
          { Name: 'template', Value: template },
        ],
      });
      await this.sesClient.send(command);

      this.logger.log(`Email sent to ${masked} (${template})`);
      return true;
    } catch (error: unknown) {
      // Log error class only. SES error.message can carry request IDs and
      // account fingerprints; nothing the receiver can act on. For
      // operational debug, inspect CloudTrail / SES bounce dashboard.
      const kind = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(`Email failed to ${masked} (${template}, ${kind})`);
      return false;
    }
  }
}
