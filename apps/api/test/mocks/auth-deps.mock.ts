/**
 * Mock factories for AuthService dependencies.
 * Each returns a fresh jest mock per test (call in beforeEach).
 */

export function makeJwtMock() {
  return {
    sign:   jest.fn((payload: unknown) => `signed.${JSON.stringify(payload)}.token`),
    verify: jest.fn(),
    decode: jest.fn(),
  };
}

export function makeConfigMock(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    JWT_EXPIRATION:            '900',        // 15 min
    REFRESH_TOKEN_EXPIRY_DAYS: '7',
    LOCKOUT_THRESHOLD:         '5',
    LOCKOUT_DURATION_MINUTES:  '15',
    NODE_ENV:                  'test',
    FRONTEND_URL:              'http://localhost:3000',
    MAX_SESSIONS_PER_USER:     '5',
  };
  const merged = { ...defaults, ...overrides };
  return {
    get: jest.fn((key: string, fallback?: string) => merged[key] ?? fallback),
    getOrThrow: jest.fn((key: string) => {
      const v = merged[key];
      if (v === undefined) throw new Error(`Config key missing: ${key}`);
      return v;
    }),
  };
}

export function makeUsersMock() {
  return {
    findByEmail:  jest.fn(),
    findById:     jest.fn(),
    create:       jest.fn(),
    update:       jest.fn(),
  };
}

export function makeSecurityLoggerMock() {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

export function makeAuditLoggerMock() {
  return {
    logAuthEvent: jest.fn().mockResolvedValue(undefined),
    log:          jest.fn().mockResolvedValue(undefined),
  };
}

export function makeEmailMock() {
  return {
    sendEmailVerification:        jest.fn().mockResolvedValue(undefined),
    sendPasswordReset:            jest.fn().mockResolvedValue(undefined),
    sendBookingConfirmation:      jest.fn().mockResolvedValue(undefined),
    sendBookingCancellation:      jest.fn().mockResolvedValue(undefined),
    sendVendorWelcome:            jest.fn().mockResolvedValue(undefined),
    sendPasswordChangedNotification: jest.fn().mockResolvedValue(undefined),
    sendAccountExistsNotification: jest.fn().mockResolvedValue(undefined),
  };
}

// EmailQuotaService — defaults to "always allowed" so existing tests
// that don't care about quota behaviour pass through unchanged. Specs
// that exercise the quota path can override the return value per test.
export function makeEmailQuotaMock() {
  return {
    tryConsume:                jest.fn().mockResolvedValue(true),
    tryConsumePerIp:           jest.fn().mockResolvedValue(true),
    tryConsumePlatformDaily:   jest.fn().mockResolvedValue(true),
    // Default: no cooldown active (0 seconds remaining). Specs exercising
    // the resend-verification 429 path override this per-test to return a
    // positive value (e.g. 60 → "wait ~1 min").
    getCooldownRemainingSec:   jest.fn().mockResolvedValue(0),
  };
}

export function makeNotificationMock() {
  return {
    send:         jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
  };
}

// Minimal Redis mock — backs the G1 (per-account login counter) and G6
// (forgot-password per-recipient cooldown) features. Defaults to "key not
// previously set" + counter-from-zero so tests don't trip rate limits or
// cooldown unless they explicitly want to exercise those branches.
export function makeRedisMock() {
  const store = new Map<string, string | number>();
  const client = {
    incr: jest.fn(async (key: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    }),
    // eval — simulates the G1 atomic Lua script (INCR + EXPIRE on first
    // set). We don't parse the actual script body; we just bump the counter
    // for the key and trust call sites pass the canonical pattern.
    // Mirrors the real ioredis eval signature: (script, numKeys, ...keysThenArgs).
    eval: jest.fn(async (_script: string, _numKeys: number, key: string, _ttlSec: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    }),
    expire: jest.fn().mockResolvedValue(1),
    del:    jest.fn(async (key: string) => { store.delete(key); return 1; }),
    // Store the value so SET/GET round-trips (M5 denylist markers rely on this).
    // TTL args (PX/EX …) are accepted and ignored — tests don't need real expiry.
    set:    jest.fn(async (key: string, value: string | number) => { store.set(key, value); return 'OK'; }),
    get:    jest.fn(async (key: string) => store.get(key)?.toString() ?? null),
    _store: store, // exposed so tests can prime state if needed
  };
  return {
    getClient: jest.fn(() => client as unknown),
    _client:   client,
  };
}

// M5/M6 session-family denylist. Functional in-memory stub: denylistSession
// records the family so isDenied() reflects it (lets a test assert an access
// token is rejected right after that session is revoked). denylistAllUserSessions
// / denylistUserSessionsExcept are no-ops here (their "kill all sessions" effect
// is asserted at the DB level by the existing suites); the dedicated
// session-family spec builds a REAL SessionDenylistService when it needs the
// full DB-backed behaviour. `_denied` is exposed so tests can prime/inspect.
export function makeSessionDenylistMock() {
  const denied = new Set<string>();
  return {
    _denied: denied,
    denylistSession: jest.fn(async (familyId?: string | null) => {
      if (familyId) denied.add(familyId);
    }),
    denylistAllUserSessions: jest.fn().mockResolvedValue(undefined),
    denylistUserSessionsExcept: jest.fn().mockResolvedValue(undefined),
    isDenied: jest.fn(async (familyId?: string | null) => !!familyId && denied.has(familyId)),
  };
}

export function makeResponseMock() {
  return {
    cookie:      jest.fn(),
    clearCookie: jest.fn(),
    redirect:    jest.fn(),
    status:      jest.fn().mockReturnThis(),
    json:        jest.fn(),
  };
}

export function makeRequestMock(overrides: Partial<{ ip: string; headers: Record<string, string>; socket: { remoteAddress: string } }> = {}) {
  return {
    ip:      overrides.ip ?? '127.0.0.1',
    headers: overrides.headers ?? {},
    socket:  overrides.socket ?? { remoteAddress: '127.0.0.1' },
  };
}
