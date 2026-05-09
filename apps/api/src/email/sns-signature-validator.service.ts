import { Injectable, Logger } from '@nestjs/common';
import { createVerify, X509Certificate } from 'crypto';

/**
 * AWS SNS HTTP/HTTPS message signature validator.
 *
 * AWS signs every SNS HTTPS-subscription delivery with an RSA signature
 * over a canonical string built from named fields. This service verifies
 * those signatures against AWS's published signing certificate.
 *
 * ─── Why this exists despite the inline doc in ses-events.controller.ts ──
 *
 * A previous attempt at SNS signature validation (`sns-payload-validator`
 * npm + a hand-rolled variant) silently rejected every legitimate SES
 * configuration-set event in production, breaking the bounce/complaint
 * suppression loop. The team rolled back and substituted three layers:
 * Cloudflare WAF AWS-IP allowlist + TopicArn pinning + content-shape
 * validation.
 *
 * This implementation runs in **WARN mode by default**:
 *   - Validates every incoming SNS message
 *   - Logs every result (success and failure with reason)
 *   - But does NOT reject failures unless `SNS_SIGNATURE_ENFORCE=true`
 *
 * Operator playbook:
 *   1. Deploy with the env unset → WARN mode → watch CloudWatch for the
 *      structured log lines emitted from ses-events.controller. Every
 *      production message should show `valid=true`.
 *   2. After ~7 days of clean WARN logs, set `SNS_SIGNATURE_ENFORCE=true`
 *      via SSM and force-new-deployment. Now invalid signatures get 403'd.
 *   3. If WARN logs show systemic mismatches, the implementation has a
 *      bug — keep WARN mode on, file an issue with the canonical bytes
 *      that failed (the logger emits enough context to reproduce).
 *
 * ─── Spec references ────────────────────────────────────────────────────
 *
 *  - https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 *  - https://docs.aws.amazon.com/sns/latest/dg/sns-message-and-json-formats.html
 *
 * Canonical construction (per AWS spec, alphabetical field order, each
 * name and value on their own line, with a trailing newline):
 *
 *   Notification:
 *     Message\n<v>\nMessageId\n<v>\n[Subject\n<v>\n]Timestamp\n<v>\nTopicArn\n<v>\nType\n<v>\n
 *   SubscriptionConfirmation / UnsubscribeConfirmation:
 *     Message\n<v>\nMessageId\n<v>\nSubscribeURL\n<v>\nTimestamp\n<v>\nToken\n<v>\nTopicArn\n<v>\nType\n<v>\n
 *
 * Subject is included only when present in the message (it's optional).
 * SignatureVersion 1 → SHA1WithRSA. SignatureVersion 2 → SHA256WithRSA.
 *
 * ─── SSRF defence on cert fetch ─────────────────────────────────────────
 *
 *  SigningCertURL is part of the user-controlled message body, so we
 *  validate it against a strict regex matching only AWS SNS cert hosts
 *  before fetching. fetch() runs with `redirect: 'manual'` to drop any
 *  cross-host redirect. The cert PEM is parsed via X509Certificate which
 *  rejects malformed input.
 */

export type SnsSignedMessage = {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  Signature: string;
  SignatureVersion: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
};

export type ValidationResult =
  | { valid: true }
  | {
      valid: false;
      reason:
        | 'invalid_cert_url'
        | 'cert_fetch_failed'
        | 'unsupported_message_type'
        | 'unsupported_signature_version'
        | 'invalid_signature_encoding'
        | 'signature_mismatch';
    };

@Injectable()
export class SnsSignatureValidator {
  private readonly logger = new Logger(SnsSignatureValidator.name);

  /**
   * AWS SNS signing certs only come from these hosts. Anchored regex,
   * partition-aware (commercial + China), strict cert-name shape so a
   * smuggled `?` or `..` in the URL can't sneak past.
   */
  private readonly CERT_URL_PATTERN =
    /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?\/SimpleNotificationService-[a-zA-Z0-9-]{1,128}\.pem$/;

  private readonly CERT_TTL_MS = 60 * 60 * 1000; // 1h
  private readonly certCache = new Map<string, { pem: string; expiresAt: number }>();

  async validate(msg: SnsSignedMessage): Promise<ValidationResult> {
    if (!this.CERT_URL_PATTERN.test(msg.SigningCertURL)) {
      return { valid: false, reason: 'invalid_cert_url' };
    }

    const algorithm = this.algorithmForVersion(msg.SignatureVersion);
    if (!algorithm) {
      return { valid: false, reason: 'unsupported_signature_version' };
    }

    const canonical = this.buildCanonical(msg);
    if (canonical === null) {
      return { valid: false, reason: 'unsupported_message_type' };
    }

    let signatureBytes: Buffer;
    try {
      signatureBytes = Buffer.from(msg.Signature, 'base64');
      if (signatureBytes.length === 0) throw new Error('empty');
    } catch {
      return { valid: false, reason: 'invalid_signature_encoding' };
    }

    let pem: string;
    try {
      pem = await this.getCert(msg.SigningCertURL);
    } catch (err) {
      this.logger.warn(
        `cert fetch failed for ${msg.SigningCertURL}: ${err instanceof Error ? err.name : 'UnknownError'}`,
      );
      return { valid: false, reason: 'cert_fetch_failed' };
    }

    const verifier = createVerify(algorithm);
    verifier.update(canonical, 'utf8');
    const ok = verifier.verify(pem, signatureBytes);
    return ok ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
  }

  private algorithmForVersion(v: string): 'SHA1' | 'SHA256' | null {
    if (v === '1') return 'SHA1';
    if (v === '2') return 'SHA256';
    return null;
  }

  /**
   * Build the canonical string AWS signed. Returns null for message
   * types we don't handle (anything other than Notification /
   * SubscriptionConfirmation / UnsubscribeConfirmation).
   *
   * Critical: every name and value goes on its own line, alphabetical
   * order, with a trailing newline after the final value. Subject is
   * included only when the field exists in the message body.
   */
  buildCanonical(msg: SnsSignedMessage): string | null {
    const lines: string[] = [];

    if (msg.Type === 'Notification') {
      lines.push('Message', msg.Message);
      lines.push('MessageId', msg.MessageId);
      if (typeof msg.Subject === 'string') {
        lines.push('Subject', msg.Subject);
      }
      lines.push('Timestamp', msg.Timestamp);
      lines.push('TopicArn', msg.TopicArn);
      lines.push('Type', msg.Type);
    } else if (
      msg.Type === 'SubscriptionConfirmation' ||
      msg.Type === 'UnsubscribeConfirmation'
    ) {
      // Subscribe/Unsubscribe messages carry Token + SubscribeURL too.
      // Validate they're present — without them the canonical is wrong
      // and we'd produce a meaningless signature mismatch.
      if (typeof msg.Token !== 'string' || typeof msg.SubscribeURL !== 'string') {
        return null;
      }
      lines.push('Message', msg.Message);
      lines.push('MessageId', msg.MessageId);
      lines.push('SubscribeURL', msg.SubscribeURL);
      lines.push('Timestamp', msg.Timestamp);
      lines.push('Token', msg.Token);
      lines.push('TopicArn', msg.TopicArn);
      lines.push('Type', msg.Type);
    } else {
      return null;
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Cache certs in-process for an hour. Each ECS task has its own cache
   * — that's fine, certs are small and AWS rotates them rarely. A short
   * TTL means a freshly-rotated cert is picked up within an hour even
   * if the task lives longer.
   */
  private async getCert(url: string): Promise<string> {
    const now = Date.now();
    const cached = this.certCache.get(url);
    if (cached && cached.expiresAt > now) {
      return cached.pem;
    }

    // `redirect: 'manual'` so a hijacked DNS or AWS misconfig can't
    // bounce us to a different host. URL is already regex-validated;
    // any redirect would mean something unexpected is happening.
    const res = await fetch(url, { redirect: 'manual' });
    if (!res.ok) throw new Error(`cert HTTP ${res.status}`);
    const pem = await res.text();

    // Throws if the body isn't a valid X.509 cert — defends against
    // a misconfigured AWS edge serving HTML or an attacker's TLS-MITM
    // on this specific path returning garbage.
    new X509Certificate(pem);

    this.certCache.set(url, { pem, expiresAt: now + this.CERT_TTL_MS });
    return pem;
  }

  /** Test/debug hook — clears the cache (used by unit tests). */
  clearCache(): void {
    this.certCache.clear();
  }
}
