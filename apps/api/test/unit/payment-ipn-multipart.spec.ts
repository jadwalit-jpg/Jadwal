/**
 * HTTP-level test for the PAY2M IPN endpoint.
 *
 * PAY2M sends the IPN as `multipart/form-data` (verified in production logs,
 * 2026-06-19 — user-agent `got`, contentType multipart/form-data). Express's
 * json + urlencoded body-parsers do NOT parse multipart, so the body arrived
 * empty and the endpoint returned 400 on every IPN. This test boots the real
 * PaymentController behind the real global ValidationPipe and asserts the
 * endpoint now parses a multipart IPN and forwards the fields to the service.
 *
 * No DB / Redis: PaymentService is mocked. The thing under test is the
 * controller's body handling, not the payment logic.
 */

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { PaymentController } from '../../src/payment/payment.controller';
import { PaymentService } from '../../src/payment/payment.service';

const VALID_RESPONSE_KEY = 'a'.repeat(64);
const VALID_BASKET = 'JDWL-549e0f09-233';

describe('POST /payment/callback/ipn — multipart/form-data parsing', () => {
  let app: INestApplication;
  const handleCallback = jest.fn().mockResolvedValue({ bookingId: '', status: 'pending' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        { provide: PaymentService, useValue: { handleCallback } },
        { provide: ConfigService, useValue: { getOrThrow: () => 'https://app.example.com' } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror production global validation (main.ts).
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => handleCallback.mockClear());

  it('parses a multipart IPN and forwards the fields to the service (200)', async () => {
    const res = await request(app.getHttpServer())
      .post('/payment/callback/ipn')
      .field('err_code', '000')
      .field('basket_id', VALID_BASKET)
      .field('transaction_id', 'TXN-9873474567')
      .field('order_date', '2026-06-19 23:35:00')
      .field('Response_Key', VALID_RESPONSE_KEY)
      .field('PaymentName', 'NAPS');

    expect(res.status).toBe(201); // Nest @Post default success status
    expect(res.body).toEqual({ received: true });
    expect(handleCallback).toHaveBeenCalledTimes(1);
    expect(handleCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        err_code: '000',
        basket_id: VALID_BASKET,
        Response_Key: VALID_RESPONSE_KEY,
      }),
    );
  });

  it('rejects a multipart body that smuggles a file (no uploads on this route)', async () => {
    const res = await request(app.getHttpServer())
      .post('/payment/callback/ipn')
      .field('err_code', '000')
      .field('basket_id', VALID_BASKET)
      .field('Response_Key', VALID_RESPONSE_KEY)
      .attach('evil', Buffer.from('malware'), 'evil.bin');

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(handleCallback).not.toHaveBeenCalled();
  });
});
