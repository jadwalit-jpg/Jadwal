// Unit tests for the PrismaService Secrets-Manager bootstrap path and the
// P1000 single-flight reconnect. These cover failure modes the integration
// suite cannot easily reach (Secrets Manager rejecting, malformed JSON,
// concurrent reconnects collapsing to one SDK call).
//
// Mock strategy: stub the AWS SDK, the pg Pool, and PrismaClient so we exercise
// PrismaService logic without any network or filesystem dependency.

// ── @aws-sdk/client-secrets-manager ──────────────────────────────────────
const sendMock = jest.fn();
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({ send: sendMock })),
  GetSecretValueCommand: jest.fn().mockImplementation((args: any) => ({ ...args, _cmd: 'GetSecretValue' })),
}));

// ── pg Pool ──────────────────────────────────────────────────────────────
const poolEndMock = jest.fn().mockResolvedValue(undefined);
const poolOnMock = jest.fn();
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    on: poolOnMock,
    end: poolEndMock,
  })),
}));

// ── @prisma/adapter-pg ───────────────────────────────────────────────────
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}));

// ── @prisma/client ───────────────────────────────────────────────────────
const prismaConnectMock = jest.fn().mockResolvedValue(undefined);
const prismaDisconnectMock = jest.fn().mockResolvedValue(undefined);
// $extends was added when O2 slow-query middleware landed. Mock returns
// `this` so the extended-client cast preserves $connect / $disconnect.
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(function (this: object) {
    const self = this as {
      $connect: typeof prismaConnectMock;
      $disconnect: typeof prismaDisconnectMock;
      $extends: jest.Mock;
    };
    self.$connect = prismaConnectMock;
    self.$disconnect = prismaDisconnectMock;
    // Return-self preserves the same mock methods on the "extended" client;
    // matches what real Prisma does (the extended client is a Proxy that
    // delegates back to the original for unchanged operations).
    self.$extends = jest.fn().mockReturnValue(self);
    return self;
  }),
  Prisma: {},
}));

// ── fs ───────────────────────────────────────────────────────────────────
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue(Buffer.from('FAKE-CA-PEM')),
}));

// Lazy import after mocks are registered
const { PrismaService } = require('../../src/prisma/prisma.service');

const REAL_SECRET_JSON = JSON.stringify({ username: 'jadwaladmin', password: 'pw-with-/at@:reserved!' });

describe('PrismaService — Secrets Manager + P1000 reconnect', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.NODE_ENV = 'test';
    delete process.env.DATABASE_URL;
    delete process.env.RDS_SECRET_ARN;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // ── 1. Bootstrap with RDS_SECRET_ARN set: SDK call, URL built from secret
  it('reads {username, password} from Secrets Manager when RDS_SECRET_ARN is set', async () => {
    process.env.RDS_SECRET_ARN = 'arn:aws:secretsmanager:eu-central-1:123:secret:rds!x';
    process.env.DB_HOST = 'jadwal-prod.example.rds.amazonaws.com';
    process.env.DB_PORT = '5432';
    process.env.DB_NAME = 'postgres';
    sendMock.mockResolvedValueOnce({ SecretString: REAL_SECRET_JSON });

    const svc = new PrismaService();
    await svc.onModuleInit();

    expect(sendMock).toHaveBeenCalledTimes(1);
    // Confirm Pool was constructed with a URL containing URL-encoded credentials
    // — the test password has reserved chars (/@:!) that must be escaped.
    const { Pool } = require('pg');
    const callArg = (Pool as jest.Mock).mock.calls[0][0];
    expect(callArg.connectionString).toContain('jadwaladmin');
    expect(callArg.connectionString).toContain('pw-with-%2Fat%40%3Areserved!');
    expect(callArg.connectionString).toContain('jadwal-prod.example.rds.amazonaws.com:5432/postgres');
    // SSL must be on for an RDS host.
    expect(callArg.ssl).toBeDefined();
    expect(callArg.ssl.rejectUnauthorized).toBe(true);
  });

  // ── 2. Bootstrap legacy DATABASE_URL path (no Secrets Manager)
  it('falls back to DATABASE_URL when RDS_SECRET_ARN is absent', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/jadwal';

    const svc = new PrismaService();
    await svc.onModuleInit();

    // No SDK call.
    expect(sendMock).not.toHaveBeenCalled();
    // SSL must be OFF for localhost (LOCAL_DEV_DB_HOSTS allowlist).
    const { Pool } = require('pg');
    const callArg = (Pool as jest.Mock).mock.calls[0][0];
    expect(callArg.connectionString).toBe('postgresql://u:p@localhost:5432/jadwal');
    expect(callArg.ssl).toBeUndefined();
  });

  // ── 3. Malformed secret JSON → fail-secure (throw on bootstrap)
  it('throws when Secrets Manager returns non-JSON SecretString', async () => {
    process.env.RDS_SECRET_ARN = 'arn:x';
    process.env.DB_HOST = 'h';
    process.env.DB_NAME = 'd';
    sendMock.mockResolvedValueOnce({ SecretString: 'not-json{' });

    const svc = new PrismaService();
    await expect(svc.onModuleInit()).rejects.toThrow(/not valid JSON/);
  });

  // ── 4. Empty SecretString → fail-secure
  it('throws when SecretString is missing or empty', async () => {
    process.env.RDS_SECRET_ARN = 'arn:x';
    process.env.DB_HOST = 'h';
    process.env.DB_NAME = 'd';
    sendMock.mockResolvedValueOnce({ SecretString: undefined });

    const svc = new PrismaService();
    await expect(svc.onModuleInit()).rejects.toThrow(/no SecretString/);
  });

  // ── 5. Missing username/password fields → fail-secure
  it('throws when secret JSON is missing username or password', async () => {
    process.env.RDS_SECRET_ARN = 'arn:x';
    process.env.DB_HOST = 'h';
    process.env.DB_NAME = 'd';
    sendMock.mockResolvedValueOnce({ SecretString: JSON.stringify({ username: 'u' }) });

    const svc = new PrismaService();
    await expect(svc.onModuleInit()).rejects.toThrow(/missing username\/password/);
  });

  // ── 6. Missing DB_HOST when RDS_SECRET_ARN set → fail-secure
  it('throws when RDS_SECRET_ARN is set but DB_HOST is missing', async () => {
    process.env.RDS_SECRET_ARN = 'arn:x';
    process.env.DB_NAME = 'd';
    // DB_HOST intentionally unset.

    const svc = new PrismaService();
    await expect(svc.onModuleInit()).rejects.toThrow(/DB_HOST is required/);
    // No SDK call should have happened — env validation runs before fetch.
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ── 7. Neither RDS_SECRET_ARN nor DATABASE_URL → fail-secure
  it('throws when neither RDS_SECRET_ARN nor DATABASE_URL is set', async () => {
    const svc = new PrismaService();
    await expect(svc.onModuleInit()).rejects.toThrow(/Either RDS_SECRET_ARN or DATABASE_URL/);
  });

  // ── 8. refreshOnAuthError single-flight: 5 concurrent calls → 1 SDK call
  it('collapses concurrent refreshOnAuthError calls into one SDK fetch', async () => {
    // Fake timers so the 5 s drain-old-pool setTimeout inside reconnect doesn't
    // leak as an open handle into the next test (Jest --detectOpenHandles).
    jest.useFakeTimers();
    process.env.RDS_SECRET_ARN = 'arn:x';
    process.env.DB_HOST = 'h';
    process.env.DB_NAME = 'd';
    // First call (bootstrap)
    sendMock.mockResolvedValueOnce({ SecretString: REAL_SECRET_JSON });
    // Single second call for the swarm (single-flight) — but provide more
    // mock responses defensively in case the test fails the assertion.
    sendMock.mockResolvedValueOnce({ SecretString: REAL_SECRET_JSON });
    sendMock.mockResolvedValueOnce({ SecretString: REAL_SECRET_JSON });

    const svc = new PrismaService();
    await svc.onModuleInit();
    expect(sendMock).toHaveBeenCalledTimes(1);

    // Fire 5 concurrent refresh requests. All should resolve, but only ONE
    // additional SDK call (total 2) should have happened.
    await Promise.all([
      svc.refreshOnAuthError(),
      svc.refreshOnAuthError(),
      svc.refreshOnAuthError(),
      svc.refreshOnAuthError(),
      svc.refreshOnAuthError(),
    ]);

    expect(sendMock).toHaveBeenCalledTimes(2);

    // Advance past the 5 s drain timer so it fires + cleans up before we
    // restore real timers.
    jest.runAllTimers();
    jest.useRealTimers();
  });

  // ── 9. Sequential refreshOnAuthError → 2 SDK calls (single-flight resets)
  it('allows a fresh fetch on a NEW rotation event after the previous one settled', async () => {
    jest.useFakeTimers();
    process.env.RDS_SECRET_ARN = 'arn:x';
    process.env.DB_HOST = 'h';
    process.env.DB_NAME = 'd';
    sendMock.mockResolvedValue({ SecretString: REAL_SECRET_JSON });

    const svc = new PrismaService();
    await svc.onModuleInit();
    expect(sendMock).toHaveBeenCalledTimes(1);

    await svc.refreshOnAuthError();
    expect(sendMock).toHaveBeenCalledTimes(2);

    await svc.refreshOnAuthError();
    expect(sendMock).toHaveBeenCalledTimes(3);

    jest.runAllTimers();
    jest.useRealTimers();
  });
});
