import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { bookingConfirmationTemplate } from './templates/booking-confirmation';
import { bookingCancellationTemplate } from './templates/booking-cancellation';
import { passwordResetTemplate } from './templates/password-reset';
import { passwordChangedTemplate } from './templates/password-changed';
import { emailVerificationTemplate } from './templates/email-verification';
import { vendorWelcomeTemplate } from './templates/vendor-welcome';
import {
  adminAlertTemplate,
  ADMIN_ALERT_SUBJECTS,
  type AdminAlertType,
} from './templates/admin-alert';
import { EmailSuppressionService } from './email-suppression.service';
import { EmailQuotaService } from './email-quota.service';
import { EmailUnsubscribeTokenService } from './email-unsubscribe-token.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Email Service — AWS SES v2 integration with RFC 8058 List-Unsubscribe headers.
 *
 * When EMAIL_ENABLED=false (dev): logs to console, never sends.
 * When EMAIL_ENABLED=true (production): sends via AWS SES v2 SDK using raw MIME
 * so we can attach `List-Unsubscribe` and `List-Unsubscribe-Post` headers
 * (RFC 8058 + Gmail/Yahoo Feb 2024 bulk-sender requirements).
 *
 * Migration history (2026-05-06): switched from `@aws-sdk/client-ses` (v1 API,
 * SendEmailCommand with Body.Html.Data) to `@aws-sdk/client-sesv2` (v2 API,
 * SendEmailCommand with Content.Raw.Data). v2 supports custom MIME headers
 * which v1 does not.
 *
 * All callers continue to use the same public methods — no signature changes.
 * The userId is looked up by email at send-time so the unsubscribe token can
 * bind to the user record.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly from: string;
  private readonly enabled: boolean;
  private readonly appUrl: string;
  private readonly apiUrl: string;
  private readonly sesClient: SESv2Client | null;
  // Optional — when set, every SendEmailCommand carries this configuration
  // set name. The set is wired in AWS to publish Bounce/Complaint events
  // to two SNS topics; without it, the bounce/complaint feedback loop is
  // a no-op even though SES still sends the email.
  private readonly configSetName: string | undefined;

  constructor(
    private config: ConfigService,
    private suppressions: EmailSuppressionService,
    private emailQuota: EmailQuotaService,
    private prisma: PrismaService,
    private unsubscribeTokens: EmailUnsubscribeTokenService,
  ) {
    this.from = this.config.get('EMAIL_FROM', 'noreply@jadwal.qa');
    this.enabled = this.config.get('EMAIL_ENABLED', 'false') === 'true';
    this.appUrl = this.config.getOrThrow<string>('APP_URL');
    // API_URL is where the unsubscribe endpoint lives (e.g. https://jadwal.qa/api).
    // Used to build the HTTPS variant of List-Unsubscribe.
    this.apiUrl = this.config.get('API_URL', this.appUrl + '/api');
    this.configSetName = this.config.get<string>('SES_CONFIG_SET_NAME');

    // Defence-in-depth: never let production boot with email in log-only mode
    if (!this.enabled && process.env.NODE_ENV === 'production') {
      throw new Error('[FATAL] EMAIL_ENABLED must be true in production');
    }

    // Only initialize SES client when email is enabled (avoids credential errors in dev)
    this.sesClient = this.enabled
      ? new SESv2Client({ region: this.config.get('AWS_REGION', 'eu-central-1') })
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

  /**
   * Per-key value cap. Long values get truncated with a trailing ellipsis.
   * Keeps a single misbehaving caller from blowing the alert email up to
   * megabytes (some receivers truncate or reject large mails).
   */
  private static readonly ADMIN_ALERT_VALUE_MAX = 200;
  /** Whole-note cap. Note is for a short narrative line, not log dumps. */
  private static readonly ADMIN_ALERT_NOTE_MAX = 500;
  /** Total number of detail entries kept. Anything beyond is dropped. */
  private static readonly ADMIN_ALERT_DETAILS_MAX_KEYS = 20;

  /**
   * Strip control chars and cap length on a free-form string. The HTML
   * template already escapes the value at render time; this layer exists
   * to keep the email *readable* (control bytes break clients like Outlook)
   * and to bound size before MIME encoding.
   */
  private sanitizeAlertValue(raw: unknown, maxLen: number): string {
    const s = String(raw ?? '');
    // eslint-disable-next-line no-control-regex
    const cleaned = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    if (cleaned.length <= maxLen) return cleaned;
    return cleaned.slice(0, maxLen) + '…';
  }

  /**
   * Send a typed operational alert to the admin inbox.
   *
   * The signature is intentionally narrow: callers pass an `AdminAlertType`
   * enum (subject is hardcoded server-side) plus optional sanitized context.
   * This prevents future code paths from accidentally placing user-controlled
   * strings into the *subject* of an admin email — a class of bug that
   * historically enables phishing-template spoofing or ASCII-art injection
   * into the admin's mailbox.
   *
   * @param data.type    Hardcoded event identifier (one of `AdminAlertType`)
   * @param data.details Optional structured context — keys are static
   *                     identifiers, values get HTML-escaped + truncated
   * @param data.note    Optional one-line narrative — sanitized + truncated
   */
  async sendAdminAlert(data: {
    type: AdminAlertType;
    details?: Record<string, unknown>;
    note?: string;
  }): Promise<boolean> {
    const subject = ADMIN_ALERT_SUBJECTS[data.type];
    if (!subject) {
      // Type-safe at compile time, but defend against a runtime caller that
      // bypassed types (test fixtures, JSON-deserialized config). Fail-closed:
      // log and return success-shaped so we don't propagate the error to a
      // critical path that's already trying to *report* a failure.
      this.logger.warn(`sendAdminAlert called with unknown type — dropping`);
      return true;
    }

    const sanitizedDetails: Record<string, string> = {};
    if (data.details) {
      const entries = Object.entries(data.details).slice(
        0,
        EmailService.ADMIN_ALERT_DETAILS_MAX_KEYS,
      );
      for (const [k, v] of entries) {
        // Keys must be static identifiers — cap at 60 chars defensively
        // (the type system does not enforce this; callers using dynamic
        // keys would be a misuse and we still need to behave sanely).
        const safeKey = this.sanitizeAlertValue(k, 60);
        sanitizedDetails[safeKey] = this.sanitizeAlertValue(
          v,
          EmailService.ADMIN_ALERT_VALUE_MAX,
        );
      }
    }

    const sanitizedNote = data.note
      ? this.sanitizeAlertValue(data.note, EmailService.ADMIN_ALERT_NOTE_MAX)
      : undefined;

    const adminEmail = this.config.get<string>('ADMIN_EMAIL', 'Jadwalqtr@gmail.com');
    return this.send(adminEmail, subject, 'admin-alert', {
      type: data.type,
      details: sanitizedDetails,
      note: sanitizedNote,
      generatedAt: new Date().toISOString(),
    });
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
      case 'admin-alert':
        html = adminAlertTemplate(data as any);
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

  /**
   * Encode a string as a MIME header value safe for any 7-bit transport.
   * Subjects with non-ASCII characters need `=?UTF-8?B?<base64>?=` encoding;
   * pure-ASCII subjects pass through unchanged. SES re-validates so this is
   * defence-in-depth.
   */
  private encodeHeader(value: string): string {
    // Fast path: ASCII-only, no special chars → use as-is
    // eslint-disable-next-line no-control-regex
    if (/^[\x20-\x7e]+$/.test(value) && !/[=?]/.test(value)) return value;
    return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
  }

  /**
   * Build the raw MIME message including List-Unsubscribe headers.
   * Returns a base64-encoded string ready for `Content.Raw.Data`.
   */
  private buildRawMime(params: {
    to: string;
    subject: string;
    html: string;
    unsubscribeToken: string | null;
  }): string {
    const { to, subject, html, unsubscribeToken } = params;

    // Build List-Unsubscribe header value. Always include the mailto: variant
    // (works even without token); add HTTPS variant only when we have a per-
    // user token (otherwise the URL would unsubscribe nobody — cleaner to omit).
    // Format per RFC 2369 / 8058:
    //   List-Unsubscribe: <https://example.com/unsubscribe?t=...>, <mailto:unsubscribe@example.com>
    const unsubMailto = `<mailto:unsubscribe@jadwal.qa?subject=unsubscribe>`;
    const listUnsubscribe = unsubscribeToken
      ? `<${this.apiUrl}/email/unsubscribe?t=${unsubscribeToken}>, ${unsubMailto}`
      : unsubMailto;

    // Headers section. Each header is a single line ≤1000 chars (RFC 5321).
    // The order doesn't matter to receivers but `From`, `To`, `Subject`,
    // `MIME-Version`, `Content-Type` first is conventional.
    const headers = [
      `From: ${this.from}`,
      `To: ${to}`,
      `Subject: ${this.encodeHeader(subject)}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      // base64, not 7bit: templates may carry non-ASCII (Arabic copy, smart
      // quotes, currency glyphs) which would violate the RFC 2045 7bit
      // contract. AWS SES also doesn't guarantee 8bit preservation when it
      // rewrites the message for open/click tracking — base64 is robust.
      `Content-Transfer-Encoding: base64`,
      `List-Unsubscribe: ${listUnsubscribe}`,
      // List-Unsubscribe-Post is the RFC 8058 marker that says "I support
      // one-click POST unsubscribe" — receivers (Gmail, Yahoo) only register
      // the sender as bulk-friendly when this exact header is present.
      ...(unsubscribeToken ? [`List-Unsubscribe-Post: List-Unsubscribe=One-Click`] : []),
    ];

    // RFC 2045 §6.8: base64 lines must be ≤76 chars; fold with CRLF.
    const encodedBody = Buffer.from(html, 'utf8')
      .toString('base64')
      .replace(/(.{76})/g, '$1\r\n');
    const mime = headers.join('\r\n') + '\r\n\r\n' + encodedBody;
    // SES v2 wants base64-encoded Raw.Data (decoded back to bytes by SES).
    // The SDK accepts a Buffer or string; we encode explicitly to be unambiguous.
    return Buffer.from(mime, 'utf8').toString('base64');
  }

  /**
   * Look up the userId belonging to this email so we can mint a
   * recipient-bound unsubscribe token. Returns null for emails not
   * associated with a User record (admin-alert recipient, non-customer
   * staff addresses) — those get only the mailto: variant.
   *
   * Failure cases (DB error, missing record) fall through to "no token"
   * rather than throwing — email send must continue regardless.
   */
  private async resolveUserId(email: string): Promise<string | null> {
    try {
      const u = await this.prisma.client.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        select: { id: true },
      });
      return u?.id ?? null;
    } catch (err) {
      const kind = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`resolveUserId failed (${kind}) — proceeding without HTTPS unsubscribe URL`);
      return null;
    }
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

      // Platform-wide daily circuit breaker — the absolute ceiling on
      // outbound volume per 24h regardless of who/where. Final cost
      // runaway gate: even if upstream caps fail, this caps total spend.
      // Skipped for admin-alert so operational notifications always go
      // out (same exception logic as the suppression check above).
      const platformOk = await this.emailQuota.tryConsumePlatformDaily();
      if (!platformOk) {
        // Success-shaped return preserves anti-enumeration on
        // /forgot-password etc. Caller cannot distinguish "we hit the
        // platform cap" from "the email actually sent".
        this.logger.warn(
          `Email to ${masked} dropped — platform daily cap exceeded (${template})`,
        );
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

    // Mint a per-recipient unsubscribe token if we can identify the user.
    // Resolution failures (admin-alert, non-customer recipients, DB hiccups)
    // fall through to mailto-only header — mail still goes out.
    let unsubscribeToken: string | null = null;
    if (template !== 'admin-alert') {
      const userId = await this.resolveUserId(to);
      if (userId) {
        unsubscribeToken = this.unsubscribeTokens.generate(userId, to);
      }
    }

    const rawMime = this.buildRawMime({ to, subject, html, unsubscribeToken });

    try {
      const command = new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [to] },
        Content: {
          Raw: {
            // SDK v2 accepts Uint8Array or base64 string. We send base64
            // explicitly — easier to inspect in unit tests and unambiguous
            // to anyone reading the wire format.
            Data: Buffer.from(rawMime, 'base64'),
          },
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
        EmailTags: [
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
