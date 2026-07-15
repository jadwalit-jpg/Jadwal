/**
 * VendorService.getPayoutEligibility / evaluatePayoutEligibility — unit tests.
 *
 * `getPayoutEligibility` is a thin wrapper that calls `resolveVendor` then
 * delegates to the private `evaluatePayoutEligibility`. The two hit
 * `vendor.findUnique` in sequence (resolve → evaluate), so every test
 * queues TWO `findUnique` replies in order.
 *
 * Matrix covered:
 *   - ok:true with `{ available, currency, minimum }` when all checks pass
 *   - VENDOR_SUSPENDED  (via eligibility branch for a vendor that passed resolve but is SUSPENDED)
 *   - INFLIGHT_PENDING  + INFLIGHT_APPROVED
 *   - NO_BANK_DETAILS   (checked after inflight, as documented)
 *   - NO_BALANCE
 *   - BELOW_MINIMUM     with MIN_PAYOUT_AMOUNT env override
 *   - lockedPaymentIds  excludes payments from booking.aggregate via `id.notIn`
 */

import { Test } from '@nestjs/testing';
import { VendorService } from '../../src/vendor/vendor.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationService } from '../../src/common/services/notification.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { AvailabilityCacheService } from '../../src/redis/availability-cache.service';
import { SessionDenylistService } from '../../src/redis/session-denylist.service';
import { makePrismaMock } from '../mocks/prisma.mock';
import {
  makeNotificationMock, makeLoyaltyMock, makeAvailabilityCacheMock,
} from '../mocks/bookings-deps.mock';
import { makeSessionDenylistMock } from '../mocks/auth-deps.mock';

async function buildSut() {
  const prisma = makePrismaMock();
  const notif = makeNotificationMock();
  const loyalty = makeLoyaltyMock();
  const cache = makeAvailabilityCacheMock();

  const mod = await Test.createTestingModule({
    providers: [
      VendorService,
      { provide: PrismaService,             useValue: prisma },
      { provide: NotificationService,       useValue: notif },
      { provide: LoyaltyService,            useValue: loyalty },
      { provide: AvailabilityCacheService,  useValue: cache },
      { provide: SessionDenylistService,    useValue: makeSessionDenylistMock() },
    ],
  }).compile();
  return { sut: mod.get(VendorService), prisma };
}

// Active vendor for resolveVendor (1st findUnique). Evaluate issues its own
// findUnique separately (2nd) with a tighter select — tests queue both.
const resolveRow = { id: 'v1', status: 'ACTIVE' as const, countryId: 'QA', businessNameEn: 'Biz' };
const fullyEligibleRow = {
  status: 'ACTIVE' as const,
  bankDetails: { iban: 'QA00' },
  country: { currencyCode: 'QAR' },
};

describe('VendorService.getPayoutEligibility — happy path', () => {
  test('ok:true with available, currency, minimum when all checks pass', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(resolveRow);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(fullyEligibleRow);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([]);
    ctx.prisma._client.booking.aggregate.mockResolvedValueOnce({
      _sum: { totalPrice: 1000, commissionAmount: 100 },
    });

    const res: any = await ctx.sut.getPayoutEligibility('u1');
    expect(res.ok).toBe(true);
    expect(res.available).toBe(900);
    expect(res.currency).toBe('QAR');
    expect(res.minimum).toBe(10); // default when MIN_PAYOUT_AMOUNT not set
  });

  test('honours MIN_PAYOUT_AMOUNT env override (BELOW_MINIMUM)', async () => {
    const original = process.env.MIN_PAYOUT_AMOUNT;
    process.env.MIN_PAYOUT_AMOUNT = '25';
    try {
      const ctx = await buildSut();
      ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(resolveRow);
      ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(fullyEligibleRow);
      ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
      ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([]);
      // available = 20 (totalPrice 25 - commission 5) — under 25
      ctx.prisma._client.booking.aggregate.mockResolvedValueOnce({
        _sum: { totalPrice: 25, commissionAmount: 5 },
      });

      const res: any = await ctx.sut.getPayoutEligibility('u1');
      expect(res.ok).toBe(false);
      expect(res.code).toBe('BELOW_MINIMUM');
      expect(res.minimum).toBe(25);
      expect(res.available).toBe(20);
    } finally {
      if (original === undefined) delete process.env.MIN_PAYOUT_AMOUNT;
      else process.env.MIN_PAYOUT_AMOUNT = original;
    }
  });
});

describe('VendorService.getPayoutEligibility — blocker codes', () => {
  test('VENDOR_SUSPENDED surfaces via eligibility even when resolveVendor passed', async () => {
    // resolveVendor only blocks SUSPENDED via throw; but the inner
    // evaluate's re-read can catch a vendor that flipped between the two
    // reads — or simply a test with a row that ACTIVE by status but with
    // missing fields. We model that scenario by returning a SUSPENDED row
    // from the 2nd findUnique (the evaluate query).
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(resolveRow);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({
      status: 'SUSPENDED', bankDetails: null, country: { currencyCode: 'QAR' },
    });

    const res: any = await ctx.sut.getPayoutEligibility('u1');
    expect(res.ok).toBe(false);
    expect(res.code).toBe('VENDOR_SUSPENDED');
    expect(res.currency).toBe('QAR');
  });

  test('INFLIGHT_PENDING when a PENDING request exists', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(resolveRow);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(fullyEligibleRow);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce({ id: 'r1', status: 'PENDING' });

    const res: any = await ctx.sut.getPayoutEligibility('u1');
    expect(res.ok).toBe(false);
    expect(res.code).toBe('INFLIGHT_PENDING');
    expect(res.available).toBe(0);
    // Short-circuit — aggregate must not run.
    expect(ctx.prisma._client.booking.aggregate).not.toHaveBeenCalled();
  });

  test('INFLIGHT_APPROVED when an APPROVED request exists', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(resolveRow);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(fullyEligibleRow);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce({ id: 'r1', status: 'APPROVED' });

    const res: any = await ctx.sut.getPayoutEligibility('u1');
    expect(res.ok).toBe(false);
    expect(res.code).toBe('INFLIGHT_APPROVED');
  });

  test('NO_BANK_DETAILS when bankDetails is null (checked AFTER inflight)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(resolveRow);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce({ ...fullyEligibleRow, bankDetails: null });
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);

    const res: any = await ctx.sut.getPayoutEligibility('u1');
    expect(res.ok).toBe(false);
    expect(res.code).toBe('NO_BANK_DETAILS');
    expect(res.message).toMatch(/bank details/i);
  });

  test('NO_BALANCE when aggregate sum is 0', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(resolveRow);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(fullyEligibleRow);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([]);
    ctx.prisma._client.booking.aggregate.mockResolvedValueOnce({
      _sum: { totalPrice: 0, commissionAmount: 0 },
    });

    const res: any = await ctx.sut.getPayoutEligibility('u1');
    expect(res.ok).toBe(false);
    expect(res.code).toBe('NO_BALANCE');
    expect(res.available).toBe(0);
  });
});

describe('VendorService.getPayoutEligibility — lockedPaymentIds filter', () => {
  test('excludes lockedPaymentIds from booking.aggregate via `id: { notIn: [...] }`', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(resolveRow);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(fullyEligibleRow);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    // APPROVED request already locks p1/p2; COMPLETED locks p3.
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([
      { paymentIds: ['p1', 'p2'] },
      { paymentIds: ['p3'] },
    ]);
    ctx.prisma._client.booking.aggregate.mockResolvedValueOnce({
      _sum: { totalPrice: 200, commissionAmount: 20 },
    });

    const res: any = await ctx.sut.getPayoutEligibility('u1');
    expect(res.ok).toBe(true);

    const aggregateCall = ctx.prisma._client.booking.aggregate.mock.calls[0]?.[0];
    expect(aggregateCall.where.payment.id).toEqual({ notIn: ['p1', 'p2', 'p3'] });
  });

  test('does NOT add `id.notIn` when lockedRequests has no paymentIds', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(resolveRow);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(fullyEligibleRow);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([]);
    ctx.prisma._client.booking.aggregate.mockResolvedValueOnce({
      _sum: { totalPrice: 1000, commissionAmount: 100 },
    });

    await ctx.sut.getPayoutEligibility('u1');

    const aggregateCall = ctx.prisma._client.booking.aggregate.mock.calls[0]?.[0];
    // No id.notIn key — the filter is additive, applied only when locked ids exist.
    expect(aggregateCall.where.payment.id).toBeUndefined();
  });

  test('lockedRequests query scopes to APPROVED + COMPLETED only', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(resolveRow);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(fullyEligibleRow);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([]);
    ctx.prisma._client.booking.aggregate.mockResolvedValueOnce({
      _sum: { totalPrice: 1000, commissionAmount: 100 },
    });

    await ctx.sut.getPayoutEligibility('u1');

    // `findFirst` is the inflight check (PENDING/APPROVED).
    // `findMany` is the lockedRequests fetch (APPROVED/COMPLETED).
    expect(ctx.prisma._client.payoutRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['APPROVED', 'COMPLETED'] },
        }),
      }),
    );
  });
});

describe('VendorService.getPayoutEligibility — regression', () => {
  test('blocker responses still include currency from vendor country', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(resolveRow);
    ctx.prisma._client.vendor.findUnique.mockResolvedValueOnce(fullyEligibleRow);
    ctx.prisma._client.payoutRequest.findFirst.mockResolvedValueOnce({ status: 'PENDING' });

    const res: any = await ctx.sut.getPayoutEligibility('u1');
    expect(res.ok).toBe(false);
    expect(res.currency).toBe('QAR');
  });
});
