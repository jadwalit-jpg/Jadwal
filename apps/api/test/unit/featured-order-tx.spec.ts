/**
 * The featured-order writers (star toggle, Save order, Remove) run in a
 * Serializable transaction and retry on a serialization failure. With Prisma
 * 7's pg adapter that failure is NOT always the known-request error P2034: a
 * conflict found at COMMIT is the adapter's own DriverAdapterError with kind
 * TransactionWriteConflict. Both must retry; past the retries the admin gets
 * a 409, never a 500.
 */
jest.mock('../../src/common/services/upload.service', () => ({
  UploadService: class {}, ALLOWED_MIME: [], MIME_TO_EXT: {}, ALLOWED_EXT: [],
}));

import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdminService, isSerializationFailure } from '../../src/admin/admin.service';

function adapterConflict() {
  const err = new Error('TransactionWriteConflict') as Error & { cause?: unknown };
  err.name = 'DriverAdapterError';
  err.cause = { kind: 'TransactionWriteConflict' };
  return err;
}
function knownP2034() {
  return new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock. Please retry your transaction', { code: 'P2034', clientVersion: 'test' });
}

describe('isSerializationFailure', () => {
  test('recognises P2034 and the pg adapter write conflict, nothing else', () => {
    expect(isSerializationFailure(knownP2034())).toBe(true);
    expect(isSerializationFailure(adapterConflict())).toBe(true);
    const byMessage = new Error('TransactionWriteConflict'); byMessage.name = 'DriverAdapterError';
    expect(isSerializationFailure(byMessage)).toBe(true);
    expect(isSerializationFailure(new Prisma.PrismaClientKnownRequestError('nope', { code: 'P2002', clientVersion: 'test' }))).toBe(false);
    expect(isSerializationFailure(new Error('TransactionWriteConflict'))).toBe(false); // not the adapter's error
    expect(isSerializationFailure(new ConflictException('x'))).toBe(false);
    expect(isSerializationFailure(null)).toBe(false);
  });
});

describe('featuredOrderTransaction retry (through unfeatureActivity)', () => {
  function make($transaction: jest.Mock) {
    const prisma = { client: { $transaction, activity: { findUnique: jest.fn().mockResolvedValue({ id: 'a1' }) } } } as any;
    return new AdminService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
  }

  test('two adapter conflicts, then success: three attempts, result returned', async () => {
    const $transaction = jest.fn()
      .mockRejectedValueOnce(adapterConflict())
      .mockRejectedValueOnce(knownP2034())
      .mockResolvedValueOnce({ id: 'a1', titleEn: 'A', isFeatured: false, featuredOrder: null });
    const svc = make($transaction);
    await expect(svc.unfeatureActivity('a1')).resolves.toMatchObject({ id: 'a1', isFeatured: false });
    expect($transaction).toHaveBeenCalledTimes(3);
    expect($transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: 'Serializable' });
  });

  test('conflicts on every attempt: 409, not the raw adapter error', async () => {
    const $transaction = jest.fn().mockRejectedValue(adapterConflict());
    const svc = make($transaction);
    await expect(svc.unfeatureActivity('a1')).rejects.toBeInstanceOf(ConflictException);
    expect($transaction).toHaveBeenCalledTimes(3);
  });

  test('any other error is not retried', async () => {
    const $transaction = jest.fn().mockRejectedValue(new Error('boom'));
    const svc = make($transaction);
    await expect(svc.unfeatureActivity('a1')).rejects.toThrow('boom');
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});
