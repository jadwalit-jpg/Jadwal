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
