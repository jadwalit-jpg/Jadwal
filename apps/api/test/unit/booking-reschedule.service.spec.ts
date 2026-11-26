/**
 * BookingRescheduleService: a serialization failure inside the move
 * transaction becomes a 409, whatever shape Prisma reports it in.
 *
 * Two concurrent Serializable transactions on the same rows surface either as
 * the known-request error P2034 (conflict found on a query) or, with Prisma 7's
 * pg adapter, as a DriverAdapterError with kind TransactionWriteConflict
 * (conflict found at COMMIT). CI hit the second shape in the "two bookings
 * racing for the last unit" integration test: the loser must get a
 * ConflictException, not a 500. Any other error is rethrown. The per-slot lock
 * is released in every case.
 */
import { ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BookingRescheduleService } from '../../src/admin/booking-reschedule.service';

const DAY = 86_400_000;
const future = new Date(Date.now() + 10 * DAY);
future.setUTCHours(10, 0, 0, 0);
const checkInDate = new Date(future.getTime() + DAY).toISOString().slice(0, 10);

function loadedBooking() {
  return {
    id: 'b-1', ref: 'JDWL-TEST1', status: 'CONFIRMED', activityId: 'a-1', customerId: 'c-1',
    startDatetime: future, endDatetime: new Date(future.getTime() + 2 * 3_600_000),
    unitNumber: null, guests: 2, bookingPhone: '+97455123456',
    totalPrice: new Prisma.Decimal(200), couponDiscount: new Prisma.Decimal(0), selectedExtras: null,
    currencyCode: 'QAR',
    activity: {
      id: 'a-1', titleEn: 'Tour', titleAr: 'جولة', bookingType: 'HOURLY', pricingModel: 'PER_PERSON',
      pricePerPerson: new Prisma.Decimal(100), minGuests: 1, durationValue: 2, checkInTime: '09:00', checkOutTime: '21:00',
      activeDays: [], hasUnits: false, unitCount: 0, unitCapacity: 1, capacity: 10,
      country: { defaultTimezone: 'Asia/Qatar', currencyCode: 'QAR' },
      vendor: { id: 'v-1', slug: 'v', userId: 'vu-1', user: { fullName: 'Vendor', email: 'v@test.com', preferredLanguage: 'EN' } },
    },
    payment: { status: 'SUCCESS' },
    customer: { id: 'c-1', fullName: 'Customer', email: 'c@test.com', preferredLanguage: 'EN' },
    reschedules: [],
  };
}

function makeService(txError: unknown) {
  const client = {
    booking: { findUnique: jest.fn().mockResolvedValue(loadedBooking()), findUniqueOrThrow: jest.fn() },
    activityBlock: { findFirst: jest.fn().mockResolvedValue(null) },
    activitySpecialPrice: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    emailOutbox: { create: jest.fn() },
    $transaction: jest.fn().mockRejectedValue(txError),
  };
  const notifications = { send: jest.fn().mockResolvedValue(undefined) } as any;
  const cache = { invalidate: jest.fn().mockResolvedValue(undefined) } as any;
  const redisLock = { acquire: jest.fn().mockResolvedValue('tok'), release: jest.fn().mockResolvedValue(undefined) } as any;
  const config = { get: (_k: string, fb?: string) => fb } as any;
  const service = new BookingRescheduleService({ client } as any, notifications, cache, redisLock, config);
  return { service, client, notifications, redisLock };
}

const dto = { checkInDate, slotTime: '14:00', reason: 'Customer asked by phone', expectedDifference: 0 };

describe('BookingRescheduleService.reschedule — transaction conflicts', () => {
  it("pg adapter's DriverAdapterError (TransactionWriteConflict at COMMIT) → 409, lock released, nothing notified", async () => {
    const err = Object.assign(new Error('TransactionWriteConflict'), { name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict' } });
    const { service, notifications, redisLock } = makeService(err);
    await expect(service.reschedule('b-1', { id: 'admin', name: 'Ali' }, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(redisLock.release).toHaveBeenCalledWith(expect.stringContaining('booking_lock:a-1:'), 'tok');
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('P2034 (serialization failure on a query) → 409', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: 'test' });
    const { service, redisLock } = makeService(err);
    await expect(service.reschedule('b-1', { id: 'admin', name: 'Ali' }, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(redisLock.release).toHaveBeenCalledTimes(1);
  });

  it('a ConflictException thrown inside the transaction (claim lost, slot taken) passes through as 409', async () => {
    const { service } = makeService(new ConflictException('These dates are fully booked'));
    await expect(service.reschedule('b-1', { id: 'admin', name: 'Ali' }, dto)).rejects.toThrow('These dates are fully booked');
  });

  it('any other error is rethrown unchanged, and the lock is still released', async () => {
    const { service, redisLock } = makeService(new Error('connection reset'));
    await expect(service.reschedule('b-1', { id: 'admin', name: 'Ali' }, dto)).rejects.toThrow('connection reset');
    expect(redisLock.release).toHaveBeenCalledTimes(1);
  });

  it('rule failures happen before the lock is taken', async () => {
    const { service, client, redisLock } = makeService(new Error('must not reach'));
    await expect(service.reschedule('b-1', { id: 'admin', name: 'Ali' }, { ...dto, slotTime: '10:15' })).rejects.toBeInstanceOf(BadRequestException);
    expect(redisLock.acquire).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
