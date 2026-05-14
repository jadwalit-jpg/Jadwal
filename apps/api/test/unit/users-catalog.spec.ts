/**
 * UsersService + UsersController + CustomerInteractionController +
 * OffersController — Wave 3 consolidated.
 */

// Stub UploadService before imports (file-type ESM killer)
jest.mock('../../src/common/services/upload.service', () => ({
  UploadService: class {
    static diskStorageConfig() { return {}; }
    validateFile() { /* no-op */ }
    async upload() { return 'https://cdn/x'; }
  },
  ALLOWED_MIME: [], MIME_TO_EXT: {}, ALLOWED_EXT: [],
}));

import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UsersService } from '../../src/users/users.service';
import { UsersController } from '../../src/users/users.controller';
import { PrismaService } from '../../src/prisma/prisma.service';
import { makePrismaMock, mockDecimal } from '../mocks/prisma.mock';

async function buildUsersSut() {
  const prisma = makePrismaMock();
  const mod = await Test.createTestingModule({
    providers: [UsersService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return { sut: mod.get(UsersService), prisma };
}

// ═══════════════════════════════════════════════════════════════════════════
// UsersService
// ═══════════════════════════════════════════════════════════════════════════

describe('UsersService.getProfile', () => {
  test('404 when user does not exist', async () => {
    const ctx = await buildUsersSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.getProfile('u-missing'))
      .rejects.toThrow(NotFoundException);
  });

  test('returns user + stats (totalBookings + upcoming + completed + totalSpent)', async () => {
    const ctx = await buildUsersSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', fullName: 'A', email: 'a@b.com', phone: null,
      emailVerified: true, role: 'CUSTOMER',
      createdAt: new Date(),
    });
    ctx.prisma._client.booking.count.mockResolvedValueOnce(10);  // total
    ctx.prisma._client.booking.count.mockResolvedValueOnce(3);   // upcoming
    ctx.prisma._client.booking.count.mockResolvedValueOnce(5);   // completed
    ctx.prisma._client.booking.aggregate.mockResolvedValueOnce({
      _sum: { totalPrice: 1000.55, serviceFee: 100.45 },
    });

    const r = await ctx.sut.getProfile('u1');
    expect(r.stats).toEqual({
      totalBookings: 10, upcomingCount: 3, completedCount: 5, totalSpent: 1101,
    });
  });

  test('never returns password hash (select explicitly scoped)', async () => {
    const ctx = await buildUsersSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', fullName: 'A', email: 'a@b.com',
    });
    ctx.prisma._client.booking.aggregate.mockResolvedValueOnce({ _sum: {} });

    await ctx.sut.getProfile('u1');

    // Assert select block excludes password fields
    const call = ctx.prisma._client.user.findUnique.mock.calls[0][0];
    expect(call.select).toBeDefined();
    expect(call.select.password).toBeUndefined();
  });
});

describe('UsersService.updateProfile', () => {
  test('404 when user missing', async () => {
    const ctx = await buildUsersSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.updateProfile('u-missing', { fullName: 'X' } as any))
      .rejects.toThrow(NotFoundException);
  });

  test('phone change updates the phone column directly (no OTP reset machinery)', async () => {
    // SMS/OTP was retired — phone is now stored as-is, the canonical
    // contact value lives on the booking (`Booking.bookingPhone`).
    const ctx = await buildUsersSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', fullName: 'A', phone: '+97400000001',
    });

    await ctx.sut.updateProfile('u1', { phone: '+97400000002' } as any);

    const data = ctx.prisma._client.user.update.mock.calls[0][0].data;
    expect(data).toEqual({ phone: '+97400000002' });
    // No OTP-reset side effects remain.
    expect(data).not.toHaveProperty('phoneVerified');
    expect(data).not.toHaveProperty('phoneOtpHash');
  });

  test('fullName-only change → does not touch phone/OTP fields', async () => {
    const ctx = await buildUsersSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({
      id: 'u1', fullName: 'A', phone: '+97400000001',
    });

    await ctx.sut.updateProfile('u1', { fullName: 'New Name' } as any);

    const data = ctx.prisma._client.user.update.mock.calls[0][0].data;
    expect(data).toEqual({ fullName: 'New Name' });
  });
});

describe('UsersService.getPoints', () => {
  test('404 when user missing', async () => {
    const ctx = await buildUsersSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce(null);
    await expect(ctx.sut.getPoints('u-missing'))
      .rejects.toThrow(NotFoundException);
  });

  test('auto-creates loyalty config singleton on first call', async () => {
    const ctx = await buildUsersSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ loyaltyPoints: 500 });
    ctx.prisma._client.loyaltyConfig.findUnique.mockResolvedValueOnce(null);
    ctx.prisma._client.loyaltyConfig.create.mockResolvedValueOnce({
      id: 'singleton', qarPerPoint: mockDecimal(0.1), minRedemption: 100,
    });

    const r = await ctx.sut.getPoints('u1');
    expect(r.loyaltyPoints).toBe(500);
    expect(ctx.prisma._client.loyaltyConfig.create).toHaveBeenCalled();
  });

  test('response does NOT include pointsPerQar (admin-only config)', async () => {
    const ctx = await buildUsersSut();
    ctx.prisma._client.user.findUnique.mockResolvedValueOnce({ loyaltyPoints: 0 });
    ctx.prisma._client.loyaltyConfig.findUnique.mockResolvedValueOnce({
      id: 'singleton', qarPerPoint: mockDecimal(0.1), minRedemption: 100, pointsPerQar: mockDecimal(1),
    });

    const r = await ctx.sut.getPoints('u1');
    expect(r).not.toHaveProperty('pointsPerQar');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// UsersController — thin delegation
// ═══════════════════════════════════════════════════════════════════════════

describe('UsersController', () => {
  async function buildCtrl() {
    const svc = {
      getProfile:    jest.fn().mockResolvedValue({ id: 'u1' }),
      updateProfile: jest.fn().mockResolvedValue({ id: 'u1' }),
      getPoints:     jest.fn().mockResolvedValue({ loyaltyPoints: 100 }),
    };
    const mod = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: svc }],
    }).compile();
    return { ctrl: mod.get(UsersController), svc };
  }

  test('GET /users/profile → getProfile(user.id)', async () => {
    const { ctrl, svc } = await buildCtrl();
    await ctrl.getProfile({ id: 'u1' } as any);
    expect(svc.getProfile).toHaveBeenCalledWith('u1');
  });

  test('PATCH /users/profile → updateProfile(user.id, dto)', async () => {
    const { ctrl, svc } = await buildCtrl();
    await ctrl.updateProfile({ id: 'u1' } as any, { fullName: 'N' } as any);
    expect(svc.updateProfile).toHaveBeenCalledWith('u1', { fullName: 'N' });
  });

  test('GET /users/points → getPoints(user.id)', async () => {
    const { ctrl, svc } = await buildCtrl();
    await ctrl.getPoints({ id: 'u1' } as any);
    expect(svc.getPoints).toHaveBeenCalledWith('u1');
  });
});
