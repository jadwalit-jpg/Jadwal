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
  // The IPN endpoint asks the service whether the source IP is trusted; mock it
  // to true so we can assert the controller forwards the verdict via opts.
  const isTrustedIpnSource = jest.fn().mockReturnValue(true);
  // Used by the browser-callback handler to decide pending-vs-failed when a
  // callback can't be verified (NAPS rail). Read-only status lookup.
  const paymentStatusByBasket = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        { provide: PaymentService, useValue: { handleCallback, isTrustedIpnSource, paymentStatusByBasket } },
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

  it('parses a multipart IPN and forwards the mapped fields + trust verdict (200)', async () => {
    // The real IPN names its hash `responseKey` (lowercase) and carries no
    // amount (confirmed from production logs) — distinct from the redirect.
    const res = await request(app.getHttpServer())
      .post('/payment/callback/ipn')
      .field('err_code', '0000')
      .field('basket_id', VALID_BASKET)
      .field('transaction_id', 'TXN-9873474567')
      .field('order_date', '2026-06-19 23:35:00')
      .field('responseKey', VALID_RESPONSE_KEY)
      .field('rdv_message_key', 'mk-1');

    expect(res.status).toBe(201); // Nest @Post default success status
    expect(res.body).toEqual({ received: true });
    expect(handleCallback).toHaveBeenCalledTimes(1);
    // Controller maps responseKey → Response_Key and tags the call as an IPN
    // with the source-IP trust verdict (mocked true here).
    expect(handleCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        err_code: '0000',
        basket_id: VALID_BASKET,
        transaction_id: 'TXN-9873474567',
        Response_Key: VALID_RESPONSE_KEY,
      }),
      expect.objectContaining({ via: 'ipn', trustedCapture: true }),
    );
  });

  it('tolerates unknown extra fields PAY2M may add (strips them, still forwards)', async () => {
    // PAY2M's IPN carries fields beyond the redirect's set. A third-party
    // webhook must NOT be rejected wholesale for an unmodelled field — we strip
    // unknowns (whitelist) and forward the known ones. handleCallback stays the
    // secret-gated security gate.
    const res = await request(app.getHttpServer())
      .post('/payment/callback/ipn')
      .field('err_code', '0000')
      .field('basket_id', VALID_BASKET)
      .field('responseKey', VALID_RESPONSE_KEY)
      .field('transaction_id', 'TXN-1')
      .field('Status_Message', 'Transaction processed') // NOT in the DTO
      .field('Reserved_1', 'anything'); // NOT in the DTO

    expect(res.status).toBe(201);
    expect(handleCallback).toHaveBeenCalledTimes(1);
    const arg = handleCallback.mock.calls[0][0];
    expect(arg.basket_id).toBe(VALID_BASKET);
    expect(arg.err_code).toBe('0000');
    // Unknown fields are stripped, never forwarded to the payment logic.
    expect(arg).not.toHaveProperty('Status_Message');
    expect(arg).not.toHaveProperty('Reserved_1');
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

// ─────────────────────────────────────────────────────────────────────────
// Browser callback (GET) — an UNVERIFIABLE NAPS redirect must show the
// "processing" screen (not a false "failed") while the payment is still
// PENDING, because the server-to-server IPN confirms it moments later. A
// genuine failure / forgery (no PENDING payment) still shows "failed". The
// SUCCESS path is unaffected (it returns before the catch).
// ─────────────────────────────────────────────────────────────────────────
describe('GET /payment/callback — unverifiable NAPS redirect → pending, not failed', () => {
  const BOOKING_UUID = '11111111-2222-4333-8444-555555555555';
  const q = `basket_id=${VALID_BASKET}&err_code=000&Response_Key=${VALID_RESPONSE_KEY}`;

  beforeEach(() => {
    handleCallback.mockReset();
    paymentStatusByBasket.mockReset();
  });

  it('hash unverifiable + payment still PENDING → redirects to status=pending', async () => {
    handleCallback.mockRejectedValueOnce(new Error('Payment verification failed'));
    paymentStatusByBasket.mockResolvedValueOnce({ status: 'PENDING', bookingId: BOOKING_UUID });

    const res = await request(app.getHttpServer()).get(`/payment/callback?${q}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=pending');
    expect(res.headers.location).toContain(BOOKING_UUID);
    expect(res.headers.location).not.toContain('status=failed');
  });

  it('hash unverifiable + no PENDING payment (genuine fail/forgery) → status=failed', async () => {
    handleCallback.mockRejectedValueOnce(new Error('Payment verification failed'));
    paymentStatusByBasket.mockResolvedValueOnce(null);

    const res = await request(app.getHttpServer()).get(`/payment/callback?${q}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=failed');
  });
});
});
