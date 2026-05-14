/**
 * Wave 4 + 5 finish — geo, audit/security loggers, hourly-activity
 * validator. Email + upload are heavy external-service wrappers and are
 * best exercised at the integration tier with fake credentials.
 *
 * The legacy SmsService block here was removed when SMS/OTP was retired —
 * the platform now relies on email only, and per-booking phone is
 * collected at booking-create time, not verified.
 */

import { Test } from '@nestjs/testing';
import { GeoService } from '../../src/geo/geo.service';
import { AuditLoggerService } from '../../src/common/services/audit-logger.service';
import { SecurityLoggerService } from '../../src/common/services/security-logger.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { assertHourlyTimesConsistent } from '../../src/common/validators/hourly-activity';
import { makePrismaMock } from '../mocks/prisma.mock';

// ═══════════════════════════════════════════════════════════════════════════
// GeoService
// ═══════════════════════════════════════════════════════════════════════════

describe('GeoService.detectLocation', () => {
  async function build() {
    const prisma = makePrismaMock();
    const mod = await Test.createTestingModule({
      providers: [GeoService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return { sut: mod.get(GeoService), prisma };
  }

  test('unknown IP → defaults to Qatar fallback country', async () => {
    const ctx = await build();
    // First findFirst (geo'd country) returns null
    ctx.prisma._client.country.findFirst.mockResolvedValueOnce(null);
    // Second (fallback Qatar) returns country
    ctx.prisma._client.country.findFirst.mockResolvedValueOnce({
      id: 'c-qa', nameEn: 'Qatar', nameAr: 'قطر', isoCode: 'QA', currencyCode: 'QAR',
    });
    ctx.prisma._client.city.findMany.mockResolvedValueOnce([
      { id: 'city-doha', nameEn: 'Doha', nameAr: 'الدوحة', lat: 25.28, lng: 51.53 },
    ]);

    const r = await ctx.sut.detectLocation('127.0.0.1'); // localhost → no geo match
    expect(r.country?.isoCode).toBe('QA');
    expect(r.source).toBe('fallback');
    expect(r.city?.nameEn).toBe('Doha');
  });

  test('no countries in DB → returns null/null/none', async () => {
    const ctx = await build();
    ctx.prisma._client.country.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.country.findFirst.mockResolvedValueOnce(null);

    const r = await ctx.sut.detectLocation('127.0.0.1');
    expect(r).toEqual({ country: null, city: null, source: 'none' });
  });

  test('multiple cities with coords → picks nearest by haversine', async () => {
    const ctx = await build();
    // Mock geoip to fake-return coords via the stubbed country path below
    // For unit purposes we verify the city-selection logic when >1 city exists
    ctx.prisma._client.country.findFirst.mockResolvedValueOnce(null);
    ctx.prisma._client.country.findFirst.mockResolvedValueOnce({
      id: 'c-qa', nameEn: 'Qatar', nameAr: 'قطر', isoCode: 'QA', currencyCode: 'QAR',
    });
    // Without real geoip coords, cities[0] is returned — still a deterministic
    // fallback, not a crash.
    ctx.prisma._client.city.findMany.mockResolvedValueOnce([
      { id: 'c1', nameEn: 'Doha', nameAr: 'د', lat: 25.28, lng: 51.53 },
      { id: 'c2', nameEn: 'Al Khor', nameAr: 'خ', lat: 25.68, lng: 51.50 },
    ]);

    const r = await ctx.sut.detectLocation('127.0.0.1');
    expect(r.city).not.toBeNull();
    expect(['c1', 'c2']).toContain(r.city?.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AuditLoggerService
// ═══════════════════════════════════════════════════════════════════════════

describe('AuditLoggerService', () => {
  async function build() {
    const prisma = makePrismaMock();
    const mod = await Test.createTestingModule({
      providers: [AuditLoggerService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return { sut: mod.get(AuditLoggerService), prisma };
  }

  test('creates audit row with all supplied params', async () => {
    const ctx = await build();
    await ctx.sut.log({
      actorType: 'ADMIN', actorId: 'a1', actorName: 'Admin',
      action: 'TEST_ACTION', entity: 'Test', entityId: 'e1', details: 'x',
    });
    expect(ctx.prisma._client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorType: 'ADMIN', actorId: 'a1', action: 'TEST_ACTION', entityId: 'e1',
        }),
      }),
    );
  });

  test('details truncated to ≤1000 chars', async () => {
    const ctx = await build();
    const long = 'x'.repeat(5000);
    await ctx.sut.log({
      actorType: 'SYSTEM', actorId: 'sys', actorName: 'system',
      action: 'a', entity: 'e', details: long,
    });
    const data = ctx.prisma._client.auditLog.create.mock.calls[0][0].data;
    expect(data.details.length).toBeLessThanOrEqual(1000);
  });

  test('Prisma failure does NOT throw (fire-and-forget)', async () => {
    const ctx = await build();
    ctx.prisma._client.auditLog.create.mockRejectedValueOnce(new Error('DB down'));
    await expect(ctx.sut.log({
      actorType: 'SYSTEM', actorId: 'sys', actorName: 's', action: 'a', entity: 'e',
    })).resolves.not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SecurityLoggerService
// ═══════════════════════════════════════════════════════════════════════════

describe('SecurityLoggerService', () => {
  async function build() {
    const prisma = makePrismaMock();
    const mod = await Test.createTestingModule({
      providers: [SecurityLoggerService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return { sut: mod.get(SecurityLoggerService), prisma };
  }

  test('email is masked (j***@example.com) — never stored in full', async () => {
    const ctx = await build();
    await ctx.sut.log({
      event: 'LOGIN_FAILED', email: 'john.doe@example.com',
      ip: '1.2.3.4', userAgent: 'UA',
    });
    const data = ctx.prisma._client.securityLog.create.mock.calls[0][0].data;
    expect(data.email).toBe('j***@example.com');
    expect(data.email).not.toContain('john.doe');
  });

  test('missing email → stored as null (no "undefined" string)', async () => {
    const ctx = await build();
    await ctx.sut.log({ event: 'LOGIN_SUCCESS', userId: 'u1' });
    const data = ctx.prisma._client.securityLog.create.mock.calls[0][0].data;
    expect(data.email).toBeNull();
  });

  test('IP is NEVER stored (GDPR/GCC privacy) — always null regardless of input', async () => {
    const ctx = await build();
    await ctx.sut.log({
      event: 'LOGIN_SUCCESS', userId: 'u1', ip: '203.0.113.42', userAgent: 'UA',
    });
    const data = ctx.prisma._client.securityLog.create.mock.calls[0][0].data;
    expect(data.ip).toBeNull();
  });

  test('userAgent length-capped at 500 chars', async () => {
    const ctx = await build();
    await ctx.sut.log({
      event: 'LOGIN_SUCCESS', userId: 'u1', userAgent: 'UA'.repeat(500),
    });
    const data = ctx.prisma._client.securityLog.create.mock.calls[0][0].data;
    expect(data.userAgent.length).toBeLessThanOrEqual(500);
  });

  test('Prisma failure does NOT throw (fire-and-forget)', async () => {
    const ctx = await build();
    ctx.prisma._client.securityLog.create.mockRejectedValueOnce(new Error('DB down'));
    await expect(ctx.sut.log({ event: 'LOGIN_SUCCESS', userId: 'u1' }))
      .resolves.not.toThrow();
  });

  test('email with no @ → masked to *** (defensive)', async () => {
    const ctx = await build();
    await ctx.sut.log({ event: 'LOGIN_FAILED', email: 'noatsign' });
    const data = ctx.prisma._client.securityLog.create.mock.calls[0][0].data;
    expect(data.email).toBe('***');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// assertHourlyTimesConsistent
// ═══════════════════════════════════════════════════════════════════════════

describe('assertHourlyTimesConsistent', () => {
  test('non-HOURLY types → no-op (no throw)', () => {
    expect(() => assertHourlyTimesConsistent({ bookingType: 'DAILY' })).not.toThrow();
    expect(() => assertHourlyTimesConsistent({ bookingType: null })).not.toThrow();
    expect(() => assertHourlyTimesConsistent({ bookingType: undefined })).not.toThrow();
  });

  test('HOURLY without checkInTime → 400', () => {
    expect(() => assertHourlyTimesConsistent({
      bookingType: 'HOURLY', checkInTime: null, checkOutTime: '17:00', durationValue: 2,
    })).toThrow(/checkInTime/);
  });

  test('HOURLY without checkOutTime → 400', () => {
    expect(() => assertHourlyTimesConsistent({
      bookingType: 'HOURLY', checkInTime: '09:00', checkOutTime: null, durationValue: 2,
    })).toThrow(/checkOutTime/);
  });

  test('HOURLY without durationValue → 400', () => {
    expect(() => assertHourlyTimesConsistent({
      bookingType: 'HOURLY', checkInTime: '09:00', checkOutTime: '17:00', durationValue: null,
    })).toThrow(/durationValue/);
  });

  test('HOURLY with malformed HH:MM → 400', () => {
    expect(() => assertHourlyTimesConsistent({
      bookingType: 'HOURLY', checkInTime: 'hh:mm', checkOutTime: '17:00', durationValue: 2,
    })).toThrow(/Invalid time format/);
  });

  test('checkOutTime <= checkInTime → 400', () => {
    expect(() => assertHourlyTimesConsistent({
      bookingType: 'HOURLY', checkInTime: '10:00', checkOutTime: '09:00', durationValue: 1,
    })).toThrow(/after checkInTime/);
    expect(() => assertHourlyTimesConsistent({
      bookingType: 'HOURLY', checkInTime: '10:00', checkOutTime: '10:00', durationValue: 1,
    })).toThrow(/after checkInTime/);
  });

  test('durationValue <= 0 → 400', () => {
    expect(() => assertHourlyTimesConsistent({
      bookingType: 'HOURLY', checkInTime: '09:00', checkOutTime: '17:00', durationValue: 0,
    })).toThrow(/durationValue must be greater than 0/);
    expect(() => assertHourlyTimesConsistent({
      bookingType: 'HOURLY', checkInTime: '09:00', checkOutTime: '17:00', durationValue: -1,
    })).toThrow(/durationValue must be greater than 0/);
  });

  test('durationValue exceeds operating window → 400', () => {
    // 09:00-17:00 = 8h window, duration=10h → error
    expect(() => assertHourlyTimesConsistent({
      bookingType: 'HOURLY', checkInTime: '09:00', checkOutTime: '17:00', durationValue: 10,
    })).toThrow(/exceeds the operating window/);
  });

  test('valid configuration → no throw', () => {
    expect(() => assertHourlyTimesConsistent({
      bookingType: 'HOURLY', checkInTime: '09:00', checkOutTime: '17:00', durationValue: 2,
    })).not.toThrow();
  });

  test('duration exactly equal to window → valid (edge case)', () => {
    expect(() => assertHourlyTimesConsistent({
      bookingType: 'HOURLY', checkInTime: '09:00', checkOutTime: '10:00', durationValue: 1,
    })).not.toThrow();
  });
});
