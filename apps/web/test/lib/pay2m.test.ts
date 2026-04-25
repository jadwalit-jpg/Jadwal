import { isAllowedPay2mFormAction, PAY2M_ALLOWED_ORIGINS } from '@/lib/pay2m';

describe('pay2m allowlist helper — PROD §18.7', () => {
  it('defaults to the production PAY2M origin', () => {
    // The exact default matters — if the PAY2M_API_URL env points to
    // payments.pay2m.com, this allowlist must include that origin or
    // every real payment will be refused by the client.
    expect(PAY2M_ALLOWED_ORIGINS).toContain('https://payments.pay2m.com');
  });

  describe('accepts legitimate PAY2M URLs', () => {
    it('accepts the documented PAY2M PostTransaction endpoint', () => {
      expect(
        isAllowedPay2mFormAction(
          'https://payments.pay2m.com/Ecommerce/api/Transaction/PostTransaction',
        ),
      ).toBe(true);
    });

    it('accepts other paths on the same origin (PAY2M can change paths)', () => {
      expect(isAllowedPay2mFormAction('https://payments.pay2m.com/any/other/path')).toBe(true);
    });

    it('accepts URLs with query strings and fragments', () => {
      expect(
        isAllowedPay2mFormAction('https://payments.pay2m.com/x?q=1#frag'),
      ).toBe(true);
    });
  });

  describe('rejects non-HTTPS schemes (no downgrade, no XSS surface)', () => {
    it('rejects http://', () => {
      expect(isAllowedPay2mFormAction('http://payments.pay2m.com/x')).toBe(false);
    });

    it('rejects javascript: URLs (the XSS-via-formaction attack vector)', () => {
      expect(isAllowedPay2mFormAction('javascript:alert(1)')).toBe(false);
    });

    it('rejects data: URLs', () => {
      expect(isAllowedPay2mFormAction('data:text/html,<script>alert(1)</script>')).toBe(false);
    });

    it('rejects file: URLs', () => {
      expect(isAllowedPay2mFormAction('file:///etc/passwd')).toBe(false);
    });
  });

  describe('rejects foreign origins', () => {
    it('rejects a look-alike subdomain of a known host', () => {
      expect(isAllowedPay2mFormAction('https://payments.pay2m.com.evil.com/x')).toBe(false);
    });

    it('rejects a completely unrelated host', () => {
      expect(isAllowedPay2mFormAction('https://evil.example/PostTransaction')).toBe(false);
    });

    it('rejects unknown subdomain (e.g. uat.pay2m.com if not allowlisted)', () => {
      expect(isAllowedPay2mFormAction('https://uat.pay2m.com/x')).toBe(false);
    });

    it('rejects an IP-literal host', () => {
      expect(isAllowedPay2mFormAction('https://1.2.3.4/x')).toBe(false);
    });
  });

  describe('rejects tampered / malformed URLs', () => {
    it('rejects URLs with embedded credentials', () => {
      // https://user:pass@host — browser would send a Basic-Auth header.
      // Never legitimate for PAY2M; suspicious of tampering.
      expect(
        isAllowedPay2mFormAction('https://user:pass@payments.pay2m.com/x'),
      ).toBe(false);
      expect(
        isAllowedPay2mFormAction('https://:password@payments.pay2m.com/x'),
      ).toBe(false);
      expect(
        isAllowedPay2mFormAction('https://user@payments.pay2m.com/x'),
      ).toBe(false);
    });

    it('rejects an empty string', () => {
      expect(isAllowedPay2mFormAction('')).toBe(false);
    });

    it('rejects a non-URL value', () => {
      expect(isAllowedPay2mFormAction('not a url at all')).toBe(false);
    });

    it('rejects non-string inputs defensively', () => {
      // formAction comes from an API response — a bad server could send
      // a number / null / object. The type says string, but runtime
      // validation still needs to reject these.
      expect(isAllowedPay2mFormAction(null as unknown as string)).toBe(false);
      expect(isAllowedPay2mFormAction(undefined as unknown as string)).toBe(false);
      expect(isAllowedPay2mFormAction(42 as unknown as string)).toBe(false);
    });

    it('rejects a protocol-relative URL (`//host/...`)', () => {
      expect(isAllowedPay2mFormAction('//payments.pay2m.com/x')).toBe(false);
    });
  });
});
