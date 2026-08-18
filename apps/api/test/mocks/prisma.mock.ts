/**
 * Lightweight Prisma mock — provides a `client` property with every model
 * expected by the services under test, each method as a jest.fn().
 *
 * Designed to be permissive: any call resolves to `undefined` unless
 * `.mockResolvedValueOnce(...)` is set in the test. Tests should set
 * expectations on the fly per-case.
 */

type AnyFn = jest.Mock;

function makeModel(): Record<string, AnyFn> {
  return {
    findUnique:       jest.fn().mockResolvedValue(null),
    findUniqueOrThrow:jest.fn(),
    findFirst:        jest.fn().mockResolvedValue(null),
    findFirstOrThrow: jest.fn(),
    findMany:         jest.fn().mockResolvedValue([]),
    create:           jest.fn().mockResolvedValue({}),
    createMany:       jest.fn().mockResolvedValue({ count: 0 }),
    update:           jest.fn().mockResolvedValue({}),
    updateMany:       jest.fn().mockResolvedValue({ count: 0 }),
    upsert:           jest.fn().mockResolvedValue({}),
    delete:           jest.fn().mockResolvedValue({}),
    deleteMany:       jest.fn().mockResolvedValue({ count: 0 }),
    count:            jest.fn().mockResolvedValue(0),
    aggregate:        jest.fn().mockResolvedValue({}),
    groupBy:          jest.fn().mockResolvedValue([]),
  };
}

export function makePrismaMock() {
  const client: Record<string, Record<string, AnyFn>> = {
    user:              makeModel(),
    vendor:            makeModel(),
    activity:          makeModel(),
    activityBlock:     makeModel(),
    activitySpecialPrice: makeModel(),
    booking:           makeModel(),
    payment:           makeModel(),
    review:            makeModel(),
    like:              makeModel(),
    coupon:            makeModel(),
    claimedCoupon:     makeModel(),
    notification:      makeModel(),
    pushSubscription:  makeModel(),
    auditLog:          makeModel(),
    securityLog:       makeModel(),
    refreshToken:      makeModel(),
    loyaltyConfig:     makeModel(),
    loyaltyLedger:     makeModel(),
    platformSettings:  makeModel(),
    payoutRequest:     makeModel(),
    trendingEvent:     makeModel(),
    country:           makeModel(),
    city:              makeModel(),
    category:          makeModel(),
  };

  // $transaction passthrough — resolves the callback with a mock tx
  const $transaction = jest.fn(async (arg: unknown, _opts?: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof client) => Promise<unknown>)(client);
    }
    // array of promises → resolve in parallel
    return Promise.all(arg as Promise<unknown>[]);
  });

  return {
    client: { ...client, $transaction },
    $transaction,
    // Expose raw model mocks for per-test assertions
    _client: client,
  };
}

export type MockPrismaService = ReturnType<typeof makePrismaMock>;

/**
 * Wrap a plain number as a minimal `Prisma.Decimal`-shaped stub for test
 * fixtures. Prisma's Decimal fields (e.g. `LoyaltyConfig.qarPerPoint`)
 * return a Decimal object at runtime, and services call `.toNumber()` on
 * it. Tests that pre-seed the mock with a plain number would otherwise
 * crash with "toNumber is not a function".
 *
 * Matches the subset of the Decimal API the app actually uses. Do NOT use
 * for arithmetic (no `.add`/`.mul`) — tests should exercise the service
 * boundary that calls `.toNumber()`, not Decimal math itself.
 */
export function mockDecimal(n: number) {
  return {
    toNumber: () => n,
    valueOf: () => n,
    toString: () => String(n),
    toFixed: (d?: number) => n.toFixed(d ?? 0),
  };
}
