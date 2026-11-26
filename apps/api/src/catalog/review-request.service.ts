import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisLockService } from '../redis/redis-lock.service';
import { NotificationService } from '../common/services/notification.service';

/** Asks go out at 09:00 in this zone, every day. */
export const REVIEW_ASK_TIMEZONE = 'Asia/Qatar';
/** Launch backlog: bookings that ended up to this many days before the FIRST run are asked too. */
export const REVIEW_ASK_BACKLOG_DAYS = 30;
/** The second (and last) ask follows the first after this many days. */
export const SECOND_ASK_AFTER_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar date (YYYY-MM-DD) of `now` in `tz`. */
export function localDateIn(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Start of today's local day, expressed the way the schema stores booking
 * times (local wall-clock tagged as UTC). A booking "ended before today" iff
 * its endDatetime is below this.
 */
export function todayStartTagged(now: Date, tz: string = REVIEW_ASK_TIMEZONE): Date {
  return new Date(`${localDateIn(now, tz)}T00:00:00.000Z`);
}

/** The one stable link that opens the review form for a booking (the WhatsApp agent sends it too). */
export function reviewPath(bookingRef: string, lang: 'EN' | 'AR' = 'EN'): string {
  return `${lang === 'AR' ? '/ar' : ''}/review/${bookingRef}`;
}

export const BOOKING_REF_PATTERN = /^JDWL-[A-Za-z0-9-]{3,24}$/;

type AskBooking = {
  id: string;
  ref: string;
  customerId: string;
  activityId: string;
  endDatetime: Date;
  customer: { email: string; fullName: string; preferredLanguage: string };
  activity: { titleEn: string; titleAr: string };
};

export interface ReviewPrompt {
  bookingId: string;
  bookingRef: string;
  endDate: string;
  activity: { id: string; titleEn: string; titleAr: string; slug: string; coverImage: string | null };
}

/**
 * Review asks. Customers who finished an activity are asked to rate it, at
 * most twice per booking:
 *   1. the morning after the activity ends (09:00 Asia/Qatar): email + in-app
 *      notification;
 *   2. three days later, if there is still no review: email only.
 * Then nothing more for that booking. One sequence per customer and activity:
 * a second completed booking for an activity the customer was already asked
 * about is not asked again, and a review by the customer stops every open ask
 * for that activity.
 *
 * Sent once even if the job runs twice: the ledger row (unique per booking)
 * claims the booking, and each ask is claimed with a conditional update
 * before anything is sent. The email goes through the outbox (durable,
 * retried, suppression and quota in the shared send path).
 *
 * Launch backlog: the first run after deploy stores `now − 30 days` as
 * `platform_settings.reviewAskFloor`, once; bookings that ended before the
 * floor are never asked, and the floor is never moved, so the backlog cannot
 * widen later.
 */
@Injectable()
export class ReviewRequestService {
  private readonly logger = new Logger(ReviewRequestService.name);

  constructor(
    private prisma: PrismaService,
    private lock: RedisLockService,
    private notifications: NotificationService,
  ) {}

  @Cron('0 9 * * *', { timeZone: REVIEW_ASK_TIMEZONE })
  async askDaily() {
    await this.lock.withLeaderLock('cron:review-requests', 30 * 60_000, async () => {
      await this.run();
    });
  }

  async run(now: Date = new Date()): Promise<{ firstAsks: number; secondAsks: number; floor: Date }> {
    const floor = await this.ensureFloor(now);
    const firstAsks = await this.sendFirstAsks(now, floor);
    const secondAsks = await this.sendSecondAsks(now);
    this.logger.log({ event: 'REVIEW_ASKS_SENT', firstAsks, secondAsks, floor: floor.toISOString() });
    return { firstAsks, secondAsks, floor };
  }

  /** The launch floor, set once by the first run (first run wins; never moved). */
  async ensureFloor(now: Date): Promise<Date> {
    const db = this.prisma.client;
    const existing = await db.platformSettings.findUnique({ where: { id: 'default' }, select: { reviewAskFloor: true } });
    if (existing?.reviewAskFloor) return existing.reviewAskFloor;
    const floor = new Date(now.getTime() - REVIEW_ASK_BACKLOG_DAYS * DAY_MS);
    if (!existing) {
      await db.platformSettings.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
    }
    // Conditional: only a still-null floor is written, so two first runs agree.
    await db.platformSettings.updateMany({ where: { id: 'default', reviewAskFloor: null }, data: { reviewAskFloor: floor } });
    const after = await db.platformSettings.findUniqueOrThrow({ where: { id: 'default' }, select: { reviewAskFloor: true } });
    return after.reviewAskFloor ?? floor;
  }

  /**
   * Completed bookings that ended before today (local) and on/after the floor,
   * not refunded, customer and listing still live, no review by this customer
   * for this activity, and no ask yet for this customer and activity.
   */
  async findFirstAskCandidates(now: Date, floor: Date, take = 500): Promise<AskBooking[]> {
    const db = this.prisma.client;
    const rows = await db.booking.findMany({
      where: {
        status: 'COMPLETED',
        endDatetime: { gte: floor, lt: todayStartTagged(now) },
        reviewRequest: null,
        customer: { deletedAt: null, isDeactivated: false },
        activity: { status: 'ACTIVE', deletedAt: null },
        OR: [{ payment: null }, { payment: { status: { notIn: ['REFUNDED', 'REFUND_PENDING'] } } }],
      },
      select: {
        id: true, ref: true, customerId: true, activityId: true, endDatetime: true,
        customer: { select: { email: true, fullName: true, preferredLanguage: true } },
        activity: { select: { titleEn: true, titleAr: true } },
      },
      orderBy: { endDatetime: 'asc' },
      take,
    });
    if (rows.length === 0) return [];
    const pairs = rows.map((r) => ({ activityId: r.activityId, customerId: r.customerId }));
    const [reviews, asked] = await Promise.all([
      db.review.findMany({ where: { OR: pairs }, select: { activityId: true, customerId: true } }),
      db.reviewRequest.findMany({ where: { OR: pairs }, select: { activityId: true, customerId: true } }),
    ]);
    const skip = new Set([...reviews, ...asked].map((r) => `${r.activityId}:${r.customerId}`));
    const out: AskBooking[] = [];
    for (const r of rows) {
      const key = `${r.activityId}:${r.customerId}`;
      if (skip.has(key)) continue;
      skip.add(key); // one sequence per customer and activity, even within one run
      out.push(r);
    }
    return out;
  }

  private async sendFirstAsks(now: Date, floor: Date): Promise<number> {
    const db = this.prisma.client;
    const candidates = await this.findFirstAskCandidates(now, floor);
    let sent = 0;
    for (const b of candidates) {
      try {
        await db.reviewRequest.create({ data: { bookingId: b.id, customerId: b.customerId, activityId: b.activityId } });
      } catch (err) {
        // Another run claimed this booking first.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
      const claim = await db.reviewRequest.updateMany({ where: { bookingId: b.id, firstAskedAt: null }, data: { firstAskedAt: now } });
      if (claim.count === 0) continue;
      await this.deliverAsk(b, 'first');
      sent += 1;
    }
    return sent;
  }

  private async sendSecondAsks(now: Date): Promise<number> {
    const db = this.prisma.client;
    const due = await db.reviewRequest.findMany({
      where: {
        firstAskedAt: { lte: new Date(now.getTime() - SECOND_ASK_AFTER_DAYS * DAY_MS) },
        secondAskedAt: null, optedOutAt: null, reviewedAt: null,
      },
      select: {
        id: true, bookingId: true, customerId: true, activityId: true,
        booking: {
          select: {
            ref: true, endDatetime: true,
            customer: { select: { email: true, fullName: true, preferredLanguage: true, deletedAt: true, isDeactivated: true } },
            activity: { select: { titleEn: true, titleAr: true, status: true, deletedAt: true } },
          },
        },
      },
      orderBy: { firstAskedAt: 'asc' },
      take: 500,
    });
    let sent = 0;
    for (const r of due) {
      const b = r.booking;
      const reviewed = await db.review.findFirst({ where: { activityId: r.activityId, customerId: r.customerId }, select: { id: true } });
      if (reviewed) {
        await db.reviewRequest.updateMany({ where: { id: r.id, reviewedAt: null }, data: { reviewedAt: now } });
        continue;
      }
      const askable = b.activity.status === 'ACTIVE' && !b.activity.deletedAt && !b.customer.deletedAt && !b.customer.isDeactivated;
      const claim = await db.reviewRequest.updateMany({ where: { id: r.id, secondAskedAt: null }, data: { secondAskedAt: now } });
      if (claim.count === 0) continue;
      if (!askable) {
        // Closed without a send: the listing or the customer is gone, so there is nothing to rate.
        this.logger.log({ event: 'REVIEW_ASK_CLOSED_UNASKABLE', bookingId: r.bookingId });
        continue;
      }
      await this.deliverAsk({ id: r.bookingId, ref: b.ref, customerId: r.customerId, activityId: r.activityId, endDatetime: b.endDatetime, customer: b.customer, activity: b.activity }, 'second');
      sent += 1;
    }
    return sent;
  }

  /** Email via the outbox (both asks) and the in-app notification (first ask only), in the customer's language. */
  private async deliverAsk(b: AskBooking, stage: 'first' | 'second'): Promise<void> {
    const db = this.prisma.client;
    const lang: 'EN' | 'AR' = b.customer.preferredLanguage === 'AR' ? 'AR' : 'EN';
    const title = lang === 'AR' ? (b.activity.titleAr || b.activity.titleEn) : b.activity.titleEn;
    if (!b.customer.email.endsWith('@deleted.local')) {
      try {
        await db.emailOutbox.create({
          data: {
            emailType: 'REVIEW_REQUEST',
            recipient: b.customer.email,
            bookingId: b.id,
            payload: {
              customerName: b.customer.fullName,
              activityTitle: b.activity.titleEn,
              activityTitleAr: b.activity.titleAr,
              endDate: b.endDatetime.toISOString(),
              bookingRef: b.ref,
              reminder: stage === 'second',
            },
          },
        });
      } catch (err: unknown) {
        const kind = err instanceof Error ? err.name : 'UnknownError';
        this.logger.error({ event: 'EMAIL_OUTBOX_ENQUEUE_FAILED', bookingId: b.id, kind, emailType: 'REVIEW_REQUEST' });
      }
    }
    if (stage === 'first') {
      await this.notifications.send({
        userId: b.customerId,
        type: 'REVIEW_REQUEST',
        title: lang === 'AR' ? 'كيف كانت تجربتك؟' : 'How was your experience?',
        message: lang === 'AR'
          ? `قيّم ${title} (الحجز ${b.ref}) — يستغرق ذلك ثوانٍ قليلة.`
          : `Rate ${title} (booking ${b.ref}) — it takes a few seconds.`,
        link: reviewPath(b.ref),
      });
    }
  }

  // ─── The pop-up and the review page ────────────────────────────────────

  private toPrompt(booking: { id: string; ref: string; endDatetime: Date; activity: ReviewPrompt['activity'] }): ReviewPrompt {
    return {
      bookingId: booking.id,
      bookingRef: booking.ref,
      endDate: booking.endDatetime.toISOString(),
      activity: booking.activity,
    };
  }

  /**
   * The next ask to show the signed-in customer, oldest first: asked at least
   * once, not opted out, not reviewed, and not snoozed since the latest ask
   * ("Later" hides it until the next ask; after the second ask, for good).
   */
  async nextPromptFor(customerId: string): Promise<ReviewPrompt | null> {
    const db = this.prisma.client;
    const rows = await db.reviewRequest.findMany({
      where: { customerId, firstAskedAt: { not: null }, optedOutAt: null, reviewedAt: null },
      orderBy: { firstAskedAt: 'asc' },
      take: 10,
      select: {
        id: true, firstAskedAt: true, secondAskedAt: true, snoozedAt: true, activityId: true,
        booking: {
          select: {
            id: true, ref: true, endDatetime: true,
            activity: { select: { id: true, titleEn: true, titleAr: true, slug: true, coverImage: true, status: true, deletedAt: true } },
          },
        },
      },
    });
    for (const r of rows) {
      const latestAsk = r.secondAskedAt ?? r.firstAskedAt!;
      if (r.snoozedAt && r.snoozedAt.getTime() >= latestAsk.getTime()) continue;
      if (r.booking.activity.status !== 'ACTIVE' || r.booking.activity.deletedAt) continue;
      const reviewed = await db.review.findFirst({ where: { activityId: r.activityId, customerId }, select: { id: true } });
      if (reviewed) {
        await db.reviewRequest.updateMany({ where: { id: r.id, reviewedAt: null }, data: { reviewedAt: new Date() } });
        continue;
      }
      const { status: _s, deletedAt: _d, ...activity } = r.booking.activity;
      void _s; void _d;
      return this.toPrompt({ ...r.booking, activity });
    }
    return null;
  }

  /**
   * The review page (/review/<ref>): the customer's own completed or confirmed
   * booking by reference, whether or not it was asked yet (the WhatsApp agent
   * may send the link first). 404 for another customer's reference.
   */
  async promptByRef(customerId: string, ref: string): Promise<{ prompt: ReviewPrompt; alreadyReviewed: boolean; canReview: boolean }> {
    const db = this.prisma.client;
    const booking = await db.booking.findFirst({
      where: { ref: { equals: ref, mode: 'insensitive' }, customerId },
      select: {
        id: true, ref: true, endDatetime: true, status: true, activityId: true,
        activity: { select: { id: true, titleEn: true, titleAr: true, slug: true, coverImage: true, status: true, deletedAt: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const reviewed = await db.review.findFirst({ where: { activityId: booking.activityId, customerId }, select: { id: true } });
    const { status, deletedAt, ...activity } = booking.activity;
    const canReview =
      !reviewed && status === 'ACTIVE' && !deletedAt && (booking.status === 'CONFIRMED' || booking.status === 'COMPLETED');
    return { prompt: this.toPrompt({ ...booking, activity }), alreadyReviewed: !!reviewed, canReview };
  }

  /** "Later" (snooze until the next ask) or "Don't ask again for this booking". */
  async dismiss(customerId: string, bookingId: string, mode: 'later' | 'never', now: Date = new Date()): Promise<{ ok: true }> {
    const db = this.prisma.client;
    const booking = await db.booking.findFirst({ where: { id: bookingId, customerId }, select: { id: true, activityId: true } });
    if (!booking) throw new NotFoundException('Booking not found');
    const data = mode === 'never' ? { optedOutAt: now } : { snoozedAt: now };
    await db.reviewRequest.upsert({
      where: { bookingId },
      create: { bookingId, customerId, activityId: booking.activityId, ...data },
      update: data,
    });
    return { ok: true };
  }

  /** A review was created: close every open ask for this customer and activity. */
  async markReviewed(customerId: string, activityId: string, now: Date = new Date()): Promise<void> {
    await this.prisma.client.reviewRequest.updateMany({
      where: { customerId, activityId, reviewedAt: null },
      data: { reviewedAt: now },
    }).catch((err: unknown) => {
      const kind = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error({ event: 'REVIEW_REQUEST_MARK_REVIEWED_FAILED', kind });
    });
  }
}
