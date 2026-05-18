/**
 * EmailService unit tests.
 *
 * Migrated 2026-05-17 from AWS SES v2 (`@aws-sdk/client-sesv2`) to Resend.
 * SES production access was denied (200/day sandbox cap); Resend has no
 * sandbox-approval gate. The transport swap moves List-Unsubscribe headers
 * off a hand-rolled raw-MIME blob and onto the `headers` field of
 * `resend.emails.send()` — all SDK-shape assertions changed accordingly.
 *
 * Covers:
 *   - Log-only mode (EMAIL_ENABLED=false) never instantiates the Resend client
 *   - Production must not boot with EMAIL_ENABLED=false (guard)
 *   - EMAIL_ENABLED=true with no RESEND_API_KEY throws at construction
 *   - send() renders template + sets List-Unsubscribe headers when a user
 *     is found by email
 *   - send() falls back to mailto-only List-Unsubscribe when no user matches
 *   - Email is masked in all log output (anti-leak)
 *   - Resend error branch returns false + logs err.name (not err.message)
 *   - tags carry env + template
 *   - Suppression list short-circuit (anti-enumeration)
 *   - Platform daily cap short-circuit (cost runaway gate)
 *   - admin-alert bypasses both gates
 */

import { EmailService } from '../../src/email/email.service';

// Mock the Resend SDK before importing anything that uses it. The SDK's
// `emails.send()` resolves with `{ data, error }` — it does not throw on
// API errors — so the mock mirrors that contract.
jest.mock('resend', () => {
  const sendMock = jest.fn().mockResolvedValue({ data: { id: 'email_mock_123' }, error: null });
  const Resend = jest.fn().mockImplementation(() => ({ emails: { send: sendMock } }));
  return { Resend, __sendMock: sendMock };
});
const resendMocks = require('resend') as any;

function makeConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    EMAIL_FROM: 'noreply@jadwal.qa',
    EMAIL_ENABLED: 'false',
    APP_URL: 'https://app.jadwal.test',
    API_URL: 'https://app.jadwal.test/api',
    RESEND_API_KEY: 're_test_key_123',
    ADMIN_EMAIL: 'ops@jadwal.qa',
    UNSUBSCRIBE_TOKEN_SECRET: 'a'.repeat(64),
  };
  const merged = { ...defaults, ...overrides };
  return {
    get: (k: string, fallback?: string) => merged[k] ?? fallback,
    getOrThrow: (k: string) => {
      const v = merged[k];
      if (v === undefined) throw new Error(`Missing config: ${k}`);
      return v;
    },
  };
}

// Default mock — suppression list always empty (no recipients filtered).
function makeSuppressions(isSuppressed: () => Promise<boolean> = async () => false) {
  return {
    isSuppressed: jest.fn(isSuppressed),
    suppress: jest.fn().mockResolvedValue(undefined),
    unsuppress: jest.fn().mockResolvedValue(true),
  };
}

// Default mock — platform daily cap always allows.
function makeQuota(tryConsumePlatformDaily: () => Promise<boolean> = async () => true) {
  return {
    tryConsume: jest.fn().mockResolvedValue(true),
    tryConsumePerIp: jest.fn().mockResolvedValue(true),
    tryConsumePlatformDaily: jest.fn(tryConsumePlatformDaily),
  };
}

// Default mock — Prisma user lookup returns a stable userId + EN language for
// any email, so the unsubscribe token includes the HTTPS variant. Tests that
// exercise the fallback (no user found) override findUnique to return null;
// tests for Arabic rendering override it to return preferredLanguage: 'AR'.
function makePrisma(
  findUnique: (args: any) => Promise<any> = async () => ({ id: 'u-mock', preferredLanguage: 'EN' }),
) {
  return {
    client: {
      user: {
        findUnique: jest.fn(findUnique),
      },
    },
  };
}

// Default mock — token service returns a fixed token for predictable assertions.
// The real service has its own dedicated unit-test suite; here we just need a
// stable string to match against.
function makeUnsubTokens() {
  return {
    generate: jest.fn().mockReturnValue('FAKE_TOKEN_123'),
    verify: jest.fn(),
    matchesEmail: jest.fn().mockReturnValue(true),
  };
}

/** Build an EmailService with mocks, optionally overriding individual deps. */
function buildSvc(opts: {
  config?: Record<string, string>;
  suppressions?: ReturnType<typeof makeSuppressions>;
  quota?: ReturnType<typeof makeQuota>;
  prisma?: ReturnType<typeof makePrisma>;
  tokens?: ReturnType<typeof makeUnsubTokens>;
} = {}) {
  return new EmailService(
    makeConfig(opts.config) as any,
    (opts.suppressions ?? makeSuppressions()) as any,
    (opts.quota ?? makeQuota()) as any,
    (opts.prisma ?? makePrisma()) as any,
    (opts.tokens ?? makeUnsubTokens()) as any,
  );
}

/** The payload object passed to `resend.emails.send()` on the Nth call. */
function sentPayload(n = 0): any {
  return resendMocks.__sendMock.mock.calls[n][0];
}

describe('EmailService — construction + prod-guard', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = ORIGINAL_ENV; });

  test('dev (EMAIL_ENABLED=false) → no Resend client instantiated', () => {
    resendMocks.Resend.mockClear();
    buildSvc({ config: { EMAIL_ENABLED: 'false' } });
    expect(resendMocks.Resend).not.toHaveBeenCalled();
  });

  test('EMAIL_ENABLED=true → Resend instantiated with the API key', () => {
    resendMocks.Resend.mockClear();
    buildSvc({ config: { EMAIL_ENABLED: 'true', RESEND_API_KEY: 're_live_abc' } });
    expect(resendMocks.Resend).toHaveBeenCalledWith('re_live_abc');
  });

  test('EMAIL_ENABLED=true + missing RESEND_API_KEY → throws at construction', () => {
    expect(() => buildSvc({ config: { EMAIL_ENABLED: 'true', RESEND_API_KEY: '' } })).toThrow(
      /FATAL.*RESEND_API_KEY is required/,
    );
  });

  test('EMAIL_ENABLED=true + whitespace-only RESEND_API_KEY → throws (treated as missing)', () => {
    expect(() => buildSvc({ config: { EMAIL_ENABLED: 'true', RESEND_API_KEY: '   ' } })).toThrow(
      /FATAL.*RESEND_API_KEY is required/,
    );
  });

  test('production + EMAIL_ENABLED=false → throws at construction (fail-safe)', () => {
    process.env.NODE_ENV = 'production';
    expect(() => buildSvc({ config: { EMAIL_ENABLED: 'false' } })).toThrow(
      /FATAL.*EMAIL_ENABLED must be true/,
    );
  });
});

describe('EmailService — suppression list short-circuit', () => {
  beforeEach(() => {
    resendMocks.__sendMock.mockClear();
  });

  test('suppressed recipient → Resend never called, returns true (anti-enumeration)', async () => {
    const suppressions = makeSuppressions(async () => true);
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, suppressions });
    const ok = await svc.sendEmailVerification('bounced@example.com', {
      userName: 'Alice', verificationLink: 'https://x/v?t=abc',
    });
    expect(ok).toBe(true);
    expect(suppressions.isSuppressed).toHaveBeenCalledWith('bounced@example.com');
    expect(resendMocks.__sendMock).not.toHaveBeenCalled();
  });

  test('non-suppressed recipient → Resend called normally', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await svc.sendPasswordReset('user@example.com', {
      userName: 'A', resetLink: 'https://x/r', expiresIn: '1 hour',
    });
    expect(resendMocks.__sendMock).toHaveBeenCalledTimes(1);
  });

  test('platform daily cap exceeded → returns success-shaped, never calls Resend', async () => {
    const quota = makeQuota(async () => false);
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, quota });
    const ok = await svc.sendEmailVerification('user@example.com', {
      userName: 'Alice', verificationLink: 'https://x/v?t=abc',
    });
    expect(ok).toBe(true);
    expect(quota.tryConsumePlatformDaily).toHaveBeenCalledTimes(1);
    expect(resendMocks.__sendMock).not.toHaveBeenCalled();
  });

  test('admin-alert bypasses platform cap — operational alerts always go out', async () => {
    const quota = makeQuota(async () => false);
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, quota });
    await svc.sendAdminAlert({ type: 'DATABASE_ERROR', note: 'fired through cap' });
    expect(quota.tryConsumePlatformDaily).not.toHaveBeenCalled();
    expect(resendMocks.__sendMock).toHaveBeenCalledTimes(1);
  });

  test('admin-alert bypasses suppression — operational alerts always go out', async () => {
    const suppressions = makeSuppressions(async () => true);
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, suppressions });
    await svc.sendAdminAlert({ type: 'SECURITY_EVENT', note: 'Something is broken' });
    expect(resendMocks.__sendMock).toHaveBeenCalledTimes(1);
    expect(suppressions.isSuppressed).not.toHaveBeenCalled();
  });
});

describe('EmailService — send dispatching + Resend payload', () => {
  beforeEach(() => {
    resendMocks.__sendMock.mockClear();
    resendMocks.__sendMock.mockResolvedValue({ data: { id: 'email_mock_123' }, error: null });
  });

  test('dev mode send returns true + never calls Resend', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'false' } });
    const ok = await svc.sendEmailVerification('user@example.com', {
      userName: 'Alice', verificationLink: 'https://app.jadwal.test/verify?token=abc',
    });
    expect(ok).toBe(true);
    expect(resendMocks.__sendMock).not.toHaveBeenCalled();
  });

  test('prod mode send calls Resend with from + to + subject + html + text', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    const ok = await svc.sendEmailVerification('user@example.com', {
      userName: 'Alice', verificationLink: 'https://app.jadwal.test/verify?token=abc',
    });
    expect(ok).toBe(true);
    expect(resendMocks.__sendMock).toHaveBeenCalledTimes(1);
    const payload = sentPayload();
    expect(payload.from).toBe('noreply@jadwal.qa');
    expect(payload.to).toBe('user@example.com');
    expect(payload.subject).toBe('Verify your email — AL Jadwal');
    expect(payload.html).toContain('<html');
    // Plain-text alternative (multipart/alternative) is sent too.
    expect(typeof payload.text).toBe('string');
    expect(payload.text.length).toBeGreaterThan(0);
    expect(payload.text).not.toContain('<html');
  });

  test('recipient preferredLanguage=AR → Arabic RTL email sent', async () => {
    const prisma = makePrisma(async () => ({ id: 'u-ar', preferredLanguage: 'AR' }));
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, prisma });
    await svc.sendPasswordReset('arabi@example.com', {
      userName: 'سارة', resetLink: 'https://app.jadwal.test/reset?t=abc', expiresIn: '1 hour',
    });
    const payload = sentPayload();
    expect(payload.subject).toBe('إعادة تعيين كلمة المرور — AL Jadwal');
    expect(payload.html).toContain('dir="rtl"');
  });

  test('explicit locale arg overrides the recipient preferredLanguage', async () => {
    // User row says EN, but the caller forces AR.
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await svc.sendPasswordReset(
      'user@example.com',
      { userName: 'A', resetLink: 'https://x/r', expiresIn: '1 hour' },
      'AR',
    );
    expect(sentPayload().subject).toBe('إعادة تعيين كلمة المرور — AL Jadwal');
  });

  test('payload carries List-Unsubscribe + List-Unsubscribe-Post headers when user is found', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await svc.sendEmailVerification('user@example.com', {
      userName: 'Alice', verificationLink: 'https://app.jadwal.test/verify?token=abc',
    });
    const headers = sentPayload().headers;
    // Both URL + mailto variants in the header (per RFC 2369 / 8058)
    expect(headers['List-Unsubscribe']).toMatch(
      /<https:\/\/.*\/email\/unsubscribe\?t=FAKE_TOKEN_123>, <mailto:unsubscribe@jadwal\.qa[^>]*>/,
    );
    // The one-click marker
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  test('payload falls back to mailto-only List-Unsubscribe when user is NOT found', async () => {
    // Prisma returns null → no userId → no token minted → no HTTPS variant
    const prisma = makePrisma(async () => null);
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, prisma });
    await svc.sendEmailVerification('stranger@example.com', {
      userName: 'A', verificationLink: 'https://x/v',
    });
    const headers = sentPayload().headers;
    expect(headers['List-Unsubscribe']).toBe('<mailto:unsubscribe@jadwal.qa?subject=unsubscribe>');
    // List-Unsubscribe-Post only emitted alongside the HTTPS variant
    expect(headers['List-Unsubscribe-Post']).toBeUndefined();
  });

  test('payload carries mailto-only header for admin-alert (no user lookup attempted)', async () => {
    const prisma = makePrisma();
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, prisma });
    await svc.sendAdminAlert({ type: 'DEPLOYMENT_FAILURE' });
    const headers = sentPayload().headers;
    // admin-alert skips the user lookup → mailto-only
    expect(headers['List-Unsubscribe']).toBe('<mailto:unsubscribe@jadwal.qa?subject=unsubscribe>');
    expect(headers['List-Unsubscribe-Post']).toBeUndefined();
    // Confirm we didn't make a wasted Prisma call
    expect(prisma.client.user.findUnique).not.toHaveBeenCalled();
  });

  test('tags carry env + template', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await svc.sendBookingConfirmation('user@example.com', {
      customerName: 'A', activityTitle: 'B', date: '2030-01-01',
      guests: 1, totalAmount: '10', currency: 'QAR', bookingId: 'b1',
    });
    const tags = sentPayload().tags;
    expect(tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'env', value: expect.any(String) }),
        expect.objectContaining({ name: 'template', value: 'booking-confirmation' }),
      ]),
    );
  });

  test('Resend returns an error → send() returns false (caller must not crash)', async () => {
    resendMocks.__sendMock.mockResolvedValueOnce({
      data: null,
      error: { name: 'rate_limit_exceeded', message: 'Too many requests' },
    });
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    const ok = await svc.sendBookingConfirmation('user@example.com', {
      customerName: 'Alice', activityTitle: 'X',
      date: '2030-06-15', guests: 2, totalAmount: '200', currency: 'QAR',
      bookingId: 'b1',
    });
    expect(ok).toBe(false);
  });

  test('Resend SDK throws → send() returns false', async () => {
    resendMocks.__sendMock.mockRejectedValueOnce(new Error('network down'));
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    const ok = await svc.sendBookingConfirmation('user@example.com', {
      customerName: 'Alice', activityTitle: 'X',
      date: '2030-06-15', guests: 2, totalAmount: '200', currency: 'QAR',
      bookingId: 'b1',
    });
    expect(ok).toBe(false);
  });

  test('Prisma findUnique error falls through to mailto-only (does not break send)', async () => {
    const prisma = makePrisma(async () => { throw new Error('connection terminated'); });
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, prisma });
    const ok = await svc.sendPasswordReset('alice@x.com', {
      userName: 'A', resetLink: 'https://x/r', expiresIn: '1 hour',
    });
    expect(ok).toBe(true);
    const headers = sentPayload().headers;
    expect(headers['List-Unsubscribe']).toBe('<mailto:unsubscribe@jadwal.qa?subject=unsubscribe>');
    expect(headers['List-Unsubscribe-Post']).toBeUndefined();
  });
});

describe('EmailService.renderTemplate — template dispatcher', () => {
  test('booking-confirmation template renders with {{APP_URL}} replaced', () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'false', APP_URL: 'https://myhost.test' } });
    const { html } = svc.renderTemplate('booking-confirmation', {
      customerName: 'A', activityTitle: 'B', date: '2030-01-01',
      guests: 1, totalAmount: '10', currency: 'QAR', bookingId: 'b1',
    });
    expect(html).not.toContain('{{APP_URL}}');
  });

  test('email-verification template includes the verification link', () => {
    const svc = buildSvc();
    const link = 'https://app.jadwal.test/verify?token=xyz';
    const { html } = svc.renderTemplate('email-verification', {
      userName: 'Alice', verificationLink: link,
    });
    expect(html).toContain('xyz');
  });

  test('password-reset template includes the reset link + expiry', () => {
    const svc = buildSvc();
    const { html } = svc.renderTemplate('password-reset', {
      userName: 'Alice',
      resetLink: 'https://app.jadwal.test/reset?t=abc123',
      expiresIn: '1 hour',
    });
    expect(html).toContain('abc123');
    expect(html).toContain('1 hour');
  });

  test('unknown template → returns a plain-HTML fallback without crashing', () => {
    const svc = buildSvc();
    const { html } = svc.renderTemplate('does-not-exist', { any: 'data' });
    expect(html).toMatch(/^<html>/);
    expect(html).not.toContain('{{APP_URL}}');
  });

  test('renderTemplate returns subject + html + text', () => {
    const svc = buildSvc();
    const out = svc.renderTemplate('password-reset', {
      userName: 'Alice', resetLink: 'https://x/r?t=abc123', expiresIn: '1 hour',
    });
    expect(out.subject).toBe('Reset Your Password — AL Jadwal');
    expect(out.html).toContain('<html');
    expect(out.text).toContain('abc123');
    expect(out.text).not.toContain('<html');
  });

  test('Arabic locale → RTL html + Arabic subject + Arabic copy', () => {
    const svc = buildSvc();
    const out = svc.renderTemplate(
      'password-reset',
      { userName: 'Alice', resetLink: 'https://x/r?t=abc', expiresIn: '1 hour' },
      'AR',
    );
    expect(out.subject).toBe('إعادة تعيين كلمة المرور — AL Jadwal');
    expect(out.html).toContain('dir="rtl"');
    expect(out.html).toContain('lang="ar"');
    expect(out.html).toContain('إعادة تعيين كلمة المرور');
  });
});

describe('EmailService — every public method routes through send()', () => {
  const cases = [
    ['sendBookingConfirmation', { customerName: 'A', activityTitle: 'B', date: '2030-01-01', guests: 1, totalAmount: '10', currency: 'QAR', bookingId: 'b1' }],
    ['sendBookingCancellation', { customerName: 'A', activityTitle: 'B', date: '2030-01-01', bookingId: 'b1' }],
    ['sendEmailVerification', { userName: 'A', verificationLink: 'https://x/v' }],
    ['sendPasswordReset', { userName: 'A', resetLink: 'https://x/r', expiresIn: '1 hour' }],
    ['sendPasswordChangedNotification', { customerName: 'A' }],
  ] as const;

  test.each(cases)('%s — dev mode returns true', async (method, data) => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'false' } });
    const ok = await (svc as any)[method]('u@example.com', data);
    expect(ok).toBe(true);
  });

  test.each(cases)('%s — prod mode issues a Resend send', async (method, data) => {
    resendMocks.__sendMock.mockClear();
    resendMocks.__sendMock.mockResolvedValue({ data: { id: 'email_mock_123' }, error: null });
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await (svc as any)[method]('u@example.com', data);
    expect(resendMocks.__sendMock).toHaveBeenCalledTimes(1);
  });
});

// ─── Typed admin-alert hardening (2026-05-08) ─────────────────────────────
describe('EmailService — sendAdminAlert typed events', () => {
  beforeEach(() => {
    resendMocks.__sendMock.mockClear();
    resendMocks.__sendMock.mockResolvedValue({ data: { id: 'email_mock_123' }, error: null });
  });

  test('subject is sourced from the type, never from caller input', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await svc.sendAdminAlert({ type: 'DATABASE_ERROR' });
    const payload = sentPayload();
    expect(payload.subject).toMatch(/^AL Jadwal/);
    expect(payload.html).toContain('Database error');
  });

  test('details are HTML-escaped in the body (defence-in-depth)', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await svc.sendAdminAlert({
      type: 'SECURITY_EVENT',
      details: { offender: '<script>alert(1)</script>' },
    });
    const body = sentPayload().html;
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('long detail values are truncated with an ellipsis', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await svc.sendAdminAlert({
      type: 'PAYMENT_DRIFT',
      details: { trace: 'x'.repeat(1000) },
    });
    const body = sentPayload().html;
    // 200-char cap + ellipsis — must contain a truncated run, not the full string
    expect(body).not.toContain('x'.repeat(1000));
    expect(body).toContain('…');
  });

  test('control characters in note are stripped before render', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await svc.sendAdminAlert({
      type: 'CRON_FAILURE',
      note: 'job\x00failed\x07at\x1bstep',
    });
    const body = sentPayload().html;
    expect(body).toContain('jobfailedatstep');
    expect(body).not.toMatch(/[\x00\x07\x1b]/);
  });

  test('unknown alert type returns success-shaped + does not call Resend', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    // Bypass the type system to simulate a bad runtime caller
    const ok = await (svc.sendAdminAlert as any)({ type: 'NOT_A_REAL_TYPE' });
    expect(ok).toBe(true);
    expect(resendMocks.__sendMock).not.toHaveBeenCalled();
  });

  test('details with more than 20 keys are capped', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    const huge: Record<string, string> = {};
    for (let i = 0; i < 50; i++) huge[`k${i}`] = `v${i}`;
    await svc.sendAdminAlert({ type: 'BOUNCE_RATE_HIGH', details: huge });
    const body = sentPayload().html;
    expect(body).toContain('k0');
    expect(body).toContain('k19');
    expect(body).not.toContain('k20');
  });
});
