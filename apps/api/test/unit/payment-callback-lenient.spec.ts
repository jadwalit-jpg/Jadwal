/**
 * GET /payment/callback must never answer a customer with JSON.
 *
 * On 24 Nov 2026 a customer's browser ended on the API callback URL showing
 * `{"statusCode":400,"message":"Bad Request"}`: the global ValidationPipe
 * (forbidNonWhitelisted) rejected PAY2M's return query before the handler ran.
 * The route now validates leniently (strip unknown fields, keep the bounds on
 * the used fields) and ALWAYS redirects to the frontend return page:
 *   - unknown extra parameters are dropped, the known ones still go to
 *     handleCallback, and the unknown NAMES are logged (never values);
 *   - a missing or malformed required field (Response_Key included) is never
 *     passed to handleCallback: the customer is redirected by the STORED
 *     payment state (SUCCESS → success, PENDING → pending, else failed) and
 *     nothing is confirmed or failed; the failing field NAME is logged;
 *   - no usable basket_id → the neutral "checking" page;
 *   - garbage of any shape → still a redirect, never a 400 body.
 * Booted behind the real global ValidationPipe exactly as main.ts configures it
 * in production (messages suppressed), so the bare-400 path is really exercised.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { PaymentController } from '../../src/payment/payment.controller';
import { PaymentService } from '../../src/payment/payment.service';
import { TermsAcceptedGuard } from '../../src/auth/guards/terms-accepted.guard';

const KEY = 'a'.repeat(64);
const BASKET = 'JDWL-549e0f09-233';
const BOOKING = '11111111-2222-4333-8444-555555555555';
const FRONT = 'https://app.example.com';

describe('GET /payment/callback — lenient validation, redirect-only', () => {
  let app: INestApplication;
  const handleCallback = jest.fn();
  const paymentStatusByBasket = jest.fn();
  const isTrustedIpnSource = jest.fn().mockReturnValue(false);
  let warn: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        { provide: PaymentService, useValue: { handleCallback, paymentStatusByBasket, isTrustedIpnSource } },
        { provide: ConfigService, useValue: { getOrThrow: () => FRONT } },
      ],
    })
      .overrideGuard(TermsAcceptedGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, disableErrorMessages: true }),
    );
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => {
    handleCallback.mockReset().mockResolvedValue({ bookingId: BOOKING, status: 'success' });
    paymentStatusByBasket.mockReset();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => { warn.mockRestore(); errorLog.mockRestore(); });

  const get = (qs: string) => request(app.getHttpServer()).get(`/payment/callback${qs ? `?${qs}` : ''}`);
  const location = (res: request.Response) => new URL(res.headers.location);
  const warnEvents = () => warn.mock.calls.map((c) => c[0]).filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>;
  const allLogText = () => JSON.stringify([...warn.mock.calls, ...errorLog.mock.calls]);

  it('a complete callback is processed and redirected as before', async () => {
    const res = await get(`basket_id=${BASKET}&err_code=000&Response_Key=${KEY}&transaction_id=TX1`);
    expect(res.status).toBe(302);
    expect(handleCallback).toHaveBeenCalledWith(expect.objectContaining({ basket_id: BASKET, err_code: '000', Response_Key: KEY, transaction_id: 'TX1' }));
    const u = location(res);
    expect(u.origin + u.pathname).toBe(`${FRONT}/payment/callback`);
    expect(u.searchParams.get('status')).toBe('success');
    expect(u.searchParams.get('bookingId')).toBe(BOOKING);
    expect(warnEvents().find((e) => e.event === 'PAY2M_CALLBACK_UNKNOWN_FIELDS')).toBeUndefined();
  });

  it('an unknown extra parameter is stripped, the callback is still processed, and the unknown NAME is logged', async () => {
    const res = await get(`basket_id=${BASKET}&err_code=000&Response_Key=${KEY}&card_scheme=NAPS&new_thing=1`);
    expect(res.status).toBe(302);
    expect(location(res).searchParams.get('status')).toBe('success');
    expect(handleCallback).toHaveBeenCalledTimes(1);
    const passed = handleCallback.mock.calls[0][0];
    expect(passed).not.toHaveProperty('card_scheme');
    expect(passed).not.toHaveProperty('new_thing');
    const ev = warnEvents().find((e) => e.event === 'PAY2M_CALLBACK_UNKNOWN_FIELDS');
    expect(ev?.fields).toEqual(['card_scheme', 'new_thing']);
    expect(allLogText()).not.toContain('NAPS'); // names only, never values
  });

  describe('a missing or malformed required field never reaches handleCallback', () => {
    it.each([
      ['missing Response_Key', `basket_id=${BASKET}&err_code=000`, 'Response_Key'],
      ['Response_Key not 64 hex chars', `basket_id=${BASKET}&err_code=000&Response_Key=abc`, 'Response_Key'],
      ['Response_Key 128 chars', `basket_id=${BASKET}&err_code=000&Response_Key=${'b'.repeat(128)}`, 'Response_Key'],
      ['missing err_code', `basket_id=${BASKET}&Response_Key=${KEY}`, 'err_code'],
      ['err_code too long', `basket_id=${BASKET}&err_code=${'9'.repeat(11)}&Response_Key=${KEY}`, 'err_code'],
      ['Response_Key sent twice (array)', `basket_id=${BASKET}&err_code=000&Response_Key=${KEY}&Response_Key=${KEY}`, 'Response_Key'],
    ])('%s → redirect by the stored state (SUCCESS), field name logged', async (_label, qs, field) => {
      paymentStatusByBasket.mockResolvedValue({ status: 'SUCCESS', bookingId: BOOKING });
      const res = await get(qs);
      expect(res.status).toBe(302);
      expect(handleCallback).not.toHaveBeenCalled();
      expect(paymentStatusByBasket).toHaveBeenCalledWith(BASKET);
      const u = location(res);
      expect(u.searchParams.get('status')).toBe('success');
      expect(u.searchParams.get('bookingId')).toBe(BOOKING);
      const ev = warnEvents().find((e) => e.event === 'PAY2M_CALLBACK_INVALID');
      expect(ev?.fields).toContain(field);
      // The secret-derived hash value is never logged, valid or not.
      expect(allLogText()).not.toContain(KEY);
      expect(allLogText()).not.toContain('b'.repeat(128));
    });

    it('stored state PENDING → pending; FAILED → failed; unknown basket → failed; nothing is written', async () => {
      const qs = `basket_id=${BASKET}&err_code=000`;
      paymentStatusByBasket.mockResolvedValueOnce({ status: 'PENDING', bookingId: BOOKING });
      let u = location(await get(qs));
      expect(u.searchParams.get('status')).toBe('pending');
      expect(u.searchParams.get('bookingId')).toBe(BOOKING);

      paymentStatusByBasket.mockResolvedValueOnce({ status: 'FAILED', bookingId: BOOKING });
      u = location(await get(qs));
      expect(u.searchParams.get('status')).toBe('failed');
      expect(u.searchParams.get('bookingId')).toBe(BOOKING);
      expect(u.searchParams.get('error')).toBe('Payment could not be verified');

      paymentStatusByBasket.mockResolvedValueOnce(null);
      u = location(await get(qs));
      expect(u.searchParams.get('status')).toBe('failed');
      expect(u.searchParams.get('bookingId')).toBe('');

      expect(handleCallback).not.toHaveBeenCalled();
    });

    it('a stored bookingId that is not a UUID is not echoed into the redirect', async () => {
      paymentStatusByBasket.mockResolvedValueOnce({ status: 'SUCCESS', bookingId: 'javascript:alert(1)' });
      const u = location(await get(`basket_id=${BASKET}&err_code=000`));
      expect(u.searchParams.get('status')).toBe('success');
      expect(u.searchParams.get('bookingId')).toBe('');
    });
  });

  describe('no usable basket id → the neutral "checking" page', () => {
    it.each([
      ['empty query', ''],
      ['only unknown fields', 'foo=bar&baz=1'],
      ['malformed basket id', `basket_id=not-ours&err_code=000&Response_Key=${KEY}`],
      ['basket id too long', `basket_id=JDWL-${'a'.repeat(40)}&err_code=000`],
      ['basket id as array', `basket_id=${BASKET}&basket_id=${BASKET}&err_code=000`],
    ])('%s', async (_label, qs) => {
      const res = await get(qs);
      expect(res.status).toBe(302);
      const u = location(res);
      expect(u.origin + u.pathname).toBe(`${FRONT}/payment/callback`);
      expect(u.searchParams.get('status')).toBe('checking');
      expect(u.searchParams.has('bookingId')).toBe(false);
      expect(handleCallback).not.toHaveBeenCalled();
      expect(paymentStatusByBasket).not.toHaveBeenCalled();
    });

    it('a failing status lookup still ends on the checking page, never an error body', async () => {
      paymentStatusByBasket.mockRejectedValueOnce(new Error('db down'));
      const res = await get(`basket_id=${BASKET}&err_code=000`);
      expect(res.status).toBe(302);
      expect(location(res).searchParams.get('status')).toBe('checking');
      expect(allLogText()).not.toContain('db down');
    });
  });

  it('never answers 400 JSON, whatever the shape of the query', async () => {
    const shapes = [
      'basket_id[nested]=x&err_code=000',
      `basket_id=${BASKET}&err_code=000&Response_Key=${KEY}&__proto__[polluted]=1`,
      `basket_id=${BASKET}&err_code=${encodeURIComponent('<script>alert(1)</script>')}&Response_Key=${KEY}`,
      `err_msg=${'x'.repeat(5000)}&basket_id=${BASKET}&err_code=000&Response_Key=${KEY}`,
      `basket_id=${BASKET}&err_code=000&Response_Key=${encodeURIComponent('%%%')}`,
    ];
    paymentStatusByBasket.mockResolvedValue(null);
    for (const qs of shapes) {
      const res = await get(qs);
      expect([302, 429]).toContain(res.status);
      if (res.status === 302) {
        expect(res.headers.location.startsWith(`${FRONT}/payment/callback?`)).toBe(true);
        expect(res.headers['content-type'] ?? '').not.toContain('application/json');
      }
    }
  });

  it('the unverifiable-hash path is unchanged: PENDING + paid-looking code → pending, failure code → failed', async () => {
    handleCallback.mockRejectedValueOnce(new Error('Payment verification failed'));
    paymentStatusByBasket.mockResolvedValueOnce({ status: 'PENDING', bookingId: BOOKING });
    let u = location(await get(`basket_id=${BASKET}&err_code=000&Response_Key=${KEY}`));
    expect(u.searchParams.get('status')).toBe('pending');

    handleCallback.mockRejectedValueOnce(new Error('Payment verification failed'));
    paymentStatusByBasket.mockResolvedValueOnce({ status: 'PENDING', bookingId: BOOKING });
    u = location(await get(`basket_id=${BASKET}&err_code=901&Response_Key=${KEY}`));
    expect(u.searchParams.get('status')).toBe('failed');
  });
});
