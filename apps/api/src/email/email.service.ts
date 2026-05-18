import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { bookingConfirmationTemplate } from './templates/booking-confirmation';
import { bookingCancellationTemplate } from './templates/booking-cancellation';
import { passwordResetTemplate } from './templates/password-reset';
import { passwordChangedTemplate } from './templates/password-changed';
import { emailVerificationTemplate } from './templates/email-verification';
import { bookingOtpTemplate } from './templates/booking-otp';
import {
  adminAlertTemplate,
  ADMIN_ALERT_SUBJECTS,
  type AdminAlertType,
} from './templates/admin-alert';
import type { RenderedEmail } from './templates/base';
import type { EmailLanguage } from '../common/utils/locale';
import { EmailSuppressionService } from './email-suppression.service';
import { EmailQuotaService } from './email-quota.service';
import { EmailUnsubscribeTokenService } from './email-unsubscribe-token.service';
import { PrismaService } from '../prisma/prisma.service';
import { CircuitBreaker, withTimeout } from '../common/utils/circuit-breaker';

/**
 * Email Service — Resend integration with RFC 8058 List-Unsubscribe headers.
 *
 * When EMAIL_ENABLED=false (dev): logs to console, never sends.
 * When EMAIL_ENABLED=true (production): sends via the Resend HTTP API.
 *
 * Bilingual (Phase 4B): every transactional email renders in the recipient's
 * language. `send()` resolves the locale — explicit per-call arg →
 * `User.preferredLanguage` (looked up by recipient email) → default `EN` — and
 * passes it to `renderTemplate`. Each template returns `{ subject, html, text }`;
 * the plain-text part rides along as the `text` field (multipart/alternative,
 * a deliverability + accessibility win). Admin alerts are always English.
 *
 * Migration history:
 *   - 2026-05-06: AWS SES v1 (`@aws-sdk/client-ses`) → SES v2
 *     (`@aws-sdk/client-sesv2`) for custom MIME headers.
 *   - 2026-05-17: SES v2 → Resend. SES production access was denied (capped at
 *     200 emails/day); Resend has no equivalent approval gate and ships from a
 *     verified domain immediately. The provider-agnostic layers (outbox queue,
 *     suppression list, 4-tier quota, unsubscribe tokens, circuit breaker) are
 *     unchanged — only the send transport swapped.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly from: string;
  private readonly enabled: boolean;
  private readonly appUrl: string;
  private readonly apiUrl: string;
  private readonly resend: Resend | null;
  // Per-call timeout for the Resend HTTP request (in ms). The AbortSignal is
  // forwarded into the SDK's underlying fetch, so a hung connection is
  // actually cancelled — not just orphaned.
  private readonly sendTimeoutMs: number;
  // Circuit breaker around the .send() call. Opens after `failureThreshold`
  // consecutive failures; when OPEN, calls fail-fast.
  private readonly breaker: CircuitBreaker;

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
    this.apiUrl = this.config.get('API_URL', this.appUrl + '/api');

    // Defence-in-depth: never let production boot with email in log-only mode
    if (!this.enabled && process.env.NODE_ENV === 'production') {
      throw new Error('[FATAL] EMAIL_ENABLED must be true in production');
    }

    // Only initialize the Resend client when email is enabled. When enabled,
    // RESEND_API_KEY is mandatory — fail loud at construction.
    if (this.enabled) {
      const apiKey = this.config.get<string>('RESEND_API_KEY', '').trim();
      if (!apiKey) {
        throw new Error('[FATAL] RESEND_API_KEY is required when EMAIL_ENABLED=true');
      }
      this.resend = new Resend(apiKey);
    } else {
      this.resend = null;
    }

    this.sendTimeoutMs = this.parsePositiveIntEnv('RESEND_SEND_TIMEOUT_MS', 10000);
    this.breaker = new CircuitBreaker({
      name: 'resend-send',
      failureThreshold: this.parsePositiveIntEnv('RESEND_BREAKER_FAILURE_THRESHOLD', 10),
      openTimeoutMs: this.parsePositiveIntEnv('RESEND_BREAKER_OPEN_MS', 30000),
      disabled: this.config.get('EXTERNAL_BREAKER_DISABLED', 'false') === 'true',
      onStateChange: (e) =>
        this.logger.warn({
          event: 'CIRCUIT_BREAKER_STATE_CHANGE',
          breaker: e.name,
          from: e.from,
          to: e.to,
          consecutiveFailures: e.consecutiveFailures,
        }),
    });
  }

  /**
   * Parse a positive-integer env knob with a safe fallback.
   *
   * `ConfigService.get` only substitutes the default when the key is
   * *undefined* — an empty-string SSM value slips through, and `Number('')`
   * is `0`. An absent / blank value falls back to the default, but a
   * *present but malformed* value (`NaN`, `0`, negative) fails loud at boot.
   */
  private parsePositiveIntEnv(key: string, fallback: number): number {
    const raw = (this.config.get<string>(key, '') ?? '').trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`[FATAL] ${key} must be a positive number, got "${raw}"`);
    }
    return Math.floor(n);
  }

  // ─── Booking Emails ──────────────────────────────────────────────────────

  async sendBookingConfirmation(
    to: string,
    data: {
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
    },
    locale?: EmailLanguage,
  ) {
    return this.send(to, 'booking-confirmation', data, locale);
  }

  async sendBookingCancellation(
    to: string,
    data: {
      customerName: string;
      activityTitle: string;
      date: string;
      bookingId: string;
      refundAmount?: string;
      currency?: string;
    },
    locale?: EmailLanguage,
  ) {
    return this.send(to, 'booking-cancellation', data, locale);
  }

  /**
   * Booking email-OTP. Sent on booking creation; customer must enter the
   * code on /bookings/[id] before /payment/initiate will issue a PAY2M
   * token. Direct send (not queued in EmailOutbox) — the code is time-
   * sensitive (10 min).
   *
   * The plaintext code is interpolated into the rendered HTML body ONLY.
   * It MUST NOT appear in any log, response, or audit trail.
   */
  async sendBookingOtp(
    to: string,
    data: {
      customerName: string;
      otpCode: string;
      bookingRef: string;
      expiresInMinutes: number;
    },
    locale?: EmailLanguage,
  ) {
    return this.send(to, 'booking-otp', data, locale);
  }

  // Payment-receipt + refund-confirmation emails are deferred to Phase 3 —
  // they will be added here together with their localized templates. They are
  // intentionally NOT stubbed: a `send*` helper with no matching template
  // would route through `renderTemplate`'s generic fallback and deliver a
  // broken email.

  // ─── Auth Emails ─────────────────────────────────────────────────────────

  async sendEmailVerification(
    to: string,
    data: { userName: string; verificationLink: string },
    locale?: EmailLanguage,
  ) {
    return this.send(to, 'email-verification', data, locale);
  }

  async sendPasswordReset(
    to: string,
    data: { userName: string; resetLink: string; expiresIn: string },
    locale?: EmailLanguage,
  ) {
    return this.send(to, 'password-reset', data, locale);
  }

  async sendPasswordChangedNotification(
    to: string,
    data: { customerName: string },
    locale?: EmailLanguage,
  ) {
    return this.send(to, 'password-changed', data, locale);
  }

  // ─── Admin Notifications ─────────────────────────────────────────────────

  /** Per-key value cap — long values get truncated with a trailing ellipsis. */
  private static readonly ADMIN_ALERT_VALUE_MAX = 200;
  /** Whole-note cap. */
  private static readonly ADMIN_ALERT_NOTE_MAX = 500;
  /** Total number of detail entries kept. */
  private static readonly ADMIN_ALERT_DETAILS_MAX_KEYS = 20;

  /**
   * Strip control chars and cap length on a free-form string. The HTML
   * template already escapes the value at render time; this layer keeps the
   * email readable (control bytes break clients) and bounds size.
   */
  private sanitizeAlertValue(raw: unknown, maxLen: number): string {
    const s = String(raw ?? '');
    const cleaned = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    if (cleaned.length <= maxLen) return cleaned;
    return cleaned.slice(0, maxLen) + '…';
  }

  /**
   * Send a typed operational alert to the admin inbox. Always English.
   *
   * The signature is intentionally narrow: callers pass an `AdminAlertType`
   * enum (subject is hardcoded server-side) plus optional sanitized context.
   */
  async sendAdminAlert(data: {
    type: AdminAlertType;
    details?: Record<string, unknown>;
    note?: string;
  }): Promise<boolean> {
    const subject = ADMIN_ALERT_SUBJECTS[data.type];
    if (!subject) {
      // Type-safe at compile time, but defend against a runtime caller that
      // bypassed types. Fail-closed: log and return success-shaped.
      this.logger.warn({ event: 'EMAIL_ADMIN_ALERT_UNKNOWN_TYPE' });
      return true;
    }

    const sanitizedDetails: Record<string, string> = {};
    if (data.details) {
      const entries = Object.entries(data.details).slice(
        0,
        EmailService.ADMIN_ALERT_DETAILS_MAX_KEYS,
      );
      for (const [k, v] of entries) {
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

    const adminEmail = this.config.get<string>('ADMIN_EMAIL', 'jadwalit@gmail.com');
    // Admin alerts are internal ops mail — forced English.
    return this.send(
      adminEmail,
      'admin-alert',
      {
        type: data.type,
        details: sanitizedDetails,
        note: sanitizedNote,
        generatedAt: new Date().toISOString(),
      },
      'EN',
    );
  }

  // ─── Template Rendering ───────────────────────────────────────────────────

  /**
   * Map a template name to its template function and render it for `locale`.
   * Returns `{ subject, html, text }`. The `{{APP_URL}}` placeholder is
   * rewritten to the configured app origin in BOTH the html and text parts.
   *
   * SECURITY: Never log the returned html/text — they embed tokens in links.
   */
  renderTemplate(
    template: string,
    data: Record<string, unknown>,
    locale: EmailLanguage = 'EN',
  ): RenderedEmail {
    let rendered: RenderedEmail;

    switch (template) {
      case 'booking-confirmation':
        rendered = bookingConfirmationTemplate(data as any, locale);
        break;
      case 'booking-cancellation':
        rendered = bookingCancellationTemplate(data as any, locale);
        break;
      case 'password-reset':
        rendered = passwordResetTemplate(data as any, locale);
        break;
      case 'password-changed':
        rendered = passwordChangedTemplate(data as any, locale);
        break;
      case 'email-verification':
        rendered = emailVerificationTemplate(data as any, locale);
        break;
      case 'booking-otp':
        rendered = bookingOtpTemplate(data as any, locale);
        break;
      case 'admin-alert':
        rendered = adminAlertTemplate(data as any);
        break;
      default:
        this.logger.warn({ event: 'EMAIL_TEMPLATE_MISSING', template });
        rendered = {
          subject: 'AL Jadwal',
          html: `<html><body><p>${template}</p></body></html>`,
          text: template,
        };
        break;
    }

    return {
      subject: rendered.subject,
      html: rendered.html.replace(/\{\{APP_URL\}\}/g, this.appUrl),
      text: rendered.text.replace(/\{\{APP_URL\}\}/g, this.appUrl),
    };
  }

  // ─── Core Send Method ────────────────────────────────────────────────────

  /** Mask email for safe logging: john@example.com → j***@example.com */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***';
    return `${local[0]}***@${domain}`;
  }

  /**
   * Build the RFC 8058 List-Unsubscribe header pair.
   *
   * Always include the mailto: variant; add the HTTPS one-click variant only
   * when we have a per-user token. `List-Unsubscribe-Post` is only meaningful
   * alongside the HTTPS URL.
   */
  private buildUnsubscribeHeaders(unsubscribeToken: string | null): Record<string, string> {
    const unsubMailto = `<mailto:unsubscribe@jadwal.qa?subject=unsubscribe>`;
    if (unsubscribeToken) {
      return {
        'List-Unsubscribe': `<${this.apiUrl}/email/unsubscribe?t=${unsubscribeToken}>, ${unsubMailto}`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };
    }
    return { 'List-Unsubscribe': unsubMailto };
  }

  /**
   * Look up the recipient's User row by email — returns the id (for the
   * unsubscribe token) and `preferredLanguage` (for locale resolution).
   * One query serves both. Returns null for non-customer recipients
   * (admin-alert addresses) or on DB error — the send still proceeds, just
   * without the HTTPS unsubscribe variant and defaulting to English.
   */
  private async resolveRecipient(
    email: string,
  ): Promise<{ id: string; preferredLanguage: EmailLanguage } | null> {
    try {
      const u = await this.prisma.client.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        select: { id: true, preferredLanguage: true },
      });
      if (!u) return null;
      return { id: u.id, preferredLanguage: u.preferredLanguage as EmailLanguage };
    } catch (err) {
      const kind = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn({ event: 'EMAIL_RESOLVE_RECIPIENT_FAILED', kind });
      return null;
    }
  }

  private async send(
    to: string,
    template: string,
    data: any,
    locale?: EmailLanguage,
  ): Promise<boolean> {
    const masked = this.maskEmail(to);
    const isAdminAlert = template === 'admin-alert';

    // Suppression + platform-cap checks short-circuit before rendering or
    // hitting Resend. Both return `true` (success-shaped) so callers can't
    // distinguish a suppressed/capped recipient from a real send
    // (anti-enumeration on /forgot-password etc.). admin-alert bypasses both —
    // operational notifications must always go out.
    if (!isAdminAlert) {
      const suppressed = await this.suppressions.isSuppressed(to);
      if (suppressed) {
        this.logger.warn({ event: 'EMAIL_SUPPRESSED', recipientMasked: masked, template });
        return true;
      }
      const platformOk = await this.emailQuota.tryConsumePlatformDaily();
      if (!platformOk) {
        this.logger.warn({ event: 'EMAIL_PLATFORM_CAP_EXCEEDED', recipientMasked: masked, template });
        return true;
      }
    }

    // Recipient lookup → unsubscribe-token userId + preferred language.
    // admin-alert skips it (internal recipient, forced English, no token).
    const recipient = isAdminAlert ? null : await this.resolveRecipient(to);
    const resolvedLocale: EmailLanguage = isAdminAlert
      ? 'EN'
      : (locale ?? recipient?.preferredLanguage ?? 'EN');

    const { subject, html, text } = this.renderTemplate(template, data, resolvedLocale);
    // SECURITY — DO NOT LOG `html` / `text`. Rendered bodies embed verification
    // links, reset links, OTP codes, and one-time tokens. Only lengths are safe.
    this.logger.debug({
      event: 'EMAIL_RENDERED',
      template,
      locale: resolvedLocale,
      htmlLength: html.length,
    });

    if (!this.enabled || !this.resend) {
      // NEVER log `data` — it carries verification tokens, reset links, OTP codes.
      this.logger.debug({ event: 'EMAIL_DEV_SKIP_SEND', recipientMasked: masked, template, subject });
      return true;
    }

    // Mint a per-recipient unsubscribe token when we identified the user.
    let unsubscribeToken: string | null = null;
    if (!isAdminAlert && recipient?.id) {
      unsubscribeToken = this.unsubscribeTokens.generate(recipient.id, to);
    }
    const headers = this.buildUnsubscribeHeaders(unsubscribeToken);

    try {
      await this.breaker.run(() =>
        withTimeout(async (signal) => {
          const { data: result, error } = await this.resend!.emails.send(
            {
              from: this.from,
              to,
              subject,
              html,
              text,
              headers,
              tags: [
                { name: 'env', value: process.env.NODE_ENV ?? 'unknown' },
                { name: 'template', value: template },
              ],
            },
            // `signal` reaches the SDK's fetch so the timeout aborts the
            // in-flight request. Cast: not in the published options type.
            { signal } as unknown as { idempotencyKey?: string },
          );
          if (error) {
            if (signal.aborted) {
              const t = new Error(`Resend send timed out after ${this.sendTimeoutMs}ms`);
              t.name = 'TimeoutError';
              throw t;
            }
            const e = new Error(error.message ?? 'Resend send failed');
            e.name = error.name ?? 'ResendError';
            throw e;
          }
          return result;
        }, this.sendTimeoutMs),
      );

      this.logger.log({
        event: 'EMAIL_SENT',
        recipientMasked: masked,
        template,
        locale: resolvedLocale,
      });
      return true;
    } catch (error: unknown) {
      // Log error class only — never the body, recipient, or message.
      const kind = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error({ event: 'EMAIL_SEND_FAILED', recipientMasked: masked, template, kind });
      return false;
    }
  }
}
