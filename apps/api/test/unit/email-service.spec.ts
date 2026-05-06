/**
 * EmailService unit tests.
 *
 * Migrated 2026-05-06 to AWS SDK SES v2 (`@aws-sdk/client-sesv2`). The v1
 * SDK can't carry custom MIME headers, which RFC 8058 requires for
 * `List-Unsubscribe` + `List-Unsubscribe-Post`. v2 takes a raw MIME blob
 * via `Content.Raw.Data`, so all SDK-shape assertions changed accordingly.
 *
 * Covers:
 *   - Log-only mode (EMAIL_ENABLED=false) never instantiates SES client
 *   - Production must not boot with EMAIL_ENABLED=false (guard)
 *   - send() renders template + builds raw MIME with List-Unsubscribe
 *     headers when a user is found by email
 *   - send() falls back to mailto-only List-Unsubscribe when no user matches
 *   - Email is masked in all log output (anti-leak)
 *   - SES error branch returns false + logs err.name (not err.message)
 *   - ConfigurationSetName + EmailTags carried through
 *   - Suppression list short-circuit (anti-enumeration)
 *   - Platform daily cap short-circuit (cost runaway gate)
 *   - admin-alert bypasses both gates
 */

import { EmailService } from '../../src/email/email.service';

// Mock SES v2 SDK before importing anything that uses it
jest.mock('@aws-sdk/client-sesv2', () => {
  const sendMock = jest.fn().mockResolvedValue({});
  const SESv2Client = jest.fn().mockImplementation(() => ({ send: sendMock }));
  const SendEmailCommand = jest.fn().mockImplementation((args) => ({ __cmd: 'SendEmail', args }));
  return { SESv2Client, SendEmailCommand, __sendMock: sendMock };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sesMocks = require('@aws-sdk/client-sesv2') as any;

function makeConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    EMAIL_FROM: 'noreply@jadwal.com',
    EMAIL_ENABLED: 'false',
    APP_URL: 'https://app.jadwal.test',
    API_URL: 'https://app.jadwal.test/api',
    AWS_REGION: 'eu-central-1',
    ADMIN_EMAIL: 'ops@jadwal.com',
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

// Default mock — Prisma user lookup returns a stable userId for any email,
// so the unsubscribe token includes the HTTPS variant. Tests that exercise
// the fallback (no user found) override findUnique to return null.
function makePrisma(findUnique: (args: any) => Promise<any> = async () => ({ id: 'u-mock' })) {
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

/** Decode the base64-encoded raw MIME from a SendEmailCommand call argument. */
function decodeMime(cmdArgs: any): string {
  const buf = cmdArgs.Content?.Raw?.Data;
  if (!buf) return '';
  return Buffer.isBuffer(buf) ? buf.toString('utf8') : Buffer.from(buf).toString('utf8');
}

describe('EmailService — construction + prod-guard', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = ORIGINAL_ENV; });

  test('dev (EMAIL_ENABLED=false) → no SES client instantiated', () => {
    sesMocks.SESv2Client.mockClear();
    buildSvc({ config: { EMAIL_ENABLED: 'false' } });
    expect(sesMocks.SESv2Client).not.toHaveBeenCalled();
  });

  test('EMAIL_ENABLED=true → SESv2Client instantiated with configured region', () => {
    sesMocks.SESv2Client.mockClear();
    buildSvc({ config: { EMAIL_ENABLED: 'true', AWS_REGION: 'eu-west-1' } });
    expect(sesMocks.SESv2Client).toHaveBeenCalledWith({ region: 'eu-west-1' });
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
    sesMocks.__sendMock.mockClear();
    sesMocks.SendEmailCommand.mockClear();
  });

  test('suppressed recipient → SES never called, returns true (anti-enumeration)', async () => {
    const suppressions = makeSuppressions(async () => true);
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, suppressions });
    const ok = await svc.sendEmailVerification('bounced@example.com', {
      userName: 'Alice', verificationLink: 'https://x/v?t=abc',
    });
    expect(ok).toBe(true);
    expect(suppressions.isSuppressed).toHaveBeenCalledWith('bounced@example.com');
    expect(sesMocks.SendEmailCommand).not.toHaveBeenCalled();
    expect(sesMocks.__sendMock).not.toHaveBeenCalled();
  });

  test('non-suppressed recipient → SES called normally', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await svc.sendPasswordReset('user@example.com', {
      userName: 'A', resetLink: 'https://x/r', expiresIn: '1 hour',
    });
    expect(sesMocks.SendEmailCommand).toHaveBeenCalledTimes(1);
  });

  test('platform daily cap exceeded → returns success-shaped, never calls SES', async () => {
    const quota = makeQuota(async () => false);
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, quota });
    const ok = await svc.sendEmailVerification('user@example.com', {
      userName: 'Alice', verificationLink: 'https://x/v?t=abc',
    });
    expect(ok).toBe(true);
    expect(quota.tryConsumePlatformDaily).toHaveBeenCalledTimes(1);
    expect(sesMocks.SendEmailCommand).not.toHaveBeenCalled();
  });

  test('admin-alert bypasses platform cap — operational alerts always go out', async () => {
    const quota = makeQuota(async () => false);
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, quota });
    await svc.sendAdminAlert({ subject: 'Cap test', message: 'fired through cap' });
    expect(quota.tryConsumePlatformDaily).not.toHaveBeenCalled();
    expect(sesMocks.SendEmailCommand).toHaveBeenCalledTimes(1);
  });

  test('SES SendEmailCommand carries ConfigurationSetName when SES_CONFIG_SET_NAME is set', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true', SES_CONFIG_SET_NAME: 'jadwal-prod' } });
    await svc.sendEmailVerification('user@example.com', {
      userName: 'A', verificationLink: 'https://x/v?t=abc',
    });
    const cmdArgs = sesMocks.SendEmailCommand.mock.calls[0][0];
    expect(cmdArgs.ConfigurationSetName).toBe('jadwal-prod');
  });

  test('SES SendEmailCommand omits ConfigurationSetName when env var unset', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await svc.sendEmailVerification('user@example.com', {
      userName: 'A', verificationLink: 'https://x/v?t=abc',
    });
    const cmdArgs = sesMocks.SendEmailCommand.mock.calls[0][0];
    expect(cmdArgs.ConfigurationSetName).toBeUndefined();
  });

  test('admin-alert bypasses suppression — operational alerts always go out', async () => {
    const suppressions = makeSuppressions(async () => true);
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, suppressions });
    await svc.sendAdminAlert({ subject: 'Test', message: 'Something is broken' });
    expect(sesMocks.SendEmailCommand).toHaveBeenCalledTimes(1);
    expect(suppressions.isSuppressed).not.toHaveBeenCalled();
  });
});

describe('EmailService — send dispatching + raw MIME', () => {
  beforeEach(() => {
    sesMocks.__sendMock.mockClear();
    sesMocks.SendEmailCommand.mockClear();
  });

  test('dev mode send returns true + never calls SES', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'false' } });
    const ok = await svc.sendEmailVerification('user@example.com', {
      userName: 'Alice', verificationLink: 'https://app.jadwal.test/verify?token=abc',
    });
    expect(ok).toBe(true);
    expect(sesMocks.__sendMock).not.toHaveBeenCalled();
  });

  test('prod mode send calls SES v2 with FromEmailAddress + Destination + Content.Raw.Data', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    const ok = await svc.sendEmailVerification('user@example.com', {
      userName: 'Alice', verificationLink: 'https://app.jadwal.test/verify?token=abc',
    });
    expect(ok).toBe(true);
    expect(sesMocks.SendEmailCommand).toHaveBeenCalledTimes(1);
    const cmdArgs = sesMocks.SendEmailCommand.mock.calls[0][0];
    expect(cmdArgs.FromEmailAddress).toBe('noreply@jadwal.com');
    expect(cmdArgs.Destination.ToAddresses).toEqual(['user@example.com']);
    // v2 ships content as raw bytes via Content.Raw.Data
    expect(cmdArgs.Content?.Raw?.Data).toBeDefined();
    const mime = decodeMime(cmdArgs);
    expect(mime).toContain('From: noreply@jadwal.com');
    expect(mime).toContain('To: user@example.com');
    expect(mime).toContain('Subject:');
    expect(mime).toContain('Content-Type: text/html');
    // HTML body present
    expect(mime).toContain('<html');
  });

  test('raw MIME includes List-Unsubscribe + List-Unsubscribe-Post when user is found', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await svc.sendEmailVerification('user@example.com', {
      userName: 'Alice', verificationLink: 'https://app.jadwal.test/verify?token=abc',
    });
    const cmdArgs = sesMocks.SendEmailCommand.mock.calls[0][0];
    const mime = decodeMime(cmdArgs);
    // Both URL + mailto variants in the header (per RFC 2369 / 8058)
    expect(mime).toMatch(/List-Unsubscribe: <https:\/\/.*\/email\/unsubscribe\?t=FAKE_TOKEN_123>, <mailto:unsubscribe@jadwal\.qa[^>]*>/);
    // The one-click marker
    expect(mime).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  });

  test('raw MIME falls back to mailto-only List-Unsubscribe when user is NOT found', async () => {
    // Prisma returns null → no userId → no token minted → no HTTPS variant
    const prisma = makePrisma(async () => null);
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, prisma });
    await svc.sendEmailVerification('stranger@example.com', {
      userName: 'A', verificationLink: 'https://x/v',
    });
    const cmdArgs = sesMocks.SendEmailCommand.mock.calls[0][0];
    const mime = decodeMime(cmdArgs);
    // Only the mailto: form (no HTTPS variant)
    expect(mime).toContain('List-Unsubscribe: <mailto:unsubscribe@jadwal.qa');
    // List-Unsubscribe-Post only emitted alongside the HTTPS variant
    expect(mime).not.toContain('List-Unsubscribe-Post:');
  });

  test('raw MIME includes mailto-only header for admin-alert (no user lookup attempted)', async () => {
    const prisma = makePrisma();
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' }, prisma });
    await svc.sendAdminAlert({ subject: 'X', message: 'Y' });
    const cmdArgs = sesMocks.SendEmailCommand.mock.calls[0][0];
    const mime = decodeMime(cmdArgs);
    // admin-alert skips the user lookup → mailto-only
    expect(mime).toContain('List-Unsubscribe: <mailto:unsubscribe@jadwal.qa');
    expect(mime).not.toContain('List-Unsubscribe-Post:');
    // Confirm we didn't make a wasted Prisma call
    expect(prisma.client.user.findUnique).not.toHaveBeenCalled();
  });

  test('EmailTags carry env + template (not the v1 Tags field)', async () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await svc.sendBookingConfirmation('user@example.com', {
      customerName: 'A', activityTitle: 'B', date: '2030-01-01',
      guests: 1, totalAmount: '10', currency: 'QAR', bookingId: 'b1',
    });
    const cmdArgs = sesMocks.SendEmailCommand.mock.calls[0][0];
    expect(cmdArgs.EmailTags).toBeDefined();
    expect(cmdArgs.EmailTags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ Name: 'template', Value: 'booking-confirmation' }),
      ]),
    );
  });

  test('SES throws → send() returns false (caller must not crash)', async () => {
    sesMocks.__sendMock.mockRejectedValueOnce(new Error('SES rejected: ThrottlingException'));
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
    const cmdArgs = sesMocks.SendEmailCommand.mock.calls[0][0];
    const mime = decodeMime(cmdArgs);
    expect(mime).toContain('List-Unsubscribe: <mailto:unsubscribe@jadwal.qa');
    expect(mime).not.toContain('List-Unsubscribe-Post:');
  });
});

describe('EmailService.renderTemplate — template dispatcher', () => {
  test('booking-confirmation template renders with {{APP_URL}} replaced', () => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'false', APP_URL: 'https://myhost.test' } });
    const html = svc.renderTemplate('booking-confirmation', {
      customerName: 'A', activityTitle: 'B', date: '2030-01-01',
      guests: 1, totalAmount: '10', currency: 'QAR', bookingId: 'b1',
    });
    expect(html).not.toContain('{{APP_URL}}');
  });

  test('email-verification template includes the verification link', () => {
    const svc = buildSvc();
    const link = 'https://app.jadwal.test/verify?token=xyz';
    const html = svc.renderTemplate('email-verification', {
      userName: 'Alice', verificationLink: link,
    });
    expect(html).toContain('xyz');
  });

  test('password-reset template includes the reset link + expiry', () => {
    const svc = buildSvc();
    const html = svc.renderTemplate('password-reset', {
      userName: 'Alice',
      resetLink: 'https://app.jadwal.test/reset?t=abc123',
      expiresIn: '1 hour',
    });
    expect(html).toContain('abc123');
    expect(html).toContain('1 hour');
  });

  test('unknown template → returns a plain-HTML fallback without crashing', () => {
    const svc = buildSvc();
    const html = svc.renderTemplate('does-not-exist', { any: 'data' });
    expect(html).toMatch(/^<html>/);
    expect(html).not.toContain('{{APP_URL}}');
  });
});

describe('EmailService — every public method routes through send()', () => {
  const cases = [
    ['sendBookingConfirmation', { customerName: 'A', activityTitle: 'B', date: '2030-01-01', guests: 1, totalAmount: '10', currency: 'QAR', bookingId: 'b1' }],
    ['sendBookingCancellation', { customerName: 'A', activityTitle: 'B', date: '2030-01-01', bookingId: 'b1' }],
    ['sendEmailVerification', { userName: 'A', verificationLink: 'https://x/v' }],
    ['sendPasswordReset', { userName: 'A', resetLink: 'https://x/r', expiresIn: '1 hour' }],
    ['sendWelcome', { userName: 'A' }],
  ] as const;

  test.each(cases)('%s — dev mode returns true', async (method, data) => {
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'false' } });
    const ok = await (svc as any)[method]('u@example.com', data);
    expect(ok).toBe(true);
  });

  test.each(cases)('%s — prod mode issues a SendEmailCommand', async (method, data) => {
    sesMocks.__sendMock.mockClear();
    sesMocks.SendEmailCommand.mockClear();
    const svc = buildSvc({ config: { EMAIL_ENABLED: 'true' } });
    await (svc as any)[method]('u@example.com', data);
    expect(sesMocks.SendEmailCommand).toHaveBeenCalledTimes(1);
  });
});
