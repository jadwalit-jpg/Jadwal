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
import { EmailSuppressionService } from './email-suppression.service';
import { EmailQuotaService } from './email-quota.service';
import { EmailUnsubscribeTokenService } from './email-unsubscribe-token.service';
import { PrismaService } from '../prisma/prisma.service';
import { CircuitBreaker, withTimeout } from '../common/utils/circuit-breaker';

/**
 * Email Service — Resend integration with RFC 8058 List-Unsubscribe headers.
 *
 * When EMAIL_ENABLED=false (dev): logs to console, never sends.
 * When EMAIL_ENABLED=true (production): sends via the Resend HTTP API. The
 * `List-Unsubscribe` + `List-Unsubscribe-Post` headers (RFC 8058 + Gmail/Yahoo
 * Feb 2024 bulk-sender requirements) ride on the `headers` field — Resend
 * builds the MIME message, so no hand-rolled raw-MIME builder is needed.
 *
 * Migration history:
 *   - 2026-05-06: AWS SES v1 (`@aws-sdk/client-ses`) → SES v2
 *     (`@aws-sdk/client-sesv2`) for custom MIME headers.
 *   - 2026-05-17: SES v2 → Resend. SES production access was denied (capped at
 *     200/day in sandbox); Resend has no sandbox-approval gate and ships from a
 *     verified domain immediately. The provider-agnostic layers (outbox queue,
 *     suppression list, 4-tier quota, unsubscribe tokens, circuit breaker) are
 *     unchanged — only the send transport swapped.
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
  private readonly resend: Resend | null;
  // Per-call timeout for the Resend HTTP request (in ms). The AbortSignal is
  // forwarded into the SDK's underlying fetch, so a hung connection is
  // actually cancelled — not just orphaned. Defaults are generous (10s);
  // Resend is normally <500ms.
  private readonly sendTimeoutMs: number;
  // Circuit breaker around the .send() call. Opens after `failureThreshold`
  // consecutive failures (each "failure" = post-retry outcome, so it takes a
  // sustained Resend outage to trip — not one bad request). When OPEN, calls
  // fail-fast with `CircuitBreakerOpenError` → caller's catch logs
  // `kind: 'CircuitBreakerOpenError'` and returns false. Default is paranoid
  // (10 failures, 30s open) so it doesn't trip on traffic spikes.
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
    // Used to build the HTTPS variant of List-Unsubscribe.
    this.apiUrl = this.config.get('API_URL', this.appUrl + '/api');

    // Defence-in-depth: never let production boot with email in log-only mode
    if (!this.enabled && process.env.NODE_ENV === 'production') {
      throw new Error('[FATAL] EMAIL_ENABLED must be true in production');
    }

    // Only initialize the Resend client when email is enabled (avoids a
    // missing-key throw in dev / test where EMAIL_ENABLED=false). When
    // enabled, RESEND_API_KEY is mandatory — fail loud at construction
    // rather than on the first send attempt.
    if (this.enabled) {
      const apiKey = this.config.get<string>('RESEND_API_KEY', '').trim();
      if (!apiKey) {
        throw new Error('[FATAL] RESEND_API_KEY is required when EMAIL_ENABLED=true');
      }
      this.resend = new Resend(apiKey);
    } else {
      this.resend = null;
    }

    // Resilience config: explicit per-call timeout + circuit breaker. Defaults
    // are paranoid (don't open on a single slow request). All knobs are env
    // overridable; `EXTERNAL_BREAKER_DISABLED=true` is the SSM kill switch.
    this.sendTimeoutMs = Number(this.config.get('RESEND_SEND_TIMEOUT_MS', '10000'));
    this.breaker = new CircuitBreaker({
      name: 'resend-send',
      failureThreshold: Number(this.config.get('RESEND_BREAKER_FAILURE_THRESHOLD', '10')),
      openTimeoutMs: Number(this.config.get('RESEND_BREAKER_OPEN_MS', '30000')),
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

  /**
   * Booking email-OTP. Sent on booking creation; customer must enter the
   * code on /bookings/[id] before /payment/initiate will issue a PAY2M
   * token. Direct send (not queued in EmailOutbox) — the code is time-
   * sensitive (10 min). If Resend is down the resend endpoint covers retries.
   *
   * The plaintext code is interpolated into the rendered HTML body ONLY.
   * It MUST NOT appear in any log, response, or audit trail.
   */
  async sendBookingOtp(to: string, data: {
    customerName: string;
    otpCode: string;
    bookingRef: string;
    expiresInMinutes: number;
  }) {
    return this.send(to, 'Your Jadwal booking verification code', 'booking-otp', data);
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
   * and to bound size before transport.
   */
  private sanitizeAlertValue(raw: unknown, maxLen: number): string {
    const s = String(raw ?? '');
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

    const adminEmail = this.config.get<string>('ADMIN_EMAIL', 'jadwalit@gmail.com');
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
      case 'booking-otp':
        html = bookingOtpTemplate(data as any);
        break;
      case 'admin-alert':
        html = adminAlertTemplate(data as any);
        break;
      default:
        this.logger.warn({ event: 'EMAIL_TEMPLATE_MISSING', template });
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
   * Build the RFC 8058 List-Unsubscribe header pair.
   *
   * Always include the mailto: variant (works even without a token); add the
   * HTTPS one-click variant only when we have a per-user token (otherwise the
   * URL would unsubscribe nobody — cleaner to omit). The `List-Unsubscribe-Post`
   * marker is what makes Gmail/Yahoo register the sender as bulk-friendly, and
   * it is only meaningful alongside the HTTPS URL.
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
      this.logger.warn({ event: 'EMAIL_RESOLVE_USER_FAILED', kind });
      return null;
    }
  }

  private async send(to: string, subject: string, template: string, _data: any): Promise<boolean> {
    const masked = this.maskEmail(to);

    // Suppression check — short-circuit before rendering or hitting Resend.
    // Bounce/complaint events populate this list via the provider webhook.
    // Returns `true` (success-shaped) so callers can't distinguish a
    // suppressed recipient from a real send — preserves anti-enumeration on
    // /forgot-password and friends. Fail-open inside the service if Prisma errors.
    //
    // Exception: admin-alert bypasses the suppression check. Operational
    // notifications must always go out — if ADMIN_EMAIL ever lands on
    // the suppression list (mailbox full → bounce; admin marks routine
    // alert as spam by mistake), silently swallowing the alert hides
    // production incidents from on-call. Worth the bounce-rate cost.
    if (template !== 'admin-alert') {
      const suppressed = await this.suppressions.isSuppressed(to);
      if (suppressed) {
        this.logger.warn({ event: 'EMAIL_SUPPRESSED', recipientMasked: masked, template });
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
        this.logger.warn({ event: 'EMAIL_PLATFORM_CAP_EXCEEDED', recipientMasked: masked, template });
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
    this.logger.debug({ event: 'EMAIL_RENDERED', template, htmlLength: html.length });

    if (!this.enabled || !this.resend) {
      // NEVER log `_data` — it carries verification tokens, reset links, OTP codes.
      this.logger.debug({ event: 'EMAIL_DEV_SKIP_SEND', recipientMasked: masked, template, subject });
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

    const headers = this.buildUnsubscribeHeaders(unsubscribeToken);

    try {
      // Resilience layering:
      //   1) `breaker.run()` short-circuits if Resend has been failing for
      //      `failureThreshold` consecutive calls — throws
      //      `CircuitBreakerOpenError` immediately (caught below, returns
      //      false; outbox/quota callers retry next drain cycle).
      //   2) `withTimeout()` creates an AbortController and aborts the SDK's
      //      underlying fetch after `sendTimeoutMs` — the request is
      //      cancelled, not orphaned.
      //   3) The Resend SDK surfaces transport/API failures as a resolved
      //      `{ error }` rather than throwing, so we re-throw on `error` to
      //      feed the breaker a real failure signal.
      await this.breaker.run(() =>
        withTimeout(async (signal) => {
          const { data, error } = await this.resend!.emails.send(
            {
              from: this.from,
              to,
              subject,
              html,
              headers,
              // Tags surface in the Resend dashboard so we can break sends
              // down by environment + template (e.g. a spike on
              // `password-reset` in prod = telltale of a forgot-password
              // attack). Resend tag names/values allow only ASCII letters,
              // digits, underscores and dashes — env + template names qualify.
              tags: [
                { name: 'env', value: process.env.NODE_ENV ?? 'unknown' },
                { name: 'template', value: template },
              ],
            },
            // The 2nd arg is spread into the underlying fetch options by the
            // SDK, so `signal` reaches fetch and the timeout actually aborts
            // the in-flight request. Cast: `signal` is not in the SDK's
            // published options type but is honoured at runtime.
            { signal } as unknown as { idempotencyKey?: string },
          );
          if (error) {
            // A timed-out request comes back here as a resolved `{ error }`
            // (the SDK swallows the AbortError). Distinguish it for clearer
            // logs; the breaker counts both the same way.
            if (signal.aborted) {
              const t = new Error(`Resend send timed out after ${this.sendTimeoutMs}ms`);
              t.name = 'TimeoutError';
              throw t;
            }
            const e = new Error(error.message ?? 'Resend send failed');
            // Resend error names are coarse identifiers (`rate_limit_exceeded`,
            // `validation_error`, `application_error`) — safe to log; they
            // carry no request IDs or recipient data.
            e.name = error.name ?? 'ResendError';
            throw e;
          }
          return data;
        }, this.sendTimeoutMs),
      );

      this.logger.log({ event: 'EMAIL_SENT', recipientMasked: masked, template });
      return true;
    } catch (error: unknown) {
      // Log error class only. `kind` will be one of:
      //   - 'CircuitBreakerOpenError' (breaker open — sustained Resend failure)
      //   - 'TimeoutError' (per-call timeout)
      //   - Resend error names (`rate_limit_exceeded`, `validation_error`, …)
      const kind = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error({ event: 'EMAIL_SEND_FAILED', recipientMasked: masked, template, kind });
      return false;
    }
  }
}
