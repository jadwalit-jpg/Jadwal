import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { isSerializationFailure } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../common/services/notification.service';
import { AvailabilityCacheService } from '../redis/availability-cache.service';
import { RedisLockService } from '../redis/redis-lock.service';
import { BusinessConflictException } from '../common/exceptions/business-exception';
import { nowInTimezone } from '../common/validators/timezone';
import {
  activeBookingFilter,
  addMonthsClamped,
  buildDatetime,
  fromMinutes,
  isValidDate,
  maxConcurrentInWindow,
  rentsWholeUnit,
  todayInTimezone,
  toMinutes,
  unassignedOverlapping,
  weekdayOf,
} from '../bookings/bookings.service';
import { dailyBaseCents, hourlyBaseCents } from '../bookings/pricing';
import type { RescheduleBookingDto, ReschedulePreviewQueryDto } from './dto/reschedule-booking.dto';
import {
  bookingWindowTexts,
  customerRescheduledMessage,
  rescheduleAuditDetails,
  vendorRescheduledMessage,
} from './booking-reschedule.text';

/**
 * Admin "Change date": move a CONFIRMED booking that has not started to other
 * dates, keeping its length (nights or hours), guests, add-ons and payment.
 *
 * Money (the safe option): totalPrice, commissionAmount, serviceFee and
 * payment.amount are never touched. The base price for the new dates is
 * computed exactly as createBooking would (special prices, pricing model,
 * minimum guests) and compared with the base price the customer was charged;
 * the difference and how it was settled OUTSIDE the website are recorded on a
 * BookingReschedule row, shown on the admin row and exported with payouts.
 *
 * Availability follows the same rules as a new booking: not in the past, not
 * beyond the advance limit, an active weekday, no vendor block, capacity or
 * a free unit (the booking keeps its unit when that unit is free on the new
 * dates, otherwise it is moved to the first free one). The booking itself is
 * excluded from the conflict scan so it can move by one night or one hour.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

type Client = Prisma.TransactionClient;

type LoadedBooking = Prisma.BookingGetPayload<{
  include: {
    activity: {
      include: {
        country: { select: { defaultTimezone: true; currencyCode: true } };
        vendor: { select: { id: true; slug: true; userId: true; user: { select: { fullName: true; email: true; preferredLanguage: true } } } };
      };
    };
    payment: { select: { status: true } };
    customer: { select: { id: true; fullName: true; email: true; preferredLanguage: true } };
    reschedules: { orderBy: { createdAt: 'desc' }; take: 1; select: { priceAfter: true } };
  };
}>;

type Target = {
  start: Date;
  end: Date;
  checkInDate: string;
  /** DAILY only */
  checkOutDate: string | null;
  /** HOURLY only */
  slotTime: string | null;
  nights: number | null;
  hours: number | null;
};

export type ReschedulePreview = {
  bookingId: string;
  ref: string;
  bookingType: string;
  guests: number;
  currency: string;
  from: { startDatetime: Date; endDatetime: Date; unitNumber: number | null };
  to: { startDatetime: Date; endDatetime: Date; checkInDate: string; checkOutDate: string | null; slotTime: string | null; unitNumber: number | null };
  nights: number | null;
  hours: number | null;
  priceBefore: number;
  priceAfter: number;
  /** priceAfter − priceBefore, 2 decimals; positive = the customer owes more */
  difference: number;
  /** Which settlements the server accepts for this difference. */
  settlementOptions: Array<'PAID_OUTSIDE' | 'REFUNDED_OUTSIDE' | 'WAIVED'>;
};

@Injectable()
export class BookingRescheduleService {
  private readonly logger = new Logger(BookingRescheduleService.name);
  private readonly maxAdvanceMonths: number;
  private readonly lockTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly availabilityCache: AvailabilityCacheService,
    private readonly redisLock: RedisLockService,
    configService: ConfigService,
  ) {
    // Same knobs as BookingsService, so an admin can move a booking exactly
    // as far ahead as a customer could book it.
    this.maxAdvanceMonths = Number(configService.get('BOOKING_MAX_ADVANCE_MONTHS', '6'));
    this.lockTtlMs = Number(configService.get('REDIS_LOCK_TTL_MS', '30000'));
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /** What the change would do: new dates, new price, difference, unit. Nothing is written. */
  async preview(bookingId: string, query: ReschedulePreviewQueryDto): Promise<ReschedulePreview> {
    const db = this.prisma.client;
    const booking = await this.load(db, bookingId);
    const tz = this.tzOf(booking);
    this.assertCanBeMoved(booking, tz);
    const target = this.computeTarget(booking, query, tz);
    await this.assertNotBlocked(db, booking, target);
    const priceAfter = await this.priceCentsFor(db, booking, target);
    const priceBefore = this.priceBeforeCents(booking);
    const unit = await this.resolveUnit(db, booking, target, new Date());
    if (!unit.ok) throw new BadRequestException(unit.message);
    return this.toPreview(booking, target, priceBefore, priceAfter, unit.unitNumber);
  }

  /** Apply the change. Returns the updated booking and the ledger row. */
  async reschedule(
    bookingId: string,
    admin: { id: string; name: string },
    dto: RescheduleBookingDto,
  ) {
    const db = this.prisma.client;
    const booking = await this.load(db, bookingId);
    const tz = this.tzOf(booking);
    this.assertCanBeMoved(booking, tz);
    const target = this.computeTarget(booking, dto, tz);
    await this.assertNotBlocked(db, booking, target);
    const priceAfterCents = await this.priceCentsFor(db, booking, target);
    const priceBeforeCents = this.priceBeforeCents(booking);
    const differenceCents = priceAfterCents - priceBeforeCents;
    const difference = differenceCents / 100;

    // The admin confirmed a difference they were shown. If prices moved under
    // them (a special price added, a previous change), make them look again.
    if (Math.round(dto.expectedDifference * 100) !== differenceCents) {
      throw new ConflictException(
        `The price difference is now ${booking.currencyCode} ${difference.toFixed(2)}, not ${dto.expectedDifference.toFixed(2)}. Check the new dates again before confirming.`,
      );
    }
    const settlement = this.validateSettlement(differenceCents, dto);
    const settlementRef = dto.settlementRef?.trim() ? dto.settlementRef.trim() : null;

    // Same per-slot Redis lock a new booking takes, so a customer booking the
    // target slot at the same moment serialises against this move.
    const lockKey = RedisLockService.buildSlotKey({
      activityId: booking.activityId,
      date: target.checkInDate,
      slot: target.slotTime ?? 'daily',
    });
    const lockToken = await this.redisLock.acquire(lockKey, this.lockTtlMs);
    if (!lockToken) {
      throw new BusinessConflictException(
        'BOOKING.SLOT_BUSY',
        'These dates are being booked right now. Please try again in a moment.',
      );
    }

    const now = new Date();
    const currency = booking.currencyCode || booking.activity.country?.currencyCode || 'QAR';
    const textsEn = bookingWindowTexts(
      { start: booking.startDatetime, end: booking.endDatetime },
      { start: target.start, end: target.end },
      booking.activity.bookingType,
      'EN',
    );

    let record: Awaited<ReturnType<Client['bookingReschedule']['create']>>;
    try {
      record = await db.$transaction(async (tx) => {
        const unit = await this.resolveUnit(tx, booking, target, now);
        if (!unit.ok) throw new ConflictException(unit.message);

        // Claim: only a CONFIRMED booking still on the dates we planned from.
        // A concurrent change (another admin, a cancel, a completion) makes
        // this a no-op and we refuse instead of overwriting their work.
        const claim = await tx.booking.updateMany({
          where: {
            id: booking.id,
            status: 'CONFIRMED',
            startDatetime: booking.startDatetime,
            endDatetime: booking.endDatetime,
          },
          data: {
            startDatetime: target.start,
            endDatetime: target.end,
            unitNumber: unit.unitNumber,
            rescheduledAt: now,
          },
        });
        if (claim.count === 0) {
          throw new ConflictException('This booking changed while you were editing it. Refresh and try again.');
        }

        const created = await tx.bookingReschedule.create({
          data: {
            bookingId: booking.id,
            fromStartDatetime: booking.startDatetime,
            fromEndDatetime: booking.endDatetime,
            toStartDatetime: target.start,
            toEndDatetime: target.end,
            fromUnitNumber: booking.unitNumber,
            toUnitNumber: unit.unitNumber,
            priceBefore: priceBeforeCents / 100,
            priceAfter: priceAfterCents / 100,
            priceDifference: difference,
            settlement,
            settlementRef,
            reason: dto.reason.trim(),
            adminId: admin.id,
            adminName: admin.name.slice(0, 200),
            createdAt: now,
          },
        });

        // Durable, detailed record next to the interceptor's generic
        // RESCHEDULE_BOOKING row. Inside the transaction: a change without
        // its audit row must not exist.
        await tx.auditLog.create({
          data: {
            actorType: 'ADMIN',
            actorId: admin.id,
            actorName: admin.name.slice(0, 200),
            action: 'BOOKING_RESCHEDULED',
            entity: 'Booking',
            entityId: booking.id,
            details: rescheduleAuditDetails({
              ref: booking.ref,
              texts: textsEn,
              fromUnit: booking.unitNumber,
              toUnit: unit.unitNumber,
              priceBefore: priceBeforeCents / 100,
              priceAfter: priceAfterCents / 100,
              difference,
              currency,
              settlement,
              settlementRef,
            }),
            actionCategory: 'FINANCIAL',
          },
        });
        return created;
      }, { isolationLevel: 'Serializable', timeout: 10_000, maxWait: 2_000 });
    } catch (err) {
      // Two Serializable transactions touched the same rows: P2034 when the
      // conflict is found on a query, or the pg adapter's DriverAdapterError
      // (TransactionWriteConflict) when it is found at COMMIT. Both mean the
      // other side won; the admin checks again.
      if (isSerializationFailure(err)) {
        throw new ConflictException('These dates were booked by someone else just now. Check the new dates again.');
      }
      throw err;
    } finally {
      await this.redisLock.release(lockKey, lockToken);
    }

    // Both windows changed occupancy; the cache is per activity.
    void this.availabilityCache.invalidate(booking.activityId);
    await this.notify(booking, target, textsEn);

    this.logger.log({
      event: 'BOOKING_RESCHEDULED',
      bookingId: booking.id,
      ref: booking.ref,
      difference,
      settlement,
    });

    const updated = await db.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: { id: true, ref: true, status: true, startDatetime: true, endDatetime: true, unitNumber: true, rescheduledAt: true },
    });
    return { booking: updated, reschedule: record };
  }

  // ─── Loading and guards ─────────────────────────────────────────────────

  private async load(db: Client, bookingId: string): Promise<LoadedBooking> {
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: {
        activity: {
          include: {
            country: { select: { defaultTimezone: true, currencyCode: true } },
            vendor: { select: { id: true, slug: true, userId: true, user: { select: { fullName: true, email: true, preferredLanguage: true } } } },
          },
        },
        payment: { select: { status: true } },
        customer: { select: { id: true, fullName: true, email: true, preferredLanguage: true } },
        reschedules: { orderBy: { createdAt: 'desc' }, take: 1, select: { priceAfter: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private tzOf(booking: LoadedBooking): string {
    return booking.activity.country?.defaultTimezone ?? 'UTC';
  }

  private assertCanBeMoved(booking: LoadedBooking, tz: string) {
    if (booking.status !== 'CONFIRMED') {
      const why: Record<string, string> = {
        PENDING: 'Only a confirmed booking can be moved. This booking is still waiting for payment.',
        CANCELLED: 'This booking was cancelled and cannot be moved.',
        COMPLETED: 'This booking is completed and cannot be moved.',
      };
      throw new BadRequestException(why[booking.status] ?? 'Only a confirmed booking can be moved.');
    }
    if (booking.payment && (booking.payment.status === 'REFUND_PENDING' || booking.payment.status === 'REFUNDED')) {
      throw new BadRequestException('This booking is being refunded and cannot be moved.');
    }
    // Booking times are local wall-clock tagged UTC: compare with the same frame.
    if (booking.startDatetime.getTime() <= nowInTimezone(tz).getTime()) {
      throw new BadRequestException('This booking has already started and cannot be moved.');
    }
  }

  /** The new window, keeping the booking's length. Pure date rules; no database. */
  private computeTarget(booking: LoadedBooking, input: ReschedulePreviewQueryDto, tz: string): Target {
    const activity = booking.activity;
    if (!isValidDate(input.checkInDate)) throw new BadRequestException('Invalid check-in date');

    const todayStr = todayInTimezone(tz);
    if (input.checkInDate < todayStr) throw new BadRequestException('Cannot move a booking to a past date');

    const maxFuture = addMonthsClamped(new Date(), this.maxAdvanceMonths).toISOString().slice(0, 10);
    if (input.checkInDate > maxFuture) {
      throw new BadRequestException(`Cannot move a booking more than ${this.maxAdvanceMonths} month(s) ahead`);
    }

    if (activity.activeDays.length > 0) {
      const day = weekdayOf(input.checkInDate);
      const allowed = activity.activeDays.some((ad) => ad.toUpperCase() === day || ad.toUpperCase().startsWith(day));
      if (!allowed) {
        throw new BadRequestException(`This activity is not available on ${day}. Available days: ${activity.activeDays.join(', ')}`);
      }
    }

    let target: Target;
    if (activity.bookingType === 'HOURLY') {
      if (!input.slotTime) throw new BadRequestException('Choose a start time for the new date');
      if (!/:(00|30)$/.test(input.slotTime)) {
        throw new BadRequestException('Start time must be on the hour or half-hour (e.g. 09:00, 09:30)');
      }
      if (!activity.checkInTime || !activity.checkOutTime) {
        throw new BadRequestException('Activity time configuration is incomplete');
      }
      const hours = Math.max(1, Math.round((booking.endDatetime.getTime() - booking.startDatetime.getTime()) / HOUR_MS));
      const startMins = toMinutes(input.slotTime);
      const endMins = startMins + hours * 60;
      if (startMins < toMinutes(activity.checkInTime)) {
        throw new BadRequestException('This time slot is before the activity opens');
      }
      if (endMins > toMinutes(activity.checkOutTime)) {
        throw new BadRequestException(`A ${hours}-hour booking starting at ${input.slotTime} would end after the activity closes (${activity.checkOutTime})`);
      }
      if (input.checkInDate === todayStr) {
        let nowLocal = '23:59';
        try {
          nowLocal = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
        } catch { /* unreadable timezone: treat every slot today as started */ }
        if (input.slotTime <= nowLocal) throw new BadRequestException('This time slot has already started');
      }
      target = {
        start: buildDatetime(input.checkInDate, input.slotTime),
        end: buildDatetime(input.checkInDate, fromMinutes(endMins)),
        checkInDate: input.checkInDate,
        checkOutDate: null,
        slotTime: input.slotTime,
        nights: null,
        hours,
      };
    } else {
      // DAILY: the stay's nights are the dates [check-in, check-out). Keep that count.
      const fromDate = booking.startDatetime.toISOString().slice(0, 10);
      const toDate = booking.endDatetime.toISOString().slice(0, 10);
      const nights = Math.max(1, Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS));
      const checkOutDate = new Date(Date.parse(`${input.checkInDate}T00:00:00Z`) + nights * DAY_MS).toISOString().slice(0, 10);
      target = {
        start: buildDatetime(input.checkInDate, activity.checkInTime ?? '14:00'),
        end: buildDatetime(checkOutDate, activity.checkOutTime ?? '11:00'),
        checkInDate: input.checkInDate,
        checkOutDate,
        slotTime: null,
        nights,
        hours: null,
      };
    }

    if (
      target.start.getTime() === booking.startDatetime.getTime() &&
      target.end.getTime() === booking.endDatetime.getTime()
    ) {
      throw new BadRequestException('The booking is already on these dates');
    }
    return target;
  }

  /** Vendor blocks: nights for a stay, the clock window for an hourly slot (same as createBooking). */
  private async assertNotBlocked(db: Client, booking: LoadedBooking, target: Target) {
    const window =
      booking.activity.bookingType === 'DAILY'
        ? { start: new Date(`${target.checkInDate}T00:00:00.000Z`), end: new Date(`${target.checkOutDate}T00:00:00.000Z`) }
        : { start: target.start, end: target.end };
    const block = await db.activityBlock.findFirst({
      where: { activityId: booking.activityId, deletedAt: null, blockStart: { lt: window.end }, blockEnd: { gt: window.start } },
      select: { id: true },
    });
    if (block) throw new BadRequestException('The vendor has closed these dates. Pick other dates.');
  }

  // ─── Price ──────────────────────────────────────────────────────────────

  /**
   * Base price for the new window, in cents, computed as createBooking does:
   * per-night prices with special dates for a stay; the date's special price
   * pro-rata by hours for a slot; times the charged guests of the pricing
   * model. Add-ons, coupon and service fee are not part of it: they do not
   * depend on the date.
   */
  private async priceCentsFor(db: Client, booking: LoadedBooking, target: Target): Promise<number> {
    const activity = booking.activity;
    const baseCents = Math.round(Number(activity.pricePerPerson) * 100);
    if (activity.bookingType === 'DAILY') {
      const checkIn = Date.parse(`${target.checkInDate}T00:00:00Z`);
      const nightDates = Array.from({ length: target.nights ?? 1 }, (_, i) => new Date(checkIn + i * DAY_MS));
      const specials = await db.activitySpecialPrice.findMany({
        where: { activityId: activity.id, deletedAt: null, date: { in: nightDates } },
        select: { date: true, price: true },
      });
      const byDate = new Map<string, number>();
      for (const s of specials) byDate.set(s.date.toISOString().slice(0, 10), Math.round(Number(s.price) * 100));
      return dailyBaseCents(
        nightDates.map((d) => byDate.get(d.toISOString().slice(0, 10)) ?? baseCents),
        activity.pricingModel,
        booking.guests,
        activity.minGuests,
      );
    }
    const special = await db.activitySpecialPrice.findFirst({
      where: { activityId: activity.id, deletedAt: null, date: new Date(`${target.checkInDate}T00:00:00.000Z`) },
      select: { price: true },
    });
    const effectiveCents = special ? Math.round(Number(special.price) * 100) : baseCents;
    const durationHours = activity.durationValue && activity.durationValue > 0 ? activity.durationValue : (target.hours ?? 1);
    return hourlyBaseCents(effectiveCents, target.hours ?? durationHours, durationHours, activity.pricingModel, booking.guests, activity.minGuests);
  }

  /**
   * Base price the customer was charged for the CURRENT dates, in cents: the
   * price after the latest date change, or, for the first change, the nominal
   * total (totalPrice + coupon discount) minus the add-ons. Never a recompute
   * with today's price list, which could differ from what was paid.
   */
  private priceBeforeCents(booking: LoadedBooking): number {
    const latest = booking.reschedules[0];
    if (latest) return Math.round(Number(latest.priceAfter) * 100);
    const nominalCents = Math.round((Number(booking.totalPrice) + Number(booking.couponDiscount)) * 100);
    const extras = Array.isArray(booking.selectedExtras) ? (booking.selectedExtras as unknown[]) : [];
    let extrasCents = 0;
    for (const e of extras) {
      if (!e || typeof e !== 'object') continue;
      const { price, qty } = e as { price?: unknown; qty?: unknown };
      const unit = Number(price);
      const count = Number.isFinite(Number(qty)) && Number(qty) > 0 ? Number(qty) : 1;
      if (Number.isFinite(unit)) extrasCents += Math.round(unit * 100) * count;
    }
    return Math.max(0, nominalCents - extrasCents);
  }

  private validateSettlement(
    differenceCents: number,
    dto: RescheduleBookingDto,
  ): 'PAID_OUTSIDE' | 'REFUNDED_OUTSIDE' | 'WAIVED' | null {
    if (differenceCents === 0) {
      if (dto.settlement) throw new BadRequestException('The price does not change on these dates, so there is nothing to settle');
      return null;
    }
    if (!dto.settlement) {
      throw new BadRequestException(
        differenceCents > 0
          ? 'The new dates cost more. Record how the customer paid the difference (or that it was waived).'
          : 'The new dates cost less. Record how the customer was refunded the difference (or that it was waived).',
      );
    }
    if (differenceCents > 0 && dto.settlement === 'REFUNDED_OUTSIDE') {
      throw new BadRequestException('The customer owes more on these dates; a refund does not apply. Choose "paid outside" or "waived".');
    }
    if (differenceCents < 0 && dto.settlement === 'PAID_OUTSIDE') {
      throw new BadRequestException('The new dates cost less; a payment does not apply. Choose "refunded outside" or "waived".');
    }
    return dto.settlement;
  }

  // ─── Availability ───────────────────────────────────────────────────────

  /**
   * Which unit (or none, for a capacity listing) the booking would occupy on
   * the new dates, with the same conflict rules as createBooking. The booking
   * itself is excluded: it may overlap its own old window. Prefers the unit
   * the customer already has.
   */
  private async resolveUnit(
    client: Client,
    booking: LoadedBooking,
    target: Target,
    now: Date,
  ): Promise<{ ok: true; unitNumber: number | null } | { ok: false; message: string }> {
    const activity = booking.activity;
    const windowBookings = await client.booking.findMany({
      where: {
        activityId: booking.activityId,
        id: { not: booking.id },
        ...activeBookingFilter(now),
        startDatetime: { lt: target.end },
        endDatetime: { gt: target.start },
      },
      select: { startDatetime: true, endDatetime: true, guests: true, unitNumber: true },
      take: Number(process.env.AVAILABILITY_MAX_DAY_BOOKINGS || 5000),
    });

    let capacityLimit: number;
    let unitNumber: number | null = null;

    if (activity.hasUnits && activity.unitCount > 0) {
      const wholeUnit = rentsWholeUnit(activity);
      const orphans = unassignedOverlapping(windowBookings, target.start, target.end);
      const freeUnits: number[] = [];
      for (let u = 1; u <= activity.unitCount; u++) {
        const unitBookings = windowBookings.filter((b) => b.unitNumber === u);
        if (wholeUnit) {
          if (unitBookings.length === 0) freeUnits.push(u);
        } else {
          const peak = maxConcurrentInWindow([...unitBookings, ...orphans], target.start, target.end);
          if (activity.unitCapacity - peak >= booking.guests) freeUnits.push(u);
        }
      }
      const usable = wholeUnit ? freeUnits.length - orphans.length : freeUnits.length;
      if (usable <= 0) return { ok: false, message: 'All units are booked on these dates' };
      unitNumber = booking.unitNumber != null && freeUnits.includes(booking.unitNumber) ? booking.unitNumber : freeUnits[0];
      capacityLimit = activity.unitCapacity;
    } else {
      if (activity.capacity !== null && activity.capacity <= 0) {
        return { ok: false, message: 'This activity has no available capacity' };
      }
      capacityLimit = activity.capacity ?? Infinity;
    }

    const finalBookings = unitNumber ? windowBookings.filter((b) => b.unitNumber === unitNumber) : windowBookings;
    const peak = maxConcurrentInWindow(finalBookings, target.start, target.end);
    const available = capacityLimit === Infinity ? Infinity : capacityLimit - peak;
    if (booking.guests > available) {
      return {
        ok: false,
        message: available <= 0
          ? 'These dates are fully booked'
          : `Only ${available} seat${available === 1 ? '' : 's'} available on these dates; this booking has ${booking.guests} guests`,
      };
    }
    return { ok: true, unitNumber };
  }

  // ─── Output and notifications ───────────────────────────────────────────

  private toPreview(
    booking: LoadedBooking,
    target: Target,
    priceBeforeCents: number,
    priceAfterCents: number,
    unitNumber: number | null,
  ): ReschedulePreview {
    const differenceCents = priceAfterCents - priceBeforeCents;
    const settlementOptions: ReschedulePreview['settlementOptions'] =
      differenceCents === 0 ? [] : differenceCents > 0 ? ['PAID_OUTSIDE', 'WAIVED'] : ['REFUNDED_OUTSIDE', 'WAIVED'];
    return {
      bookingId: booking.id,
      ref: booking.ref,
      bookingType: booking.activity.bookingType,
      guests: booking.guests,
      currency: booking.currencyCode || booking.activity.country?.currencyCode || 'QAR',
      from: { startDatetime: booking.startDatetime, endDatetime: booking.endDatetime, unitNumber: booking.unitNumber },
      to: {
        startDatetime: target.start,
        endDatetime: target.end,
        checkInDate: target.checkInDate,
        checkOutDate: target.checkOutDate,
        slotTime: target.slotTime,
        unitNumber,
      },
      nights: target.nights,
      hours: target.hours,
      priceBefore: priceBeforeCents / 100,
      priceAfter: priceAfterCents / 100,
      difference: differenceCents / 100,
      settlementOptions,
    };
  }

  /**
   * Customer and vendor: in-app notification now, email through the outbox.
   * Best effort after the commit: the change stands even if a notification
   * fails (logged), like every other booking notification.
   */
  private async notify(booking: LoadedBooking, target: Target, textsEn: { from: string; to: string }) {
    const db = this.prisma.client;
    const bookingType = booking.activity.bookingType;
    const textsAr = bookingWindowTexts(
      { start: booking.startDatetime, end: booking.endDatetime },
      { start: target.start, end: target.end },
      bookingType,
      'AR',
    );
    const customerLang = booking.customer.preferredLanguage === 'AR' ? 'AR' : 'EN';
    const customerNote = customerRescheduledMessage({
      lang: customerLang,
      ref: booking.ref,
      titleEn: booking.activity.titleEn,
      titleAr: booking.activity.titleAr,
      texts: customerLang === 'AR' ? textsAr : textsEn,
    });
    await this.notifications.send({
      userId: booking.customerId,
      type: 'BOOKING_RESCHEDULED',
      title: customerNote.title,
      message: customerNote.message,
      link: `/bookings/${booking.id}`,
    });

    const vendorUser = booking.activity.vendor.user;
    const vendorLang = vendorUser.preferredLanguage === 'AR' ? 'AR' : 'EN';
    const vendorNote = vendorRescheduledMessage({
      lang: vendorLang,
      ref: booking.ref,
      titleEn: booking.activity.titleEn,
      titleAr: booking.activity.titleAr,
      customerName: booking.customer.fullName,
      texts: vendorLang === 'AR' ? textsAr : textsEn,
    });
    await this.notifications.send({
      userId: booking.activity.vendor.userId,
      type: 'BOOKING_RESCHEDULED',
      title: vendorNote.title,
      message: vendorNote.message,
      link: `/vendor/${booking.activity.vendor.slug}/bookings`,
    });

    // Emails: the shared send path applies suppression, quota and the
    // recipient's language; the template picks the matching window text.
    const common = {
      bookingRef: booking.ref,
      bookingId: booking.id,
      activityTitle: booking.activity.titleEn,
      activityTitleAr: booking.activity.titleAr,
      fromText: textsEn.from,
      toText: textsEn.to,
      fromTextAr: textsAr.from,
      toTextAr: textsAr.to,
    };
    if (!booking.customer.email.endsWith('@deleted.local')) {
      try {
        await db.emailOutbox.create({
          data: {
            emailType: 'BOOKING_RESCHEDULED',
            recipient: booking.customer.email,
            bookingId: booking.id,
            payload: { ...common, customerName: booking.customer.fullName },
          },
        });
      } catch (err) {
        this.logger.error({ event: 'EMAIL_OUTBOX_ENQUEUE_FAILED', emailType: 'BOOKING_RESCHEDULED', bookingId: booking.id, err: (err as Error)?.name });
      }
    }
    if (vendorUser.email && !vendorUser.email.endsWith('@deleted.local')) {
      try {
        await db.emailOutbox.create({
          data: {
            emailType: 'VENDOR_BOOKING_RESCHEDULED',
            recipient: vendorUser.email,
            bookingId: booking.id,
            payload: {
              ...common,
              vendorName: vendorUser.fullName,
              vendorSlug: booking.activity.vendor.slug,
              customerName: booking.customer.fullName,
              customerPhone: booking.bookingPhone,
              guests: booking.guests,
            },
          },
        });
      } catch (err) {
        this.logger.error({ event: 'EMAIL_OUTBOX_ENQUEUE_FAILED', emailType: 'VENDOR_BOOKING_RESCHEDULED', bookingId: booking.id, err: (err as Error)?.name });
      }
    }
  }
}
