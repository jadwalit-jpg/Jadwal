/**
 * Review asks against a real DB — ReviewRequestService.
 *
 *   - the launch floor is stored once (first run − 30 days) and never moved
 *   - first ask: completed, ended before today, on/after the floor, not
 *     refunded, listing and customer live, no review, one per customer+activity
 *   - running the job twice sends once (ledger claim)
 *   - second ask three days later, email only, never after a review / opt-out
 *   - a review closes the asks; the pop-up "next", snooze, opt-out, by-ref
 */
import { NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { getTestContext, seedReference } from './_setup';
import {
  ReviewRequestService, REVIEW_ASK_BACKLOG_DAYS, SECOND_ASK_AFTER_DAYS, todayStartTagged, localDateIn,
} from '../../src/catalog/review-request.service';

const ctx = getTestContext();
beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

const DAY = 24 * 60 * 60 * 1000;
// A fixed "now": 09:00 Qatar (06:00 UTC) on 20 Dec 2026 — in the future, so
// snoozes stamped with the real clock (dismiss) sort before the cron's asks.
const NOW = new Date('2026-12-20T06:00:00.000Z');

function makeSvc() {
  const notifications = { send: jest.fn().mockResolvedValue(undefined), notifyAdmins: jest.fn() } as any;
  const lock = { withLeaderLock: jest.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()) } as any;
  const svc = new ReviewRequestService({ client: ctx.prisma } as any, lock, notifications);
  return { svc, notifications };
}

type Seed = Awaited<ReturnType<typeof seedReference>>;

/** A COMPLETED booking whose activity ended `endedDaysAgo` days before NOW (wall-clock tagged UTC). */
async function completedBooking(seed: Seed, opts: { endedDaysAgo: number; activityId?: string; customerId?: string; paymentStatus?: 'SUCCESS' | 'REFUNDED' | 'REFUND_PENDING' | null; status?: 'COMPLETED' | 'CONFIRMED' | 'CANCELLED' }) {
  const end = new Date(`${localDateIn(new Date(NOW.getTime() - opts.endedDaysAgo * DAY), 'Asia/Qatar')}T18:00:00.000Z`);
  const start = new Date(end.getTime() - 2 * 60 * 60 * 1000);
  const payment = opts.paymentStatus === null ? null : await ctx.prisma.payment.create({
    data: { amount: 200, currency: 'QAR', status: opts.paymentStatus ?? 'SUCCESS', method: 'PAY2M', gatewayBasketId: `B-${crypto.randomUUID().slice(0, 8)}`, paidAt: start },
  });
  const booking = await ctx.prisma.booking.create({
    data: {
      ref: `JDWL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, currencyCode: 'QAR', guests: 2, bookingPhone: '+97455123456',
      totalPrice: 195, serviceFee: 5, status: opts.status ?? 'COMPLETED', startDatetime: start, endDatetime: end,
      activityId: opts.activityId ?? seed.activity.id, customerId: opts.customerId ?? seed.customer.id, vendorId: seed.vendor.id,
      paymentId: payment?.id ?? null,
    },
  });
  if (payment) await ctx.prisma.payment.update({ where: { id: payment.id }, data: { bookingId: booking.id } });
  return booking;
}

async function secondActivity(seed: Seed) {
  return ctx.prisma.activity.create({
    data: {
      vendorId: seed.vendor.id, categoryId: seed.category.id, countryId: seed.country.id, cityId: seed.city.id,
      titleEn: 'Second Tour', titleAr: 'جولة ثانية', slug: 'second-tour-' + crypto.randomUUID().slice(0, 6),
      descriptionEn: 'd', descriptionAr: 'و', locationAddress: 'Doha', locationLat: 25.2, locationLng: 51.5,
      bookingType: 'HOURLY', pricingModel: 'PER_PERSON', pricePerPerson: 50, capacity: 10, durationValue: 2,
      checkInTime: '09:00', checkOutTime: '21:00', status: 'ACTIVE',
    },
  });
}

describe('the launch floor', () => {
  it('is stored once as first run − 30 days and not moved by later runs', async () => {
    const { svc } = makeSvc();
    await seedReference(ctx.prisma);
    const first = await svc.run(NOW);
    expect(first.floor.getTime()).toBe(NOW.getTime() - REVIEW_ASK_BACKLOG_DAYS * DAY);
    const stored = await ctx.prisma.platformSettings.findUniqueOrThrow({ where: { id: 'default' } });
    expect(stored.reviewAskFloor!.getTime()).toBe(first.floor.getTime());
    const later = await svc.run(new Date(NOW.getTime() + 40 * DAY));
    expect(later.floor.getTime()).toBe(first.floor.getTime());
  });

  it('todayStartTagged is the local day start as a tagged-UTC wall clock', () => {
    expect(todayStartTagged(new Date('2026-11-20T22:30:00.000Z'), 'Asia/Qatar').toISOString()).toBe('2026-11-21T00:00:00.000Z'); // 01:30 Qatar next day
    expect(todayStartTagged(new Date('2026-11-20T06:00:00.000Z'), 'Asia/Qatar').toISOString()).toBe('2026-11-20T00:00:00.000Z');
  });
});

describe('first ask', () => {
  it('asks a completed booking that ended yesterday: ledger row, one email, one notification, in the customer language', async () => {
    const { svc, notifications } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    await ctx.prisma.user.update({ where: { id: seed.customer.id }, data: { preferredLanguage: 'AR' } });
    const b = await completedBooking(seed, { endedDaysAgo: 1 });

    const res = await svc.run(NOW);
    expect(res.firstAsks).toBe(1);
    const row = await ctx.prisma.reviewRequest.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(row.firstAskedAt!.getTime()).toBe(NOW.getTime());
    expect(row.secondAskedAt).toBeNull();
    const outbox = await ctx.prisma.emailOutbox.findMany({ where: { bookingId: b.id } });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].emailType).toBe('REVIEW_REQUEST');
    expect(outbox[0].recipient).toBe('customer@test.com');
    expect(outbox[0].payload).toEqual(expect.objectContaining({ bookingRef: b.ref, activityTitle: 'Sample Tour', activityTitleAr: 'جولة', reminder: false }));
    expect(notifications.send).toHaveBeenCalledTimes(1);
    expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({
      userId: seed.customer.id, type: 'REVIEW_REQUEST', link: `/review/${b.ref}`, title: 'كيف كانت تجربتك؟',
    }));
    expect(notifications.send.mock.calls[0][0].message).toContain('جولة');
  });

  it('running the job twice sends once', async () => {
    const { svc, notifications } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const b = await completedBooking(seed, { endedDaysAgo: 2 });
    await svc.run(NOW);
    const again = await svc.run(new Date(NOW.getTime() + 60_000));
    expect(again.firstAsks).toBe(0);
    expect(await ctx.prisma.emailOutbox.count({ where: { bookingId: b.id } })).toBe(1);
    expect(notifications.send).toHaveBeenCalledTimes(1);
  });

  it('does not ask: ended today, ended before the floor, refunded, refund pending, not completed, reviewed, inactive listing, deleted or deactivated customer', async () => {
    const { svc, notifications } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const other = await secondActivity(seed);
    const third = await secondActivity(seed);
    await completedBooking(seed, { endedDaysAgo: 0 });                                    // ends today → tomorrow's run
    await completedBooking(seed, { endedDaysAgo: REVIEW_ASK_BACKLOG_DAYS + 2 });          // before the floor
    await completedBooking(seed, { endedDaysAgo: 1, paymentStatus: 'REFUNDED', activityId: other.id });
    await completedBooking(seed, { endedDaysAgo: 1, paymentStatus: 'REFUND_PENDING', activityId: third.id });
    await completedBooking(seed, { endedDaysAgo: 1, status: 'CONFIRMED' });
    await completedBooking(seed, { endedDaysAgo: 1, status: 'CANCELLED' });
    // reviewed already (same activity as the "ends today" row, different one below)
    const reviewedAct = await secondActivity(seed);
    await ctx.prisma.review.create({ data: { activityId: reviewedAct.id, customerId: seed.customer.id, rating: 5 } });
    await completedBooking(seed, { endedDaysAgo: 1, activityId: reviewedAct.id });
    // inactive listing
    const inactive = await secondActivity(seed);
    await ctx.prisma.activity.update({ where: { id: inactive.id }, data: { status: 'INACTIVE' } });
    await completedBooking(seed, { endedDaysAgo: 1, activityId: inactive.id });
    // deleted customer
    const gone = await ctx.prisma.user.create({ data: { fullName: 'Gone', email: `${crypto.randomUUID()}@deleted.local`, password: 'x', role: 'CUSTOMER', deletedAt: new Date() } });
    await completedBooking(seed, { endedDaysAgo: 1, customerId: gone.id, activityId: other.id });
    const off = await ctx.prisma.user.create({ data: { fullName: 'Off', email: `${crypto.randomUUID()}@test.com`, password: 'x', role: 'CUSTOMER', isDeactivated: true } });
    await completedBooking(seed, { endedDaysAgo: 1, customerId: off.id, activityId: third.id });

    const res = await svc.run(NOW);
    expect(res.firstAsks).toBe(0);
    expect(await ctx.prisma.reviewRequest.count()).toBe(0);
    expect(await ctx.prisma.emailOutbox.count()).toBe(0);
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('asks the backlog that ended within 30 days before the first run, and one sequence per customer and activity', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const old = await completedBooking(seed, { endedDaysAgo: 20 });
    const newer = await completedBooking(seed, { endedDaysAgo: 3 }); // same customer + activity → one sequence
    const otherAct = await secondActivity(seed);
    const otherBooking = await completedBooking(seed, { endedDaysAgo: 5, activityId: otherAct.id });
    const res = await svc.run(NOW);
    expect(res.firstAsks).toBe(2);
    const rows = await ctx.prisma.reviewRequest.findMany();
    expect(rows.map((r) => r.bookingId).sort()).toEqual([old.id, otherBooking.id].sort());
    expect(rows.find((r) => r.bookingId === newer.id)).toBeUndefined();
  });

  it('a booking that ends today is asked by tomorrow\'s run', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const b = await completedBooking(seed, { endedDaysAgo: 0 });
    expect((await svc.run(NOW)).firstAsks).toBe(0);
    expect((await svc.run(new Date(NOW.getTime() + DAY))).firstAsks).toBe(1);
    expect(await ctx.prisma.reviewRequest.count({ where: { bookingId: b.id } })).toBe(1);
  });
});

describe('second ask', () => {
  it('goes out three days after the first, email only, then nothing more', async () => {
    const { svc, notifications } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const b = await completedBooking(seed, { endedDaysAgo: 1 });
    await svc.run(NOW);
    expect((await svc.run(new Date(NOW.getTime() + 2 * DAY))).secondAsks).toBe(0);
    const third = await svc.run(new Date(NOW.getTime() + SECOND_ASK_AFTER_DAYS * DAY));
    expect(third.secondAsks).toBe(1);
    const outbox = await ctx.prisma.emailOutbox.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: 'asc' } });
    expect(outbox).toHaveLength(2);
    expect((outbox[1].payload as any).reminder).toBe(true);
    expect(notifications.send).toHaveBeenCalledTimes(1); // the in-app notification is first-ask only
    const row = await ctx.prisma.reviewRequest.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(row.secondAskedAt).toBeTruthy();
    const fourth = await svc.run(new Date(NOW.getTime() + 10 * DAY));
    expect(fourth.secondAsks).toBe(0);
    expect(fourth.firstAsks).toBe(0);
    expect(await ctx.prisma.emailOutbox.count({ where: { bookingId: b.id } })).toBe(2);
  });

  it('is skipped after a review or an opt-out', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const reviewedB = await completedBooking(seed, { endedDaysAgo: 1 });
    const otherAct = await secondActivity(seed);
    const optedB = await completedBooking(seed, { endedDaysAgo: 1, activityId: otherAct.id });
    await svc.run(NOW);
    await ctx.prisma.review.create({ data: { activityId: seed.activity.id, customerId: seed.customer.id, rating: 4 } });
    await svc.dismiss(seed.customer.id, optedB.id, 'never', new Date(NOW.getTime() + 60 * 60_000));
    const res = await svc.run(new Date(NOW.getTime() + SECOND_ASK_AFTER_DAYS * DAY));
    expect(res.secondAsks).toBe(0);
    expect(await ctx.prisma.emailOutbox.count({ where: { bookingId: reviewedB.id } })).toBe(1);
    expect(await ctx.prisma.emailOutbox.count({ where: { bookingId: optedB.id } })).toBe(1);
    expect((await ctx.prisma.reviewRequest.findUniqueOrThrow({ where: { bookingId: reviewedB.id } })).reviewedAt).toBeTruthy();
  });
});

describe('the pop-up and the review page', () => {
  it('next: the oldest open ask; Later hides it until the next ask; Never hides it for good; a review closes it', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const b = await completedBooking(seed, { endedDaysAgo: 1 });
    expect(await svc.nextPromptFor(seed.customer.id)).toBeNull(); // not asked yet
    await svc.run(NOW);
    const prompt = await svc.nextPromptFor(seed.customer.id);
    expect(prompt).toEqual(expect.objectContaining({ bookingId: b.id, bookingRef: b.ref }));
    expect(prompt!.activity).toEqual(expect.objectContaining({ id: seed.activity.id, titleEn: 'Sample Tour', coverImage: '/placeholder.webp' }));

    await svc.dismiss(seed.customer.id, b.id, 'later', new Date(NOW.getTime() + 60_000));
    expect(await svc.nextPromptFor(seed.customer.id)).toBeNull();
    await svc.run(new Date(NOW.getTime() + SECOND_ASK_AFTER_DAYS * DAY)); // the second ask re-opens it
    expect((await svc.nextPromptFor(seed.customer.id))?.bookingId).toBe(b.id);

    await svc.dismiss(seed.customer.id, b.id, 'never', new Date(NOW.getTime() + SECOND_ASK_AFTER_DAYS * DAY + 60_000));
    expect(await svc.nextPromptFor(seed.customer.id)).toBeNull();

    const otherAct = await secondActivity(seed);
    const b2 = await completedBooking(seed, { endedDaysAgo: 1, activityId: otherAct.id });
    await svc.run(new Date(NOW.getTime() + 4 * DAY));
    expect((await svc.nextPromptFor(seed.customer.id))?.bookingId).toBe(b2.id);
    await svc.markReviewed(seed.customer.id, otherAct.id);
    expect(await svc.nextPromptFor(seed.customer.id)).toBeNull();
  });

  it('by-ref: the customer\'s own booking (any case), 404 for another customer; canReview and alreadyReviewed', async () => {
    const { svc } = makeSvc();
    const seed = await seedReference(ctx.prisma);
    const b = await completedBooking(seed, { endedDaysAgo: 1 });
    const res = await svc.promptByRef(seed.customer.id, b.ref.toLowerCase());
    expect(res.prompt.bookingId).toBe(b.id);
    expect(res.canReview).toBe(true);
    expect(res.alreadyReviewed).toBe(false);
    await expect(svc.promptByRef(seed.vendorUser.id, b.ref)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.dismiss(seed.vendorUser.id, b.id, 'later')).rejects.toBeInstanceOf(NotFoundException);
    await ctx.prisma.review.create({ data: { activityId: seed.activity.id, customerId: seed.customer.id, rating: 3 } });
    const after = await svc.promptByRef(seed.customer.id, b.ref);
    expect(after.alreadyReviewed).toBe(true);
    expect(after.canReview).toBe(false);
  });
});
