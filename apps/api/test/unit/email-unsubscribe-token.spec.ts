import { ConfigService } from '@nestjs/config';
import { EmailUnsubscribeTokenService } from '../../src/email/email-unsubscribe-token.service';

/**
 * Pure unit tests for the HMAC-signed unsubscribe token. No DB, no SES, no
 * NestJS — just the service in isolation.
 */
function makeService(overrides: Record<string, string | number> = {}): EmailUnsubscribeTokenService {
  const config = {
    get: (key: string) => overrides[key],
    getOrThrow: (key: string) => {
      const v = overrides[key];
      if (v === undefined) throw new Error(`missing ${key}`);
      return v;
    },
  } as unknown as ConfigService;
  return new EmailUnsubscribeTokenService(config);
}

const VALID_SECRET = 'a'.repeat(64); // 64-char hex-shaped secret

describe('EmailUnsubscribeTokenService', () => {
  describe('constructor', () => {
    test('throws when UNSUBSCRIBE_TOKEN_SECRET is missing', () => {
      expect(() => makeService({})).toThrow(/UNSUBSCRIBE_TOKEN_SECRET/);
    });

    test('throws when secret is shorter than 32 chars', () => {
      expect(() => makeService({ UNSUBSCRIBE_TOKEN_SECRET: 'short' })).toThrow(/≥32/);
    });

    test('accepts 32-char secret as the minimum', () => {
      expect(() => makeService({ UNSUBSCRIBE_TOKEN_SECRET: 'a'.repeat(32) })).not.toThrow();
    });
  });

  describe('generate / verify round-trip', () => {
    test('a freshly minted token verifies', () => {
      const svc = makeService({ UNSUBSCRIBE_TOKEN_SECRET: VALID_SECRET });
      const token = svc.generate('user-123', 'Alice@Example.COM');
      const result = svc.verify(token);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.userId).toBe('user-123');
        // emailHash is recomputed from the lowercased+trimmed email
        expect(result.emailHash).toMatch(/^[0-9a-f]{16}$/);
      }
    });

    test('email is lowercased + trimmed before hashing', () => {
      const svc = makeService({ UNSUBSCRIBE_TOKEN_SECRET: VALID_SECRET });
      const a = svc.generate('u1', 'Alice@Example.COM');
      const b = svc.generate('u1', '  alice@example.com  ');
      // Tokens differ (timestamps differ over multiple calls within a tick);
      // but the recipient hash should match.
      const ra = svc.verify(a);
      const rb = svc.verify(b);
      expect(ra.ok && rb.ok).toBe(true);
      if (ra.ok && rb.ok) expect(ra.emailHash).toBe(rb.emailHash);
    });

    test('matchesEmail confirms a valid email', () => {
      const svc = makeService({ UNSUBSCRIBE_TOKEN_SECRET: VALID_SECRET });
      const token = svc.generate('u1', 'alice@example.com');
      const result = svc.verify(token);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(svc.matchesEmail(result.emailHash, 'alice@example.com')).toBe(true);
        expect(svc.matchesEmail(result.emailHash, 'ALICE@EXAMPLE.COM')).toBe(true);
        expect(svc.matchesEmail(result.emailHash, 'eve@example.com')).toBe(false);
      }
    });
  });

  describe('rejection cases', () => {
    test('rejects malformed (non base64url) token', () => {
      const svc = makeService({ UNSUBSCRIBE_TOKEN_SECRET: VALID_SECRET });
      const result = svc.verify('not!valid!base64url');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('malformed');
    });

    test('rejects token with no dot separator', () => {
      const svc = makeService({ UNSUBSCRIBE_TOKEN_SECRET: VALID_SECRET });
      // Encode "no-dot-here" as base64url — valid encoding, no separator
      const fake = Buffer.from('no-dot-here', 'utf8').toString('base64url');
      const result = svc.verify(fake);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('malformed');
    });

    test('rejects tampered signature', () => {
      const svc = makeService({ UNSUBSCRIBE_TOKEN_SECRET: VALID_SECRET });
      const good = svc.generate('u1', 'a@example.com');
      // Decode, flip a byte in the signature, re-encode
      const decoded = Buffer.from(good, 'base64url').toString('utf8');
      const dot = decoded.lastIndexOf('.');
      const payload = decoded.slice(0, dot);
      const sig = decoded.slice(dot + 1);
      // Flip first signature char to a different valid base64url char
      const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
      const tampered = Buffer.from(`${payload}.${flipped}`, 'utf8').toString('base64url');
      const result = svc.verify(tampered);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('bad_signature');
    });

    test('rejects tampered payload (different userId)', () => {
      const svc = makeService({ UNSUBSCRIBE_TOKEN_SECRET: VALID_SECRET });
      const good = svc.generate('u1', 'a@example.com');
      const decoded = Buffer.from(good, 'base64url').toString('utf8');
      const dot = decoded.lastIndexOf('.');
      const payload = decoded.slice(0, dot);
      const sig = decoded.slice(dot + 1);
      // Mutate the userId in the payload, keep original signature
      const newPayload = payload.replace(/^u1/, 'u2');
      const tampered = Buffer.from(`${newPayload}.${sig}`, 'utf8').toString('base64url');
      const result = svc.verify(tampered);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('bad_signature');
    });

    test('rejects expired token', () => {
      const svc = makeService({
        UNSUBSCRIBE_TOKEN_SECRET: VALID_SECRET,
        UNSUBSCRIBE_TOKEN_TTL_DAYS: 1,
      });
      const real = Date.now;
      // Fake time at 2 days ago for token generation
      const twoDaysAgo = real() - 2 * 86400 * 1000;
      Date.now = () => twoDaysAgo;
      const oldToken = svc.generate('u1', 'a@example.com');
      // Restore current time; token should be expired
      Date.now = real;
      const result = svc.verify(oldToken);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('expired');
    });

    test('rejects token signed by a different secret', () => {
      const a = makeService({ UNSUBSCRIBE_TOKEN_SECRET: VALID_SECRET });
      const b = makeService({ UNSUBSCRIBE_TOKEN_SECRET: 'b'.repeat(64) });
      const tokenFromA = a.generate('u1', 'alice@example.com');
      const result = b.verify(tokenFromA);
      expect(result.ok).toBe(false);
      // Could be bad_signature OR length-mismatch (both correctly reject)
      if (!result.ok) expect(['bad_signature', 'malformed']).toContain(result.reason);
    });
  });

  describe('format', () => {
    test('generated token is opaque base64url', () => {
      const svc = makeService({ UNSUBSCRIBE_TOKEN_SECRET: VALID_SECRET });
      const token = svc.generate('u1', 'a@example.com');
      // base64url alphabet: A-Z a-z 0-9 - _ (no =, no +, no /)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      // Sanity: decoded form contains exactly one dot (payload.signature)
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      expect(decoded.split('.').length).toBe(2);
    });
  });
});
