/**
 * CustomerInteractionController — review-ask endpoints: roles, validation,
 * and that the review submit closes the open asks.
 *   GET  /customer/review-prompts/next
 *   GET  /customer/review-prompts/by-ref/:ref
 *   POST /customer/review-prompts/:bookingId/dismiss
 *   POST /customer/reviews → markReviewed
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { CustomerInteractionController } from '../../src/catalog/customer-interaction.controller';
import { ReviewRequestService } from '../../src/catalog/review-request.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationService } from '../../src/common/services/notification.service';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';

const BOOKING_ID = '3f2b9c1e-6d4a-4b7c-9e8f-1a2b3c4d5e6f';
const ACTIVITY_ID = '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
type FakeUser = { id: string; email: string; role: 'ADMIN' | 'VENDOR' | 'CUSTOMER'; fullName: string };

describe('Review-ask endpoints', () => {
  let app: INestApplication;
  let currentUser: FakeUser = { id: 'cust-1', email: 'c@test.local', role: 'CUSTOMER', fullName: 'Cust' };
  const prompt = { bookingId: BOOKING_ID, bookingRef: 'JDWL-ABC', endDate: '2026-11-20T18:00:00.000Z', activity: { id: ACTIVITY_ID, titleEn: 'Tour', titleAr: 'جولة', slug: 'tour', coverImage: null } };
  const svc = {
    nextPromptFor: jest.fn().mockResolvedValue(prompt),
    promptByRef: jest.fn().mockResolvedValue({ prompt, alreadyReviewed: false, canReview: true }),
    dismiss: jest.fn().mockResolvedValue({ ok: true }),
    markReviewed: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    client: {
      activity: { findFirst: jest.fn().mockResolvedValue({ id: ACTIVITY_ID, status: 'ACTIVE' }) },
      booking: { findFirst: jest.fn().mockResolvedValue({ id: BOOKING_ID }) },
      review: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r-1', rating: 5, customer: { fullName: 'Cust' }, activity: { titleEn: 'Tour', vendor: { userId: 'v-1' } } }),
      },
    },
  };
  const notifications = { send: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerInteractionController],
      providers: [
        { provide: ReviewRequestService, useValue: svc },
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notifications },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({
        canActivate: (ctx: any) => { ctx.switchToHttp().getRequest().user = currentUser; return true; },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => {
    currentUser = { id: 'cust-1', email: 'c@test.local', role: 'CUSTOMER', fullName: 'Cust' };
    for (const fn of Object.values(svc)) fn.mockClear();
    prisma.client.review.create.mockClear();
  });

  it('GET next: the customer gets the prompt; a vendor gets null without a service call', async () => {
    const res = await request(app.getHttpServer()).get('/customer/review-prompts/next');
    expect(res.status).toBe(200);
    expect(res.body.prompt.bookingRef).toBe('JDWL-ABC');
    expect(svc.nextPromptFor).toHaveBeenCalledWith('cust-1');
    currentUser = { ...currentUser, role: 'VENDOR' };
    const v = await request(app.getHttpServer()).get('/customer/review-prompts/next');
    expect(v.status).toBe(200);
    expect(v.body).toEqual({ prompt: null });
    expect(svc.nextPromptFor).toHaveBeenCalledTimes(1);
  });

  it('GET by-ref: valid reference → service; malformed reference → 404 without a lookup; vendor → 403', async () => {
    const ok = await request(app.getHttpServer()).get('/customer/review-prompts/by-ref/JDWL-ABC');
    expect(ok.status).toBe(200);
    expect(ok.body.canReview).toBe(true);
    expect(svc.promptByRef).toHaveBeenCalledWith('cust-1', 'JDWL-ABC');
    expect((await request(app.getHttpServer()).get('/customer/review-prompts/by-ref/not-a-ref')).status).toBe(404);
    expect((await request(app.getHttpServer()).get(`/customer/review-prompts/by-ref/${encodeURIComponent('JDWL-<x>')}`)).status).toBe(404);
    expect(svc.promptByRef).toHaveBeenCalledTimes(1);
    currentUser = { ...currentUser, role: 'VENDOR' };
    expect((await request(app.getHttpServer()).get('/customer/review-prompts/by-ref/JDWL-ABC')).status).toBe(403);
  });

  it('POST dismiss: later / never accepted, anything else 400, non-UUID 400, vendor 403', async () => {
    const post = (id: string, body: unknown) => request(app.getHttpServer()).post(`/customer/review-prompts/${id}/dismiss`).send(body as object);
    expect((await post(BOOKING_ID, { mode: 'later' })).status).toBe(201);
    expect((await post(BOOKING_ID, { mode: 'never' })).status).toBe(201);
    expect(svc.dismiss).toHaveBeenCalledWith('cust-1', BOOKING_ID, 'later');
    expect(svc.dismiss).toHaveBeenCalledWith('cust-1', BOOKING_ID, 'never');
    expect((await post(BOOKING_ID, { mode: 'forever' })).status).toBe(400);
    expect((await post(BOOKING_ID, { mode: 'later', extra: 1 })).status).toBe(400);
    expect((await post('nope', { mode: 'later' })).status).toBe(400);
    expect(svc.dismiss).toHaveBeenCalledTimes(2);
    currentUser = { ...currentUser, role: 'VENDOR' };
    expect((await post(BOOKING_ID, { mode: 'later' })).status).toBe(403);
  });

  it('POST reviews: a created review closes the open asks for that customer and activity', async () => {
    const res = await request(app.getHttpServer()).post('/customer/reviews').send({ activityId: ACTIVITY_ID, rating: 5 });
    expect(res.status).toBe(201);
    expect(svc.markReviewed).toHaveBeenCalledWith('cust-1', ACTIVITY_ID);
    // Still rating-only: a comment is rejected by the DTO.
    const withText = await request(app.getHttpServer()).post('/customer/reviews').send({ activityId: ACTIVITY_ID, rating: 5, text: 'great' });
    expect(withText.status).toBe(400);
  });
});
