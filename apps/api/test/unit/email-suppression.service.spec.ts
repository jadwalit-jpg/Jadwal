/**
 * EmailSuppressionService unit tests.
 *
 * Covers:
 *   - hash discipline: same email different cases → same hash → same row
 *   - isSuppressed → false when row missing, true when present
 *   - suppress() upserts (idempotent across repeat events for same recipient)
 *   - unsuppress() returns true on hit, false on miss (idempotent)
 *   - DB error in isSuppressed → fail OPEN (returns false)
 */

import { EmailSuppressionService } from '../../src/email/email-suppression.service';
import { makePrismaMock } from '../mocks/prisma.mock';

function makeSut() {
  const prisma = makePrismaMock();
  // Add the new emailSuppression model that the prisma mock doesn't know about
  // (the makePrismaMock factory enumerates a fixed list). Wire a fresh model
  // mock onto the client object so the service can call it.
  const emailSuppression = {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
  };
  (prisma._client as any).emailSuppression = emailSuppression;
  (prisma.client as any).emailSuppression = emailSuppression;

  const sut = new EmailSuppressionService(prisma as any);
  return { sut, prisma, emailSuppression };
}

describe('EmailSuppressionService.isSuppressed', () => {
  test('returns false when no row exists', async () => {
    const { sut, emailSuppression } = makeSut();
    emailSuppression.findUnique.mockResolvedValueOnce(null);
    expect(await sut.isSuppressed('a@b.com')).toBe(false);
  });

  test('returns true when row exists for the email hash', async () => {
    const { sut, emailSuppression } = makeSut();
    emailSuppression.findUnique.mockResolvedValueOnce({ id: 'row-1' });
    expect(await sut.isSuppressed('a@b.com')).toBe(true);
  });

  test('case + whitespace differences hash to the same value', async () => {
    const { sut, emailSuppression } = makeSut();
    await sut.isSuppressed('  Alice@Example.COM  ');
    await sut.isSuppressed('alice@example.com');
    const calls = emailSuppression.findUnique.mock.calls;
    expect(calls[0][0].where.emailHash).toBe(calls[1][0].where.emailHash);
  });

  test('Prisma error → fails OPEN (returns false), never throws', async () => {
    const { sut, emailSuppression } = makeSut();
    emailSuppression.findUnique.mockRejectedValueOnce(new Error('DB down'));
    expect(await sut.isSuppressed('a@b.com')).toBe(false);
  });
});

describe('EmailSuppressionService.suppress', () => {
  test('upserts with normalized email hash + reason + bounceType', async () => {
    const { sut, emailSuppression } = makeSut();
    await sut.suppress('  USER@EXAMPLE.com ', 'bounce', 'Permanent/General', 'mx hard-fail');
    expect(emailSuppression.upsert).toHaveBeenCalledTimes(1);
    const args = emailSuppression.upsert.mock.calls[0][0];
    expect(args.where.emailHash).toMatch(/^[a-f0-9]{64}$/);
    expect(args.create.reason).toBe('bounce');
    expect(args.create.bounceType).toBe('Permanent/General');
    expect(args.update.reason).toBe('bounce');
  });

  test('idempotent — calling twice for the same email upserts (no error)', async () => {
    const { sut, emailSuppression } = makeSut();
    await sut.suppress('a@b.com', 'complaint');
    await sut.suppress('a@b.com', 'complaint');
    expect(emailSuppression.upsert).toHaveBeenCalledTimes(2);
  });

  test('Prisma error in suppress → propagates (caller / SNS retries)', async () => {
    const { sut, emailSuppression } = makeSut();
    emailSuppression.upsert.mockRejectedValueOnce(new Error('DB down'));
    await expect(sut.suppress('a@b.com', 'bounce')).rejects.toThrow();
  });

  test('re-suppression without notes does NOT overwrite existing operator notes', async () => {
    // SNS automated events don't pass `notes`. If the update branch
    // wrote `notes: notes ?? null` it would erase any admin-added
    // annotation the next time the address shows up in another bounce
    // event. The fix omits the notes field from the update payload
    // entirely when the caller didn't provide one.
    const { sut, emailSuppression } = makeSut();
    await sut.suppress('a@b.com', 'complaint'); // no notes
    const updateArg = emailSuppression.upsert.mock.calls[0][0].update;
    expect(updateArg).not.toHaveProperty('notes');
    expect(updateArg.reason).toBe('complaint');
  });

  test('re-suppression WITH notes provided → notes is written', async () => {
    const { sut, emailSuppression } = makeSut();
    await sut.suppress('a@b.com', 'manual', undefined, 'admin annotation');
    const updateArg = emailSuppression.upsert.mock.calls[0][0].update;
    expect(updateArg.notes).toBe('admin annotation');
  });
});

describe('EmailSuppressionService.unsuppress', () => {
  test('returns true when a row was deleted', async () => {
    const { sut, emailSuppression } = makeSut();
    emailSuppression.delete.mockResolvedValueOnce({});
    expect(await sut.unsuppress('a'.repeat(64))).toBe(true);
  });

  test('returns false on P2025 (row not found) — idempotent', async () => {
    const { sut, emailSuppression } = makeSut();
    const err: any = new Error('Record not found');
    err.code = 'P2025';
    emailSuppression.delete.mockRejectedValueOnce(err);
    expect(await sut.unsuppress('a'.repeat(64))).toBe(false);
  });

  test('rethrows non-P2025 errors so admin sees them', async () => {
    const { sut, emailSuppression } = makeSut();
    emailSuppression.delete.mockRejectedValueOnce(new Error('connection reset'));
    await expect(sut.unsuppress('a'.repeat(64))).rejects.toThrow(/connection reset/);
  });
});
