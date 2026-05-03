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
import { createVerify } from 'node:crypto';
import { RATE_LIMIT_AUTH } from '../common/throttle-config';
import { EmailSuppressionService } from './email-suppression.service';

// Signable fields per https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
// The previously-used `sns-validator` 0.3.5 npm has buggy lists (includes
// SubscribeURL in NOTIFICATION's signables and Subject in SUBSCRIPTION's),
// which intermittently mismatches AWS's canonical string and yields
// "The message signature is invalid." on real SES bounce / complaint
// notifications. Inlining the AWS-spec lists fixes that.
const SIGNABLE_KEYS_NOTIFICATION = [
  'Message',
  'MessageId',
  'Subject',
  'Timestamp',
  'TopicArn',
  'Type',
] as const;
const SIGNABLE_KEYS_SUBSCRIPTION = [
  'Message',
  'MessageId',
  'SubscribeURL',
  'Timestamp',
  'Token',
  'TopicArn',
  'Type',
] as const;

// AWS publishes signing certs from sns.<region>.amazonaws.com[.cn] only.
// Fetching from any other host opens an SSRF vector — pin the regex.
const SIGNING_CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/i;

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
}

interface SesBounceMessage {
  notificationType: 'Bounce';
  bounce: {
    bounceType: 'Permanent' | 'Transient' | 'Undetermined';
    bounceSubType?: string;
    bouncedRecipients: Array<{ emailAddress: string; status?: string; diagnosticCode?: string }>;
    timestamp: string;
  };
  mail?: { messageId?: string };
}

interface SesComplaintMessage {
  notificationType: 'Complaint';
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
 * Auth:
 *
 *   This route is PUBLIC by necessity (AWS doesn't sign requests with a
 *   shared secret — they sign each message with X.509 + Sig V1/V2).
 *   Defence-in-depth:
 *     - Cloudflare WAF restricts the path to AWS SNS published IP ranges
 *       (configured manually outside this codebase, see runbook)
 *     - sns-validator verifies signature against AWS's public cert
 *     - TopicArn pinned to env vars — payloads from a different topic
 *       are dropped even if the signature is valid (defence against
 *       cross-topic confusion attacks)
 *
 * Rate limit:
 *
 *   AUTH bucket (5/min). AWS retries failed deliveries with exponential
 *   backoff so we have generous slack; legitimate volume is well under
 *   1/sec even during a real bounce storm.
 */
// Public route by default in this codebase — endpoints aren't guarded
// unless they explicitly use @UseGuards(JwtAuthGuard). This webhook MUST
// be reachable without auth (AWS doesn't have a session cookie); SNS
// signature verification + WAF IP allowlist + topic-ARN pinning are the
// auth substitute.
@Controller('webhooks/ses-events')
export class SesEventsController {
  private readonly logger = new Logger(SesEventsController.name);
  private readonly bouncesTopicArn: string | undefined;
  private readonly complaintsTopicArn: string | undefined;
  // Cert cache — AWS rotates signing certs occasionally; entries live
  // for the process lifetime. RSS impact is negligible (one PEM ~1.5 KB).
  private readonly certCache = new Map<string, string>();

  constructor(
    private config: ConfigService,
    private suppressions: EmailSuppressionService,
  ) {
    this.bouncesTopicArn = this.config.get<string>('SNS_TOPIC_ARN_BOUNCES');
    this.complaintsTopicArn = this.config.get<string>('SNS_TOPIC_ARN_COMPLAINTS');
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

    // Pin the topic — drop anything from an unexpected topic before we
    // even verify the signature. Catches cross-topic confusion if AWS
    // permissions are ever misconfigured.
    if (
      body.TopicArn !== this.bouncesTopicArn &&
      body.TopicArn !== this.complaintsTopicArn
    ) {
      this.logger.warn(`ses-events rejected: unknown TopicArn`);
      throw new ForbiddenException();
    }

    // RSA signature verification using AWS's public cert. Builds the
    // canonical string per the SNS spec (signable keys differ between
    // Notification vs Subscription messages — see the spec lists at
    // module scope).
    const sigOk = await this.verifySnsSignature(body);
    if (!sigOk) {
      this.logger.warn(
        `ses-events signature verification failed (sigVer=${body.SignatureVersion}, type=${body.Type})`,
      );
      throw new ForbiddenException();
    }

    if (body.Type === 'SubscriptionConfirmation') {
      // AWS sends this once per subscription. To complete the handshake
      // we GET an HTTPS endpoint at `sns.<region>.amazonaws.com[.cn]`
      // with `Action=ConfirmSubscription` + the TopicArn + a Token.
      //
      // SSRF defence: do NOT call fetch(body.SubscribeURL) — that field
      // is part of the SNS message body and a CodeQL taint analysis
      // (rightly) flags it as user-controlled even after a hostname
      // regex check. Instead we extract the Token (regex-validated to
      // an opaque base64-ish string), then reconstruct the URL from
      // validated components:
      //   - scheme: hardcoded `https://`
      //   - hostname: `sns.<region>.amazonaws.com[.cn]`, region derived
      //     from TopicArn (which we already pinned to two known ARNs
      //     above), partition-suffix from the ARN's `arn:aws-cn:` prefix
      //   - path: hardcoded `/`
      //   - query: hardcoded action + URL-encoded TopicArn + URL-encoded
      //     Token
      // No part of the constructed URL flows directly from the message
      // payload into fetch() — the Token is the only user-input value
      // and it's regex-validated + percent-encoded.
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

    if (inner.notificationType === 'Bounce') {
      const subType = inner.bounce.bounceSubType ?? '';
      // Only suppress on Permanent bounces. Transient bounces (mailbox
      // full, greylisting) often clear by retry — auto-suppressing
      // would block legit users on intermittent infrastructure issues.
      if (inner.bounce.bounceType !== 'Permanent') {
        this.logger.log(`ses-events bounce ignored type=${inner.bounce.bounceType}`);
        return { ok: true };
      }
      for (const recip of inner.bounce.bouncedRecipients) {
        if (recip.emailAddress) {
          await this.suppressions.suppress(
            recip.emailAddress,
            'bounce',
            `Permanent/${subType}`,
            recip.diagnosticCode?.slice(0, 200),
          );
        }
      }
    } else if (inner.notificationType === 'Complaint') {
      // Always suppress complaints — recipient explicitly marked as
      // spam, sending again hurts SES reputation badly.
      for (const recip of inner.complaint.complainedRecipients) {
        if (recip.emailAddress) {
          await this.suppressions.suppress(
            recip.emailAddress,
            'complaint',
            inner.complaint.complaintFeedbackType?.slice(0, 50),
          );
        }
      }
    } else {
      this.logger.warn(`ses-events unhandled notificationType`);
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

  /**
   * Verify an SNS message signature per AWS spec. Returns true if the
   * message is authentically signed by AWS, false otherwise.
   *
   *   1. Validate SigningCertURL is HTTPS at sns.<region>.amazonaws.com[.cn]/*.pem
   *   2. Fetch (and cache) the X.509 cert
   *   3. Build the canonical string from SignableKeys:
   *        - For Notification: Message, MessageId, [Subject], Timestamp, TopicArn, Type
   *        - For Subscription / UnsubscribeConfirmation: Message, MessageId, SubscribeURL, Timestamp, Token, TopicArn, Type
   *      Each key+value is appended as `${key}\n${value}\n`. Skip keys that
   *      are absent / null / undefined (AWS does the same when signing).
   *   4. RSA verify with SHA1 (SignatureVersion=1) or SHA256 (=2).
   *
   * Inlined here because the popular `sns-validator` 0.3.5 npm has the
   * wrong signable-keys lists, which intermittently mismatches AWS's
   * canonical and rejects real bounce/complaint notifications.
   */
  protected async verifySnsSignature(body: SnsMessage): Promise<boolean> {
    const sigVer = body.SignatureVersion;
    if (sigVer !== '1' && sigVer !== '2') return false;

    if (!body.SigningCertURL || typeof body.SigningCertURL !== 'string') return false;
    let certUrl: URL;
    try {
      certUrl = new URL(body.SigningCertURL);
    } catch {
      return false;
    }
    if (certUrl.protocol !== 'https:') return false;
    if (!certUrl.pathname.endsWith('.pem')) return false;
    if (!SIGNING_CERT_HOST.test(certUrl.host)) return false;

    const keys: readonly string[] =
      body.Type === 'SubscriptionConfirmation' || body.Type === 'UnsubscribeConfirmation'
        ? SIGNABLE_KEYS_SUBSCRIPTION
        : SIGNABLE_KEYS_NOTIFICATION;

    let canonical = '';
    for (const k of keys) {
      const v = (body as unknown as Record<string, unknown>)[k];
      // AWS skips missing fields when signing; null and undefined behave
      // the same in our parsed body. Empty string is included only if the
      // field was actually emitted by AWS (which it isn't for Subject —
      // SES omits the key entirely when no subject was set).
      if (v === undefined || v === null) continue;
      canonical += `${k}\n${String(v)}\n`;
    }

    const cert = await this.fetchSigningCert(body.SigningCertURL);
    if (!cert) return false;

    try {
      const verifier = createVerify(sigVer === '1' ? 'RSA-SHA1' : 'RSA-SHA256');
      verifier.update(canonical, 'utf8');
      return verifier.verify(cert, body.Signature, 'base64');
    } catch (err) {
      this.logger.warn(
        `ses-events crypto.verify threw: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return false;
    }
  }

  protected async fetchSigningCert(url: string): Promise<string | null> {
    const cached = this.certCache.get(url);
    if (cached) return cached;
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (!res.ok) return null;
      const text = await res.text();
      // Cap cert cache at 16 entries — AWS rotates rarely, so this is
      // an absolute belt-and-braces against unbounded growth from
      // attacker-controlled URLs (which we already host-pin above).
      if (this.certCache.size >= 16) {
        const firstKey = this.certCache.keys().next().value;
        if (firstKey !== undefined) this.certCache.delete(firstKey);
      }
      this.certCache.set(url, text);
      return text;
    } catch {
      return null;
    }
  }
}
