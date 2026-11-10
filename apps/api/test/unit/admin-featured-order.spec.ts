/**
 * HTTP-level checks for the Featured order endpoints.
 *
 *   GET /admin/activities/featured
 *   PUT /admin/activities/featured/order { ids }
 *
 * AdminController is guarded class-level (@UseGuards(JwtAuthGuard, RolesGuard)
 * + @Roles('ADMIN')), so vendors and customers get 403 before the service
 * runs. JwtAuthGuard is replaced by a fake that sets req.user; RolesGuard, the
 * ValidationPipe and AdminAuditInterceptor are the real ones, so this also
 * pins the DTO rules and that a save is audited as REORDER_FEATURED_ACTIVITIES.
 *
 * It also proves the route order: 'activities/featured' is declared before
 * 'activities/:id', otherwise GET would hit ParseUUIDPipe and return 400.
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
import { ConflictException, INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { AdminController } from '../../src/admin/admin.controller';
import { AdminService } from '../../src/admin/admin.service';
import { UploadService } from '../../src/common/services/upload.service';
import { CleanupService } from '../../src/common/services/cleanup.service';
import { EmailSuppressionService } from '../../src/email/email-suppression.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';

const ID_A = '0b6d6b0e-2f0c-4a7e-9c3b-2d6f1a8e5c11';
const ID_B = '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

type FakeUser = { id: string; email: string; role: 'ADMIN' | 'VENDOR' | 'CUSTOMER'; fullName: string };

describe('Featured order endpoints — roles, validation, audit', () => {
  let app: INestApplication;
  let currentUser: FakeUser = { id: 'admin-1', email: 'admin@test.local', role: 'ADMIN', fullName: 'Admin' };
  const getFeaturedActivities = jest.fn().mockResolvedValue({ data: [{ id: ID_A }, { id: ID_B }], total: 2, homepageLimit: 20 });
  const setFeaturedOrder = jest.fn().mockResolvedValue({ updated: 2 });
  const auditCreate = jest.fn().mockResolvedValue({});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AdminService, useValue: { getFeaturedActivities, setFeaturedOrder } },
        { provide: UploadService, useValue: {} },
        { provide: CleanupService, useValue: {} },
        { provide: EmailSuppressionService, useValue: {} },
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
    currentUser = { id: 'admin-1', email: 'admin@test.local', role: 'ADMIN', fullName: 'Admin' };
    getFeaturedActivities.mockClear(); setFeaturedOrder.mockClear(); auditCreate.mockClear();
  });
  const flush = () => new Promise((r) => setImmediate(r));

  const list = () => request(app.getHttpServer()).get('/admin/activities/featured');
  const save = (body: unknown) => request(app.getHttpServer()).put('/admin/activities/featured/order').send(body as object);

  describe('GET /admin/activities/featured', () => {
    it('admin: 200 with the list (and the route is not swallowed by activities/:id)', async () => {
      const res = await list();
      expect(res.status).toBe(200);
      expect(res.body.data.map((a: any) => a.id)).toEqual([ID_A, ID_B]);
      expect(getFeaturedActivities).toHaveBeenCalledTimes(1);
      await flush();
      expect(auditCreate).not.toHaveBeenCalled(); // reads are not audited
    });

    it.each(['VENDOR', 'CUSTOMER'] as const)('%s: 403, service never called', async (role) => {
      currentUser = { id: `${role.toLowerCase()}-1`, email: `${role.toLowerCase()}@test.local`, role, fullName: role };
      expect((await list()).status).toBe(403);
      expect(getFeaturedActivities).not.toHaveBeenCalled();
    });
  });

  describe('PUT /admin/activities/featured/order', () => {
    it('admin: 200, the service receives the ids in order, and the save is audited', async () => {
      const res = await save({ ids: [ID_B, ID_A] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updated: 2 });
      expect(setFeaturedOrder).toHaveBeenCalledWith([ID_B, ID_A]);
      await flush();
      expect(auditCreate).toHaveBeenCalledTimes(1);
      expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          action: 'REORDER_FEATURED_ACTIVITIES',
          entity: 'Activity',
          actorId: 'admin-1',
          actionCategory: 'OPERATIONAL',
          details: expect.stringContaining(ID_B),
        }),
      }));
    });

    it('an empty list is accepted (nothing featured → nothing to order; the service checks the set)', async () => {
      expect((await save({ ids: [] })).status).toBe(200);
      expect(setFeaturedOrder).toHaveBeenCalledWith([]);
    });

    it.each(['VENDOR', 'CUSTOMER'] as const)('%s: 403, service never called, no audit row', async (role) => {
      currentUser = { id: `${role.toLowerCase()}-1`, email: `${role.toLowerCase()}@test.local`, role, fullName: role };
      expect((await save({ ids: [ID_A, ID_B] })).status).toBe(403);
      expect(setFeaturedOrder).not.toHaveBeenCalled();
      await flush();
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it.each([
      ['a duplicate id', { ids: [ID_A, ID_A] }],
      ['a non-UUID id', { ids: [ID_A, 'not-a-uuid'] }],
      ['ids that is not an array', { ids: ID_A }],
      ['missing ids', {}],
      ['an unexpected field', { ids: [ID_A], force: true }],
      ['more than 500 ids', { ids: Array.from({ length: 501 }, () => randomUUID()) }],
    ])('rejects %s with 400, service never called', async (_name, body) => {
      expect((await save(body)).status).toBe(400);
      expect(setFeaturedOrder).not.toHaveBeenCalled();
    });

    it('a changed featured set surfaces as 409 with the server message', async () => {
      setFeaturedOrder.mockRejectedValueOnce(new ConflictException('The featured list changed. Reload and try again.'));
      const res = await save({ ids: [ID_A, ID_B] });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('The featured list changed. Reload and try again.');
    });
  });
});
