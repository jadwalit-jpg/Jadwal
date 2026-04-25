/**
 * LoyaltyService — single source of truth for loyaltyPoints mutations.
 *
 * Critical: conditional updateMany (atomic TOCTOU-safe redeem), ledger
 * append, adjust-with-clamp. Contract: every method requires a tx.
 */

import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { makePrismaMock } from '../mocks/prisma.mock';

async function buildSut() {
  const prisma = makePrismaMock();
  const mod = await Test.createTestingModule({
    providers: [LoyaltyService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  // Build a mock tx that mirrors prisma.client shape
  const tx = prisma._client as unknown as any;
  return { sut: mod.get(LoyaltyService), tx, prisma };
}

// ═══════════════════════════════════════════════════════════════════════════
// redeem — atomic conditional updateMany guards insufficient-balance race
// ═══════════════════════════════════════════════════════════════════════════

describe('LoyaltyService.redeem', () => {
  test('400 on non-positive amount (0, negative, non-integer)', async () => {
    const { sut, tx } = await buildSut();
    await expect(sut.redeem(tx, { userId: 'u1', amount: 0, bookingId: 'b1', note: 'n' }))
      .rejects.toThrow(BadRequestException);
    await expect(sut.redeem(tx, { userId: 'u1', amount: -5, bookingId: 'b1', note: 'n' }))
      .rejects.toThrow(BadRequestException);
    await expect(sut.redeem(tx, { userId: 'u1', amount: 1.5, bookingId: 'b1', note: 'n' }))
      .rejects.toThrow(BadRequestException);
  });

  test('409 when balance insufficient (updateMany count=0)', async () => {
    const { sut, tx } = await buildSut();
    tx.user.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(sut.redeem(tx, { userId: 'u1', amount: 100, bookingId: 'b1', note: 'n' }))
      .rejects.toThrow(ConflictException);
    // Ledger must NOT have been written on failure
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled();
  });

  test('updateMany WHERE includes balance-gte guard (no TOCTOU)', async () => {
    const { sut, tx } = await buildSut();
    tx.user.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.user.findUniqueOrThrow.mockResolvedValueOnce({ loyaltyPoints: 400 });

    await sut.redeem(tx, { userId: 'u1', amount: 100, bookingId: 'b1', note: 'cancel' });

    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1', loyaltyPoints: { gte: 100 } },
        data:  { loyaltyPoints: { decrement: 100 } },
      }),
    );
  });

  test('writes ledger row with NEGATIVE delta + balanceAfter + BOOKING_REDEEM source', async () => {
    const { sut, tx } = await buildSut();
    tx.user.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.user.findUniqueOrThrow.mockResolvedValueOnce({ loyaltyPoints: 300 });

    await sut.redeem(tx, { userId: 'u1', amount: 100, bookingId: 'b1', note: 'points redemption' });

    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1', delta: -100, balanceAfter: 300,
          source: 'BOOKING_REDEEM', bookingId: 'b1',
          actorType: 'CUSTOMER', actorId: 'u1',
          reason: 'points redemption',
        }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// refund / earn — simple increment paths, both write ledger
// ═══════════════════════════════════════════════════════════════════════════

describe('LoyaltyService.refund', () => {
  test('400 on non-positive amount', async () => {
    const { sut, tx } = await buildSut();
    await expect(sut.refund(tx, {
      userId: 'u1', amount: 0, bookingId: 'b1',
      source: 'CANCEL_REFUND_PAID', actorType: 'CUSTOMER', note: 'n',
    })).rejects.toThrow(BadRequestException);
  });

  test('increments balance + writes ledger with positive delta', async () => {
    const { sut, tx } = await buildSut();
    tx.user.update.mockResolvedValueOnce({ loyaltyPoints: 150 });

    await sut.refund(tx, {
      userId: 'u1', amount: 50, bookingId: 'b1',
      source: 'CANCEL_REFUND_PAID', actorType: 'CUSTOMER', note: 'customer cancel',
    });

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data:  { loyaltyPoints: { increment: 50 } },
      }),
    );
    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          delta: 50, balanceAfter: 150, source: 'CANCEL_REFUND_PAID',
        }),
      }),
    );
  });

  test('actorId nullish → stored as null (not undefined → Prisma error)', async () => {
    const { sut, tx } = await buildSut();
    tx.user.update.mockResolvedValueOnce({ loyaltyPoints: 50 });

    await sut.refund(tx, {
      userId: 'u1', amount: 50, bookingId: 'b1',
      source: 'CANCEL_REFUND_PAID', actorType: 'CUSTOMER', note: 'n',
    });

    const call = tx.loyaltyLedger.create.mock.calls[0][0];
    expect(call.data.actorId).toBeNull();
  });
});

describe('LoyaltyService.earn', () => {
  test('BOOKING_EARN source + SYSTEM actor + null actorId (automated path)', async () => {
    const { sut, tx } = await buildSut();
    tx.user.update.mockResolvedValueOnce({ loyaltyPoints: 200 });

    await sut.earn(tx, { userId: 'u1', amount: 25, bookingId: 'b1', note: 'completed booking' });

    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'BOOKING_EARN', actorType: 'SYSTEM', actorId: null,
        }),
      }),
    );
  });

  test('400 on zero/negative amount', async () => {
    const { sut, tx } = await buildSut();
    await expect(sut.earn(tx, { userId: 'u1', amount: 0, bookingId: 'b1', note: 'n' }))
      .rejects.toThrow(BadRequestException);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// adjust — admin manual, clamps at 0, never goes negative
// ═══════════════════════════════════════════════════════════════════════════

describe('LoyaltyService.adjust', () => {
  test('400 on delta=0 (must be non-zero)', async () => {
    const { sut, tx } = await buildSut();
    await expect(sut.adjust(tx, {
      userId: 'u1', delta: 0, actorType: 'ADMIN', actorId: 'a1', reason: 'fix',
    })).rejects.toThrow(BadRequestException);
  });

  test('positive delta → applied as-is', async () => {
    const { sut, tx } = await buildSut();
    tx.user.findUniqueOrThrow.mockResolvedValueOnce({ loyaltyPoints: 50 });
    tx.user.update.mockResolvedValueOnce({ loyaltyPoints: 150 });

    const r = await sut.adjust(tx, {
      userId: 'u1', delta: 100, actorType: 'ADMIN', actorId: 'a1', reason: 'gift',
    });

    expect(r.appliedDelta).toBe(100);
    expect(r.balanceAfter).toBe(150);
  });

  test('negative delta within balance → applied as-is', async () => {
    const { sut, tx } = await buildSut();
    tx.user.findUniqueOrThrow.mockResolvedValueOnce({ loyaltyPoints: 500 });
    tx.user.update.mockResolvedValueOnce({ loyaltyPoints: 400 });

    const r = await sut.adjust(tx, {
      userId: 'u1', delta: -100, actorType: 'ADMIN', actorId: 'a1', reason: 'correction',
    });

    expect(r.appliedDelta).toBe(-100);
  });

  test('negative delta EXCEEDS balance → CLAMPED to -currentBalance (never goes below 0)', async () => {
    const { sut, tx } = await buildSut();
    tx.user.findUniqueOrThrow.mockResolvedValueOnce({ loyaltyPoints: 100 });
    tx.user.update.mockResolvedValueOnce({ loyaltyPoints: 0 });

    const r = await sut.adjust(tx, {
      userId: 'u1', delta: -500, actorType: 'ADMIN', actorId: 'a1', reason: 'fraud',
    });

    expect(r.appliedDelta).toBe(-100);           // Clamped
    expect(r.balanceAfter).toBe(0);
  });

  test('clamp note added to ledger reason (audit trail of intent vs applied)', async () => {
    const { sut, tx } = await buildSut();
    tx.user.findUniqueOrThrow.mockResolvedValueOnce({ loyaltyPoints: 100 });
    tx.user.update.mockResolvedValueOnce({ loyaltyPoints: 0 });

    await sut.adjust(tx, {
      userId: 'u1', delta: -500, actorType: 'ADMIN', actorId: 'a1', reason: 'fraud deduction',
    });

    const reason = tx.loyaltyLedger.create.mock.calls[0][0].data.reason;
    expect(reason).toMatch(/clamped from -500/);
    expect(reason).toMatch(/balance was 100/);
    expect(reason).toMatch(/fraud deduction/);
  });

  test('source=ADMIN_ADJUST with actorId captured (attribution)', async () => {
    const { sut, tx } = await buildSut();
    tx.user.findUniqueOrThrow.mockResolvedValueOnce({ loyaltyPoints: 50 });
    tx.user.update.mockResolvedValueOnce({ loyaltyPoints: 150 });

    await sut.adjust(tx, {
      userId: 'u1', delta: 100, actorType: 'ADMIN', actorId: 'admin-42', reason: 'gift',
    });

    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'ADMIN_ADJUST', actorType: 'ADMIN', actorId: 'admin-42',
        }),
      }),
    );
  });
});
