/**
 * Wave 2 business-logic remediation contracts.
 *
 * Pins each launch-blocker fix from the pre-launch audit:
 *   §B7 — audit-write failures must surface (no silent swallow)
 *   §B8 — audit retention split: FINANCIAL kept 7y, OPERATIONAL ages out
 *   §B10 — daily reconciliation cron writes a snapshot + alerts on drift
 *
 * The tests here are LOGIC contracts, not exception/HTTP shapes — they
 * exist so a future refactor cannot accidentally re-open one of these
 * gaps.
 */

import { getTestContext, seedReference } from './_setup';
import { AuditLoggerService } from '../../src/common/services/audit-logger.service';
import { CleanupService } from '../../src/common/services/cleanup.service';
import { ReconciliationService } from '../../src/common/services/reconciliation.service';
import { NotificationService } from '../../src/common/services/notification.service';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makePrismaShim() {
  return { client: ctx.prisma } as any;
}

function makeNotificationServiceStub() {
  const sent: any[] = [];
  return {
    sent,
    svc: {
      notifyAdmins: jest.fn(async (params: any) => { sent.push(params); }),
    } as unknown as NotificationService,
  };
}

// ─────────────────────────────────────────────────────────────────────
// B7 — audit-logger must surface failures (no silent swallow)
// ─────────────────────────────────────────────────────────────────────

describe('B7 — AuditLoggerService surfaces write failures', () => {
  it('logs an error when the underlying create() throws', async () => {
    const explodingPrisma = {
      client: {
        auditLog: {
          create: jest.fn(async () => {
            throw Object.assign(new Error('FK violation'), { name: 'PrismaClientKnownRequestError' });
          }),
        },
      },
    } as any;

    const svc = new AuditLoggerService(explodingPrisma);
    const errSpy = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);

    // Must NOT throw — business flow shouldn't crash on audit hiccup
    await expect(
      svc.log({
        actorType: 'SYSTEM', actorId: 'sys', actorName: 'cron',
        action: 'TEST_ACTION', entity: 'Test',
      }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toMatch(/Audit write failed.*TEST_ACTION/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// B8 — audit retention split: FINANCIAL stays, OPERATIONAL ages out
// ─────────────────────────────────────────────────────────────────────

describe('B8 — audit retention split honours actionCategory', () => {
  it('persists actionCategory=FINANCIAL when explicitly tagged', async () => {
    const svc = new AuditLoggerService(makePrismaShim());
    await svc.log({
      actorType: 'SYSTEM', actorId: 'sys', actorName: 'cron',
      action: 'PAYMENT_INITIATED', entity: 'Payment',
      actionCategory: 'FINANCIAL',
    });
    const row = await ctx.prisma.auditLog.findFirst({ where: { action: 'PAYMENT_INITIATED' } });
    expect(row?.actionCategory).toBe('FINANCIAL');
  });

  it('defaults to OPERATIONAL when not tagged', async () => {
    const svc = new AuditLoggerService(makePrismaShim());
    await svc.log({
      actorType: 'SYSTEM', actorId: 'sys', actorName: 'cron',
      action: 'STATE_TRANSITION', entity: 'Booking',
    });
    const row = await ctx.prisma.auditLog.findFirst({ where: { action: 'STATE_TRANSITION' } });
    expect(row?.actionCategory).toBe('OPERATIONAL');
  });

  it('cleanup soft-archives OPERATIONAL but preserves FINANCIAL under tight retention', async () => {
    // Seed: one OPERATIONAL row 200 days old, one FINANCIAL row 200 days old.
    // With OPERATIONAL retention = 180d and FINANCIAL retention = 2555d (default),
    // ONLY the operational row should get archivedAt set.
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

    const opRow = await ctx.prisma.auditLog.create({
      data: {
        actorType: 'ADMIN', actorId: 'admin-1', actorName: 'Admin',
        action: 'UPDATE_VENDOR_STATUS', entity: 'Vendor',
        actionCategory: 'OPERATIONAL',
        createdAt: oldDate,
      },
    });
    const finRow = await ctx.prisma.auditLog.create({
      data: {
        actorType: 'SYSTEM', actorId: 'sys', actorName: 'cron',
        action: 'PAYMENT_INITIATED', entity: 'Payment',
        actionCategory: 'FINANCIAL',
        createdAt: oldDate,
      },
    });

    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'RETENTION_AUDIT_LOG_DAYS') return '180';
        if (key === 'RETENTION_AUDIT_LOG_FINANCIAL_DAYS') return '2555';
        return fallback;
      }),
    } as any;
    const svc = new CleanupService(
      makePrismaShim(),
      { log: jest.fn() } as any,
      config,
      {} as any,
      { invalidate: jest.fn(), invalidateMany: jest.fn() } as any,
      { acquire: jest.fn().mockResolvedValue('lock-token'), release: jest.fn().mockResolvedValue(undefined) } as any,
    );

    await (svc as any).cleanOldAuditLogs();

    const opAfter = await ctx.prisma.auditLog.findUnique({ where: { id: opRow.id } });
    const finAfter = await ctx.prisma.auditLog.findUnique({ where: { id: finRow.id } });

    expect(opAfter?.archivedAt).not.toBeNull();
    expect(finAfter?.archivedAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// B10 — daily reconciliation cron
// ─────────────────────────────────────────────────────────────────────

describe('B10 — ReconciliationService computes drift + alerts on mismatch', () => {
  async function buildSeed() {
    return seedReference(ctx.prisma);
  }

  /** Create one SUCCESS-paid booking + payment that reconciles cleanly. */
  async function createCleanPayment(seed: Awaited<ReturnType<typeof seedReference>>, amount: number, commission: number) {
    const payment = await ctx.prisma.payment.create({
      data: { amount, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date() },
    });
    const startDt = new Date(Date.now() - 25 * 3600_000);
    const endDt = new Date(Date.now() - 23 * 3600_000);
    const booking = await ctx.prisma.booking.create({
      data: {
        ref: `JDWL-RECON-${Math.random().toString(36).slice(2, 8)}`,
        customerId: seed.customer.id,
        vendorId: seed.vendor.id,
        activityId: seed.activity.id,
        guests: 1,
      bookingPhone: '+97455123456',
        guestBreakdown: {},
        startDatetime: startDt,
        endDatetime: endDt,
        totalPrice: amount,
        currencyCode: 'QAR',
        commissionPct: 10,
        commissionAmount: commission,
        serviceFee: 0,
        status: 'COMPLETED',
        paymentId: payment.id,
        reservedUntil: new Date(Date.now() - 60_000),
      },
    });
    return { payment, booking };
  }

  it('writes a passing reconciliation row when totals balance', async () => {
    const seed = await buildSeed();
    // One payment of 100 QAR with 10 commission. Nothing else in the ledger.
    await createCleanPayment(seed, 100, 10);

    const stub = makeNotificationServiceStub();
    const auditLogger = new AuditLoggerService(makePrismaShim());
    const svc = new ReconciliationService(makePrismaShim(), auditLogger, stub.svc, { withLeaderLock: (_k: string, _t: number, fn: () => unknown) => fn() } as any);

    const result = await svc.runReconciliation();

    expect(result.totalPayments).toBe(100);
    expect(result.platformFees).toBe(10);
    expect(result.vendorEarnings).toBe(90);
    expect(result.totalRefunded).toBe(0);
    expect(result.drift).toBe(0);
    expect(result.passed).toBe(true);

    const row = await ctx.prisma.reconciliationLog.findFirst();
    expect(row?.passed).toBe(true);
    expect(row?.drift.toNumber()).toBe(0);

    expect(stub.sent).toHaveLength(0);
  });

  it('detects drift, fires admin alert + writes FINANCIAL audit row', async () => {
    const seed = await buildSeed();
    // Manufacture drift: payment of 100 QAR but the booking row carries
    // totalPrice=80 (someone hand-edited the ledger). Reconciliation
    // sees: totalPayments=100, vendor=72, fees=8, refunded=0 → drift=20.
    const payment = await ctx.prisma.payment.create({
      data: { amount: 100, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date() },
    });
    const startDt = new Date(Date.now() - 25 * 3600_000);
    const endDt = new Date(Date.now() - 23 * 3600_000);
    await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-RECON-DRIFT',
        customerId: seed.customer.id,
        vendorId: seed.vendor.id,
        activityId: seed.activity.id,
        guests: 1,
      bookingPhone: '+97455123456',
        guestBreakdown: {},
        startDatetime: startDt,
        endDatetime: endDt,
        totalPrice: 80,           // hand-edited from 100
        currencyCode: 'QAR',
        commissionPct: 10,
        commissionAmount: 8,
        serviceFee: 0,
        status: 'COMPLETED',
        paymentId: payment.id,
        reservedUntil: new Date(Date.now() - 60_000),
      },
    });

    const stub = makeNotificationServiceStub();
    const auditLogger = new AuditLoggerService(makePrismaShim());
    const svc = new ReconciliationService(makePrismaShim(), auditLogger, stub.svc, { withLeaderLock: (_k: string, _t: number, fn: () => unknown) => fn() } as any);

    const result = await svc.runReconciliation();

    expect(result.passed).toBe(false);
    expect(result.drift).toBe(20);

    const row = await ctx.prisma.reconciliationLog.findFirst();
    expect(row?.passed).toBe(false);
    expect(row?.drift.toNumber()).toBe(20);

    // Admin alert fired
    expect(stub.sent).toHaveLength(1);
    expect(stub.sent[0].type).toBe('SYSTEM');
    expect(stub.sent[0].title).toMatch(/drift detected/i);

    // FINANCIAL audit row written
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'RECONCILIATION_DRIFT_DETECTED' } });
    expect(audit?.actionCategory).toBe('FINANCIAL');
  });

  it('a refund does NOT create phantom drift (regression: refund was removed twice)', async () => {
    const seed = await buildSeed();
    // 100 kept (vendor 90 + fee 10) and a separate 50 fully refunded.
    // Nothing is wrong here: the 100 balances, and the 50 came in and went
    // straight back out.
    await createCleanPayment(seed, 100, 10);
    await ctx.prisma.payment.create({
      data: {
        amount: 50, currency: 'QAR', status: 'REFUNDED', payoutStatus: 'UNPAID',
        method: 'PAY2M', paidAt: new Date(), refundAmount: 50, refundedAt: new Date(),
      },
    });

    const stub = makeNotificationServiceStub();
    const auditLogger = new AuditLoggerService(makePrismaShim());
    const svc = new ReconciliationService(makePrismaShim(), auditLogger, stub.svc, { withLeaderLock: (_k: string, _t: number, fn: () => unknown) => fn() } as any);

    const result = await svc.runReconciliation();

    // Refunding flips the payment SUCCESS -> REFUNDED, so it is ALREADY out of
    // totalPayments and out of the bookings aggregate. Subtracting the refund
    // again removed the same money twice and produced drift = -refundAmount on
    // any day a refund existed. This asserts the money that was KEPT balances,
    // and the refund is reported without distorting the equation.
    expect(result.totalPayments).toBe(100);
    expect(result.vendorEarnings).toBe(90);
    expect(result.platformFees).toBe(10);
    expect(result.totalRefunded).toBe(50);   // still surfaced for reporting
    expect(result.drift).toBe(0);
    expect(result.passed).toBe(true);
    expect(stub.sent).toHaveLength(0);       // and no admin alert fires
  });

  it('a PARTIAL refund also produces no phantom drift', async () => {
    const seed = await buildSeed();
    await createCleanPayment(seed, 100, 10);
    // Late cancellation: customer paid 80, got 30 back, platform kept 50.
    await ctx.prisma.payment.create({
      data: {
        amount: 80, currency: 'QAR', status: 'REFUNDED', payoutStatus: 'UNPAID',
        method: 'PAY2M', paidAt: new Date(), refundAmount: 30, refundedAt: new Date(),
      },
    });

    const stub = makeNotificationServiceStub();
    const auditLogger = new AuditLoggerService(makePrismaShim());
    const svc = new ReconciliationService(makePrismaShim(), auditLogger, stub.svc, { withLeaderLock: (_k: string, _t: number, fn: () => unknown) => fn() } as any);

    const result = await svc.runReconciliation();

    expect(result.totalRefunded).toBe(30);
    expect(result.drift).toBe(0);
    expect(result.passed).toBe(true);
  });

  it('still detects REAL drift when a refund is also present', async () => {
    const seed = await buildSeed();
    // The fix must not blunt the check: a genuinely mismatched booking has to
    // still fail even on a day that also has refunds in the ledger.
    const payment = await ctx.prisma.payment.create({
      data: { amount: 100, currency: 'QAR', status: 'SUCCESS', payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date() },
    });
    await ctx.prisma.booking.create({
      data: {
        ref: 'JDWL-RECON-DRIFT-RF', customerId: seed.customer.id, vendorId: seed.vendor.id,
        activityId: seed.activity.id, guests: 1, bookingPhone: '+97455123456', guestBreakdown: {},
        startDatetime: new Date(Date.now() - 25 * 3600_000),
        endDatetime: new Date(Date.now() - 23 * 3600_000),
        totalPrice: 80,            // hand-edited: does not match the 100 charged
        currencyCode: 'QAR', commissionPct: 10, commissionAmount: 8, serviceFee: 0,
        status: 'COMPLETED', paymentId: payment.id, reservedUntil: new Date(Date.now() - 60_000),
      },
    });
    await ctx.prisma.payment.create({
      data: {
        amount: 50, currency: 'QAR', status: 'REFUNDED', payoutStatus: 'UNPAID',
        method: 'PAY2M', paidAt: new Date(), refundAmount: 50, refundedAt: new Date(),
      },
    });

    const stub = makeNotificationServiceStub();
    const auditLogger = new AuditLoggerService(makePrismaShim());
    const svc = new ReconciliationService(makePrismaShim(), auditLogger, stub.svc, { withLeaderLock: (_k: string, _t: number, fn: () => unknown) => fn() } as any);

    const result = await svc.runReconciliation();

    // 100 charged vs 80 recorded = 20 genuinely unaccounted, and the refund
    // must not mask it (nor inflate it).
    expect(result.drift).toBe(20);
    expect(result.passed).toBe(false);
    expect(stub.sent).toHaveLength(1);
  });

  it('surfaces held/kept money that no bucket reconciles (blind spot)', async () => {
    const seed = await buildSeed();
    await createCleanPayment(seed, 100, 10);
    // REFUND_PENDING: money still held, refund decision outstanding.
    await ctx.prisma.payment.create({
      data: { amount: 40, currency: 'QAR', status: 'REFUND_PENDING', payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date() },
    });
    // REJECTED: customer cancelled, refund denied, platform KEPT the money.
    await ctx.prisma.payment.create({
      data: { amount: 25, currency: 'QAR', status: 'REJECTED', payoutStatus: 'UNPAID', method: 'PAY2M', paidAt: new Date() },
    });

    const stub = makeNotificationServiceStub();
    const auditLogger = new AuditLoggerService(makePrismaShim());
    const svc = new ReconciliationService(makePrismaShim(), auditLogger, stub.svc, { withLeaderLock: (_k: string, _t: number, fn: () => unknown) => fn() } as any);

    const result = await svc.runReconciliation();

    // These states are deliberately outside the equation for now, but they must
    // be VISIBLE - money nobody checks is how a real gap hides in plain sight.
    expect(result.unreconciledCount).toBe(2);
    expect(result.unreconciledHeld).toBe(65);
    // ...and they must not be mistaken for drift.
    expect(result.drift).toBe(0);
    expect(result.passed).toBe(true);
  });

  it('upserts on same-day re-run rather than duplicating rows', async () => {
    const seed = await buildSeed();
    await createCleanPayment(seed, 100, 10);

    const stub = makeNotificationServiceStub();
    const auditLogger = new AuditLoggerService(makePrismaShim());
    const svc = new ReconciliationService(makePrismaShim(), auditLogger, stub.svc, { withLeaderLock: (_k: string, _t: number, fn: () => unknown) => fn() } as any);

    await svc.runReconciliation();
    await svc.runReconciliation();
    await svc.runReconciliation();

    const rows = await ctx.prisma.reconciliationLog.findMany();
    expect(rows).toHaveLength(1);
  });
});
