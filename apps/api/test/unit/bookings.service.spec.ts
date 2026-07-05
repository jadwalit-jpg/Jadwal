/**
 * BookingsService unit tests — targeted on high-value / high-risk paths.
 *
 * Full createBooking coverage (1400-line $transaction path) is deferred to
 * integration tests where a real DB gives realistic row-lock semantics. Here
 * we focus on:
 *   - Input-validation guards (404/403/409/400 branches)
 *   - cancelBooking permission matrix + state machine
 *   - getBookingById authorisation
 *   - awardLoyaltyPoints idempotency + skip branches
 *   - getHourlyAvailability preconditions
 */

import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BookingsService } from '../../src/bookings/bookings.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditLoggerService } from '../../src/common/services/audit-logger.service';
import { NotificationService } from '../../src/common/services/notification.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { RedisLockService } from '../../src/redis/redis-lock.service';
import { AvailabilityCacheService } from '../../src/redis/availability-cache.service';
import { EmailService } from '../../src/email/email.service';
import { EmailQuotaService } from '../../src/email/email-quota.service';
import { SecurityLoggerService } from '../../src/common/services/security-logger.service';
import { ConfigService } from '@nestjs/config';
import { makePrismaMock } from '../mocks/prisma.mock';
import { makeConfigMock } from '../mocks/auth-deps.mock';
import {
  makeAuditLoggerMock, makeNotificationMock, makeLoyaltyMock,
  makeRedisLockMock, makeAvailabilityCacheMock,
} from '../mocks/bookings-deps.mock';

async function buildSut() {
  const prisma = makePrismaMock();
  const config = makeConfigMock({
    RESERVATION_WINDOW_MINUTES: '15',
    BOOKING_MAX_ADVANCE_YEARS:  '2',
    REDIS_LOCK_TTL_MS:          '30000',
  });
  const audit = makeAuditLoggerMock();
  const notif = makeNotificationMock();
  const loyalty = makeLoyaltyMock();
  const lock = makeRedisLockMock();
  const cache = makeAvailabilityCacheMock();

  // Email-OTP gate deps — minimal stubs so the SUT compiles. The unit tests
  // here focus on permission / state-machine paths and never invoke
  // sendBookingEmailOtp / verifyBookingEmailOtp directly (integration suite
  // covers those against a real DB).
  const email = { sendBookingOtp: jest.fn().mockResolvedValue(true) } as any;
  const emailQuota = { tryConsume: jest.fn().mockResolvedValue(true) } as any;
  const securityLogger = { log: jest.fn().mockResolvedValue(undefined) } as any;

  const mod = await Test.createTestingModule({
    providers: [
      BookingsService,
      { provide: PrismaService,             useValue: prisma },
      { provide: ConfigService,             useValue: config },
      { provide: AuditLoggerService,        useValue: audit },
      { provide: NotificationService,       useValue: notif },
      { provide: LoyaltyService,            useValue: loyalty },
      { provide: RedisLockService,          useValue: lock },
      { provide: AvailabilityCacheService,  useValue: cache },
      { provide: EmailService,              useValue: email },
      { provide: EmailQuotaService,         useValue: emailQuota },
      { provide: SecurityLoggerService,     useValue: securityLogger },
    ],
  }).compile();

  return { sut: mod.get(BookingsService), prisma, audit, notif, loyalty, lock, cache, email, emailQuota, securityLogger };
}

const futureDate = (offsetMs = 24 * 60 * 60 * 1000) => new Date(Date.now() + offsetMs);
const pastDate   = () => new Date(Date.now() - 60 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// getBookingById — ownership gate
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.getBookingById', () => {
  test('404 when booking does not exist', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce(null);
    await expect(ctx.sut.getBookingById('u1', 'b-missing'))
      .rejects.toThrow(NotFoundException);
  });

  test('404 when booking belongs to another customer (IDOR collapsed to 404)', async () => {
    // Ownership is in the where clause now, so a foreign-customer booking
    // never makes it through findFirst — the mock returns null and the
    // service throws NotFoundException, identical to "booking does not
    // exist". No 403 oracle.
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce(null);
    await expect(ctx.sut.getBookingById('u1', 'b1'))
      .rejects.toThrow(NotFoundException);
    expect(ctx.prisma._client.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'b1', customerId: 'u1' }) }),
    );
  });

  test('returns the booking row when owned by the caller', async () => {
    const ctx = await buildSut();
    const row = { id: 'b1', customerId: 'u1', ref: 'JDWL-ABC', status: 'CONFIRMED' };
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce(row);
    const r = await ctx.sut.getBookingById('u1', 'b1');
    expect(r).toBe(row);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// cancelBooking — permission + state-machine matrix
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.cancelBooking', () => {
  const baseActivity = {
    titleEn: 'Tour', checkInTime: '09:00', bookingType: 'HOURLY',
    cancellationPolicy: { cutoffHours: 24, refundPct: 100 },
    country: { defaultTimezone: 'UTC' },
  };

  test('404 when booking does not exist', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce(null);
    await expect(ctx.sut.cancelBooking('u1', 'b-missing'))
      .rejects.toThrow(NotFoundException);
  });

  test('404 when booking belongs to another customer (IDOR collapsed to 404)', async () => {
    // Ownership in where → foreign booking never reaches the service body.
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce(null);
    await expect(ctx.sut.cancelBooking('u1', 'b1'))
      .rejects.toThrow(NotFoundException);
    expect(ctx.prisma._client.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'b1', customerId: 'u1' }) }),
    );
  });

  test('400 when booking is already CANCELLED (idempotent guard)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', customerId: 'u1', status: 'CANCELLED',
      startDatetime: futureDate(),
      activity: baseActivity, payment: null,
    });
    await expect(ctx.sut.cancelBooking('u1', 'b1'))
      .rejects.toThrow(/already cancelled/i);
  });

  test('400 when booking is COMPLETED (past-activity guard)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', customerId: 'u1', status: 'COMPLETED',
      startDatetime: pastDate(),
      activity: baseActivity, payment: null,
    });
    await expect(ctx.sut.cancelBooking('u1', 'b1'))
      .rejects.toThrow(/completed/i);
  });

  test('400 when booking start has already passed (late-cancel guard)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.booking.findFirst.mockResolvedValueOnce({
      id: 'b1', customerId: 'u1', status: 'CONFIRMED',
      startDatetime: pastDate(),
      activity: baseActivity, payment: null,
    });
    await expect(ctx.sut.cancelBooking('u1', 'b1'))
      .rejects.toThrow(/already started/i);
  });
});

// Note: the standalone BookingsService.awardLoyaltyPoints method was removed —
// it was dead (0 callers). Awarding happens inline in the admin/vendor status-
// completion paths + the auto-complete cron, covered by cleanup-cron.int.spec.ts
// (earn-on-completion + pointsAwarded idempotency) and the admin/vendor suites.

// ═══════════════════════════════════════════════════════════════════════════
// getHourlyAvailability — precondition guards
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.getHourlyAvailability', () => {
  test('400 on malformed date', async () => {
    const ctx = await buildSut();
    await expect(ctx.sut.getHourlyAvailability('a1', 'not-a-date'))
      .rejects.toThrow(/invalid date/i);
    // Guard must fire BEFORE DB is hit
    expect(ctx.prisma._client.activity.findUnique).not.toHaveBeenCalled();
  });

  test('404 when activity missing', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.activity.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.getHourlyAvailability('a-missing', '2026-05-01'))
      .rejects.toThrow(NotFoundException);
  });

  test('404 when activity exists but INACTIVE (status guard)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.activity.findUnique.mockResolvedValueOnce({
      id: 'a1', status: 'INACTIVE', bookingType: 'HOURLY',
      checkInTime: '09:00', checkOutTime: '17:00', durationValue: 2,
      country: { defaultTimezone: 'UTC' },
    });
    await expect(ctx.sut.getHourlyAvailability('a1', '2026-05-01'))
      .rejects.toThrow(NotFoundException);
  });

  test('400 when activity is DAILY (wrong booking type)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.activity.findUnique.mockResolvedValueOnce({
      id: 'a1', status: 'ACTIVE', bookingType: 'DAILY',
      checkInTime: null, checkOutTime: null, durationValue: null,
      country: { defaultTimezone: 'UTC' },
    });
    await expect(ctx.sut.getHourlyAvailability('a1', '2026-05-01'))
      .rejects.toThrow(/not HOURLY/);
  });

  test('400 when activity config incomplete (missing checkInTime)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.activity.findUnique.mockResolvedValueOnce({
      id: 'a1', status: 'ACTIVE', bookingType: 'HOURLY',
      checkInTime: null, checkOutTime: '17:00', durationValue: 2,
      country: { defaultTimezone: 'UTC' },
    });
    await expect(ctx.sut.getHourlyAvailability('a1', '2026-05-01'))
      .rejects.toThrow(/configuration incomplete/i);
  });

  test('400 when durationValue is 0 → caught by config-incomplete guard (falsy)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.activity.findUnique.mockResolvedValueOnce({
      id: 'a1', status: 'ACTIVE', bookingType: 'HOURLY',
      checkInTime: '09:00', checkOutTime: '17:00', durationValue: 0,
      country: { defaultTimezone: 'UTC' },
    });
    await expect(ctx.sut.getHourlyAvailability('a1', '2026-05-01'))
      .rejects.toThrow(/configuration incomplete/i);
  });

  test('400 when durationValue is negative → caught by "> 0" guard (div-by-zero)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.activity.findUnique.mockResolvedValueOnce({
      id: 'a1', status: 'ACTIVE', bookingType: 'HOURLY',
      checkInTime: '09:00', checkOutTime: '17:00', durationValue: -1,
      country: { defaultTimezone: 'UTC' },
    });
    await expect(ctx.sut.getHourlyAvailability('a1', '2026-05-01'))
      .rejects.toThrow(/duration must be greater than 0/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getDailyAvailability — precondition guards (mirror of HOURLY)
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.getDailyAvailability', () => {
  test('404 when activity missing', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.activity.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.getDailyAvailability('a1', '2026-05-01', '2026-05-03'))
      .rejects.toThrow(NotFoundException);
  });

  test('400 on malformed check-in date', async () => {
    const ctx = await buildSut();
    await expect(ctx.sut.getDailyAvailability('a1', 'bad-date', '2026-05-03'))
      .rejects.toThrow(/invalid/i);
    expect(ctx.prisma._client.activity.findUnique).not.toHaveBeenCalled();
  });

  test('400 when activity is HOURLY (wrong booking type)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.activity.findUnique.mockResolvedValueOnce({
      id: 'a1', status: 'ACTIVE', bookingType: 'HOURLY',
      checkInTime: '09:00', checkOutTime: '17:00', durationValue: 2,
      country: { defaultTimezone: 'UTC' },
    });
    await expect(ctx.sut.getDailyAvailability('a1', '2026-05-01', '2026-05-03'))
      .rejects.toThrow(/not DAILY/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getCalendarAvailability — basic guards
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsService.getCalendarAvailability', () => {
  test('404 when activity missing (existence check comes before month validation)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.activity.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.getCalendarAvailability('a1', '2026-05'))
      .rejects.toThrow(NotFoundException);
  });

  test('400 on out-of-range month (e.g. month 13) AFTER activity lookup', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.activity.findUnique.mockResolvedValueOnce({
      id: 'a1', status: 'ACTIVE', bookingType: 'HOURLY',
      country: { currencyCode: 'QAR', defaultTimezone: 'UTC' },
    });
    await expect(ctx.sut.getCalendarAvailability('a1', '2026-13'))
      .rejects.toThrow(/invalid month format/i);
  });

  test('cache hit short-circuits before any compute', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.activity.findUnique.mockResolvedValueOnce({
      id: 'a1', status: 'ACTIVE', bookingType: 'HOURLY',
      country: { currencyCode: 'QAR', defaultTimezone: 'UTC' },
    });
    const cachedPayload = { days: [{ date: '2026-05-01', available: 5 }] };
    ctx.cache.get.mockResolvedValueOnce(cachedPayload);

    const r = await ctx.sut.getCalendarAvailability('a1', '2026-05');
    expect(r).toBe(cachedPayload);
    // No booking query happened
    expect(ctx.prisma._client.booking.findMany).not.toHaveBeenCalled();
  });
});
