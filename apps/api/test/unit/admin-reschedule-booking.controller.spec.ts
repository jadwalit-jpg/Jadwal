/**
 * HTTP-level checks for the admin "Change date" endpoints.
 *
 *   GET  /admin/bookings/:id/reschedule-preview
 *   POST /admin/bookings/:id/reschedule
 *
 * AdminBookingsController is guarded class-level (JwtAuthGuard + RolesGuard,
 * @Roles('ADMIN')) with the real AdminAuditInterceptor. JwtAuthGuard is
 * replaced by a fake that sets req.user for the role under test, so the spec
 * pins: a vendor or customer gets 403 before the service runs; an admin
 * reaches the service with their id and name; the DTO rejects bad input
 * (whitelist + forbidNonWhitelisted); the POST is audited as
 * RESCHEDULE_BOOKING (FINANCIAL) and a rejected caller produces no audit row.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AdminBookingsController } from '../../src/admin/admin-bookings.controller';
import { BookingRescheduleService } from '../../src/admin/booking-reschedule.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';

const BOOKING_ID = '0b6d6b0e-2f0c-4a7e-9c3b-2d6f1a8e5c11';
type FakeUser = { id: string; email: string; role: 'ADMIN' | 'VENDOR' | 'CUSTOMER'; fullName: string };
const ADMIN: FakeUser = { id: 'admin-1', email: 'admin@test.local', role: 'ADMIN', fullName: 'Ali Admin' };

describe('admin booking reschedule endpoints', () => {
  let app: INestApplication;
  let currentUser: FakeUser = ADMIN;
  const preview = jest.fn().mockResolvedValue({ difference: 0 });
  const reschedule = jest.fn().mockResolvedValue({ booking: { id: BOOKING_ID }, reschedule: { id: 'r-1' } });
  const auditCreate = jest.fn().mockResolvedValue({});
  const flush = () => new Promise((r) => setImmediate(r));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminBookingsController],
      providers: [
        { provide: BookingRescheduleService, useValue: { preview, reschedule } },
        { provide: PrismaService, useValue: { client: { auditLog: { create: auditCreate } } } },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { currentUser = ADMIN; preview.mockClear(); reschedule.mockClear(); auditCreate.mockClear(); });

  const http = () => request(app.getHttpServer());
  const validBody = { checkInDate: '2026-12-20', slotTime: '14:00', reason: 'Customer asked by phone', expectedDifference: 0 };

  describe('roles', () => {
    it.each(['VENDOR', 'CUSTOMER'] as const)('%s: 403 on both endpoints, service not called, no audit row', async (role) => {
      currentUser = { id: 'u-1', email: 'x@test.local', role, fullName: 'X' };
      await http().get(`/admin/bookings/${BOOKING_ID}/reschedule-preview?checkInDate=2026-12-20`).expect(403);
      await http().post(`/admin/bookings/${BOOKING_ID}/reschedule`).send(validBody).expect(403);
      await flush();
      expect(preview).not.toHaveBeenCalled();
      expect(reschedule).not.toHaveBeenCalled();
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it('admin preview: 200 and the service gets the booking id and the query', async () => {
      await http().get(`/admin/bookings/${BOOKING_ID}/reschedule-preview?checkInDate=2026-12-20&slotTime=14:00`).expect(200);
      expect(preview).toHaveBeenCalledWith(BOOKING_ID, expect.objectContaining({ checkInDate: '2026-12-20', slotTime: '14:00' }));
    });

    it('admin reschedule: 201, the service gets the admin id + name and the body; audited as RESCHEDULE_BOOKING (FINANCIAL)', async () => {
      await http().post(`/admin/bookings/${BOOKING_ID}/reschedule`).send({ ...validBody, settlement: 'WAIVED', settlementRef: 'x' }).expect(201);
      expect(reschedule).toHaveBeenCalledWith(
        BOOKING_ID,
        { id: 'admin-1', name: 'Ali Admin' },
        expect.objectContaining({ checkInDate: '2026-12-20', slotTime: '14:00', reason: 'Customer asked by phone', expectedDifference: 0, settlement: 'WAIVED', settlementRef: 'x' }),
      );
      await flush();
      expect(auditCreate).toHaveBeenCalledTimes(1);
      expect(auditCreate.mock.calls[0][0].data).toMatchObject({ action: 'RESCHEDULE_BOOKING', actionCategory: 'FINANCIAL', entity: 'Booking', actorId: 'admin-1' });
    });

    it('a preview is a read: no audit row', async () => {
      await http().get(`/admin/bookings/${BOOKING_ID}/reschedule-preview?checkInDate=2026-12-20`).expect(200);
      await flush();
      expect(auditCreate).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('booking id must be a UUID', async () => {
      await http().get('/admin/bookings/not-a-uuid/reschedule-preview?checkInDate=2026-12-20').expect(400);
      await http().post('/admin/bookings/not-a-uuid/reschedule').send(validBody).expect(400);
      expect(preview).not.toHaveBeenCalled();
      expect(reschedule).not.toHaveBeenCalled();
    });

    it.each([
      ['missing checkInDate', {}],
      ['checkInDate not a date', { checkInDate: '20/12/2026' }],
      ['slotTime not HH:MM', { checkInDate: '2026-12-20', slotTime: '2pm' }],
      ['unknown field', { checkInDate: '2026-12-20', guests: 3 }],
    ])('preview 400: %s', async (_label, query) => {
      await http().get(`/admin/bookings/${BOOKING_ID}/reschedule-preview`).query(query).expect(400);
      expect(preview).not.toHaveBeenCalled();
    });

    it.each([
      ['missing reason', { ...validBody, reason: undefined }],
      ['reason too short', { ...validBody, reason: 'why' }],
      ['reason too long', { ...validBody, reason: 'x'.repeat(501) }],
      ['missing expectedDifference', { ...validBody, expectedDifference: undefined }],
      ['expectedDifference not a number', { ...validBody, expectedDifference: 'ten' }],
      ['expectedDifference with 3 decimals', { ...validBody, expectedDifference: 10.005 }],
      ['unknown settlement', { ...validBody, settlement: 'CARD' }],
      ['settlementRef too long', { ...validBody, settlementRef: 'x'.repeat(201) }],
      ['unknown field', { ...validBody, totalPrice: 1 }],
      ['bad date', { ...validBody, checkInDate: 'tomorrow' }],
    ])('reschedule 400: %s', async (_label, body) => {
      await http().post(`/admin/bookings/${BOOKING_ID}/reschedule`).send(body).expect(400);
      expect(reschedule).not.toHaveBeenCalled();
    });

    it('expectedDifference arrives as a number even when sent as a numeric string', async () => {
      await http().post(`/admin/bookings/${BOOKING_ID}/reschedule`).send({ ...validBody, expectedDifference: '-12.5' }).expect(201);
      expect(reschedule.mock.calls[0][2].expectedDifference).toBe(-12.5);
    });
  });
});
