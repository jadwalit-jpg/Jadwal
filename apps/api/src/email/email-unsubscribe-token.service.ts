import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * Stateless HMAC-signed token for one-click email unsubscribe (RFC 8058).
 *
 * The token encodes `userId|emailHash|expiry` and an HMAC-SHA256 signature.
 * Verification needs only the server-side secret — no DB lookup, no Redis.
 *
 * Why we bind `emailHash` (sha256 of lowercase+trimmed email, first 16 hex
 * chars) into the payload:
 *   - Token is per-recipient: cannot unsubscribe user A using user B's token
 *   - Hash (not plaintext) keeps the wire format short and avoids logging
 *     emails into URL-shaped places (CloudFront access logs, Sentry breadcrumbs)
 *   - 64-bit binding is plenty: forging a token still requires the secret;
 *     the email hash is just a recipient guard, not the auth boundary
 *
 * Why `crypto.timingSafeEqual` for signature comparison:
 *   - Plain `===` leaks per-byte timing, allowing a remote attacker to
 *     incrementally discover valid signatures
 *   - timingSafeEqual runs in constant time regardless of where the bytes diverge
 *
 * Why TTL (default 90 days):
 *   - Limits replay window after secret rotation
 *   - Long enough that recipients who archive emails for months can still
 *     click unsubscribe later
 *   - Configurable via UNSUBSCRIBE_TOKEN_TTL_DAYS env var
 */
type VerifyOk = { ok: true; userId: string; emailHash: string };
type VerifyFail = { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };
export type VerifyResult = VerifyOk | VerifyFail;

@Injectable()
export class EmailUnsubscribeTokenService {
  private readonly logger = new Logger(EmailUnsubscribeTokenService.name);
  private readonly secret: Buffer;
  private readonly ttlSeconds: number;

  constructor(config: ConfigService) {
    const s = config.get<string>('UNSUBSCRIBE_TOKEN_SECRET');
    // Boot-time guard. main.ts already enforces this in REQUIRED_IN_PRODUCTION,
    // but local dev or test envs may skip the global validator — fail fast here
    // so we never sign with an empty secret and write toy signatures to email.
    if (!s || s.length < 32) {
      throw new Error(
        'UNSUBSCRIBE_TOKEN_SECRET is required and must be ≥32 characters. Generate via: ' +
          "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    this.secret = Buffer.from(s, 'utf8');
    const ttlDays = Number(config.get('UNSUBSCRIBE_TOKEN_TTL_DAYS') ?? 90);
    this.ttlSeconds = ttlDays * 86400;
  }

  /**
   * Build the recipient-binding hash. Always lowercase + trim before hashing
   * so the same email signs to the same hash regardless of how it was
   * captured at signup vs in the User row.
   */
  private hashEmail(email: string): string {
    return createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 16);
  }

  /**
   * Generate a fresh token for the given user/email pair.
   * Returns a single base64url string suitable for inclusion in email URLs.
   */
  generate(userId: string, email: string): string {
    const emailHash = this.hashEmail(email);
    const expiry = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const payload = `${userId}|${emailHash}|${expiry}`;
    const sig = createHmac('sha256', this.secret).update(payload).digest('base64url');
    // Pack `payload.signature` into a single opaque base64url blob so the URL
    // has exactly one query parameter. Avoids subtle bugs where pipe chars
    // or equals signs in the payload break query-string parsing in some
    // tools / load balancers.
    return Buffer.from(`${payload}.${sig}`, 'utf8').toString('base64url');
  }

  /**
   * Verify a token. On success returns userId + emailHash for the caller
   * to look up the user record + cross-check the current email matches.
   * On failure returns a `reason` for logging — but the HTTP layer should
   * NOT echo the reason to the client (avoid token-state oracle).
   */
  verify(token: string): VerifyResult {
    let decoded: string;
    try {
      decoded = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      return { ok: false, reason: 'malformed' };
    }

    // Split on the last dot — payload itself contains pipes but no dots
    const dot = decoded.lastIndexOf('.');
    if (dot < 0) return { ok: false, reason: 'malformed' };
    const payload = decoded.slice(0, dot);
    const sig = decoded.slice(dot + 1);

    const expected = createHmac('sha256', this.secret).update(payload).digest('base64url');

    // Length-check first: timingSafeEqual throws on mismatched buffer lengths,
    // and a length mismatch is itself diagnostic of a malformed signature.
    let match = false;
    if (sig.length === expected.length) {
      try {
        match = timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      } catch {
        return { ok: false, reason: 'malformed' };
      }
    }
    if (!match) return { ok: false, reason: 'bad_signature' };

    const parts = payload.split('|');
    if (parts.length !== 3) return { ok: false, reason: 'malformed' };
    const [userId, emailHash, expiryStr] = parts;
    if (!userId || !emailHash || !expiryStr) return { ok: false, reason: 'malformed' };

    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry) || expiry <= 0) return { ok: false, reason: 'malformed' };
    if (Math.floor(Date.now() / 1000) > expiry) return { ok: false, reason: 'expired' };

    return { ok: true, userId, emailHash };
  }

  /**
   * Helper for the email-send path: the same hash function used during sign,
   * exposed so callers can confirm a User.email matches a token's emailHash
   * without re-implementing the hashing logic.
   */
  matchesEmail(emailHash: string, email: string): boolean {
    return this.hashEmail(email) === emailHash;
  }
}
