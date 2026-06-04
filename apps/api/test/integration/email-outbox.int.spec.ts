/**
 * R4 — EmailOutbox drain worker + daily prune, against a real DB.
 *
 *   - A due PENDING row → SENT after a successful send.
 *   - send() returns false → PENDING, attempt++, nextAttemptAt pushed out,
 *     lastError = 'SES_SEND_FAILED' (no recipient leaked).
 *   - send() throws → PENDING, attempt++, lastError = the error class.
 *   - After MAX_ATTEMPTS (5) failures → FAILED + failedAt set.
 *   - A row whose nextAttemptAt is in the future is not picked up.
 *   - Daily cleanup prunes old SENT/FAILED rows but not recent or PENDING ones.
 */

import { getTestContext } from './_setup';
import { OutboxDrainService } from '../../src/email/outbox-drain.service';
import { CleanupService } from '../../src/common/services/cleanup.service';

const ctx = getTestContext();

beforeAll(async () => { await ctx.start(); }, 30_000);
beforeEach(async () => { await ctx.reset(); });
afterAll(async () => { await ctx.stop(); });

function makeDrainService(sendImpl: (to: string, data: unknown) => Promise<boolean>) {
  const prismaSvc = { client: ctx.prisma } as any;
  // The leader lock just runs the function (single test process == single leader).
  const lock = { withLeaderLock: async (_k: string, _ttl: number, fn: () => Promise<unknown>) => fn() } as any;
  const emailService = { sendBookingConfirmation: jest.fn(sendImpl) } as any;
  return { svc: new OutboxDrainService(prismaSvc, lock, emailService), emailService };
}

const PAYLOAD = {
  customerName: 'Test Customer',
  activityTitle: 'Sample Tour',
  date: '1 Oct 2030',
  guests: 2,
  totalAmount: '205.00',
  currency: 'QAR',
  bookingId: '00000000-0000-4000-8000-00000000bbbb',
};

function seedRow(overrides: Record<string, unknown> = {}) {
  return ctx.prisma.emailOutbox.create({
    data: {
      emailType: 'BOOKING_CONFIRMATION',
      recipient: 'customer@test.com',
      payload: PAYLOAD,
      bookingId: PAYLOAD.bookingId,
      ...overrides,
    },
  });
}

describe('OutboxDrainService.drain', () => {
  test('a due PENDING row → SENT, attempts=1, lastError cleared', async () => {
    const row = await seedRow();
    const { svc } = makeDrainService(async () => true);

    await svc.drain();

    const after = await ctx.prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('SENT');
    expect(after.sentAt).toBeInstanceOf(Date);
    expect(after.attempts).toBe(1);
    expect(after.lastError).toBeNull();
  });

  test('send returns false → PENDING, attempts=1, nextAttemptAt in the future, lastError=EMAIL_SEND_FAILED', async () => {
    const row = await seedRow();
    const { svc } = makeDrainService(async () => false);

    await svc.drain();

    const after = await ctx.prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('PENDING');
    expect(after.attempts).toBe(1);
    expect(after.lastError).toBe('EMAIL_SEND_FAILED');
    expect(after.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  test('send throws → PENDING, attempts=1, lastError = the error class (no PII)', async () => {
    const row = await seedRow();
    const { svc } = makeDrainService(async () => { throw new TypeError('SES exploded for customer@test.com'); });

    await svc.drain();

    const after = await ctx.prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('PENDING');
    expect(after.attempts).toBe(1);
    expect(after.lastError).toBe('TypeError'); // class only — message (with the email) not stored
  });

  test('5th failed attempt → FAILED + failedAt set', async () => {
    // Seed a row that's already failed 4 times; the next failure is the 5th → give up.
    const row = await seedRow({ attempts: 4, lastError: 'SES_SEND_FAILED' });
    const { svc } = makeDrainService(async () => false);

    await svc.drain();

    const after = await ctx.prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('FAILED');
    expect(after.failedAt).toBeInstanceOf(Date);
    expect(after.attempts).toBe(5);
  });

  test('a row not yet due (nextAttemptAt in the future) is skipped', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const row = await seedRow({ nextAttemptAt: future, attempts: 1, lastError: 'SES_SEND_FAILED' });
    const { svc, emailService } = makeDrainService(async () => true);

    await svc.drain();

    expect(emailService.sendBookingConfirmation).not.toHaveBeenCalled();
    const after = await ctx.prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('PENDING');
    expect(after.attempts).toBe(1);
  });

  test('already-SENT rows are not re-sent', async () => {
    const row = await seedRow({ status: 'SENT', sentAt: new Date(), attempts: 1 });
    const { svc, emailService } = makeDrainService(async () => true);

    await svc.drain();

    expect(emailService.sendBookingConfirmation).not.toHaveBeenCalled();
    const after = await ctx.prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.attempts).toBe(1);
  });
});

describe('CleanupService.cleanOldOutboxRows', () => {
  function makeCleanup() {
    const prismaSvc = { client: ctx.prisma } as any;
    const configService = { get: (_k: string, fallback?: string) => fallback } as any; // RETENTION_EMAIL_OUTBOX_DAYS → 30
    return new CleanupService(prismaSvc, {} as any, configService, {} as any, {} as any, {} as any);
  }

  test('prunes old SENT/FAILED rows; keeps recent ones and all PENDING', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago > 30-day retention
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    const oldSent    = await seedRow({ status: 'SENT',   sentAt: old,   createdAt: old });
    const oldFailed  = await seedRow({ status: 'FAILED', failedAt: old, createdAt: old, lastError: 'SES_SEND_FAILED' });
    const oldPending = await seedRow({ status: 'PENDING',                createdAt: old }); // never pruned — still retrying
    const recentSent = await seedRow({ status: 'SENT',   sentAt: recent, createdAt: recent });

    const deleted = await makeCleanup().cleanOldOutboxRows();
    expect(deleted).toBe(2);

    const ids = (await ctx.prisma.emailOutbox.findMany({ select: { id: true } })).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([oldPending.id, recentSent.id]));
    expect(ids).not.toContain(oldSent.id);
    expect(ids).not.toContain(oldFailed.id);
  });
});
