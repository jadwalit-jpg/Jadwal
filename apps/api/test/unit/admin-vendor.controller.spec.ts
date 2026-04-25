/**
 * AdminController + VendorController + both audit interceptors.
 *
 * Controllers are thin delegation; interceptors handle audit logging with
 * PII/secret redaction.
 */

// UploadService imports `file-type` (ESM-only) and `sharp` — both hostile to
// Jest's CJS transform path. Stub the whole module at the loader level so
// Nest never needs to instantiate it (we inject our own mock anyway).
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

import { of, lastValueFrom } from 'rxjs';
import { Test } from '@nestjs/testing';
import { AdminController } from '../../src/admin/admin.controller';
import { VendorController } from '../../src/vendor/vendor.controller';
import { AdminService } from '../../src/admin/admin.service';
import { VendorService } from '../../src/vendor/vendor.service';
import { BookingsService } from '../../src/bookings/bookings.service';
import { UploadService } from '../../src/common/services/upload.service';
import { CleanupService } from '../../src/common/services/cleanup.service';
import { AdminAuditInterceptor } from '../../src/admin/interceptors/audit.interceptor';
import { PrismaService } from '../../src/prisma/prisma.service';
import { makePrismaMock } from '../mocks/prisma.mock';

function makeAdminSvcMock() {
  return {
    getAdminProfile:       jest.fn().mockResolvedValue({}),
    updateAdminProfile:    jest.fn().mockResolvedValue({}),
    changeAdminPassword:   jest.fn().mockResolvedValue({ message: 'ok' }),
    getLoyaltyConfig:      jest.fn().mockResolvedValue({}),
    updateLoyaltyConfig:   jest.fn().mockResolvedValue({}),
    getLoyaltyUsers:       jest.fn().mockResolvedValue({ data: [] }),
    adjustUserPoints:      jest.fn().mockResolvedValue({}),
    getDashboardStats:     jest.fn().mockResolvedValue({}),
    getUsers:              jest.fn().mockResolvedValue({ data: [] }),
    updateUserRole:        jest.fn().mockResolvedValue({}),
    deactivateUser:        jest.fn().mockResolvedValue({}),
    deleteUser:            jest.fn().mockResolvedValue({}),
    getVendorStats:        jest.fn().mockResolvedValue({}),
    getVendors:            jest.fn().mockResolvedValue({ data: [] }),
    updateVendorStatus:    jest.fn().mockResolvedValue({}),
    updateVendorTrust:     jest.fn().mockResolvedValue({}),
    updateVendorCommission:jest.fn().mockResolvedValue({}),
    deleteVendor:          jest.fn().mockResolvedValue({}),
    getActivities:         jest.fn().mockResolvedValue({ data: [] }),
    getActivity:           jest.fn().mockResolvedValue({}),
    updateActivityStatus:  jest.fn().mockResolvedValue({}),
    updateActivity:        jest.fn().mockResolvedValue({}),
    toggleFeatured:        jest.fn().mockResolvedValue({}),
    getBookings:           jest.fn().mockResolvedValue({ data: [] }),
    updateBookingStatus:   jest.fn().mockResolvedValue({}),
  };
}

function makeVendorSvcMock() {
  return {
    getDashboardStats:     jest.fn().mockResolvedValue({}),
    getActivities:         jest.fn().mockResolvedValue({ data: [] }),
    getActivity:           jest.fn().mockResolvedValue({}),
    getActivityBySlug:     jest.fn().mockResolvedValue({}),
    createActivity:        jest.fn().mockResolvedValue({}),
    updateActivity:        jest.fn().mockResolvedValue({}),
    deleteActivity:        jest.fn().mockResolvedValue({}),
    toggleActivityStatus:  jest.fn().mockResolvedValue({}),
    getBookings:           jest.fn().mockResolvedValue({ data: [] }),
    updateBookingStatus:   jest.fn().mockResolvedValue({}),
    getReviews:            jest.fn().mockResolvedValue({ data: [] }),
    replyToReview:         jest.fn().mockResolvedValue({}),
    getEarnings:           jest.fn().mockResolvedValue({}),
    getRevenueChart:       jest.fn().mockResolvedValue([]),
    getSettings:           jest.fn().mockResolvedValue({}),
    updateSettings:        jest.fn().mockResolvedValue({}),
    changePassword:        jest.fn().mockResolvedValue({ message: 'ok' }),
    getCoupons:            jest.fn().mockResolvedValue({ data: [] }),
    createCoupon:          jest.fn().mockResolvedValue({}),
    getPayoutRequests:     jest.fn().mockResolvedValue({ data: [] }),
    requestPayout:         jest.fn().mockResolvedValue({}),
    getActivityAnalytics:  jest.fn().mockResolvedValue([]),
  };
}

function makeUploadMock() {
  return {
    validateFile: jest.fn(),
    upload:       jest.fn().mockResolvedValue('https://cdn/x.webp'),
  };
}

function makeCleanupMock() {
  return { manualCleanup: jest.fn().mockResolvedValue({}) };
}

function makeBookingsSvcStub() {
  return { getVendorRefundRequests: jest.fn().mockResolvedValue([]) };
}

// ═══════════════════════════════════════════════════════════════════════════
// AdminController — delegation
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminController — delegation', () => {
  async function buildCtrl() {
    const adminSvc = makeAdminSvcMock();
    const upload = makeUploadMock();
    const cleanup = makeCleanupMock();
    const mod = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService,    useValue: adminSvc },
        { provide: UploadService,   useValue: upload },
        { provide: CleanupService,  useValue: cleanup },
      ],
    })
      .overrideInterceptor(AdminAuditInterceptor).useValue({ intercept: (_c: any, n: any) => n.handle() })
      .compile();
    return { ctrl: mod.get(AdminController), svc: adminSvc };
  }

  test('GET /admin/profile → getAdminProfile(user.id)', async () => {
    const { ctrl, svc } = await buildCtrl();
    await ctrl.getAdminProfile({ id: 'a1' } as any);
    expect(svc.getAdminProfile).toHaveBeenCalledWith('a1');
  });

  test('PATCH /admin/profile → updateAdminProfile(user.id, dto)', async () => {
    const { ctrl, svc } = await buildCtrl();
    await ctrl.updateAdminProfile({ id: 'a1' } as any, { fullName: 'X' } as any);
    expect(svc.updateAdminProfile).toHaveBeenCalledWith('a1', { fullName: 'X' });
  });

  test('PATCH /admin/profile/password → split into current + new password', async () => {
    const { ctrl, svc } = await buildCtrl();
    await ctrl.changeAdminPassword(
      { id: 'a1' } as any,
      { currentPassword: 'old', newPassword: 'NewPw123' } as any,
    );
    expect(svc.changeAdminPassword).toHaveBeenCalledWith('a1', 'old', 'NewPw123');
  });

  test('PATCH /admin/loyalty/users/:id/points passes caller actor.id (audit)', async () => {
    const { ctrl, svc } = await buildCtrl();
    await ctrl.adjustUserPoints(
      'u1',
      { delta: 100, reason: 'gift' } as any,
      { id: 'admin-1' } as any,
    );
    expect(svc.adjustUserPoints).toHaveBeenCalledWith('u1', 100, 'gift', 'admin-1');
  });

  test('PATCH /admin/vendors/:id/status passes adminUserId for cascade attribution', async () => {
    const { ctrl, svc } = await buildCtrl();
    await ctrl.updateVendorStatus(
      { id: 'admin-1' } as any,
      'v1',
      { status: 'SUSPENDED' } as any,
    );
    expect(svc.updateVendorStatus).toHaveBeenCalledWith('v1', 'SUSPENDED', 'admin-1');
  });

  test('PATCH /admin/activities/:id/status passes user.id + reason (audit)', async () => {
    const { ctrl, svc } = await buildCtrl();
    await ctrl.updateActivityStatus(
      { id: 'admin-1' } as any,
      'a1',
      { status: 'INACTIVE', reason: 'vendor complaint' } as any,
    );
    expect(svc.updateActivityStatus).toHaveBeenCalledWith('a1', 'INACTIVE', 'admin-1', 'vendor complaint');
  });

  test('PATCH /admin/bookings/:id/status passes user.id (audit + cascade)', async () => {
    const { ctrl, svc } = await buildCtrl();
    await ctrl.updateBookingStatus(
      { id: 'admin-1' } as any,
      'b1',
      { status: 'CANCELLED' } as any,
    );
    expect(svc.updateBookingStatus).toHaveBeenCalledWith('admin-1', 'b1', 'CANCELLED');
  });

  test('DELETE /admin/users/:id → deleteUser(id)', async () => {
    const { ctrl, svc } = await buildCtrl();
    await ctrl.deleteUser('u1');
    expect(svc.deleteUser).toHaveBeenCalledWith('u1');
  });

  test('DELETE /admin/vendors/:id → deleteVendor(id)', async () => {
    const { ctrl, svc } = await buildCtrl();
    await ctrl.deleteVendor('v1');
    expect(svc.deleteVendor).toHaveBeenCalledWith('v1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VendorController — delegation
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorController — delegation', () => {
  async function buildCtrl() {
    const vendorSvc = makeVendorSvcMock();
    const bookings = makeBookingsSvcStub();
    const upload = makeUploadMock();
    const { VendorAuditInterceptor } = require('../../src/vendor/interceptors/vendor-audit.interceptor');
    const mod = await Test.createTestingModule({
      controllers: [VendorController],
      providers: [
        { provide: VendorService,     useValue: vendorSvc },
        { provide: BookingsService,   useValue: bookings },
        { provide: UploadService,     useValue: upload },
        { provide: PrismaService,     useValue: makePrismaMock() },
      ],
    })
      .overrideInterceptor(VendorAuditInterceptor).useValue({ intercept: (_c: any, n: any) => n.handle() })
      .compile();
    return { ctrl: mod.get(VendorController), vendorSvc, bookings, upload };
  }

  test('GET /vendor/dashboard/stats → vendorService.getDashboardStats(user.id)', async () => {
    const { ctrl, vendorSvc } = await buildCtrl();
    await ctrl.getDashboardStats({ id: 'u1' } as any);
    expect(vendorSvc.getDashboardStats).toHaveBeenCalledWith('u1');
  });

  test('POST /vendor/activities → createActivity(user.id, dto)', async () => {
    const { ctrl, vendorSvc } = await buildCtrl();
    await ctrl.createActivity({ id: 'u1' } as any, { titleEn: 'Tour' } as any);
    expect(vendorSvc.createActivity).toHaveBeenCalledWith('u1', { titleEn: 'Tour' });
  });

  test('PATCH /vendor/activities/:id → updateActivity(user.id, id, dto)', async () => {
    const { ctrl, vendorSvc } = await buildCtrl();
    await ctrl.updateActivity({ id: 'u1' } as any, 'a1', { titleEn: 'New' } as any);
    expect(vendorSvc.updateActivity).toHaveBeenCalledWith('u1', 'a1', { titleEn: 'New' });
  });

  test('PATCH /vendor/activities/:id/toggle → toggleActivityStatus(user.id, id)', async () => {
    const { ctrl, vendorSvc } = await buildCtrl();
    await ctrl.toggleActivityStatus({ id: 'u1' } as any, 'a1');
    expect(vendorSvc.toggleActivityStatus).toHaveBeenCalledWith('u1', 'a1');
  });

  test('PATCH /vendor/bookings/:id/status → updateBookingStatus(user.id, id, dto.status)', async () => {
    const { ctrl, vendorSvc } = await buildCtrl();
    await ctrl.updateBookingStatus({ id: 'u1' } as any, 'b1', { status: 'CONFIRMED' } as any);
    expect(vendorSvc.updateBookingStatus).toHaveBeenCalledWith('u1', 'b1', 'CONFIRMED');
  });

  test('GET /vendor/refund-requests → bookingsService.getVendorRefundRequests(user.id)', async () => {
    const { ctrl, bookings } = await buildCtrl();
    await ctrl.getRefundRequests({ id: 'u1' } as any);
    expect(bookings.getVendorRefundRequests).toHaveBeenCalledWith('u1');
  });

  test('PATCH /vendor/reviews/:id/reply → replyToReview(user.id, id, dto.reply)', async () => {
    const { ctrl, vendorSvc } = await buildCtrl();
    await ctrl.replyToReview({ id: 'u1' } as any, 'rv1', { reply: 'Thanks!' } as any);
    expect(vendorSvc.replyToReview).toHaveBeenCalledWith('u1', 'rv1', 'Thanks!');
  });

  test('PATCH /vendor/settings/password → splits currentPassword + newPassword', async () => {
    const { ctrl, vendorSvc } = await buildCtrl();
    await ctrl.changePassword(
      { id: 'u1' } as any,
      { currentPassword: 'old', newPassword: 'NewPw123' } as any,
    );
    expect(vendorSvc.changePassword).toHaveBeenCalledWith('u1', 'old', 'NewPw123');
  });

  test('POST /vendor/upload-image validates + uploads', async () => {
    const { ctrl, upload } = await buildCtrl();
    const file = { originalname: 'x.webp', mimetype: 'image/webp' };
    await ctrl.uploadImage(file as any);
    expect(upload.validateFile).toHaveBeenCalledWith(file);
    expect(upload.upload).toHaveBeenCalledWith(file, 'activities');
  });

  test('POST /vendor/payout-requests → requestPayout(user.id)', async () => {
    const { ctrl, vendorSvc } = await buildCtrl();
    await ctrl.requestPayout({ id: 'u1' } as any);
    expect(vendorSvc.requestPayout).toHaveBeenCalledWith('u1');
  });

  test('GET /vendor/analytics/activities → getActivityAnalytics(user.id)', async () => {
    const { ctrl, vendorSvc } = await buildCtrl();
    await ctrl.getActivityAnalytics({ id: 'u1' } as any);
    expect(vendorSvc.getActivityAnalytics).toHaveBeenCalledWith('u1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AdminAuditInterceptor — PII/secret redaction + method filter
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminAuditInterceptor', () => {
  async function buildInterceptor() {
    const prisma = makePrismaMock();
    const interceptor = new AdminAuditInterceptor(prisma as unknown as PrismaService);
    return { interceptor, prisma };
  }

  function ctxWith(req: any, responseValue: unknown = { ok: true }) {
    return {
      context: {
        switchToHttp: () => ({ getRequest: () => req }),
      } as any,
      next: { handle: () => of(responseValue) },
    };
  }

  test('GET requests are NOT logged (reads are skipped)', async () => {
    const { interceptor, prisma } = await buildInterceptor();
    const { context, next } = ctxWith({ method: 'GET', url: '/admin/users', user: { id: 'a1' }, route: { path: '/admin/users' }, params: {}, body: {} });

    await lastValueFrom(interceptor.intercept(context, next));

    expect(prisma._client.auditLog.create).not.toHaveBeenCalled();
  });

  test('POST mutation is logged with resolved action + actorId + actorName', async () => {
    const { interceptor, prisma } = await buildInterceptor();
    const { context, next } = ctxWith({
      method: 'POST', url: '/admin/coupons',
      route: { path: '/admin/coupons' },
      user: { id: 'admin-1', fullName: 'Admin One' },
      params: {}, body: { code: 'SAVE10', discountValue: 10 },
    });

    await lastValueFrom(interceptor.intercept(context, next));
    // Logging is fire-and-forget — give microtask queue a tick
    await new Promise((r) => setImmediate(r));

    expect(prisma._client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorType: 'ADMIN',
          actorId:   'admin-1',
          actorName: 'Admin One',
          action:    'CREATE_COUPON',
          entity:    'Coupon',
        }),
      }),
    );
  });

  test('password fields are REDACTED in logged details', async () => {
    const { interceptor, prisma } = await buildInterceptor();
    const { context, next } = ctxWith({
      method: 'PATCH', url: '/admin/profile/password',
      route: { path: '/admin/profile/password' },
      user: { id: 'admin-1' },
      params: {},
      body: { currentPassword: 'PLAINTEXT_OLD', newPassword: 'PLAINTEXT_NEW' },
    });

    await lastValueFrom(interceptor.intercept(context, next));
    await new Promise((r) => setImmediate(r));

    const call = prisma._client.auditLog.create.mock.calls[0][0];
    const details = call.data.details;
    expect(details).not.toContain('PLAINTEXT_OLD');
    expect(details).not.toContain('PLAINTEXT_NEW');
    expect(details).toContain('[REDACTED]');
  });

  test('email, phone, fullName, iban, bankDetails, otp all redacted', async () => {
    const { interceptor, prisma } = await buildInterceptor();
    const { context, next } = ctxWith({
      method: 'POST', url: '/admin/users',
      route: { path: '/admin/users' },
      user: { id: 'admin-1' },
      params: {},
      body: {
        email: 'secret@example.com', phone: '+97412345678', fullName: 'John Doe',
        iban: 'QA12BANK0000000001', bankDetails: { accountNumber: '12345' },
        otp: '654321', code: '123456',
      },
    });

    await lastValueFrom(interceptor.intercept(context, next));
    await new Promise((r) => setImmediate(r));

    const details = prisma._client.auditLog.create.mock.calls[0][0].data.details;
    expect(details).not.toContain('secret@example.com');
    expect(details).not.toContain('+97412345678');
    expect(details).not.toContain('John Doe');
    expect(details).not.toContain('QA12BANK');
    expect(details).not.toContain('12345');
    expect(details).not.toContain('654321');
  });

  test('image fields are summarized (not base64-dumped into audit row)', async () => {
    const { interceptor, prisma } = await buildInterceptor();
    const { context, next } = ctxWith({
      method: 'PATCH', url: '/admin/activities/a1',
      route: { path: '/admin/activities/:id' },
      user: { id: 'admin-1' },
      params: { id: 'a1' },
      body: { gallery: ['/u/1.webp', '/u/2.webp', '/u/3.webp'], coverImage: '/u/c.webp' },
    });

    await lastValueFrom(interceptor.intercept(context, next));
    await new Promise((r) => setImmediate(r));

    const details = prisma._client.auditLog.create.mock.calls[0][0].data.details;
    expect(details).toContain('[3 images]');
    expect(details).toContain('[image]');
  });

  test('actorName falls back to user:{id-slice} when fullName missing', async () => {
    const { interceptor, prisma } = await buildInterceptor();
    const { context, next } = ctxWith({
      method: 'DELETE', url: '/admin/users/abc12345-xxxx',
      route: { path: '/admin/users/:id' },
      user: { id: 'abc12345-xxxx' }, // no fullName
      params: { id: 'abc12345-xxxx' }, body: {},
    });

    await lastValueFrom(interceptor.intercept(context, next));
    await new Promise((r) => setImmediate(r));

    const data = prisma._client.auditLog.create.mock.calls[0][0].data;
    expect(data.actorName).toBe('user:abc12345');
  });

  test('details truncated to 1000 chars (bound on audit-row size)', async () => {
    const { interceptor, prisma } = await buildInterceptor();
    const huge = 'x'.repeat(5000);
    const { context, next } = ctxWith({
      method: 'POST', url: '/admin/activities/a1',
      route: { path: '/admin/activities/a1' },
      user: { id: 'admin-1' }, params: {},
      body: { description: huge },
    });

    await lastValueFrom(interceptor.intercept(context, next));
    await new Promise((r) => setImmediate(r));

    const details = prisma._client.auditLog.create.mock.calls[0][0].data.details;
    expect(details.length).toBeLessThanOrEqual(1000);
  });

  test('no user (guard didn\'t attach) → no audit row written', async () => {
    const { interceptor, prisma } = await buildInterceptor();
    const { context, next } = ctxWith({
      method: 'POST', url: '/admin/coupons',
      route: { path: '/admin/coupons' },
      user: undefined, params: {}, body: {},
    });

    await lastValueFrom(interceptor.intercept(context, next));
    await new Promise((r) => setImmediate(r));

    expect(prisma._client.auditLog.create).not.toHaveBeenCalled();
  });
});
