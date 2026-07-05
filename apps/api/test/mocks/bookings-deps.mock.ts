/**
 * Mock factories for BookingsService dependencies beyond Prisma + Config.
 */

export function makeAuditLoggerMock() {
  return {
    log:          jest.fn().mockResolvedValue(undefined),
    logAuthEvent: jest.fn().mockResolvedValue(undefined),
  };
}

export function makeNotificationMock() {
  return {
    send:         jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
  };
}

export function makeLoyaltyMock() {
  return {
    getConfig:      jest.fn().mockResolvedValue({
      id: 'singleton', pointsPerQar: 1, qarPerPoint: 0.1, enabled: true,
    }),
    earnPoints:     jest.fn().mockResolvedValue(undefined),
    redeemPoints:  jest.fn().mockResolvedValue(undefined),
    refundPoints:  jest.fn().mockResolvedValue(undefined),
    adjustBalance: jest.fn().mockResolvedValue(undefined),
    // Points are QAR-denominated (1 pt = 1 QAR): earn on cash basis, round to
    // 2 dp (mirrors the real LoyaltyService.computeEarnedPoints).
    computeEarnedPoints: jest.fn((total: number, discount: number, rate: number) =>
      rate <= 0 ? 0 : Math.round(Math.max(0, total - discount) * rate * 100) / 100,
    ),
  };
}

export function makeRedisLockMock() {
  return {
    acquire:       jest.fn().mockResolvedValue('lock-token-1'),
    release:       jest.fn().mockResolvedValue(undefined),
  };
}

export function makeAvailabilityCacheMock() {
  return {
    get:              jest.fn().mockResolvedValue(null),
    set:              jest.fn().mockResolvedValue(undefined),
    invalidate:       jest.fn().mockResolvedValue(undefined),
    invalidateMany:   jest.fn().mockResolvedValue(undefined),
  };
}

// C1: ReferenceDataCacheService — wraps origin-side Redis cache for
// countries / categories / cities / platform-info. Mock returns null
// on get (force DB path) + no-ops set/invalidate so tests exercise
// the un-cached code path by default. Specs that care about the
// cache layer override per-test.
export function makeReferenceDataCacheMock() {
  return {
    get:        jest.fn().mockResolvedValue(null),
    set:        jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
  };
}
