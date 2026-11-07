/**
 * HTTP-level role check for the admin cancel action.
 *
 * The admin panel's "Cancel booking" button calls
 * PATCH /admin/bookings/:id/status { status: 'CANCELLED' }. AdminController
 * is guarded class-level (@UseGuards(JwtAuthGuard, RolesGuard) + @Roles('ADMIN')),
 * so a vendor or customer must get 403 before the service runs, and an admin
 * must reach AdminService.updateBookingStatus with their own id.
 *
 * JwtAuthGuard is replaced by a fake that sets req.user for the role under
 * test; RolesGuard is the real one.
 */
jest.mock('../../src/common/services/upload.service', () => ({
  UploadService: class {
    static diskStorageConfig(_label: string) { return {}; }
    validateFile(_f: unknown) { /* no-op */ }
    async upload(_f: unknown, _label: string) { return 'https://cdn/stub'; }
  },
  ALLOWED_MIME: ['image/jpeg', 'image/webp'],
  MIME_TO_EXT:  { 'image/jpeg': '.jpg', 'image/webp': '.webp' },
  ALLOWED_EXT:  ['.jpg', '.webp'],
}));

import { Test } from '@nestjs/testing';
import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AdminController } from '../../src/admin/admin.controller';
import { AdminService } from '../../src/admin/admin.service';
import { UploadService } from '../../src/common/services/upload.service';
import { CleanupService } from '../../src/common/services/cleanup.service';
import { EmailSuppressionService } from '../../src/email/email-suppression.service';
import { AdminAuditInterceptor } from '../../src/admin/interceptors/audit.interceptor';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';

const BOOKING_ID = '0b6d6b0e-2f0c-4a7e-9c3b-2d6f1a8e5c11';

type FakeUser = { id: string; email: string; role: 'ADMIN' | 'VENDOR' | 'CUSTOMER'; fullName: string } | null;

describe('PATCH /admin/bookings/:id/status (CANCELLED) — role enforcement', () => {
  let app: INestApplication;
  let currentUser: FakeUser = null;
  const updateBookingStatus = jest.fn().mockResolvedValue({ id: BOOKING_ID, status: 'CANCELLED' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: { updateBookingStatus } },
        { provide: UploadService, useValue: {} },
        { provide: CleanupService, useValue: {} },
        { provide: EmailSuppressionService, useValue: {} },
      ],
    })
      .overrideInterceptor(AdminAuditInterceptor).useValue({ intercept: (_c: any, n: any) => n.handle() })
      .overrideGuard(JwtAuthGuard).useValue({
        canActivate: (ctx: any) => {
          if (!currentUser) throw new UnauthorizedException();
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
  beforeEach(() => { updateBookingStatus.mockClear(); });

  const cancel = () =>
    request(app.getHttpServer()).patch(`/admin/bookings/${BOOKING_ID}/status`).send({ status: 'CANCELLED' });

  it('admin: 200 and the service is called with the admin id, booking id and CANCELLED', async () => {
    currentUser = { id: 'admin-1', email: 'admin@test.local', role: 'ADMIN', fullName: 'Admin' };
    const res = await cancel();
    expect(res.status).toBe(200);
    expect(updateBookingStatus).toHaveBeenCalledTimes(1);
    expect(updateBookingStatus).toHaveBeenCalledWith('admin-1', BOOKING_ID, 'CANCELLED');
  });

  it('vendor: 403 and the service is never called', async () => {
    currentUser = { id: 'vendor-1', email: 'vendor@test.local', role: 'VENDOR', fullName: 'Vendor' };
    const res = await cancel();
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Forbidden resource');
    expect(updateBookingStatus).not.toHaveBeenCalled();
  });

  it('customer: 403 and the service is never called', async () => {
    currentUser = { id: 'cust-1', email: 'customer@test.local', role: 'CUSTOMER', fullName: 'Customer' };
    const res = await cancel();
    expect(res.status).toBe(403);
    expect(updateBookingStatus).not.toHaveBeenCalled();
  });

  it('no session: 401 and the service is never called', async () => {
    currentUser = null;
    const res = await cancel();
    expect(res.status).toBe(401);
    expect(updateBookingStatus).not.toHaveBeenCalled();
  });

  it('admin with a bad status value: 400 from validation, service never called', async () => {
    currentUser = { id: 'admin-1', email: 'admin@test.local', role: 'ADMIN', fullName: 'Admin' };
    const res = await request(app.getHttpServer())
      .patch(`/admin/bookings/${BOOKING_ID}/status`)
      .send({ status: 'REFUNDED' });
    expect(res.status).toBe(400);
    expect(updateBookingStatus).not.toHaveBeenCalled();
  });
});
