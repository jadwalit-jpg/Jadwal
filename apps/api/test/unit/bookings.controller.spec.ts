/**
 * BookingsController + AvailabilityController — thin HTTP layer.
 *
 * Verifies delegation, RBAC short-circuits, query coercion, coupon-validate
 * pre-DB guards.
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BookingsController } from '../../src/bookings/bookings.controller';
import { AvailabilityController } from '../../src/bookings/availability.controller';
import { BookingsService } from '../../src/bookings/bookings.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { makePrismaMock } from '../mocks/prisma.mock';

function makeBookingsSvcMock() {
  return {
    createBooking:         jest.fn().mockResolvedValue({ id: 'b1' }),
    getMyBookings:         jest.fn().mockResolvedValue({ items: [], total: 0 }),
    getBookingById:        jest.fn().mockResolvedValue({ id: 'b1' }),
    cancelBooking:         jest.fn().mockResolvedValue({ id: 'b1', status: 'CANCELLED' }),
    recordRefundDecision:  jest.fn().mockResolvedValue({ ok: true }),
    getHourlyAvailability: jest.fn().mockResolvedValue({ slots: [] }),
    getDailyAvailability:  jest.fn().mockResolvedValue({ days: [] }),
    getCalendarAvailability: jest.fn().mockResolvedValue({ days: [] }),
    getVendorRefundRequests: jest.fn().mockResolvedValue([]),
    awardLoyaltyPoints:    jest.fn().mockResolvedValue(null),
  };
}

async function buildBookingsCtrl() {
  const svc = makeBookingsSvcMock();
  const prisma = makePrismaMock();
  const mod = await Test.createTestingModule({
    controllers: [BookingsController],
    providers: [
      { provide: BookingsService, useValue: svc },
      { provide: PrismaService,   useValue: prisma },
    ],
  }).compile();
  return { ctrl: mod.get(BookingsController), svc, prisma };
}

async function buildAvailabilityCtrl() {
  const svc = makeBookingsSvcMock();
  const mod = await Test.createTestingModule({
    controllers: [AvailabilityController],
    providers: [{ provide: BookingsService, useValue: svc }],
  }).compile();
  return { ctrl: mod.get(AvailabilityController), svc };
}

// ═══════════════════════════════════════════════════════════════════════════
// BookingsController — create, list, get, cancel
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsController — core routes', () => {
  test('POST /bookings blocks ADMIN role (only customers can book)', async () => {
    const { ctrl, svc } = await buildBookingsCtrl();
    expect(() => ctrl.create({ id: 'a1', role: 'ADMIN' } as any, {} as any))
      .toThrow(ForbiddenException);
    expect(svc.createBooking).not.toHaveBeenCalled();
  });

  test('POST /bookings blocks VENDOR role', async () => {
    const { ctrl, svc } = await buildBookingsCtrl();
    expect(() => ctrl.create({ id: 'v1', role: 'VENDOR' } as any, {} as any))
      .toThrow(ForbiddenException);
    expect(svc.createBooking).not.toHaveBeenCalled();
  });

  test('POST /bookings → createBooking(userId, dto) for CUSTOMER', async () => {
    const { ctrl, svc } = await buildBookingsCtrl();
    const dto = { activityId: 'a1', guests: 2 } as any;
    await ctrl.create({ id: 'u1', role: 'CUSTOMER' } as any, dto);
    expect(svc.createBooking).toHaveBeenCalledWith('u1', dto);
  });

  test('GET /bookings/my coerces negative page to 1 and falsy limit to default 20', async () => {
    // parseInt('-5') || 1 → -5 (truthy), Math.max(1, -5) → 1
    // parseInt('0')  || 20 → 20 (0 is falsy falls back to 20), Math.max(1, 20) → 20
    const { ctrl, svc } = await buildBookingsCtrl();
    await ctrl.getMyBookings({ id: 'u1' } as any, '-5', '0', undefined);
    expect(svc.getMyBookings).toHaveBeenCalledWith('u1', 1, 20, undefined);
  });

  test('GET /bookings/my accepts valid status (case-insensitive)', async () => {
    const { ctrl, svc } = await buildBookingsCtrl();
    await ctrl.getMyBookings({ id: 'u1' } as any, '1', '20', 'confirmed');
    expect(svc.getMyBookings).toHaveBeenCalledWith('u1', 1, 20, 'CONFIRMED');
  });

  test('GET /bookings/my ignores invalid status (passes undefined)', async () => {
    const { ctrl, svc } = await buildBookingsCtrl();
    await ctrl.getMyBookings({ id: 'u1' } as any, '1', '20', 'NOT_A_STATUS');
    expect(svc.getMyBookings).toHaveBeenCalledWith('u1', 1, 20, undefined);
  });

  test('GET /bookings/my/:id delegates to getBookingById', async () => {
    const { ctrl, svc } = await buildBookingsCtrl();
    await ctrl.getOne({ id: 'u1' } as any, 'b1');
    expect(svc.getBookingById).toHaveBeenCalledWith('u1', 'b1');
  });

  test('DELETE /bookings/:id/cancel delegates to cancelBooking', async () => {
    const { ctrl, svc } = await buildBookingsCtrl();
    await ctrl.cancel({ id: 'u1' } as any, 'b1');
    expect(svc.cancelBooking).toHaveBeenCalledWith('u1', 'b1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BookingsController — refund decision (vendor / admin)
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsController.recordRefundDecision', () => {
  test('403 when CUSTOMER calls (RBAC)', async () => {
    const { ctrl, svc } = await buildBookingsCtrl();
    expect(() => ctrl.recordRefundDecision(
      { id: 'u1', role: 'CUSTOMER' } as any, 'b1',
      { action: 'APPROVE', amount: 50 } as any,
    )).toThrow(ForbiddenException);
    expect(svc.recordRefundDecision).not.toHaveBeenCalled();
  });

  test('VENDOR → delegates with user.id, user.role, id, action, amount, note', async () => {
    const { ctrl, svc } = await buildBookingsCtrl();
    await ctrl.recordRefundDecision(
      { id: 'v1', role: 'VENDOR' } as any, 'b1',
      { action: 'APPROVE', amount: 50, note: 'ok' } as any,
    );
    expect(svc.recordRefundDecision).toHaveBeenCalledWith('v1', 'VENDOR', 'b1', 'APPROVE', 50, 'ok');
  });

  test('ADMIN → delegates identically', async () => {
    const { ctrl, svc } = await buildBookingsCtrl();
    await ctrl.recordRefundDecision(
      { id: 'a1', role: 'ADMIN' } as any, 'b1',
      { action: 'REJECT' } as any,
    );
    expect(svc.recordRefundDecision).toHaveBeenCalledWith('a1', 'ADMIN', 'b1', 'REJECT', undefined, undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BookingsController.validateCoupon
// ═══════════════════════════════════════════════════════════════════════════

describe('BookingsController.validateCoupon', () => {
  test('400 when code or activityId missing', async () => {
    const { ctrl } = await buildBookingsCtrl();
    await expect(ctrl.validateCoupon('', 'a1', '100')).rejects.toThrow(BadRequestException);
    await expect(ctrl.validateCoupon('X', '', '100')).rejects.toThrow(BadRequestException);
  });

  test('400 on malformed code (special chars, injection attempt)', async () => {
    const { ctrl, prisma } = await buildBookingsCtrl();
    await expect(ctrl.validateCoupon("'; DROP TABLE--", 'a1', '100'))
      .rejects.toThrow(/invalid coupon code format/i);
    // Guard fires before DB is hit
    expect(prisma._client.coupon.findUnique).not.toHaveBeenCalled();
  });

  test('400 when coupon not in DB', async () => {
    const { ctrl, prisma } = await buildBookingsCtrl();
    prisma._client.coupon.findUnique.mockResolvedValueOnce(null);
    await expect(ctrl.validateCoupon('NOPE', 'a1', '100'))
      .rejects.toThrow(/invalid coupon code/i);
  });

  test('400 when coupon.status !== APPROVED', async () => {
    const { ctrl, prisma } = await buildBookingsCtrl();
    prisma._client.coupon.findUnique.mockResolvedValueOnce({
      id: 'c1', code: 'SAVE10', status: 'PENDING',
      validFrom: new Date(Date.now() - 1000), validTo: new Date(Date.now() + 1000),
      discountType: 'FIXED', discountValue: 10, minOrderAmount: null, maxDiscount: null,
      usageLimit: null, usedCount: 0, vendorId: null, applicableActivityIds: [],
    });
    await expect(ctrl.validateCoupon('SAVE10', 'a1', '100'))
      .rejects.toThrow(/not active/i);
  });

  test('400 when coupon expired', async () => {
    const { ctrl, prisma } = await buildBookingsCtrl();
    prisma._client.coupon.findUnique.mockResolvedValueOnce({
      id: 'c1', code: 'OLD', status: 'APPROVED',
      validFrom: new Date(Date.now() - 10000), validTo: new Date(Date.now() - 1000),
      discountType: 'FIXED', discountValue: 10, minOrderAmount: null, maxDiscount: null,
      usageLimit: null, usedCount: 0, vendorId: null, applicableActivityIds: [],
    });
    await expect(ctrl.validateCoupon('OLD', 'a1', '100'))
      .rejects.toThrow(/expired/i);
  });

  test('400 when usageLimit reached', async () => {
    const { ctrl, prisma } = await buildBookingsCtrl();
    prisma._client.coupon.findUnique.mockResolvedValueOnce({
      id: 'c1', code: 'LIMIT', status: 'APPROVED',
      validFrom: new Date(Date.now() - 10000), validTo: new Date(Date.now() + 10000),
      discountType: 'FIXED', discountValue: 10, minOrderAmount: null, maxDiscount: null,
      usageLimit: 100, usedCount: 100, vendorId: null,
    });
    await expect(ctrl.validateCoupon('LIMIT', 'a1', '100'))
      .rejects.toThrow(/usage limit/i);
  });

  test('vendor-specific coupon → 400 when activity belongs to different vendor', async () => {
    const { ctrl, prisma } = await buildBookingsCtrl();
    prisma._client.coupon.findUnique.mockResolvedValueOnce({
      id: 'c1', code: 'VENDOR1', status: 'APPROVED',
      validFrom: new Date(Date.now() - 10000), validTo: new Date(Date.now() + 10000),
      discountType: 'FIXED', discountValue: 10, minOrderAmount: null, maxDiscount: null,
      usageLimit: null, usedCount: 0, vendorId: 'v1',
    });
    prisma._client.activity.findUnique.mockResolvedValueOnce({ vendorId: 'v2' });

    await expect(ctrl.validateCoupon('VENDOR1', 'a1', '100'))
      .rejects.toThrow(/not valid for this activity/i);
  });

  test('400 when orderAmount < minOrderAmount', async () => {
    const { ctrl, prisma } = await buildBookingsCtrl();
    prisma._client.coupon.findUnique.mockResolvedValueOnce({
      id: 'c1', code: 'MIN50', status: 'APPROVED',
      validFrom: new Date(Date.now() - 10000), validTo: new Date(Date.now() + 10000),
      discountType: 'FIXED', discountValue: 10, minOrderAmount: 50, maxDiscount: null,
      usageLimit: null, usedCount: 0, vendorId: null, applicableActivityIds: [],
    });
    await expect(ctrl.validateCoupon('MIN50', 'a1', '40'))
      .rejects.toThrow(/minimum order amount is 50/i);
  });

  test('PERCENTAGE coupon with maxDiscount cap → capped value returned', async () => {
    const { ctrl, prisma } = await buildBookingsCtrl();
    prisma._client.coupon.findUnique.mockResolvedValueOnce({
      id: 'c1', code: 'P20', status: 'APPROVED',
      validFrom: new Date(Date.now() - 10000), validTo: new Date(Date.now() + 10000),
      discountType: 'PERCENTAGE', discountValue: 20, minOrderAmount: null, maxDiscount: 15,
      usageLimit: null, usedCount: 0, vendorId: null, applicableActivityIds: [],
    });
    const r = await ctrl.validateCoupon('P20', 'a1', '200');
    // 20% of 200 = 40, capped at 15
    expect(r.discount).toBe(15);
  });

  test('FIXED coupon caps discount at order amount (no negative totals)', async () => {
    const { ctrl, prisma } = await buildBookingsCtrl();
    prisma._client.coupon.findUnique.mockResolvedValueOnce({
      id: 'c1', code: 'F50', status: 'APPROVED',
      validFrom: new Date(Date.now() - 10000), validTo: new Date(Date.now() + 10000),
      discountType: 'FIXED', discountValue: 50, minOrderAmount: null, maxDiscount: null,
      usageLimit: null, usedCount: 0, vendorId: null, applicableActivityIds: [],
    });
    const r = await ctrl.validateCoupon('F50', 'a1', '30');
    // Discount value 50 > order 30 → capped at 30
    expect(r.discount).toBe(30);
  });

  test('valid coupon → upper-cases + trims before DB lookup', async () => {
    const { ctrl, prisma } = await buildBookingsCtrl();
    prisma._client.coupon.findUnique.mockResolvedValueOnce({
      id: 'c1', code: 'SAVE10', status: 'APPROVED',
      validFrom: new Date(Date.now() - 10000), validTo: new Date(Date.now() + 10000),
      discountType: 'FIXED', discountValue: 10, minOrderAmount: null, maxDiscount: null,
      usageLimit: null, usedCount: 0, vendorId: null, applicableActivityIds: [],
    });
    await ctrl.validateCoupon('  save10  ', 'a1', '100');
    expect(prisma._client.coupon.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: 'SAVE10' } }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AvailabilityController
// ═══════════════════════════════════════════════════════════════════════════

describe('AvailabilityController', () => {
  test('GET /availability/hourly/:id delegates activityId + date', async () => {
    const { ctrl, svc } = await buildAvailabilityCtrl();
    await ctrl.hourly('a1', '2026-05-01');
    expect(svc.getHourlyAvailability).toHaveBeenCalledWith('a1', '2026-05-01');
  });

  test('GET /availability/daily/:id delegates + parses unitNumber', async () => {
    const { ctrl, svc } = await buildAvailabilityCtrl();
    await ctrl.daily('a1', '2026-05-01', '2026-05-03', '2');
    expect(svc.getDailyAvailability).toHaveBeenCalledWith('a1', '2026-05-01', '2026-05-03', 2);
  });

  test('GET /availability/daily undefined unit → passes undefined (not NaN)', async () => {
    const { ctrl, svc } = await buildAvailabilityCtrl();
    await ctrl.daily('a1', '2026-05-01', '2026-05-03', undefined);
    expect(svc.getDailyAvailability).toHaveBeenCalledWith('a1', '2026-05-01', '2026-05-03', undefined);
  });

  test('GET /availability/daily rejects non-integer unitNumber', async () => {
    const { ctrl } = await buildAvailabilityCtrl();
    expect(() => ctrl.daily('a1', '2026-05-01', '2026-05-03', 'abc'))
      .toThrow(/positive integer/i);
  });

  test('GET /availability/daily rejects zero/negative unitNumber', async () => {
    const { ctrl } = await buildAvailabilityCtrl();
    expect(() => ctrl.daily('a1', '2026-05-01', '2026-05-03', '0'))
      .toThrow(/positive integer/i);
    expect(() => ctrl.daily('a1', '2026-05-01', '2026-05-03', '-3'))
      .toThrow(/positive integer/i);
  });

  test('GET /availability/calendar/:id delegates with month + parsed unit', async () => {
    const { ctrl, svc } = await buildAvailabilityCtrl();
    await ctrl.calendar('a1', '2026-05', '1');
    expect(svc.getCalendarAvailability).toHaveBeenCalledWith('a1', '2026-05', 1);
  });

  test('GET /availability/calendar rejects non-integer unitNumber', async () => {
    const { ctrl } = await buildAvailabilityCtrl();
    expect(() => ctrl.calendar('a1', '2026-05', 'NaN'))
      .toThrow(/positive integer/i);
  });
});
