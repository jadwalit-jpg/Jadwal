import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Webhook } from 'svix';
import { RATE_LIMIT_CALLBACK } from '../common/throttle-config';
import { EmailSuppressionService } from './email-suppression.service';

/**
 * Resend bounce / complaint webhook.
 *
 * Replaces the retired SES → SNS feedback loop (`ses-events.controller.ts`)
 * after the 2026-05-17 migration to Resend. Resend signs every webhook with
 * Svix; we verify the signature, then translate bounce/complaint events into
 * `EmailSuppression` rows so future sends short-circuit before they hit
 * Resend.
 *
 * ─── Why this is ban-risk critical ──────────────────────────────────────
 *
 * A high bounce or complaint rate is what gets a Resend account throttled
 * or suspended. Fast hard-bounce + complaint suppression is the primary
 * defence: once an address shows up here it never gets mailed again, so a
 * stale / typo'd / spam-trap address can only cost us one bounce, not a
 * recurring drip that erodes domain reputation.
 *
 * ─── Auth model ─────────────────────────────────────────────────────────
 *
 *   1. **Svix signature** (enforced). Resend signs the request with the
 *      endpoint secret (`RESEND_WEBHOOK_SECRET`, `whsec_…`). `Webhook.verify`
 *      checks the `svix-id` / `svix-timestamp` / `svix-signature` headers
 *      against the raw body and a ±5-min timestamp window — replay- and
 *      tamper-proof. A failed verification 403s before any DB write.
 *      Unlike the old SNS validator (which shipped in WARN mode for a bake
 *      period), this is enforced from day one — Svix verification is a
 *      mature, well-tested primitive, not a hand-rolled canonicaliser.
 *   2. **Raw-body requirement.** The signature covers the exact request
 *      bytes, so this route is parsed by `express.raw()` (wired in main.ts)
 *      — not the global JSON parser. A request that didn't go through the
 *      raw parser arrives without a Buffer body and is rejected.
 *   3. **Cloudflare** still fronts the origin; the webhook path can carry an
 *      edge rate-limit / WAF rule as defence-in-depth.
 *
 * Worst case if the signature is somehow bypassed: an attacker injects
 * suppression rows for arbitrary addresses (a DoS that silently drops a
 * victim's mail). Recovery path: `DELETE /admin/email-suppressions/:hash`.
 *
 * Rate limit: CALLBACK bucket (20/min). Resend retries failed deliveries
 * with backoff; transactional-only volume keeps real event rate well under
 * 1/sec even during a bounce burst.
 */

/** Subset of the Resend webhook event shape we act on. */
interface ResendWebhookEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string | string[];
    subject?: string;
    bounce?: { type?: string; subType?: string; message?: string };
  };
}

@Controller('webhooks/resend-events')
export class ResendEventsController {
  private readonly logger = new Logger(ResendEventsController.name);
  /** Svix verifier — null when no secret is configured (dev / misconfig). */
  private readonly webhook: Webhook | null;

  constructor(
    config: ConfigService,
    private readonly suppressions: EmailSuppressionService,
  ) {
    const secret = config.get<string>('RESEND_WEBHOOK_SECRET', '').trim();
    // No secret → no verifier → every request is rejected (fail-closed).
    // Production cannot boot without it (main.ts REQUIRED_IN_PRODUCTION),
    // so this null path only ever applies to dev / test.
    this.webhook = secret ? new Webhook(secret) : null;
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle(RATE_LIMIT_CALLBACK)
  async handle(
    @Req() req: Request,
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
  ) {
    if (!this.webhook) {
      this.logger.error('resend-events rejected: RESEND_WEBHOOK_SECRET not configured');
      throw new ForbiddenException();
    }

    // The signature is computed over the exact request bytes. `express.raw()`
    // (main.ts) leaves `req.body` as a Buffer for this path; anything else
    // means the request bypassed the raw parser — reject rather than risk a
    // re-serialised mismatch.
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      this.logger.warn('resend-events rejected: body is not a raw Buffer');
      throw new ForbiddenException();
    }

    let event: ResendWebhookEvent;
    try {
      event = this.webhook.verify(rawBody, {
        'svix-id': svixId ?? '',
        'svix-timestamp': svixTimestamp ?? '',
        'svix-signature': svixSignature ?? '',
      }) as ResendWebhookEvent;
    } catch (err) {
      // WebhookVerificationError (bad signature, stale timestamp, missing
      // headers). Log the class only — never the body or headers.
      const kind = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn({ event: 'RESEND_WEBHOOK_SIGNATURE_INVALID', kind });
      throw new ForbiddenException();
    }

    const recipients = this.extractRecipients(event.data?.to);

    switch (event.type) {
      case 'email.bounced': {
        const bounce = event.data?.bounce;
        // Transient bounces (mailbox full, greylisting) often clear on
        // retry — auto-suppressing would block legit users over an
        // intermittent receiver-side issue. Suppress everything else
        // (Permanent / Undetermined / type absent) — a hard bounce must
        // never get a second send.
        if (bounce?.type === 'Transient') {
          this.logger.log({ event: 'RESEND_WEBHOOK_BOUNCE_IGNORED', bounceType: 'Transient' });
          break;
        }
        const bounceType = `${bounce?.type ?? 'Unknown'}/${bounce?.subType ?? ''}`;
        for (const email of recipients) {
          await this.suppressions.suppress(
            email,
            'bounce',
            bounceType,
            bounce?.message?.slice(0, 200),
          );
        }
        break;
      }
      case 'email.complained': {
        // Always suppress — the recipient explicitly marked us as spam.
        // Sending again is the single fastest way to wreck sender reputation.
        for (const email of recipients) {
          await this.suppressions.suppress(email, 'complaint');
        }
        break;
      }
      case 'email.delivery_delayed':
        // Informational — Resend is still retrying. No suppression.
        this.logger.log({ event: 'RESEND_WEBHOOK_DELIVERY_DELAYED' });
        break;
      default:
        // email.sent / email.delivered / email.opened / etc. — ack only.
        this.logger.debug({ event: 'RESEND_WEBHOOK_UNHANDLED', type: event.type });
        break;
    }

    return { ok: true };
  }

  /**
   * Normalise the Resend `data.to` field — it may be a single address or an
   * array — into a clean list of non-empty strings.
   */
  private extractRecipients(to: string | string[] | undefined): string[] {
    if (!to) return [];
    const list = Array.isArray(to) ? to : [to];
    return list.filter((e): e is string => typeof e === 'string' && e.trim().length > 0);
  }
}
