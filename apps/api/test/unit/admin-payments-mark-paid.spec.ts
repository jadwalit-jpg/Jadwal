/**
 * AdminPaymentsController — roles, validation and audit for the gateway
 * rescue endpoints:
 *   GET  /admin/payments/unconfirmed
 *   POST /admin/payments/:id/mark-paid
 *
 * The service is mocked; the real guards, pipes and the audit interceptor run.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AdminPaymentsController } from '../../src/admin/admin-payments.controller';
import { AdminService } from '../../src/admin/admin.service';
import { PaymentService } from '../../src/payment/payment.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';

const PAYMENT_ID = '3f2b9c1e-6d4a-4b7c-9e8f-1a2b3c4d5e6f';
type FakeUser = { id: string; email: string; role: 'ADMIN' | 'VENDOR' | 'CUSTOMER'; fullName: string };

describe('Admin gateway-payment endpoints', () => {
  let app: INestApplication;
  let currentUser: FakeUser = { id: 'admin-1', email: 'admin@test.local', role: 'ADMIN', fullName: 'Ali Admin' };
  const getUnconfirmedGatewayPayments = jest.fn().mockResolvedValue([{ id: PAYMENT_ID, basketId: 'JDWL-abc' }]);
  const confirmPaymentManually = jest.fn().mockResolvedValue({ bookingId: 'b-1', ref: 'JDWL-1', path: 'confirmed' });
  const auditCreate = jest.fn().mockResolvedValue({});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminPaymentsController],
      providers: [
        { provide: AdminService, useValue: { getUnconfirmedGatewayPayments } },
        { provide: PaymentService, useValue: { confirmPaymentManually } },
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
  beforeEach(() => {
    currentUser = { id: 'admin-1', email: 'admin@test.local', role: 'ADMIN', fullName: 'Ali Admin' };
    getUnconfirmedGatewayPayments.mockClear(); confirmPaymentManually.mockClear(); auditCreate.mockClear();
  });
  const flush = () => new Promise((r) => setImmediate(r));
  const markPaid = (id: string, body: unknown) => request(app.getHttpServer()).post(`/admin/payments/${id}/mark-paid`).send(body as object);
  const GOOD = { transactionId: 'PAY2M-TXN-123', note: 'Captured per the PAY2M dashboard on 22 Nov' };

  it('GET unconfirmed: admin 200, not audited; vendor and customer 403', async () => {
    const res = await request(app.getHttpServer()).get('/admin/payments/unconfirmed');
    expect(res.status).toBe(200);
    expect(res.body[0].basketId).toBe('JDWL-abc');
    await flush();
    expect(auditCreate).not.toHaveBeenCalled();
    for (const role of ['VENDOR', 'CUSTOMER'] as const) {
      currentUser = { id: role, email: `${role}@test.local`, role, fullName: role };
      expect((await request(app.getHttpServer()).get('/admin/payments/unconfirmed')).status).toBe(403);
    }
    expect(getUnconfirmedGatewayPayments).toHaveBeenCalledTimes(1);
  });

  it('POST mark-paid: admin 201, the service gets the admin, txn and note, and it is audited as FINANCIAL', async () => {
    const res = await markPaid(PAYMENT_ID, GOOD);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ bookingId: 'b-1', ref: 'JDWL-1', path: 'confirmed' });
    expect(confirmPaymentManually).toHaveBeenCalledWith(PAYMENT_ID, { adminId: 'admin-1', adminName: 'Ali Admin' }, GOOD);
    await flush();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'MARK_PAYMENT_PAID', entity: 'Payment', entityId: PAYMENT_ID, actorId: 'admin-1', actionCategory: 'FINANCIAL',
      }),
    }));
  });

  it('POST mark-paid: validation — non-UUID id, missing note, short note, bad transaction id, extra field, no amount accepted', async () => {
    expect((await markPaid('not-a-uuid', GOOD)).status).toBe(400);
    expect((await markPaid(PAYMENT_ID, { transactionId: 'PAY2M-TXN-123' })).status).toBe(400);
    expect((await markPaid(PAYMENT_ID, { ...GOOD, note: 'ok' })).status).toBe(400);
    expect((await markPaid(PAYMENT_ID, { ...GOOD, transactionId: 'has spaces' })).status).toBe(400);
    expect((await markPaid(PAYMENT_ID, { ...GOOD, transactionId: 'ab' })).status).toBe(400);
    expect((await markPaid(PAYMENT_ID, { ...GOOD, amount: 1 })).status).toBe(400); // the amount is never accepted
    expect(confirmPaymentManually).not.toHaveBeenCalled();
  });

  it.each(['VENDOR', 'CUSTOMER'] as const)('POST mark-paid: %s gets 403 and the service is never called', async (role) => {
    currentUser = { id: `${role.toLowerCase()}-1`, email: `${role.toLowerCase()}@test.local`, role, fullName: role };
    expect((await markPaid(PAYMENT_ID, GOOD)).status).toBe(403);
    expect(confirmPaymentManually).not.toHaveBeenCalled();
    await flush();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
