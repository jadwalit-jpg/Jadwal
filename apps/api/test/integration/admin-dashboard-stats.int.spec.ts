/**
 * AdminService.getDashboardStats — every KPI, pinned against a hand-computed
 * dataset.
 *
 * WHY THIS EXISTS
 * ---------------
 * The dashboard runs ~15 aggregates in parallel. Three of them read the SAME
 * bookings (paid, inside the window) and each sums a different column, so they
 * can be one query. A refactor like that is safe only if nobody can swap two
 * columns, drop the payment filter or lose the window by accident — and the one
 * pre-existing test (points-visibility) covers a single Wanasa booking where
 * most of the columns are 0 and cannot tell one column from another.
 *
 * So every money column here carries a DIFFERENT value, and the dataset has a
 * row for each way a booking can fall outside a sum:
 *
 *   A  paid, in window, payout UNPAID, coupon + points discounts
 *   B  paid, in window, payout PAID            (excluded from "owed")
 *   C  payment still PENDING                   (counted, never summed)
 *   D  paid, 45 days old, payout UNPAID        (windowed out at 30, in at 60+)
 *
 * Expected numbers are derived by hand in the comments, not read back from the
 * code under test.
 */

import { getTestContext, seedReference } from './_setup';
import { AdminService } from '../../src/admin/admin.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { makeSessionDenylistMock } from '../mocks/auth-deps.mock';
import * as crypto from 'crypto';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeAdmin(client: any = ctx.prisma) {
  const prismaSvc = { client } as any;
  const notificationService = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const inval = { invalidate: jest.fn().mockResolvedValue(undefined), invalidateMany: jest.fn().mockResolvedValue(undefined) } as any;
  return new AdminService(
    prismaSvc, notificationService, new LoyaltyService(prismaSvc), inval, inval,
    makeSessionDenylistMock() as any,
  );
}

const DAY = 24 * 60 * 60 * 1000;
let slot = 0;

async function addBooking(seed: any, o: {
  status: 'PENDING' | 'CONFIRMED';
  payment: { status: 'SUCCESS' | 'PENDING'; amount: number; payoutStatus?: 'UNPAID' | 'PAID' };
  totalPrice: number; commission: number; fee: number; coupon: number; points: number;
  ageDays?: number;
}) {
  const createdAt = new Date(Date.now() - (o.ageDays ?? 0) * DAY);
  const payment = await ctx.prisma.payment.create({
    data: {
      amount: o.payment.amount, currency: 'QAR', status: o.payment.status, method: 'card',
      ...(o.payment.payoutStatus ? { payoutStatus: o.payment.payoutStatus } : {}),
      createdAt,
    },
  });
  const start = new Date(`2030-07-${String(10 + slot++).padStart(2, '0')}T10:00:00Z`);
  await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-DS-${crypto.randomUUID().slice(0, 8)}`,
      currencyCode: 'QAR', guests: 2, bookingPhone: '+97455123456',
      totalPrice: o.totalPrice, serviceFee: o.fee, commissionAmount: o.commission,
      couponDiscount: o.coupon, pointsDiscount: o.points,
      status: o.status,
      startDatetime: start, endDatetime: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      activityId: seed.activity.id, customerId: seed.customer.id, vendorId: seed.vendor.id,
      paymentId: payment.id, createdAt,
    },
  });
}

async function seedDataset() {
  slot = 0;
  const seed = await seedReference(ctx.prisma);
  await ctx.prisma.user.update({ where: { id: seed.customer.id }, data: { loyaltyPoints: 1234 } });

  // A  paid · in window · UNPAID payout
  await addBooking(seed, { status: 'CONFIRMED', payment: { status: 'SUCCESS', amount: 300, payoutStatus: 'UNPAID' },
    totalPrice: 400, commission: 40, fee: 5, coupon: 30, points: 70 });
  // B  paid · in window · payout PAID
  await addBooking(seed, { status: 'CONFIRMED', payment: { status: 'SUCCESS', amount: 200, payoutStatus: 'PAID' },
    totalPrice: 200, commission: 20, fee: 7, coupon: 0, points: 0 });
  // C  payment PENDING — must be counted as a booking but never summed
  await addBooking(seed, { status: 'PENDING', payment: { status: 'PENDING', amount: 999 },
    totalPrice: 999, commission: 99, fee: 9, coupon: 11, points: 13 });
  // D  paid · 45 days old · UNPAID payout
  await addBooking(seed, { status: 'CONFIRMED', payment: { status: 'SUCCESS', amount: 500, payoutStatus: 'UNPAID' },
    totalPrice: 600, commission: 60, fee: 4, coupon: 5, points: 3, ageDays: 45 });
  // E  a refund waiting for a decision (no booking needed — it is a Payment aggregate)
  await ctx.prisma.payment.create({
    data: { amount: 50, currency: 'QAR', status: 'REFUND_PENDING', method: 'card' },
  });
  return seed;
}

describe('AdminService.getDashboardStats', () => {
  test('default window (30 days) — each KPI equals the hand-computed value', async () => {
    await seedDataset();
    const s: any = await makeAdmin().getDashboardStats();

    // Windowed = A, B, C. D is 45 days old.
    expect(s.range).toBe('30');
    expect(s.totalBookings).toBe(3);                 // A + B + C
    expect(s.confirmedBookings).toBe(2);             // A + B
    expect(Number(s.totalRevenue)).toBe(500);        // payments 300 + 200 (C pending, D old)
    expect(s.bookingsValue).toBe(630);               // (400+200) totalPrice + (30+0) coupon
    expect(s.wanasaFundedValue).toBe(70);            // pointsDiscount 70 + 0
    expect(s.totalCommission).toBe(60);              // 40 + 20
    expect(s.totalServiceFees).toBe(12);             // 5 + 7
  });

  test('NOT windowed: owed payout, points, refunds, structural counts', async () => {
    const seed = await seedDataset();
    const s: any = await makeAdmin().getDashboardStats();

    // payment SUCCESS + UNPAID = A and D (D is old but liabilities are point-in-time)
    // (400-40) + (600-60) = 360 + 540
    expect(s.pendingPayoutOwed).toBe(900);
    expect(s.totalPointsIssued).toBe(1234);
    expect(s.refundPendingCount).toBe(1);
    expect(s.refundPendingAmount).toBe(50);
    expect(s.totalUsers).toBe(await ctx.prisma.user.count());
    expect(s.totalVendors).toBe(await ctx.prisma.vendor.count());
    expect(s.activeVendors).toBe(await ctx.prisma.vendor.count({ where: { status: 'ACTIVE' } }));
    expect(s.pendingVendors).toBe(await ctx.prisma.vendor.count({ where: { status: 'PENDING' } }));
    expect(s.totalActivities).toBe(await ctx.prisma.activity.count());
    expect(s.pendingActivities).toBe(await ctx.prisma.activity.count({ where: { status: 'PENDING' } }));
    expect(seed.customer.id).toBeTruthy();
  });

  test.each([
    // range, expected: bookings, confirmed, revenue, bookingsValue, wanasa, commission, fees
    ['60',  4, 3, 1000, 1235, 73, 120, 16],  // D (45d) now inside
    ['90',  4, 3, 1000, 1235, 73, 120, 16],
    ['all', 4, 3, 1000, 1235, 73, 120, 16],
    ['bogus', 3, 2,  500,  630, 70,  60, 12], // unknown range falls back to 30
  ] as const)('range=%s widens/keeps the window correctly', async (range, b, c, rev, val, w, com, fee) => {
    await seedDataset();
    const s: any = await makeAdmin().getDashboardStats(range);
    expect(s.totalBookings).toBe(b);
    expect(s.confirmedBookings).toBe(c);
    expect(Number(s.totalRevenue)).toBe(rev);
    expect(s.bookingsValue).toBe(val);            // (400+200+600)+(30+0+5) = 1235
    expect(s.wanasaFundedValue).toBe(w);          // 70 + 0 + 3
    expect(s.totalCommission).toBe(com);          // 40 + 20 + 60
    expect(s.totalServiceFees).toBe(fee);         // 5 + 7 + 4
    // Liabilities never move with the range.
    expect(s.pendingPayoutOwed).toBe(900);
  });

  test('an unpaid booking never contributes to any money sum', async () => {
    slot = 0;
    const seed = await seedReference(ctx.prisma);
    await addBooking(seed, { status: 'PENDING', payment: { status: 'PENDING', amount: 999 },
      totalPrice: 999, commission: 99, fee: 9, coupon: 11, points: 13 });
    const s: any = await makeAdmin().getDashboardStats('all');
    expect(s.totalBookings).toBe(1);
    expect(Number(s.totalRevenue)).toBe(0);
    expect(s.bookingsValue).toBe(0);
    expect(s.wanasaFundedValue).toBe(0);
    expect(s.totalCommission).toBe(0);
    expect(s.totalServiceFees).toBe(0);
    expect(s.pendingPayoutOwed).toBe(0);
  });

  test('empty platform — every KPI is a number (0), never null/NaN', async () => {
    const s: any = await makeAdmin().getDashboardStats();
    for (const k of ['totalBookings', 'confirmedBookings', 'bookingsValue', 'wanasaFundedValue',
      'totalCommission', 'totalServiceFees', 'pendingPayoutOwed', 'totalPointsIssued',
      'refundPendingCount', 'refundPendingAmount']) {
      expect(typeof s[k]).toBe('number');
      expect(Number.isNaN(s[k])).toBe(false);
      expect(s[k]).toBe(0);
    }
    expect(Number(s.totalRevenue)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Concurrency: how many queries are in flight at the same moment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wraps the Prisma delegates the dashboard uses so every count()/aggregate()
 * is counted while it is running. Each in-flight query holds one pooled
 * connection, and each open connection costs the 1 GB db.t3.micro ~1.3 MB
 * (CloudWatch: ~6 connections -> ~95 MB free, ~30 -> ~63 MB, alarm line
 * ~105 MB). Opening the dashboard used to fire 13 at once.
 */
function instrumented() {
  const stats = { inFlight: 0, peak: 0, total: 0 };
  const wrapModel = (model: any) =>
    new Proxy(model, {
      get(target, prop) {
        const orig = target[prop];
        if ((prop === 'count' || prop === 'aggregate') && typeof orig === 'function') {
          return (...args: any[]) => {
            stats.inFlight++;
            stats.total++;
            stats.peak = Math.max(stats.peak, stats.inFlight);
            // Prisma promises are lazy: resolving here is what starts the query.
            return Promise.resolve(orig.apply(target, args)).finally(() => { stats.inFlight--; });
          };
        }
        return typeof orig === 'function' ? orig.bind(target) : orig;
      },
    });
  const client = {
    user: wrapModel(ctx.prisma.user),
    vendor: wrapModel(ctx.prisma.vendor),
    activity: wrapModel(ctx.prisma.activity),
    booking: wrapModel(ctx.prisma.booking),
    payment: wrapModel(ctx.prisma.payment),
  };
  return { client, stats };
}

describe('AdminService.getDashboardStats — connection pressure', () => {
  test('never has more than 5 queries in flight (was 13), and still runs all 13', async () => {
    await seedDataset();
    const { client, stats } = instrumented();
    await makeAdmin(client).getDashboardStats();

    expect(stats.total).toBe(13);          // none dropped, none added
    expect(stats.peak).toBeLessThanOrEqual(5);
    expect(stats.inFlight).toBe(0);        // everything settled
  });

  test('the instrumented path returns exactly the same numbers as the plain one', async () => {
    await seedDataset();
    const plain: any = await makeAdmin().getDashboardStats('all');
    const { client } = instrumented();
    const wrapped: any = await makeAdmin(client).getDashboardStats('all');
    expect(wrapped).toEqual(plain);
  });

  test('a failing query still rejects (the grouping does not swallow errors)', async () => {
    await seedDataset();
    const { client } = instrumented();
    (client as any).payment = {
      count: client.payment.count,
      aggregate: () => Promise.reject(new Error('boom')),
    };
    await expect(makeAdmin(client).getDashboardStats()).rejects.toThrow('boom');
  });
});
