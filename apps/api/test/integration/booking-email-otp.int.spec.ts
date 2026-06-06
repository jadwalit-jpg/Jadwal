/**
 * Booking email-OTP — once-per-user behaviour.
 *
 * The OTP proves "a real human controls this email" and only needs to clear
 * ONCE per customer. This suite pins that:
 *   - A fresh user's FIRST booking sends an OTP and is born unverified.
 *   - Clearing the OTP stamps `User.bookingOtpVerifiedAt` (one-way, set-once).
 *   - Every LATER booking by that user is born already `emailOtpVerifiedAt` —
 *     no OTP email sent, payment gate satisfied.
 *   - A first-timer who abandons (never verifies) still gets an OTP next time.
 */

import { getTestContext, seedReference } from './_setup';
import { BookingsService } from '../../src/bookings/bookings.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import * as crypto from 'crypto';

// Must match the pepper the BookingsService mock config returns below, so the
// hash stampOtp() seeds verifies against hashBookingOtp()'s peppered HMAC.
const OTP_PEPPER = 'test-otp-pepper';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeBookingsService() {
  const prismaSvc = { client: ctx.prisma } as any;
  const auditLogger = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const notificationService = {
    send: jest.fn().mockResolvedValue(undefined),
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
    sendToMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  const redisLock = {
    acquire: jest.fn().mockResolvedValue('lock-token'),
    release: jest.fn().mockResolvedValue(undefined),
  } as any;
  const configService = {
    get: (k: string, fallback?: string) => {
      const cfg: Record<string, string> = {
        RESERVATION_WINDOW_MINUTES: '15',
        BOOKING_MAX_ADVANCE_YEARS: '2',
        REDIS_LOCK_TTL_MS: '30000',
        BOOKING_OTP_PEPPER: OTP_PEPPER,
      };
      return cfg[k] ?? fallback;
    },
  } as any;
  const loyalty = new LoyaltyService(prismaSvc);
  const availabilityCache = {
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidateMany: jest.fn().mockResolvedValue(undefined),
  } as any;
  // sendBookingOtp returns true even on failure (anti-enumeration); the mock
  // mirrors that. We assert on call COUNT, not the return value.
  const emailService = {
    sendBookingOtp: jest.fn().mockResolvedValue(true),
  } as any;
  const emailQuota = {
    tryConsume: jest.fn().mockResolvedValue(true),
  } as any;
  const securityLogger = { log: jest.fn() } as any;

  return {
    svc: new BookingsService(
      prismaSvc, auditLogger, notificationService, redisLock,
      configService, loyalty, availabilityCache,
      emailService, emailQuota, securityLogger,
    ),
    emailService,
  };
}

/** YYYY-MM-DD a fixed number of days in the future. */
function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/**
 * The booking-create OTP send is fire-and-forget (`void … .catch()`). Poll the
 * mock until it has been called `expected` times, or fail after the timeout.
 */
async function waitForOtpSends(
  fn: jest.Mock,
  expected: number,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (fn.mock.calls.length < expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  expect(fn).toHaveBeenCalledTimes(expected);
}

/** Settle any still-pending fire-and-forget OTP work before a negative assert. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 150));
}

/**
 * Stamp a known OTP code on a PENDING booking so `verifyBookingEmailOtp` can be
 * exercised without the (mocked) email send. Mirrors `generateAndSendBookingOtp`.
 */
async function stampOtp(bookingId: string, code: string): Promise<void> {
  await ctx.prisma.booking.update({
    where: { id: bookingId },
    data: {
      emailOtpHash: crypto.createHmac('sha256', OTP_PEPPER).update(code).digest('hex'),
      emailOtpExpiry: new Date(Date.now() + 10 * 60 * 1000),
      emailOtpAttempts: 0,
    },
  });
}

describe('Booking email-OTP — once-per-user', () => {
  test('first booking of a fresh user → unverified + OTP email sent', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc, emailService } = makeBookingsService();

    const res = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 1,
      bookingPhone: '+97455123456',
    });

    const b = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: res.booking.id },
    });
    expect(b.status).toBe('PENDING');
    expect(b.emailOtpVerifiedAt).toBeNull();

    await waitForOtpSends(emailService.sendBookingOtp, 1);

    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: seed.customer.id },
    });
    expect(user.bookingOtpVerifiedAt).toBeNull();
  });

  test('clearing the OTP stamps User.bookingOtpVerifiedAt (set-once)', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc } = makeBookingsService();

    const res = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 1,
      bookingPhone: '+97455123456',
    });

    await stampOtp(res.booking.id, '123456');
    await svc.verifyBookingEmailOtp(seed.customer.id, res.booking.id, '123456');

    const afterFirst = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: seed.customer.id },
    });
    expect(afterFirst.bookingOtpVerifiedAt).toBeInstanceOf(Date);

    // A second verify on the already-verified booking is an idempotent no-op
    // and must NOT move the original timestamp.
    await svc.verifyBookingEmailOtp(seed.customer.id, res.booking.id, '123456');
    const afterSecond = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: seed.customer.id },
    });
    expect(afterSecond.bookingOtpVerifiedAt!.getTime()).toBe(
      afterFirst.bookingOtpVerifiedAt!.getTime(),
    );
  });

  test('second booking of a verified user → born verified, NO OTP email', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc, emailService } = makeBookingsService();

    // First booking → verify the OTP.
    const first = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 1,
      bookingPhone: '+97455123456',
    });
    await waitForOtpSends(emailService.sendBookingOtp, 1);
    await stampOtp(first.booking.id, '654321');
    await svc.verifyBookingEmailOtp(seed.customer.id, first.booking.id, '654321');

    emailService.sendBookingOtp.mockClear();

    // Second booking → must skip the OTP entirely.
    const second = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(8),
      slotTime: '10:00',
      guests: 1,
      bookingPhone: '+97455123456',
    });

    const b = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: second.booking.id },
    });
    // Born verified → payment.service's `if (!booking.emailOtpVerifiedAt)`
    // gate passes and the frontend's `needsEmailOtp` computes false.
    expect(b.status).toBe('PENDING');
    expect(b.emailOtpVerifiedAt).toBeInstanceOf(Date);
    expect(b.emailOtpHash).toBeNull();

    await settle();
    expect(emailService.sendBookingOtp).not.toHaveBeenCalled();
  });

  test('first-timer who abandons (never verifies) → next booking still needs the OTP', async () => {
    const seed = await seedReference(ctx.prisma);
    const { svc, emailService } = makeBookingsService();

    // First booking — OTP sent but never verified.
    await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(7),
      slotTime: '10:00',
      guests: 1,
      bookingPhone: '+97455123456',
    });
    await waitForOtpSends(emailService.sendBookingOtp, 1);

    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: seed.customer.id },
    });
    expect(user.bookingOtpVerifiedAt).toBeNull();

    // Second booking — still a first-timer → another OTP, born unverified.
    const second = await svc.createBooking(seed.customer.id, {
      activityId: seed.activity.id,
      checkInDate: futureDate(8),
      slotTime: '10:00',
      guests: 1,
      bookingPhone: '+97455123456',
    });
    await waitForOtpSends(emailService.sendBookingOtp, 2);

    const b = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: second.booking.id },
    });
    expect(b.emailOtpVerifiedAt).toBeNull();
  });
});
