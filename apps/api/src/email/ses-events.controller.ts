import {
  Controller,
  Post,
  Headers,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_AUTH } from '../common/throttle-config';
import { EmailSuppressionService } from './email-suppression.service';
import { SnsSignatureValidator } from './sns-signature-validator.service';

interface SnsMessage {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  UnsubscribeURL?: string;
  SubscribeURL?: string;
  Subject?: string;
  Token?: string;
}

interface SesBounceMessage {
  notificationType?: 'Bounce';
  eventType?: 'Bounce';
  bounce: {
    bounceType: 'Permanent' | 'Transient' | 'Undetermined';
    bounceSubType?: string;
    bouncedRecipients: Array<{ emailAddress: string; status?: string; diagnosticCode?: string }>;
    timestamp: string;
  };
  mail?: { messageId?: string };
}

interface SesComplaintMessage {
  notificationType?: 'Complaint';
  eventType?: 'Complaint';
  complaint: {
    complainedRecipients: Array<{ emailAddress: string }>;
    complaintFeedbackType?: string;
    timestamp: string;
  };
  mail?: { messageId?: string };
}

type SesNotification = SesBounceMessage | SesComplaintMessage;

/**
 * SES → SNS → this endpoint feedback loop.
 *
 * Flow:
 *
 *   1. SES configuration set publishes Bounce/Complaint events to two
 *      SNS topics (jadwal-ses-bounces, jadwal-ses-complaints).
 *   2. Each SNS topic has an HTTPS subscription pointing at this route.
 *   3. AWS POSTs SubscriptionConfirmation once → we hit the SubscribeURL
 *      to confirm; from then on AWS POSTs Notification messages here.
 *   4. We parse the inner SES JSON, hash the recipient address, and
 *      upsert into EmailSuppression so future sends are short-circuited.
 *
 * ─── Auth model: 4 layers (3 enforced + 1 in WARN-mode rollout) ─────
 *
 * We layer 4 independent checks. Three are enforcing today; the 4th
 * (SNS signature validation) runs in WARN mode pending a bake-in
 * period. Once SNS_SIGNATURE_ENFORCE=true is set in env, layer 4 hard-
 * rejects mismatches.
 *
 * History on layer 4: a previous attempt at SNS signature validation
 * (`sns-payload-validator` npm + a hand-rolled variant) silently
 * rejected every legit SES configuration-set event in production. The
 * team rolled back and added the 3 substitute layers below. This
 * iteration ships the validator in WARN mode so we can SEE whether
 * our implementation handles real production messages without
 * regressing the suppression loop. After ~7 days of clean
 * `valid=true` log lines, an operator flips SNS_SIGNATURE_ENFORCE
 * via SSM + force-new-deployment to make signature mismatches
 * actually reject.
 *
 * Auth layers — all 3 enforcing layers must pass; layer 4 logs only:
 *
 *   1. **Cloudflare WAF allowlist of AWS SNS publish IP ranges**
 *      configured on `/api/webhooks/ses-events` outside this codebase.
 *      AWS publishes the exact source IPs at
 *      https://ip-ranges.amazonaws.com/ip-ranges.json (service=SNS,
 *      region=eu-central-1). Anything not from those ranges is 403'd
 *      at the edge. This is the primary network-level auth.
 *
 *   2. **TopicArn pinning** (this file, line ~95). The body's TopicArn
 *      must match one of two values from env: `SNS_TOPIC_ARN_BOUNCES`
 *      or `SNS_TOPIC_ARN_COMPLAINTS`. An attacker who somehow lands a
 *      request from an AWS IP would still need to know our exact topic
 *      ARNs to be accepted.
 *
 *   3. **Content-shape validation** (parse + dispatch on Type and inner
 *      notificationType / eventType). Malformed messages are 200-acked
 *      to stop SNS retries but produce no DB writes.
 *
 *   4. **SNS RSA signature** (WARN mode initially). The validator
 *      service (sns-signature-validator.service.ts) builds the AWS
 *      canonical from the parsed message values, fetches the cert at
 *      SigningCertURL (URL-validated against the AWS SNS host pattern
 *      first, with cert PEM parsing as a second gate), and verifies
 *      the RSA signature. Result is logged structured on every call.
 *      Only enforced when `SNS_SIGNATURE_ENFORCE=true` in env — until
 *      then a `signature_mismatch` log is emitted but the request
 *      continues through layers 1–3. This avoids regressing on the
 *      historical issue where signature verification rejected legit
 *      production events.
 *
 * Worst case if all four are bypassed: an attacker can inject
 * suppression rows for arbitrary email addresses (DoS the suppression
 * list to silently drop legit emails). Mitigated by the planned
 * `DELETE /admin/email-suppressions/:hash` admin endpoint for recovery.
 *
 * SubscribeURL handling: even though we trust the body for routing
 * decisions, we DON'T trust it for outbound-fetch URLs. The
 * SubscriptionConfirmation handshake reconstructs the confirm URL from
 * validated atoms (regex-bounded Token, hardcoded scheme/host derived
 * from the already-pinned TopicArn region) — see `buildConfirmationUrl`.
 *
 * Rate limit:
 *
 *   AUTH bucket (5/min). AWS retries failed deliveries with exponential
 *   backoff so we have generous slack; legitimate volume is well under
 *   1/sec even during a real bounce storm.
 */
@Controller('webhooks/ses-events')
export class SesEventsController {
  private readonly logger = new Logger(SesEventsController.name);
  private readonly bouncesTopicArn: string | undefined;
  private readonly complaintsTopicArn: string | undefined;
  private readonly enforceSignature: boolean;

  constructor(
    private config: ConfigService,
    private suppressions: EmailSuppressionService,
    private snsSignature: SnsSignatureValidator,
  ) {
    this.bouncesTopicArn = this.config.get<string>('SNS_TOPIC_ARN_BOUNCES');
    this.complaintsTopicArn = this.config.get<string>('SNS_TOPIC_ARN_COMPLAINTS');
    // Off by default — runs validator in WARN mode. Flip to "true" via
    // SSM after ~7 days of clean WARN logs to enforce mismatches.
    this.enforceSignature = this.config.get<string>('SNS_SIGNATURE_ENFORCE') === 'true';
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle(RATE_LIMIT_AUTH)
  async handle(
    @Headers('x-amz-sns-message-type') messageType: string | undefined,
    @Body() body: SnsMessage,
  ) {
    if (!messageType) throw new ForbiddenException();
    if (!body || typeof body !== 'object') throw new ForbiddenException();

    // Pin the topic — drop anything from an unexpected topic. Combined
    // with the Cloudflare AWS-IP allowlist on this path, this is the
    // primary auth gate (see class-level Auth model comment).
    if (
      body.TopicArn !== this.bouncesTopicArn &&
      body.TopicArn !== this.complaintsTopicArn
    ) {
      this.logger.warn(`ses-events rejected: unknown TopicArn`);
      throw new ForbiddenException();
    }

    // Layer 4 — SNS RSA signature check (WARN/ENFORCE per env flag).
    // Run on every accepted message so we get a population sample of
    // valid=true vs reasons-for-mismatch in CloudWatch. Until we flip
    // SNS_SIGNATURE_ENFORCE, a mismatch logs but doesn't reject — that
    // way an implementation bug here can't take the suppression loop
    // dark like the previous attempt did.
    const sigResult = await this.snsSignature.validate(body).catch((err) => {
      // The validator itself is supposed to swallow errors and return
      // a structured result. If it throws anyway (programmer error,
      // unexpected runtime), treat it like a mismatch in WARN — never
      // crash the webhook over a defence-in-depth check.
      this.logger.error(
        `ses-events sig-validator threw: ${err instanceof Error ? err.name : 'UnknownError'}`,
      );
      return { valid: false as const, reason: 'signature_mismatch' as const };
    });
    if (!sigResult.valid) {
      this.logger.warn(
        `ses-events signature ${this.enforceSignature ? 'REJECTED' : 'WARN'}: ` +
          `reason=${sigResult.reason} type=${body.Type} ` +
          `topicArn=${body.TopicArn} messageId=${body.MessageId} ` +
          `sigVersion=${body.SignatureVersion}`,
      );
      if (this.enforceSignature) {
        throw new ForbiddenException();
      }
    } else {
      this.logger.log(
        `ses-events signature valid type=${body.Type} messageId=${body.MessageId}`,
      );
    }

    if (body.Type === 'SubscriptionConfirmation') {
      // AWS sends this once per subscription. To complete the handshake
      // we GET an HTTPS endpoint at `sns.<region>.amazonaws.com[.cn]`
      // with `Action=ConfirmSubscription` + the TopicArn + a Token.
      //
      // SSRF defence: do NOT call fetch(body.SubscribeURL) — that field
      // is part of the SNS message body and a CodeQL taint analysis
      // (rightly) flags it as user-controlled even after a hostname
      // regex check. Instead we reconstruct the URL from validated
      // atoms (regex-bounded Token, hardcoded scheme/host derived from
      // the already-pinned TopicArn region).
      const safeUrl = this.buildConfirmationUrl(body);
      if (!safeUrl) {
        this.logger.warn('ses-events SubscribeURL rejected: malformed Token / TopicArn');
        throw new ForbiddenException();
      }
      // codeql[js/server-side-request-forgery]: URL is reconstructed from
      // hardcoded scheme/path + region derived from already-validated
      // TopicArn + regex-validated Token. fetch never sees user-input
      // characters in the host or scheme. `redirect: 'manual'` is the
      // last belt-and-braces — even if AWS SNS unexpectedly issued a
      // 30x to a different host, fetch returns the redirect response
      // without following it (no second outbound request).
      await fetch(safeUrl, { redirect: 'manual' }).catch(() => undefined);
      this.logger.log(`SNS subscription confirmed for topic ${body.TopicArn}`);
      return { ok: true };
    }

    if (body.Type === 'UnsubscribeConfirmation') {
      // Operator manually unsubscribed via console. Acknowledge only —
      // not an event we act on.
      this.logger.warn(`SNS unsubscribed from ${body.TopicArn}`);
      return { ok: true };
    }

    if (body.Type !== 'Notification') {
      // Unexpected SNS message type. Acknowledge to stop retries but
      // don't process.
      this.logger.warn(`unexpected SNS message Type=${body.Type}`);
      return { ok: true };
    }

    let inner: SesNotification;
    try {
      inner = JSON.parse(body.Message) as SesNotification;
    } catch {
      this.logger.warn('ses-events Message JSON parse failed');
      // Return 200 — we don't want SNS to retry malformed messages.
      return { ok: true };
    }

    // SES has two notification field-name conventions:
    //   - `notificationType` — older SES feedback notifications
    //   - `eventType` — newer SES configuration-set events
    // We accept both since the configuration-set is the modern path
    // but legacy notifications may still arrive.
    const kind =
      ('notificationType' in inner && inner.notificationType) ||
      ('eventType' in inner && inner.eventType) ||
      undefined;

    if (kind === 'Bounce') {
      const bounceMsg = inner as SesBounceMessage;
      const subType = bounceMsg.bounce.bounceSubType ?? '';
      // Only suppress on Permanent bounces. Transient bounces (mailbox
      // full, greylisting) often clear by retry — auto-suppressing
      // would block legit users on intermittent infrastructure issues.
      if (bounceMsg.bounce.bounceType !== 'Permanent') {
        this.logger.log(`ses-events bounce ignored type=${bounceMsg.bounce.bounceType}`);
        return { ok: true };
      }
      for (const recip of bounceMsg.bounce.bouncedRecipients) {
        if (recip.emailAddress) {
          await this.suppressions.suppress(
            recip.emailAddress,
            'bounce',
            `Permanent/${subType}`,
            recip.diagnosticCode?.slice(0, 200),
          );
        }
      }
    } else if (kind === 'Complaint') {
      const complaintMsg = inner as SesComplaintMessage;
      // Always suppress complaints — recipient explicitly marked as
      // spam, sending again hurts SES reputation badly.
      for (const recip of complaintMsg.complaint.complainedRecipients) {
        if (recip.emailAddress) {
          await this.suppressions.suppress(
            recip.emailAddress,
            'complaint',
            complaintMsg.complaint.complaintFeedbackType?.slice(0, 50),
          );
        }
      }
    } else {
      this.logger.warn(`ses-events unhandled notificationType/eventType=${kind}`);
    }

    return { ok: true };
  }

  /**
   * Reconstruct the SNS confirmation URL from validated parts. Returns
   * null if the input doesn't look like a real AWS SNS confirmation
   * request, in which case the caller MUST NOT call fetch.
   *
   * Why reconstruction instead of trusting body.SubscribeURL:
   *   - Even after a hostname regex check, taint analysis treats the
   *     full URL as user-controlled because the path/query bits could
   *     still steer the request semantically.
   *   - Reconstructing from validated atoms (validated TopicArn region +
   *     regex-bounded Token) keeps the host, scheme, path, and action
   *     parameter completely outside the user-input dataflow.
   */
  private buildConfirmationUrl(body: SnsMessage): string | null {
    if (!body.SubscribeURL) return null;

    let parsed: URL;
    try {
      parsed = new URL(body.SubscribeURL);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:') return null;

    // TopicArn is already validated against env-config above; extracting
    // the region is therefore safe (one of two known ARNs).
    //   ARN format: arn:<partition>:sns:<region>:<account>:<topic>
    const arnParts = body.TopicArn.split(':');
    if (arnParts.length < 6) return null;
    const partition = arnParts[1];
    const region = arnParts[3];
    if (!/^[a-z0-9-]+$/.test(region)) return null;
    if (partition !== 'aws' && partition !== 'aws-cn') return null;
    const tld = partition === 'aws-cn' ? 'amazonaws.com.cn' : 'amazonaws.com';

    const token = parsed.searchParams.get('Token');
    // SNS Tokens are opaque ~150-char base64-ish strings. Bound the shape
    // so a malicious Token can't carry ; or & or other URL-shape chars
    // even after percent-encoding.
    if (!token || !/^[A-Za-z0-9_-]{1,2048}$/.test(token)) return null;

    // Final URL is fully reconstructed: hardcoded scheme/path/Action,
    // hostname assembled from validated region + tld, query from
    // already-pinned TopicArn + regex-validated Token. fetch never sees
    // user-input characters outside encodeURIComponent's escape table.
    return (
      `https://sns.${region}.${tld}/` +
      `?Action=ConfirmSubscription` +
      `&TopicArn=${encodeURIComponent(body.TopicArn)}` +
      `&Token=${encodeURIComponent(token)}`
    );
  }
}
