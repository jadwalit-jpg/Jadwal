/**
 * Three logically-related invariants that share one mocked AdminService:
 *
 *   1) `markPayoutsPaid` in-flight guard — blocks bulk mark-paid if any
 *      submitted payment belongs to a vendor with a PENDING request, or
 *      is in an APPROVED request's paymentIds lock set.
 *   2) `processPayoutRequest` COMPLETED branch — payments stay UNPAID;
 *      the two-step flow is "complete request → admin marks paid separately
 *      on the Payments tab". Pin that there's no payment.updateMany call.
 *   3) `getPayouts` enrichment — returns { status: 'PENDING' | 'APPROVED' }
 *      per payment row so the UI can disable mark-paid on locked rows.
 *
 * All tests stay pure-mocked (Prisma + deps) and run in <1s total.
 */

import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminService } from '../../src/admin/admin.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationService } from '../../src/common/services/notification.service';
import { LoyaltyService } from '../../src/common/services/loyalty.service';
import { AvailabilityCacheService } from '../../src/redis/availability-cache.service';
import { ReferenceDataCacheService } from '../../src/redis/reference-data-cache.service';
import { SessionDenylistService } from '../../src/redis/session-denylist.service';
import { makePrismaMock } from '../mocks/prisma.mock';
import {
  makeNotificationMock, makeLoyaltyMock, makeAvailabilityCacheMock, makeReferenceDataCacheMock,
} from '../mocks/bookings-deps.mock';
import { makeSessionDenylistMock } from '../mocks/auth-deps.mock';

async function buildSut() {
  const prisma = makePrismaMock();
  const notif = makeNotificationMock();
  const loyalty = { ...makeLoyaltyMock(), adjust: jest.fn().mockResolvedValue({ appliedDelta: 0 }) };
  const cache = makeAvailabilityCacheMock();
  const refCache = makeReferenceDataCacheMock();

  const mod = await Test.createTestingModule({
    providers: [
      AdminService,
      { provide: PrismaService,             useValue: prisma },
      { provide: NotificationService,       useValue: notif },
      { provide: LoyaltyService,            useValue: loyalty },
      { provide: AvailabilityCacheService,  useValue: cache },
      { provide: ReferenceDataCacheService, useValue: refCache },
      { provide: SessionDenylistService,    useValue: makeSessionDenylistMock() },
    ],
  }).compile();
  return { sut: mod.get(AdminService), prisma, notif };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) markPayoutsPaid — in-flight guard
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.markPayoutsPaid — in-flight guard', () => {
  test('blocks when a vendor has a PENDING request covering the submitted payments', async () => {
    const ctx = await buildSut();
    // One submitted payment, vendor A.
    ctx.prisma._client.payment.findMany.mockResolvedValueOnce([
      { id: 'p1', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha Tours', status: 'ACTIVE' } } },
    ]);
    // A has a PENDING request → locks the whole vendor's payments.
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([
      { vendorId: 'vA', status: 'PENDING', paymentIds: [], vendor: { businessNameEn: 'Alpha Tours' } },
    ]);

    await expect(ctx.sut.markPayoutsPaid(['p1'], 'TEST-WIRE-REF'))
      .rejects.toThrow(/alpha tours.*in-flight payout request.*payout requests page/i);
    // Must NOT flip any payments when blocked.
    expect(ctx.prisma._client.payment.updateMany).not.toHaveBeenCalled();
  });

  test('blocks when the specific paymentId is in an APPROVED request.paymentIds[]', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findMany.mockResolvedValueOnce([
      { id: 'p1', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha', status: 'ACTIVE' } } },
      { id: 'p2', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha', status: 'ACTIVE' } } },
    ]);
    // APPROVED blocks ONLY the specific paymentIds in its array.
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([
      { vendorId: 'vA', status: 'APPROVED', paymentIds: ['p1'], vendor: { businessNameEn: 'Alpha' } },
    ]);

    await expect(ctx.sut.markPayoutsPaid(['p1', 'p2'], 'TEST-WIRE-REF'))
      .rejects.toThrow(/alpha.*in-flight/i);
  });

  test('allows bulk mark-paid when APPROVED request covers different paymentIds', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payment.findMany.mockResolvedValueOnce([
      { id: 'p1', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha', status: 'ACTIVE' } } },
    ]);
    // APPROVED locks 'other-id', not 'p1' — so 'p1' is free to mark paid.
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([
      { vendorId: 'vA', status: 'APPROVED', paymentIds: ['other-id'], vendor: { businessNameEn: 'Alpha' } },
    ]);
    // Escrow probe — nothing in escrow, so the batch is not rejected.
    ctx.prisma._client.payment.findMany.mockResolvedValueOnce([]);
    ctx.prisma._client.payment.updateMany.mockResolvedValueOnce({ count: 1 });
    // Third findMany is for the notification lookup.
    ctx.prisma._client.payment.findMany.mockResolvedValueOnce([
      { booking: { vendorId: 'vA', vendor: { userId: 'u1', slug: 'alpha-tours' } } },
    ]);

    const result = await ctx.sut.markPayoutsPaid(['p1'], 'TEST-WIRE-REF');
    expect(result).toEqual({ updated: 1 });
    // Must flip SUCCESS + still-UNPAID payments ONLY (optimistic, one-way),
    // AND only for bookings whose activity has already ended (escrow buffer).
    // Without the endDatetime filter a future booking could be paid out and
    // then cancelled+refunded — money out twice with no clawback.
    expect(ctx.prisma._client.payment.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['p1'] },
        status: 'SUCCESS',
        payoutStatus: 'UNPAID',
        booking: { endDatetime: { lt: expect.any(Date) } },
      },
      data: expect.objectContaining({ payoutStatus: 'PAID' }),
    });
  });

  // ── Escrow guard on the RELEASE path ──────────────────────────────────────
  // evaluatePayoutEligibility and the approve-payout path both filter on
  // `booking.endDatetime < payoutCutoff`. markPayoutsPaid omitted it, so a
  // future booking could be marked PAID; the customer could then cancel before
  // start (cancelBooking only blocks AFTER start) and the refund would be
  // approved with the vendor already holding the money.
  describe('escrow buffer', () => {
    async function setupUnblocked() {
      const ctx = await buildSut();
      ctx.prisma._client.payment.findMany.mockResolvedValueOnce([
        { id: 'p1', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha', status: 'ACTIVE' } } },
      ]);
      ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([]);
      return ctx;
    }

    test('restricts the update to bookings whose activity has ENDED', async () => {
      const ctx = await setupUnblocked();
      // Escrow probe finds nothing in escrow…
      ctx.prisma._client.payment.findMany.mockResolvedValueOnce([]);
      ctx.prisma._client.payment.updateMany.mockResolvedValueOnce({ count: 1 });
      // …then the notification lookup.
      ctx.prisma._client.payment.findMany.mockResolvedValueOnce([
        { booking: { vendorId: 'vA', vendor: { userId: 'u1', slug: 'alpha' } } },
      ]);

      await ctx.sut.markPayoutsPaid(['p1'], 'TEST-WIRE-REF');

      const where = ctx.prisma._client.payment.updateMany.mock.calls[0][0].where;
      expect(where.booking.endDatetime.lt).toBeInstanceOf(Date);
      // Cutoff is "now" minus the configured buffer — never in the future,
      // which would let unfinished bookings settle.
      expect(where.booking.endDatetime.lt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    // Marking paid records a wire that ALREADY LEFT the bank, and the admin UI
    // toasts success unconditionally. Settling a subset would leave the skipped
    // rows UNPAID, so they reappear next cycle and get wired a SECOND time.
    // Reject the whole batch instead, writing nothing.
    // Escrow rows are OFFERED by the payouts list (it does not filter on
    // endDatetime) and marking paid records a wire that already left the bank.
    // Silently skipping them would leave them UNPAID -> re-wired next cycle.
    // Genuinely-invalid states (REFUNDED/REJECTED/...) are still skipped
    // silently: the list never offers those, so no human acts on them.
    test('REJECTS the batch when a selected row is still in escrow — nothing is written', async () => {
      const ctx = await setupUnblocked();
      // The escrow probe finds p2 still in escrow.
      ctx.prisma._client.payment.findMany.mockResolvedValueOnce([{ id: 'p2' }]);

      await expect(ctx.sut.markPayoutsPaid(['p1', 'p2'], 'TEST-WIRE-REF'))
        .rejects.toThrow(/still in payout escrow[\s\S]*No payments were changed/i);

      // Critical: no partial settlement.
      expect(ctx.prisma._client.payment.updateMany).not.toHaveBeenCalled();
    });

    test('the rejection names the in-escrow payment ids so the admin can fix the selection', async () => {
      const ctx = await setupUnblocked();
      ctx.prisma._client.payment.findMany.mockResolvedValueOnce([{ id: 'p2' }]);

      await expect(ctx.sut.markPayoutsPaid(['p1', 'p2'], 'TEST-WIRE-REF'))
        .rejects.toThrow(/p2/);
    });

    test('honours PAYOUT_SETTLEMENT_BUFFER_DAYS by pushing the cutoff further back', async () => {
      const prev = process.env.PAYOUT_SETTLEMENT_BUFFER_DAYS;
      process.env.PAYOUT_SETTLEMENT_BUFFER_DAYS = '3';
      try {
        const ctx = await setupUnblocked();
        // escrow probe (empty), then the update, then the notification lookup
        ctx.prisma._client.payment.findMany.mockResolvedValueOnce([]);
        ctx.prisma._client.payment.updateMany.mockResolvedValueOnce({ count: 1 });
        ctx.prisma._client.payment.findMany.mockResolvedValueOnce([]);

        await ctx.sut.markPayoutsPaid(['p1'], 'TEST-WIRE-REF');

        const cutoff = ctx.prisma._client.payment.updateMany.mock.calls[0][0].where.booking.endDatetime.lt;
        // ~3 days back, allowing a second of execution slack.
        const expected = Date.now() - 3 * 86_400_000;
        expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5_000);
      } finally {
        if (prev === undefined) delete process.env.PAYOUT_SETTLEMENT_BUFFER_DAYS;
        else process.env.PAYOUT_SETTLEMENT_BUFFER_DAYS = prev;
      }
    });
  });

  test('names up to 3 offending vendors and appends "and N more" for the rest', async () => {
    const ctx = await buildSut();
    // 5 vendors all have PENDING requests.
    ctx.prisma._client.payment.findMany.mockResolvedValueOnce([
      { id: 'p1', booking: { vendor: { id: 'v1', businessNameEn: 'V One', status: 'ACTIVE' } } },
      { id: 'p2', booking: { vendor: { id: 'v2', businessNameEn: 'V Two', status: 'ACTIVE' } } },
      { id: 'p3', booking: { vendor: { id: 'v3', businessNameEn: 'V Three', status: 'ACTIVE' } } },
      { id: 'p4', booking: { vendor: { id: 'v4', businessNameEn: 'V Four', status: 'ACTIVE' } } },
      { id: 'p5', booking: { vendor: { id: 'v5', businessNameEn: 'V Five', status: 'ACTIVE' } } },
    ]);
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([
      { vendorId: 'v1', status: 'PENDING', paymentIds: [], vendor: { businessNameEn: 'V One' } },
      { vendorId: 'v2', status: 'PENDING', paymentIds: [], vendor: { businessNameEn: 'V Two' } },
      { vendorId: 'v3', status: 'PENDING', paymentIds: [], vendor: { businessNameEn: 'V Three' } },
      { vendorId: 'v4', status: 'PENDING', paymentIds: [], vendor: { businessNameEn: 'V Four' } },
      { vendorId: 'v5', status: 'PENDING', paymentIds: [], vendor: { businessNameEn: 'V Five' } },
    ]);

    await expect(ctx.sut.markPayoutsPaid(['p1', 'p2', 'p3', 'p4', 'p5'], 'TEST-WIRE-REF'))
      .rejects.toThrow(/v one, v two, v three and 2 more have an in-flight/i);
  });

  test('notifies each unique vendor once with a slug-scoped link', async () => {
    const ctx = await buildSut();
    // Two payments, both from vendor vA (should get one notification).
    ctx.prisma._client.payment.findMany.mockResolvedValueOnce([
      { id: 'p1', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha', status: 'ACTIVE' } } },
      { id: 'p2', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha', status: 'ACTIVE' } } },
    ]);
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([]); // no inflight
    // Escrow probe — nothing in escrow, so nothing is rejected.
    ctx.prisma._client.payment.findMany.mockResolvedValueOnce([]);
    ctx.prisma._client.payment.updateMany.mockResolvedValueOnce({ count: 2 });
    // Third findMany for notifications.
    ctx.prisma._client.payment.findMany.mockResolvedValueOnce([
      { booking: { vendorId: 'vA', vendor: { userId: 'uA', slug: 'alpha-tours' } } },
      { booking: { vendorId: 'vA', vendor: { userId: 'uA', slug: 'alpha-tours' } } },
    ]);

    await ctx.sut.markPayoutsPaid(['p1', 'p2'], 'TEST-WIRE-REF');

    expect(ctx.notif.send).toHaveBeenCalledTimes(1);
    expect(ctx.notif.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'uA',
        link: '/vendor/alpha-tours/earnings',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) processPayoutRequest — COMPLETED branch does NOT flip payment status
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.processPayoutRequest — APPROVED → COMPLETED (two-step money-settle)', () => {
  test('closing the request does NOT call payment.updateMany (payments stay UNPAID)', async () => {
    const ctx = await buildSut();
    // Request is APPROVED with 2 locked payments.
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1',
      status: 'APPROVED',
      vendorId: 'v1',
      amount: 500,
      currency: 'QAR',
      paymentIds: ['p1', 'p2'],
      vendor: { userId: 'u1', slug: 'acme', businessNameEn: 'Acme' },
    });
    // §M2 — count is called TWICE: once outside the tx (pre-flight) and
    // again inside the tx (race re-check). mockResolvedValue (not Once)
    // covers both calls.
    ctx.prisma._client.payment.count.mockResolvedValue(2);
    ctx.prisma._client.payoutRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    ctx.prisma._client.payoutRequest.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'req-1', status: 'COMPLETED', amount: 500, currency: 'QAR',
    });

    await ctx.sut.processPayoutRequest('req-1', 'COMPLETED', 'Transfer confirmed');

    // Payment rows must be untouched — the two-step flow separates request
    // closure from cash settlement.
    expect(ctx.prisma._client.payment.updateMany).not.toHaveBeenCalled();
    // The request itself must transition via optimistic lock on status=APPROVED.
    const reqUpdate = ctx.prisma._client.payoutRequest.updateMany.mock.calls[0]?.[0];
    expect(reqUpdate.where).toEqual({ id: 'req-1', status: 'APPROVED' });
    expect(reqUpdate.data.status).toBe('COMPLETED');
  });

  test('§M2 — drifted payments → auto-revert to PENDING with system note (no longer aborts)', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', status: 'APPROVED', vendorId: 'v1', amount: 500, currency: 'QAR',
      paymentIds: ['p1', 'p2'], adminNote: null,
      vendor: { userId: 'u1', slug: 'acme', businessNameEn: 'Acme' },
    });
    // Only 1 of 2 still eligible — admin markPayoutsPaid may have run in
    // the gap, or a cascade refund moved one out. New §M2 contract:
    // auto-revert to PENDING with a system note instead of leaving the
    // request stuck in APPROVED.
    ctx.prisma._client.payment.count.mockResolvedValueOnce(1);
    // The revert updateMany returns count:1 (revert succeeded).
    ctx.prisma._client.payoutRequest.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(ctx.sut.processPayoutRequest('req-1', 'COMPLETED'))
      .rejects.toThrow(/no longer eligible|re-evaluate|auto-reverted/i);

    // Revert call MUST have run with status:PENDING + cleared paymentIds
    const revertCall = ctx.prisma._client.payoutRequest.updateMany.mock.calls[0]?.[0];
    expect(revertCall.where).toEqual({ id: 'req-1', status: 'APPROVED' });
    expect(revertCall.data.status).toBe('PENDING');
    expect(revertCall.data.paymentIds).toEqual([]);
    expect(revertCall.data.adminNote).toMatch(/no longer eligible|re-evaluate/i);
    expect(revertCall.data.processedAt).toBeNull();
  });

  test('concurrent COMPLETE (updateMany.count===0) → ConflictException', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', status: 'APPROVED', vendorId: 'v1', amount: 500, currency: 'QAR',
      paymentIds: ['p1'],
      vendor: { userId: 'u1', slug: 'acme', businessNameEn: 'Acme' },
    });
    // Eligible at preflight AND at re-check — both count calls return 1.
    ctx.prisma._client.payment.count.mockResolvedValue(1);
    ctx.prisma._client.payoutRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(ctx.sut.processPayoutRequest('req-1', 'COMPLETED'))
      .rejects.toThrow(ConflictException);
  });

  test('vendor notification title signals "transfer in progress" (not "paid")', async () => {
    const ctx = await buildSut();
    ctx.prisma._client.payoutRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1', status: 'APPROVED', vendorId: 'v1', amount: 500, currency: 'QAR',
      paymentIds: ['p1'],
      vendor: { userId: 'u1', slug: 'acme', businessNameEn: 'Acme' },
    });
    // Both preflight + re-check inside tx return 1.
    ctx.prisma._client.payment.count.mockResolvedValue(1);
    ctx.prisma._client.payoutRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    ctx.prisma._client.payoutRequest.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'req-1', amount: 500, currency: 'QAR',
    });

    await ctx.sut.processPayoutRequest('req-1', 'COMPLETED');

    expect(ctx.notif.send).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/transfer in progress/i),
        link: '/vendor/acme/earnings',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) getPayouts — inflightRequest enrichment
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminService.getPayouts — inflightRequest enrichment', () => {
  function seedCommon(ctx: Awaited<ReturnType<typeof buildSut>>, payments: any[]) {
    // Promise.all of [findMany, count]
    ctx.prisma._client.payment.findMany.mockResolvedValueOnce(payments);
    ctx.prisma._client.payment.count.mockResolvedValueOnce(payments.length);
  }

  test('PENDING request on a vendor marks ALL that vendor\'s rows with {status:"PENDING"}', async () => {
    const ctx = await buildSut();
    seedCommon(ctx, [
      { id: 'p1', status: 'SUCCESS', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha', status: 'ACTIVE' } } },
      { id: 'p2', status: 'SUCCESS', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha', status: 'ACTIVE' } } },
      { id: 'p3', status: 'SUCCESS', booking: { vendor: { id: 'vB', businessNameEn: 'Beta', status: 'ACTIVE' } } },
    ]);
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([
      { id: 'r1', vendorId: 'vA', status: 'PENDING', paymentIds: [] },
    ]);

    const res = await ctx.sut.getPayouts({});

    expect(res.data[0].inflightRequest).toEqual({ status: 'PENDING' });
    expect(res.data[1].inflightRequest).toEqual({ status: 'PENDING' });
    // vendor vB has no inflight request
    expect(res.data[2].inflightRequest).toBeNull();
  });

  test('APPROVED request locks only its paymentIds — other rows stay null', async () => {
    const ctx = await buildSut();
    seedCommon(ctx, [
      { id: 'p1', status: 'SUCCESS', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha', status: 'ACTIVE' } } },
      { id: 'p2', status: 'SUCCESS', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha', status: 'ACTIVE' } } },
    ]);
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([
      { id: 'r1', vendorId: 'vA', status: 'APPROVED', paymentIds: ['p1'] },
    ]);

    const res = await ctx.sut.getPayouts({});
    expect(res.data[0].inflightRequest).toEqual({ status: 'APPROVED' });
    // p2 is NOT in paymentIds — must stay null so admin can mark it paid.
    expect(res.data[1].inflightRequest).toBeNull();
  });

  test('PENDING wins over APPROVED when both apply to the same vendor', async () => {
    // Rare but possible during transient states. PENDING is the more
    // conservative block (whole vendor), so it should take priority.
    const ctx = await buildSut();
    seedCommon(ctx, [
      { id: 'p1', status: 'SUCCESS', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha', status: 'ACTIVE' } } },
    ]);
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([
      { id: 'r1', vendorId: 'vA', status: 'PENDING', paymentIds: [] },
      { id: 'r2', vendorId: 'vA', status: 'APPROVED', paymentIds: ['p1'] },
    ]);

    const res = await ctx.sut.getPayouts({});
    expect(res.data[0].inflightRequest).toEqual({ status: 'PENDING' });
  });

  test('no inflight request for any visible vendor → every row has null', async () => {
    const ctx = await buildSut();
    seedCommon(ctx, [
      { id: 'p1', status: 'SUCCESS', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha', status: 'ACTIVE' } } },
    ]);
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([]);

    const res = await ctx.sut.getPayouts({});
    expect(res.data[0].inflightRequest).toBeNull();
  });

  test('empty page → does NOT issue the payoutRequest lookup', async () => {
    const ctx = await buildSut();
    seedCommon(ctx, []);

    await ctx.sut.getPayouts({});
    expect(ctx.prisma._client.payoutRequest.findMany).not.toHaveBeenCalled();
  });

  test('only queries payoutRequests for PENDING + APPROVED (not COMPLETED/REJECTED)', async () => {
    const ctx = await buildSut();
    seedCommon(ctx, [
      { id: 'p1', status: 'SUCCESS', booking: { vendor: { id: 'vA', businessNameEn: 'Alpha', status: 'ACTIVE' } } },
    ]);
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([]);

    await ctx.sut.getPayouts({});
    expect(ctx.prisma._client.payoutRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['PENDING', 'APPROVED'] },
        }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getPayouts — the list means "PAYABLE NOW"
// ═══════════════════════════════════════════════════════════════════════════
//
// A vendor is paid only after the activity has taken place; the customer can
// still cancel before it starts. Enforcing that only in markPayoutsPaid is not
// enough — if the list still OFFERS in-escrow rows, "select all" trips the
// guard and the entire batch is refused, so nothing settles at all. The filter
// has to be here, and the escrowed money still has to be VISIBLE or a missing
// payout is indistinguishable from lost money.

describe('AdminService.getPayouts — escrow filtering + upcoming visibility', () => {
  function seed(ctx: any, rows: any[], upcoming = 0, nextDate: Date | null = null) {
    ctx.prisma._client.payment.findMany.mockResolvedValueOnce(rows);   // page query
    ctx.prisma._client.payment.count.mockResolvedValueOnce(rows.length); // total
    ctx.prisma._client.payoutRequest.findMany.mockResolvedValueOnce([]); // no inflight
    ctx.prisma._client.payment.count.mockResolvedValueOnce(upcoming);    // upcomingCount
    ctx.prisma._client.payment.findFirst.mockResolvedValueOnce(
      nextDate ? { booking: { endDatetime: nextDate } } : null,
    );
  }

  test('restricts the query to bookings whose activity has ENDED', async () => {
    const ctx = await buildSut();
    seed(ctx, []);

    await ctx.sut.getPayouts({});

    const where = ctx.prisma._client.payment.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('SUCCESS');
    expect(where.booking.endDatetime.lt).toBeInstanceOf(Date);
    // Cutoff is never in the future — that would offer unfinished bookings.
    expect(where.booking.endDatetime.lt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test('search still works AND stays inside the escrow filter (cannot widen it)', async () => {
    const ctx = await buildSut();
    seed(ctx, []);

    await ctx.sut.getPayouts({ search: 'alpha' } as any);

    const b = ctx.prisma._client.payment.findMany.mock.calls[0][0].where.booking;
    // Both must be present: a search that dropped endDatetime would re-expose
    // in-escrow rows through the search box.
    expect(b.endDatetime.lt).toBeInstanceOf(Date);
    expect(Array.isArray(b.OR)).toBe(true);
  });

  test('reports upcoming (in-escrow) money so it is visible but not payable', async () => {
    const ctx = await buildSut();
    const soon = new Date(Date.now() + 3 * 86_400_000);
    seed(ctx, [], 12, soon);

    const res: any = await ctx.sut.getPayouts({});

    expect(res.upcomingCount).toBe(12);
    expect(res.upcomingFrom).toEqual(soon);
    // ...and none of it leaked into the payable list.
    expect(res.data).toHaveLength(0);
    expect(res.total).toBe(0);
  });

  test('upcoming counts only UNPAID rows on not-yet-ended bookings', async () => {
    const ctx = await buildSut();
    seed(ctx, [], 3, new Date(Date.now() + 86_400_000));

    await ctx.sut.getPayouts({});

    // 2nd count call is the upcoming probe.
    const upcomingWhere = ctx.prisma._client.payment.count.mock.calls[1][0].where;
    expect(upcomingWhere.status).toBe('SUCCESS');
    expect(upcomingWhere.payoutStatus).toBe('UNPAID');
    expect(upcomingWhere.booking.endDatetime.gte).toBeInstanceOf(Date);
  });
});
