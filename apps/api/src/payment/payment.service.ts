import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisLockService } from '../redis/redis-lock.service';
import { AvailabilityCacheService } from '../redis/availability-cache.service';
import { AuditLoggerService } from '../common/services/audit-logger.service';
import { refundCouponUsage } from '../bookings/bookings.service';
import { NotificationService } from '../common/services/notification.service';
import { LoyaltyService } from '../common/services/loyalty.service';
import { EmailService } from '../email/email.service';
import { CircuitBreaker, CircuitBreakerOpenError, withTimeout } from '../common/utils/circuit-breaker';
import * as crypto from 'crypto';

interface Pay2mTokenResponse {
  MERCHANT_ID: string;
  ACCESS_TOKEN: string;
  NAME: string;
  GENERATED_DATE_TIME: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly enabled: boolean;
  private readonly merchantId: string;
  private readonly merchantName: string;
  private readonly securedKey: string;
  // PAY2M callback secret word. Configured in the PAY2M merchant portal and
  // mirrored into SSM as PAY2M_SECRET_WORD — the two MUST be identical.
  // Empty string when no secret word is set in the portal (pre-launch
  // state); production requires it non-empty (main.ts). See verifyCallbackHash.
  private readonly secretWord: string;
  private readonly apiUrl: string;
  private readonly returnUrl: string;
  // Per-attempt timeout for the PAY2M token-fetch HTTP call (in ms).
  // Replaces the inline `AbortSignal.timeout(15000)`. Worst-case wall time
  // for a single initiatePayment is roughly `MAX_ATTEMPTS * tokenTimeoutMs`
  // plus the (~500ms × 2^n) exponential backoff between retries. Keep this
  // generous (PAY2M's hosted-checkout pre-auth is normally <500ms but card-
  // network handoff can stall briefly). Same shape as `EmailService.sendTimeoutMs`.
  private readonly tokenTimeoutMs: number;
  // Circuit breaker around PAY2M token fetches. Opens after `failureThreshold`
  // consecutive failures (each "failure" = a single attempt — see retry-loop
  // note in `getAccessToken`). When OPEN, callers fail-fast with
  // `CircuitBreakerOpenError` → caller turns it into a 503-shaped
  // `BadRequestException('Payment gateway is temporarily unavailable')`
  // identical to what an exhausted retry loop produces. Default is paranoid
  // (10 failures, 30s open) — must sustain real outage to trip.
  //
  // Why a breaker on top of the existing retry loop:
  //   - The retry loop already bounds latency for a single customer (~32s
  //     worst case across 3 attempts). The breaker bounds aggregate cost
  //     when PAY2M is down for many concurrent customers — instead of every
  //     checkout burning 32s of NestJS worker time, after the threshold is
  //     reached subsequent attempts return in <1ms. Saves the API worker
  //     pool from pile-up under a sustained gateway outage.
  //   - Single-probe invariant in HALF_OPEN (see CircuitBreaker class doc)
  //     means we only test the gateway once per 30s cooldown — gentle on
  //     PAY2M when it's recovering.
  private readonly breaker: CircuitBreaker;

  // ── IPN capture-confirmation gate (server-to-server) ──────────────────────
  // PAY2M's IPN is the authoritative "captured" signal for NAPS, where the
  // browser callback is hash-unverifiable (no amount) and capture-ambiguous.
  // The IPN carries no amount either, so its hash can't be verified our way —
  // the trust anchor is the SOURCE IP (Cloudflare-set cf-connecting-ip, which a
  // client cannot forge while the ALB security group is locked to Cloudflare's
  // ranges). Ships behind a flag (default OFF) so merging is a no-op until the
  // allow-list + a live test are confirmed. Empty allow-list ⇒ fail-closed.
  private readonly ipnConfirmEnabled: boolean;
  private readonly ipnAllowedIps: ReadonlySet<string>;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private redisLock: RedisLockService,
    private auditLogger: AuditLoggerService,
    private notificationService: NotificationService,
    private emailService: EmailService,
    private availabilityCache: AvailabilityCacheService,
    private loyalty: LoyaltyService,
  ) {
    this.enabled = this.config.get('PAYMENT_ENABLED', 'false') === 'true';
    this.merchantId = this.config.getOrThrow<string>('PAY2M_MERCHANT_ID');
    this.securedKey = this.config.getOrThrow<string>('PAY2M_SECURED_KEY');
    // Default to '' — a missing/empty secret word is a valid (if insecure,
    // forgeable) pre-launch state. main.ts fails-fast in production if it is
    // empty, so production always has a real secret word.
    this.secretWord = this.config.get<string>('PAY2M_SECRET_WORD', '') ?? '';
    this.returnUrl = this.config.getOrThrow<string>('PAY2M_RETURN_URL');
    this.apiUrl = this.config.getOrThrow<string>('PAY2M_API_URL');
    this.merchantName = this.config.getOrThrow<string>('PAY2M_MERCHANT_NAME');

    // IPN capture-confirmation gate. OFF by default — when off, an IPN is
    // logged but never confirms a booking. The allow-list defaults to the
    // observed PAY2M IPN source (34.18.115.33); override via SSM with a
    // comma-separated list. An empty list ⇒ NO IPN is ever trusted (fail-closed).
    this.ipnConfirmEnabled = this.config.get('PAY2M_IPN_CONFIRM_ENABLED', 'false') === 'true';
    this.ipnAllowedIps = new Set(
      (this.config.get<string>('PAY2M_IPN_ALLOWED_IPS', '34.18.115.33') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

    // Resilience config — explicit per-attempt timeout + circuit breaker.
    // Mirrors `EmailService` / `SmsService`: defaults are paranoid (10
    // consecutive failures, 30s open cooldown) so a single misbehaving
    // checkout doesn't trip it. `EXTERNAL_BREAKER_DISABLED=true` is the
    // SSM kill switch shared with SES + SNS — flips all three breakers
    // off without a code change.
    // A malformed env value (empty string, "abc", "0", "-5") would coerce to
    // NaN/0/negative and AbortSignal.timeout would abort immediately on every
    // PAY2M call — fail-fast at construction so a misconfig surfaces in logs
    // rather than masquerading as a gateway outage.
    const parsePositiveInt = (raw: unknown, fallback: number): number => {
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    this.tokenTimeoutMs = parsePositiveInt(this.config.get('PAY2M_TOKEN_TIMEOUT_MS'), 15000);
    this.breaker = new CircuitBreaker({
      name: 'pay2m-token',
      failureThreshold: parsePositiveInt(this.config.get('PAY2M_BREAKER_FAILURE_THRESHOLD'), 10),
      openTimeoutMs: parsePositiveInt(this.config.get('PAY2M_BREAKER_OPEN_MS'), 30000),
      disabled: this.config.get('EXTERNAL_BREAKER_DISABLED', 'false') === 'true',
      onStateChange: (e) =>
        this.logger.warn({
          event: 'CIRCUIT_BREAKER_STATE_CHANGE',
          breaker: e.name,
          from: e.from,
          to: e.to,
          consecutiveFailures: e.consecutiveFailures,
        }),
    });
  }

  // ─── Get PAY2M Access Token ─────────────────────────────────────────────

  // Hard cap on PAY2M response payload. Genuine token responses are ~200
  // bytes; 16 KiB is generous future-proofing without exposing us to a
  // memory-DoS scenario where an upstream (compromised or misbehaving)
  // returns a huge body that response.json() would buffer in full.
  private static readonly PAY2M_MAX_RESPONSE_BYTES = 16 * 1024;

  private async getAccessToken(basketId: string, amount: string): Promise<string> {
    const url = `${this.apiUrl}/GetAccessToken`;
    const body = new URLSearchParams({
      MERCHANT_ID: this.merchantId,
      SECURED_KEY: this.securedKey,
      BASKET_ID: basketId,
      TXNAMT: amount,
    });

    // R2 + O.92/O.93: retry-with-backoff on transient failures (network
    // blip, 5xx, 429), each attempt wrapped in a circuit breaker + explicit
    // timeout. Layering, outermost-first:
    //   1) Retry loop — 3 attempts with exponential backoff. Bounds latency
    //      for a single customer. Skipped entirely if the breaker is OPEN
    //      (no point retrying when the breaker just told us the gateway is
    //      sustainedly broken — would just burn 3 × ~1ms with the same
    //      fail-fast outcome).
    //   2) `breaker.run()` — short-circuits if PAY2M has been failing for
    //      `failureThreshold` consecutive attempts. Throws
    //      `CircuitBreakerOpenError`, caught below → bail out of loop.
    //   3) `withTimeout` — AbortController-backed per-attempt deadline. The
    //      signal is forwarded to `fetch()` so an in-flight TCP connection
    //      is actually cancelled (not just orphaned).
    //   4) `fetch()` itself.
    //
    // getAccessToken is idempotent (read-only token fetch — POSTed only
    // because PAY2M's API requires POST shape). Retrying is unconditionally
    // safe. 3 attempts max, ~500ms + jitter between, ~46s worst case
    // (3 × tokenTimeoutMs default 15s + ~1.5s backoff) — fits the 60s
    // app-level timeout.
    //
    // Inline helper rather than an npm dep: p-retry v5+ is ESM-only and
    // tsconfig is `module: commonjs`. Pulling p-retry v4 (last CJS) would
    // add a maintenance signal nobody owns. ~10 lines does what we need.
    const MAX_ATTEMPTS = 3;
    let response: globalThis.Response | undefined;
    let lastErrKind: 'timeout' | 'network' | 'http' = 'network';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const r = await this.breaker.run(async () => {
          const res = await withTimeout(
            (signal) =>
              fetch(url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'User-Agent': 'AL Jadwal-API/1.0',
                },
                body: body.toString(),
                signal,
              }),
            this.tokenTimeoutMs,
          );
          // The breaker counts whatever the callback throws as a failure.
          // 5xx + 429 are gateway-health signals (PAY2M is up but its app
          // is sick / throttling us) — surface them as breaker failures
          // so a sustained 500-storm trips the breaker. 4xx is client-side
          // (bad credential, validation) and never trips the breaker —
          // we let it fall through and the outer `!response.ok` branch
          // throws a clean BadRequestException for it.
          if (res.status >= 500 || res.status === 429) {
            const upstreamErr = new Error(`PAY2M_UPSTREAM_${res.status}`);
            upstreamErr.name = 'Pay2mUpstreamError';
            (upstreamErr as Error & { status?: number }).status = res.status;
            throw upstreamErr;
          }
          return res;
        });
        response = r;
        break;
      } catch (err: unknown) {
        // Breaker OPEN — gateway is sustainedly broken. Don't burn the
        // remaining retry attempts; every subsequent breaker.run() in this
        // tick would throw the same error in <1ms anyway.
        if (err instanceof CircuitBreakerOpenError) {
          this.logger.warn({ event: 'PAY2M_BREAKER_OPEN', attempt });
          throw new BadRequestException('Payment gateway is temporarily unavailable');
        }
        const errName = (err as { name?: string })?.name;
        if (errName === 'Pay2mUpstreamError') {
          lastErrKind = 'http';
          const status = (err as { status?: number }).status;
          this.logger.warn({ event: 'PAY2M_RETRY', attempt, status });
        } else if (errName === 'TimeoutError' || (err as { message?: string })?.message?.startsWith('Timed out')) {
          // `withTimeout` aborts with `new Error('Timed out after Nms')` —
          // not a true `TimeoutError`, so accept either form.
          lastErrKind = 'timeout';
          this.logger.warn({ event: 'PAY2M_RETRY', attempt, kind: 'timeout' });
        } else {
          lastErrKind = 'network';
          this.logger.warn({ event: 'PAY2M_RETRY', attempt, kind: 'network' });
        }
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((res) => setTimeout(res, 500 * 2 ** (attempt - 1) + Math.random() * 100));
          continue;
        }
        // All attempts exhausted — never leak raw error.message / cause.code.
        this.logger.error({ event: 'PAY2M_TOKEN_FAILED', kind: lastErrKind, attempts: MAX_ATTEMPTS });
        throw new BadRequestException('Payment gateway is temporarily unavailable');
      }
    }
    if (!response) {
      // Defensive: we should always have either a `response` or have thrown
      // above. If somehow we exit the loop with neither, treat it the same
      // as an exhausted-retry path.
      this.logger.error({ event: 'PAY2M_TOKEN_FAILED', kind: 'http', attempts: MAX_ATTEMPTS, lastKind: lastErrKind });
      throw new BadRequestException('Payment gateway is temporarily unavailable');
    }

    if (!response.ok) {
      this.logger.error({ event: 'PAY2M_TOKEN_HTTP_ERROR', status: response.status });
      throw new BadRequestException('Payment gateway is temporarily unavailable');
    }

    // Two-step size guard:
    //   1. If PAY2M sends Content-Length, reject before reading any body.
    //   2. Otherwise (chunked transfer, no header), stream the body and
    //      abort the stream the moment the byte count exceeds the cap.
    //
    // We CAN'T use `await response.text()` then check text.length:
    //   - text() reads the entire stream to completion before resolving,
    //     so by the time we'd check the length we'd already have buffered
    //     the full payload in memory (defeats the purpose).
    //   - JS string.length counts UTF-16 code units, not UTF-8 bytes —
    //     comparing it to a byte cap is off by 1–4× depending on input.
    // Manual stream reading + byteLength accounting fixes both.
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > PaymentService.PAY2M_MAX_RESPONSE_BYTES) {
      this.logger.error({ event: 'PAY2M_RESPONSE_TOO_LARGE', bytes: contentLength });
      throw new BadRequestException('Payment gateway is temporarily unavailable');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      this.logger.error({ event: 'PAY2M_RESPONSE_NO_BODY' });
      throw new BadRequestException('Payment gateway is temporarily unavailable');
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > PaymentService.PAY2M_MAX_RESPONSE_BYTES) {
          // Cancel the stream so we don't keep pulling bytes — frees memory
          // immediately and signals upstream we're done.
          await reader.cancel();
          this.logger.error({ event: 'PAY2M_RESPONSE_TOO_LARGE', capBytes: PaymentService.PAY2M_MAX_RESPONSE_BYTES });
          throw new BadRequestException('Payment gateway is temporarily unavailable');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    let data: Pay2mTokenResponse;
    try {
      const text = Buffer.concat(chunks).toString('utf-8');
      data = JSON.parse(text);
    } catch {
      this.logger.error({ event: 'PAY2M_RESPONSE_NOT_JSON' });
      throw new BadRequestException('Payment gateway is temporarily unavailable');
    }

    if (!data.ACCESS_TOKEN) {
      this.logger.error({ event: 'PAY2M_TOKEN_EMPTY' });
      throw new BadRequestException('Payment gateway is temporarily unavailable');
    }

    return data.ACCESS_TOKEN;
  }

  // ─── Build Form Payload ─────────────────────────────────────────────────

  private buildFormPayload(params: {
    token: string;
    basketId: string;
    amount: string;
    currency: string;
    customerEmail: string;
    customerPhone: string;
    description: string;
    orderDate: string;
  }): Record<string, string> {
    return {
      MERCHANT_ID: this.merchantId,
      MERCHANT_NAME: this.merchantName,
      TOKEN: params.token,
      PROCCODE: '00',
      TXNAMT: params.amount,
      CUSTOMER_MOBILE_NO: params.customerPhone || '',
      CUSTOMER_EMAIL_ADDRESS: params.customerEmail,
      // PAY2M docs (section 3.2) require a SIGNATURE field but state it is
      // "a random string value" — PAY2M does not validate its content.
      // crypto.randomUUID() satisfies the "random string" requirement
      // without exposing any internal state.
      SIGNATURE: crypto.randomUUID(),
      VERSION: 'AL Jadwal-1.0',
      TXNDESC: params.description,
      SUCCESS_URL: this.returnUrl,
      FAILURE_URL: this.returnUrl,
      CHECKOUT_URL: `${this.returnUrl}/ipn`, // Server-to-server push (IPN) — separate from browser redirect
      BASKET_ID: params.basketId,
      ORDER_DATE: params.orderDate,
      CURRENCY_CODE: params.currency,
      STORE_ID: this.config.get('PAY2M_STORE_ID', ''),
    };
  }

  // ─── Verify Callback Response ───────────────────────────────────────────

  /**
   * Resolves PAY2M's Response_Key to the err_code that cryptographically SIGNED
   * it plus the RAIL that produced it — or null if no candidate matches
   * (invalid / forged / foreign hash).
   *
   * Recipe: SHA256(merchant_id + basket_id + <secret word> + <amount/err pair>).
   * The card rail signs `amount + err_code`; the NAPS/QPay rail signs
   * `err_code + amount` (fields swapped — proven from live production logs
   * 2026-06-10: the recipeMatch diagnostic printed `recipe=m+b+s+e+a amount=d0
   * err=00` on real NAPS callbacks, i.e. err-first with the integer amount,
   * signed "00" while the visible err_code field echoed "001"). We try BOTH
   * orders, the canonical amount renderings (PAY2M strips trailing zeros), and
   * the success spellings "00"/"000".
   *
   * BOTH orders verify AUTHENTICITY only — every attempt is gated by the secret
   * word, so a forger can't produce a match for either order, and a genuine
   * failure is signed with its own failure code (no spelling we try can read it
   * as success). What the orders additionally tell us is WHICH RAIL sent the
   * callback, and the rails differ in what a success signature MEANS:
   *   - card  (amount+err): a signed "00" is only emitted post-capture → safe
   *     to confirm the booking on it.
   *   - naps  (err+amount): a signed "00" can be emitted at a PENDING/session
   *     stage BEFORE the money moves (observed live 2026-06-09: basket
   *     JDWL-939bd325-fa3 verified as success while PAY2M's status stayed
   *     "Pending" and no card was charged). So a NAPS success proves the
   *     message is genuine — NOT that the money was captured. handleCallback
   *     therefore HOLDS NAPS successes instead of confirming them.
   *
   * ⚠ SECURITY: when the secret word is EMPTY the hash carries no secret — every
   * other input is visible in the customer's browser, so the callback is
   * forgeable. main.ts fails-fast in production if PAY2M_SECRET_WORD is empty.
   */
  private resolveSignedErrCode(
    basketId: string,
    amount: string,
    receivedErrCode: string,
    responseKey: string,
  ): { errCode: string; rail: 'card' | 'naps' } | null {
    // Format gate — reject obvious garbage in O(1) before hashing.
    if (typeof responseKey !== 'string' || !/^[a-f0-9]{64}$/i.test(responseKey)) {
      return null;
    }
    const n = Number(amount);
    const amountForms = new Set<string>([String(amount)]);
    if (Number.isFinite(n)) {
      amountForms.add(n.toString());  // "1.00" → "1" (PAY2M strips trailing zeros)
      amountForms.add(n.toFixed(0));  // → "1"   (NAPS uses the integer form)
      amountForms.add(n.toFixed(2));  // → "1.00" (card form)
    }
    // We try the received code plus the canonical success spellings ("00" vs
    // "000"). The secret word gates every attempt, so a forger can't verify and
    // a genuine failure only matches its own failure code.
    const errForms = new Set<string>([receivedErrCode, '00', '000']);
    const target = Buffer.from(responseKey.toLowerCase(), 'hex');
    for (const ec of errForms) {
      for (const amt of amountForms) {
        // card rail: amount+err ; NAPS/QPay rail: err+amount.
        const candidates: Array<{ tail: string; rail: 'card' | 'naps' }> = [
          { tail: `${amt}${ec}`, rail: 'card' },
          { tail: `${ec}${amt}`, rail: 'naps' },
        ];
        for (const { tail, rail } of candidates) {
          const expected = Buffer.from(
            crypto
              .createHash('sha256')
              .update(`${this.merchantId}${basketId}${this.secretWord}${tail}`)
              .digest('hex'),
            'hex',
          );
          // timingSafeEqual needs equal-length buffers — both are 32 bytes.
          if (expected.length === target.length && crypto.timingSafeEqual(expected, target)) {
            return { errCode: ec, rail };
          }
        }
      }
    }
    return null;
  }

  /** Boolean convenience wrapper — true iff the Response_Key verifies (either rail). */
  verifyCallbackHash(basketId: string, amount: string, errCode: string, responseKey: string): boolean {
    return this.resolveSignedErrCode(basketId, amount, errCode, responseKey) !== null;
  }

  // ─── Initiate Payment ───────────────────────────────────────────────────

  async initiatePayment(bookingId: string, userId: string, idempotencyKey?: string) {
    // 0. Check payment gateway is enabled before any DB work
    if (!this.enabled) {
      throw new BadRequestException('Payment service is not available');
    }

    const db = this.prisma.client;

    // 1. Load booking + payment
    // Ownership is baked into the where clause so a guessed UUID returns
    // the same 404 whether the booking doesn't exist or belongs to someone
    // else — no IDOR oracle.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, customerId: userId },
      select: {
        id: true,
        status: true,
        reservedUntil: true,
        paymentId: true,
        ref: true,
        bookingPhone: true,
        emailOtpVerifiedAt: true,
        activity: { select: { titleEn: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'PENDING') throw new BadRequestException('Booking is not in a payable state');

    // Check reservation hasn't expired (with 1-minute buffer)
    if (booking.reservedUntil && booking.reservedUntil < new Date(Date.now() + 60 * 1000)) {
      throw new BadRequestException('Reservation has expired. Please create a new booking.');
    }

    // Email-OTP gate. The customer must have verified the 6-digit code that
    // was emailed at booking-create time before we will hand the gateway
    // any payment token. Defends against session-cookie theft + provides a
    // per-booking "is the customer actually here" check.
    //
    // No 404 oracle leak: by the time we reach this line, ownership + state
    // checks have already passed, so the booking is known-yours.
    if (!booking.emailOtpVerifiedAt) {
      throw new BadRequestException('Please verify your email before proceeding to payment.');
    }

    // Generic "not in a payable state" — collapses three internal paths
    // (no paymentId FK, payment row missing, payment already processed)
    // into one client message so a probing attacker can't fingerprint
    // payment internals. Server-side log retains the actual reason.
    const NOT_PAYABLE = 'This booking is not in a payable state.';
    if (!booking.paymentId) throw new BadRequestException(NOT_PAYABLE);

    const payment = await db.payment.findUnique({
      where: { id: booking.paymentId },
      select: { id: true, amount: true, currency: true, status: true, gatewayBasketId: true, idempotencyKey: true },
    });
    if (!payment) throw new BadRequestException(NOT_PAYABLE);
    if (payment.status !== 'PENDING') throw new BadRequestException(NOT_PAYABLE);

    // 1b. Idempotency key (R3). Mirrors the Booking.idempotencyKey pattern.
    // A key the same user already used: if it points at THIS payment it's a
    // legit retry (carry on — we re-use the set-once basket and fetch a fresh
    // token below; we deliberately do NOT cache+replay the form, since the
    // PAY2M token expires). If it points at a DIFFERENT payment, the client
    // reused a key across bookings → reject. A key first seen under another
    // user looks like "not found" here; the @unique column is the backstop
    // (P2002 → 409 via PrismaExceptionFilter) when we try to stamp it below.
    let idempotentRetry = false;
    if (idempotencyKey) {
      const prior = await db.payment.findFirst({
        where: { idempotencyKey, booking: { is: { customerId: userId } } },
        select: { id: true },
      });
      if (prior) {
        if (prior.id !== payment.id) {
          throw new ConflictException('This idempotency key was already used for a different booking.');
        }
        idempotentRetry = true;
      }
    }

    // 2. Redis lock to prevent double-pay from multiple tabs
    const lockKey = `payment_lock:${payment.id}`;
    const lockToken = await this.redisLock.acquire(lockKey, 30000);
    if (!lockToken) throw new BadRequestException(NOT_PAYABLE);

    try {
      // 3. Generate basket ID if not already set, and stamp the moment we hand
      // off to the gateway. paymentInitiatedAt is the source of truth for the
      // cleanup cron's "abandoned at gateway" sweep — it always reflects the
      // most recent attempt, even if the customer retries from a stale tab.
      const existingBasket = payment.gatewayBasketId;
      const basketId: string = existingBasket ?? `JDWL-${crypto.randomUUID().slice(0, 12)}`;
      const now = new Date();
      await db.payment.update({
        where: { id: payment.id },
        data: {
          // gatewayBasketId + paymentFirstInitiatedAt are set ONCE on the
          // first initiate. The cleanup cron uses paymentFirstInitiatedAt
          // for the abandonment-cutoff so a customer cannot keep their
          // PENDING reservation alive by re-hitting /payment/initiate.
          ...(existingBasket
            ? {}
            : { gatewayBasketId: basketId, paymentFirstInitiatedAt: now }),
          // Stamp the idempotency key the first time we see one for this
          // payment. Never overwrite (if the row already carries a key — even
          // a different one from an inconsistent client — leave it; the
          // payment is still a single payment). The @unique column rejects a
          // cross-payment collision here with P2002 → 409.
          ...(payment.idempotencyKey || !idempotencyKey ? {} : { idempotencyKey }),
          // paymentInitiatedAt re-stamps every retry — useful for forensics
          // ("when did the customer last try to hand off to PAY2M?").
          paymentInitiatedAt: now,
        },
      });

      const amount = Number(payment.amount).toFixed(2);

      // 4. Get access token from PAY2M
      const token = await this.getAccessToken(basketId, amount);

      // 5. Load customer info for form
      const customer = await db.user.findUnique({
        where: { id: userId },
        select: { email: true, phone: true, fullName: true },
      });

      // 6. Build form payload.
      // PAY2M's CUSTOMER_MOBILE_NO is MANDATORY (per PAY2M API docs §3.3).
      // Source priority:
      //   1. booking.bookingPhone — the per-booking contact phone the customer
      //      entered at checkout (required, NOT NULL since PR #264).
      //   2. customer.phone — defensive fallback only for any pre-bookingPhone
      //      legacy rows; never expected to fire on post-migration bookings.
      const formFields = this.buildFormPayload({
        token,
        basketId,
        amount,
        currency: payment.currency,
        customerEmail: customer?.email || '',
        customerPhone: booking.bookingPhone || customer?.phone || '',
        description: `Booking ${booking.ref} — ${booking.activity?.titleEn || 'Activity'}`,
        orderDate: new Date().toISOString().replace('T', ' ').slice(0, 19), // "YYYY-MM-DD HH:mm:ss" matching PAY2M PHP example
      });

      // 7. Audit log
      await this.auditLogger.log({
        actorType: 'CUSTOMER',
        actorId: userId,
        actorName: customer?.fullName || `user:${userId.slice(0, 8)}`,
        action: 'PAYMENT_INITIATED',
        entity: 'Payment',
        entityId: payment.id,
        details: `Amount: ${amount} ${payment.currency}, Basket: ${basketId}`,
        actionCategory: 'FINANCIAL',
      });

      return {
        formAction: `${this.apiUrl}/PostTransaction`,
        formFields,
        // true when this call matched a previously-seen idempotency key for
        // the same payment (a recognized retry). The form is still rebuilt
        // with a fresh PAY2M token — only the basket is re-used.
        idempotent: idempotentRetry,
      };
    } finally {
      await this.redisLock.release(lockKey, lockToken);
    }
  }

  /** How far a held NAPS booking's reservation is extended so the out-of-band
   *  capture confirmation (PAY2M's delayed IPN: 5–15 min documented) has room
   *  to arrive before the cleanup cron reaps the slot. */
  private static readonly NAPS_HOLD_EXTENSION_MS = 30 * 60_000;

  /**
   * Hold a verified NAPS-rail success WITHOUT confirming or deleting anything.
   * The hash proves the callback genuinely came from PAY2M, but on this rail a
   * success signature can precede the actual capture — so the only safe move
   * is to keep payment + booking PENDING, give the confirmation time to arrive
   * (forward-only reservation extension), and leave a FINANCIAL audit trail.
   * Logs carry only non-sensitive transaction metadata — never the
   * Response_Key or secret word.
   */
  private async holdNapsSuccess(
    paymentId: string,
    bookingId: string | null,
    params: { err_code: string; basket_id: string; transaction_id?: string },
  ): Promise<void> {
    if (bookingId) {
      const extendTo = new Date(Date.now() + PaymentService.NAPS_HOLD_EXTENSION_MS);
      // Forward-only and PENDING-only: never shorten a longer hold, never
      // resurrect a cancelled/expired booking's reservation.
      await this.prisma.client.booking.updateMany({
        where: { id: bookingId, status: 'PENDING', reservedUntil: { lt: extendTo } },
        data: { reservedUntil: extendTo },
      });
    }
    this.logger.log({
      event: 'PAY2M_NAPS_SUCCESS_HELD',
      paymentId,
      basketId: params.basket_id,
      errCode: params.err_code,
    });
    await this.auditLogger.log({
      actorType: 'SYSTEM',
      actorId: 'pay2m-callback',
      actorName: 'PAY2M Gateway',
      action: 'PAYMENT_NAPS_AWAITING_CAPTURE',
      entity: 'Payment',
      entityId: paymentId,
      details: `basket: ${params.basket_id}, err_code: ${params.err_code}, txn: ${params.transaction_id || 'N/A'} — NAPS success verified (authentic) but capture unconfirmed; booking held PENDING`,
      actionCategory: 'FINANCIAL',
    });
  }

  /**
   * Whether an inbound IPN's REAL source IP is an allow-listed PAY2M server.
   * FAIL-CLOSED: false when the feature is off, the IP is missing, or the
   * allow-list is empty. The caller passes the Cloudflare-set `cf-connecting-ip`
   * (a client cannot forge it while the ALB security group is locked to
   * Cloudflare ranges) — this is the trust anchor for the hash-less IPN.
   */
  isTrustedIpnSource(sourceIp: string | undefined | null): boolean {
    if (!this.ipnConfirmEnabled) return false;
    if (!sourceIp) return false;
    return this.ipnAllowedIps.has(sourceIp);
  }

  // ─── Handle Callback from PAY2M ────────────────────────────────────────

  async handleCallback(params: {
    err_code: string;
    err_msg?: string;
    basket_id: string;
    transaction_id?: string;
    Response_Key: string;
    order_date?: string;
    // 'pending' = a verified NAPS-rail success held awaiting capture
    // confirmation — neither confirmed nor failed yet.
  }, opts?: {
    // 'ipn' = a server-to-server IPN (trust by source IP, no hash verify);
    // 'callback' (default) = the browser redirect (hash-verified).
    via?: 'callback' | 'ipn';
    // Set by the controller when an IPN's real source IP is allow-listed AND
    // the feature flag is on. Only a trusted IPN may confirm/fail a booking.
    trustedCapture?: boolean;
  }): Promise<{ bookingId: string; status: 'success' | 'failed' | 'pending'; error?: string }> {
    // 0. Reject callbacks when payment is disabled (maintenance, misconfiguration)
    if (!this.enabled) {
      this.logger.warn({ event: 'PAY2M_CALLBACK_WHILE_DISABLED' });
      throw new BadRequestException('Payment service is not available');
    }

    const db = this.prisma.client;

    // 1. Find payment by basket ID
    const payment = await db.payment.findUnique({
      where: { gatewayBasketId: params.basket_id },
      select: {
        id: true, bookingId: true, amount: true, currency: true, status: true,
        // §B2 — bookingSnapshot + bookingRecreatedAt feed the orphan-recovery
        // branch when the cleanup cron hard-deleted the booking before the
        // success callback arrived. Snapshot was frozen at booking creation;
        // recreatedAt is the idempotency marker so a replayed callback can't
        // insert a second copy.
        bookingSnapshot: true,
        bookingRecreatedAt: true,
        // Pull the booking's coupon snapshot too so we can detect (and
        // forensically audit) the coupon-expiry race below — see the
        // PAYMENT_COUPON_INVALID_AT_CONFIRMATION audit emission. Cheap
        // single-query addition; no extra round-trip vs the existing find.
        booking: { select: { couponCode: true, couponDiscount: true, status: true, cancelledBy: true } },
      },
    });

    if (!payment) {
      this.logger.warn({ event: 'PAY2M_CALLBACK_UNKNOWN_BASKET' });
      throw new BadRequestException('Payment not found');
    }

    // 2. Idempotent — if already processed as SUCCESS, return early
    if (payment.status === 'SUCCESS') {
      return { bookingId: payment.bookingId!, status: 'success' };
    }

    // 3. Resolve the Response_Key and derive success from the SIGNED code plus
    //    the RAIL that signed it.
    //
    // resolveSignedErrCode returns the err_code that cryptographically validates
    // PAY2M's Response_Key and which rail signed it (or null if nothing
    // matches). We trust THAT signed code for success — not the raw err_code
    // field — because the NAPS/QPay rail echoes a 3-digit status (e.g. "001")
    // in the field yet signs the hash with the 2-digit gateway code "00". A
    // failure is signed with its own failure code, so it can never resolve to
    // a success code.
    //
    // The rail decides what a verified SUCCESS means:
    //   - card: "00" is only emitted post-capture → confirm the booking.
    //   - naps: "00" can be emitted at a PENDING stage BEFORE any money moves
    //     (live incident 2026-06-09, basket JDWL-939bd325-fa3) → HOLD the
    //     booking (no confirm, no delete) until PAY2M confirms the capture
    //     out-of-band (IPN / status inquiry — the trigger lands in a follow-up).
    //
    // ⚠ LAUNCH BLOCKER while the secret word is EMPTY: every hash input is
    // otherwise visible in the customer's browser, so a forged callback could
    // confirm an unpaid booking. main.ts fails-fast in production if
    // PAY2M_SECRET_WORD is empty, so a deploy cannot ship that configuration.
    const amount = Number(payment.amount).toFixed(2);
    let hashValid: boolean;
    let isSuccess: boolean;
    let isNapsHeldSuccess: boolean;

    if (opts?.via === 'ipn') {
      // ── IPN path — trust by SOURCE IP, not hash ──────────────────────────
      // The IPN carries no `amount`, so resolveSignedErrCode (which hashes the
      // amount) cannot verify it. The trust anchor is `opts.trustedCapture`,
      // set by the controller ONLY when the IPN's real source IP is allow-listed
      // AND the feature flag is on. An untrusted IPN confirms/fails NOTHING.
      // PAY2M's IPN success code is "0000"; the browser callback uses "000"/"00".
      const successCode = ['00', '000', '0000'].includes((params.err_code ?? '').trim());
      if (!opts.trustedCapture) {
        this.logger.warn({ event: 'PAY2M_IPN_UNTRUSTED', paymentId: payment.id, basketId: params.basket_id });
        // Take NO action — never fail or confirm a legit pending payment on an
        // unverified, possibly-forged notification. Leave it for the cron.
        return { bookingId: payment.bookingId ?? '', status: 'pending' };
      }
      if (!successCode) {
        // NON-success IPN. We do NOT know PAY2M's full code taxonomy (a final
        // decline vs a still-processing/authorized status), so we take NO
        // destructive action — leave the payment PENDING. A genuine decline is
        // already surfaced + FAILED by the browser callback, and an unpaid
        // PENDING is reaped by the cleanup cron once its reservation lapses.
        // This guarantees we can never prematurely FAIL a payment that PAY2M may
        // still capture (which would also wrongly free the slot). Only an
        // explicit success confirms; nothing else mutates state from an IPN.
        this.logger.warn({ event: 'PAY2M_IPN_NONSUCCESS_NOOP', paymentId: payment.id, basketId: params.basket_id, errCode: params.err_code });
        return { bookingId: payment.bookingId ?? '', status: 'pending' };
      }
      // Trusted SUCCESS IPN = authoritative capture confirmation → confirm the
      // booking via the shared transaction below (no hash, no NAPS hold). The
      // charged amount is the server-frozen `payment.amount`, never anything in
      // the IPN, so amount integrity is unchanged.
      this.logger.log({ event: 'PAY2M_IPN_CAPTURE_CONFIRMED', paymentId: payment.id, basketId: params.basket_id, errCode: params.err_code });
      hashValid = true;
      isNapsHeldSuccess = false;
      isSuccess = true;
    } else {
      // ── Browser-callback path — hash-verified (unchanged) ────────────────
      const resolved = this.resolveSignedErrCode(
        params.basket_id,
        amount,
        params.err_code,
        params.Response_Key,
      );
      hashValid = resolved !== null;
      const signedSuccess = resolved !== null && (resolved.errCode === '00' || resolved.errCode === '000');
      isNapsHeldSuccess = signedSuccess && resolved!.rail === 'naps';
      // Only a CARD-rail success may confirm a booking in this handler; a
      // NAPS-rail success is authentic but capture-ambiguous and is held.
      isSuccess = signedSuccess && resolved!.rail === 'card';
    }

    // 2b. CRITICAL: If payment was marked FAILED by the cleanup cron but PAY2M
    // now sends a VERIFIED success, the customer WAS charged — recover the
    // booking (the reservation timer expired while they were on the PAY2M page).
    // A NAPS-rail success is NOT capture proof, so it must not trigger the
    // recovery either — it is held exactly like the pre-FAILED case below.
    if (payment.status === 'FAILED' && !isSuccess) {
      if (isNapsHeldSuccess) {
        await this.holdNapsSuccess(payment.id, payment.bookingId, params);
        return { bookingId: payment.bookingId ?? '', status: 'pending' };
      }
      return { bookingId: payment.bookingId!, status: 'failed', error: 'Payment was previously declined' };
    }
    // FAILED && isSuccess (card rail) → fall through to recover (optimistic lock below).

    // 4. Reject any callback whose Response_Key does not verify (corrupt,
    // malformed, foreign-rail, or forged).
    if (!hashValid) {
      // Logs only NON-sensitive transaction metadata (basket/amount/err_code) —
      // never the Response_Key or secret word, which together with the otherwise
      // known inputs would form an offline brute-force oracle for the secret.
      this.logger.warn({
        event: 'PAY2M_HASH_MISMATCH',
        paymentId: payment.id,
        errCode: params.err_code,
        basketId: params.basket_id,
        amountUsed: amount,
      });
      await this.auditLogger.log({
        actorType: 'SYSTEM',
        actorId: 'pay2m-callback',
        actorName: 'PAY2M Gateway',
        action: 'PAYMENT_HASH_MISMATCH',
        entity: 'Payment',
        entityId: payment.id,
        details: `err_code: ${params.err_code}, basket: ${params.basket_id}, isSuccess: ${isSuccess}`,
        actionCategory: 'FINANCIAL',
      });
      throw new BadRequestException('Payment verification failed');
    }

    // 4a. NAPS-rail verified success → HOLD (no confirm, no delete). The
    // message is genuine (secret-gated hash, unforgeable) but this rail emits
    // success-signed callbacks pre-capture: confirming here booked UNPAID
    // orders (#369 incident, basket 939bd325) and rejecting here destroyed
    // PAID ones (#370, money-taken-no-booking). We do neither — payment and
    // booking stay PENDING, the reservation is extended so a delayed capture
    // confirmation (PAY2M's delayed IPN is documented at 5–15 min) doesn't
    // lose the slot, and the hold is audited. The capture-confirmation
    // trigger (IPN with a source allow-list / status inquiry) lands in a
    // follow-up — until then NOTHING can confirm a NAPS booking, which is
    // fail-safe in both directions.
    if (isNapsHeldSuccess) {
      await this.holdNapsSuccess(payment.id, payment.bookingId, params);
      return { bookingId: payment.bookingId ?? '', status: 'pending' };
    }

    // 4b. Coupon expiry-race detection. The customer may have created the
    //     PENDING booking with a valid coupon, then sat on the PAY2M
    //     hosted-checkout page long enough that the coupon's validTo
    //     passed (or admin un-approved it, or another customer's booking
    //     pushed it past usageLimit). The discount was frozen into
    //     payment.amount at booking creation and the customer was charged
    //     that discounted amount on PAY2M's page — we honor the price the
    //     customer was quoted (customer-friendly + payment.amount already
    //     verified by hash above). What we DON'T do silently is let the
    //     forensic signal vanish: emit a PAYMENT_COUPON_INVALID_AT_CONFIRMATION
    //     audit row so admin/finance can reconcile if the rate of these
    //     events suggests a coupon-policy problem.
    if (isSuccess && payment.booking?.couponCode) {
      const liveCoupon = await db.coupon.findUnique({
        where: { code: payment.booking.couponCode },
        select: { status: true, validTo: true, usageLimit: true, usedCount: true },
      });
      const now = new Date();
      const couponInvalid =
        !liveCoupon ||
        liveCoupon.status !== 'APPROVED' ||
        liveCoupon.validTo < now ||
        (liveCoupon.usageLimit !== null && liveCoupon.usedCount > liveCoupon.usageLimit);
      if (couponInvalid) {
        await this.auditLogger.log({
          actorType: 'SYSTEM',
          actorId: 'pay2m-callback',
          actorName: 'PAY2M Gateway',
          action: 'PAYMENT_COUPON_INVALID_AT_CONFIRMATION',
          entity: 'Payment',
          entityId: payment.id,
          details: `couponCode: ${payment.booking.couponCode}, discount: ${payment.booking.couponDiscount}, status: ${liveCoupon?.status ?? 'NOT_FOUND'}, validTo: ${liveCoupon?.validTo?.toISOString() ?? 'N/A'}, usedCount/limit: ${liveCoupon?.usedCount ?? 'N/A'}/${liveCoupon?.usageLimit ?? '∞'}`,
          actionCategory: 'FINANCIAL',
        });
        this.logger.warn({ event: 'PAY2M_COUPON_INVALID_AT_CONFIRMATION', paymentId: payment.id, couponCode: payment.booking.couponCode });
      }
    }

    // 5. Update payment + booking in transaction (optimistic lock)
    const savedBookingId = payment.bookingId;
    let deletedActivityId: string | null = null;
    /// After-commit recovery dispatch. We deliberately do NOT recreate the
    /// booking inside this same tx: a slot-conflict during recreate would
    /// roll back the payment-status flip too, which is wrong (the
    /// customer's money is real, the payment SHOULD show SUCCESS).
    /// Instead, the inner tx flips payment to SUCCESS unconditionally and
    /// raises a flag; a separate tx below tries the booking recovery and
    /// falls back to REFUND_PENDING + audit + customer notification if
    /// recovery isn't safe.
    let recoveryMode: 'B2_ORPHAN' | 'M6_SYSTEM_CANCELLED' | 'CANCELLED_REFUND' | null = null;
    const updated = await db.$transaction(async (tx: any) => {
      if (isSuccess) {
        // Accept SUCCESS from PENDING or FAILED (recovery from cron race condition)
        const result = await tx.payment.updateMany({
          where: { id: payment.id, status: { in: ['PENDING', 'FAILED'] } },
          data: {
            status: 'SUCCESS',
            gatewayTxnId: params.transaction_id || null,
            gatewayErrCode: params.err_code,
            gatewayResponseKey: params.Response_Key,
            paidAt: new Date(),
            method: 'PAY2M',
          },
        });
        if (result.count === 0) return false; // Already SUCCESS (duplicate callback)

        // Check if booking still exists (cron may have deleted it)
        const booking = await tx.booking.findUnique({
          where: { id: payment.bookingId! },
          select: { id: true, status: true, cancelledBy: true },
        });
        if (booking) {
          if (booking.status === 'CANCELLED') {
            if (booking.cancelledBy === 'SYSTEM') {
              // §M6 — the booking was auto-cancelled by SYSTEM (e.g. the
              // reservation window expired) but PAY2M's success callback now
              // arrives. The customer didn't choose to cancel, so try to
              // recover their booking. We can't blindly un-cancel (another
              // customer may have grabbed the slot): flag for after-commit
              // recovery (slot-conflict + activity-status checks) which
              // un-cancels safely or queues a refund.
              recoveryMode = 'M6_SYSTEM_CANCELLED';
            } else {
              // Deliberately cancelled by the customer/vendor/admin BEFORE this
              // capture: their cancel flipped the still-PENDING payment to
              // FAILED, and the card success is arriving late. We must NOT
              // resurrect a deliberately-cancelled booking — the slot may have
              // been resold, and confirming it would charge the customer for a
              // booking that was intentionally killed (risking a double-sell).
              // The captured money is refunded instead.
              //
              // (Bug fix: this previously fell into an unconditional
              // `status: 'CONFIRMED'` because the only CANCELLED branch required
              // `cancelledBy === 'SYSTEM'`, which is never set anywhere — so
              // every cancelled booking was silently re-confirmed and charged.)
              recoveryMode = 'CANCELLED_REFUND';
            }
          } else {
            // Booking exists in a confirmable state — confirm it. PENDING is
            // the normal happy path; an already-CONFIRMED booking is a
            // duplicate-callback edge case we tolerate idempotently.
            await tx.booking.update({
              where: { id: payment.bookingId },
              data: { status: 'CONFIRMED' },
            });
          }
        } else {
          // §B2 — booking was deleted by cron. Customer's money is real; we
          // need to either re-insert the booking from the snapshot we froze
          // at creation time or queue a refund. Cannot do either in this tx
          // (slot-conflict during recreate would roll back the payment-success
          // flip). Hand off to after-commit recovery.
          recoveryMode = 'B2_ORPHAN';
        }
      } else {
        // Verify still PENDING before deleting
        const result = await tx.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: { status: 'FAILED' }, // Mark first, then delete — prevents race
        });
        if (result.count === 0) return false; // Already processed
        // Payment failed/cancelled — delete the unpaid booking entirely (no trace)
        if (payment.bookingId) {
          // Capture activityId INSIDE the tx before the cascade so we know which
          // availability cache to invalidate after commit. Also capture coupon
          // state so we can refund usage before the booking row disappears.
          const doomed = await tx.booking.findUnique({
            where: { id: payment.bookingId },
            select: { activityId: true, customerId: true, couponCode: true, pointsRedeemed: true },
          });
          if (doomed) {
            deletedActivityId = doomed.activityId;
            // createBooking incremented coupon.usedCount at reservation time;
            // a failed payment means the booking never completed — return
            // that increment so the coupon stays accurate.
            await refundCouponUsage(tx, doomed.couponCode, doomed.customerId);
            // Return any Wanasa points the customer redeemed on this booking.
            // They were debited at booking-create time; deleting the booking on
            // a failed payment without refunding them would silently confiscate
            // the customer's store credit. Mirrors the cleanup cron's points
            // refund on stale-booking deletion, and keeps the points accounting
            // CONSISTENT so the §B2 recovery can safely re-debit if a late,
            // verified success ever recreates this booking.
            const redeemed = Number(doomed.pointsRedeemed) || 0;
            if (redeemed > 0) {
              await this.loyalty.refund(tx, {
                userId: doomed.customerId,
                amount: redeemed,
                bookingId: payment.bookingId,
                source: 'CANCEL_REFUND_UNPAID',
                actorType: 'SYSTEM',
                actorId: 'pay2m-callback',
                note: `Payment failed — returned ${redeemed} redeemed points for deleted booking`,
              });
            }
          }
          await tx.booking.update({ where: { id: payment.bookingId }, data: { paymentId: null } });
        }
        await tx.payment.delete({ where: { id: payment.id } });
        if (payment.bookingId) {
          await tx.booking.delete({ where: { id: payment.bookingId } });
        }
      }
      return true;
    });

    // If optimistic lock failed, another callback already processed this — return idempotent response
    if (!updated) {
      const current = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
      if (current?.status === 'SUCCESS') return { bookingId: savedBookingId!, status: 'success' as const };
      return { bookingId: savedBookingId ?? '', status: 'failed' as const, error: 'Payment was previously processed' };
    }

    // Tx committed: if the failure branch deleted a booking, the slot is now
    // free. Bump the availability cache so in-flight calendar reads see it.
    if (deletedActivityId) {
      void this.availabilityCache.invalidate(deletedActivityId);
    }

    // §B2 / §M6 — booking-recovery dispatch. Runs in its own tx outside
    // the payment-status flip so a slot-conflict during recreate cannot
    // roll back the SUCCESS update. The recovery helper writes its own
    // FINANCIAL audit row in every branch (recreated / un-cancelled /
    // refund-queued) so reconciliation has a forensic trail regardless
    // of outcome.
    if (recoveryMode === 'B2_ORPHAN') {
      await this.attemptB2OrphanRecovery(payment.id, params.basket_id);
    } else if (recoveryMode === 'M6_SYSTEM_CANCELLED') {
      await this.attemptM6UnCancel(payment.id, payment.bookingId!, params.basket_id);
    } else if (recoveryMode === 'CANCELLED_REFUND') {
      // Booking was deliberately cancelled before this late capture — queue a
      // refund of the captured money. The booking stays cancelled.
      await this.queueB2Refund(
        payment.id,
        payment.amount,
        payment.currency,
        params.basket_id,
        'BOOKING_CANCELLED_BEFORE_CAPTURE',
      );
    }

    // 6. Audit log (use saved bookingId since record may be deleted for failures)
    await this.auditLogger.log({
      actorType: 'SYSTEM',
      actorId: 'pay2m-callback',
      actorName: 'PAY2M Gateway',
      action: isSuccess ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED',
      entity: 'Payment',
      entityId: payment.id,
      details: `err_code: ${params.err_code}, txn: ${params.transaction_id || 'N/A'}`,
    });

    // For failed payments, booking is deleted — skip notification and return early
    if (!isSuccess) {
      return { bookingId: savedBookingId ?? '', status: 'failed' as const, error: this.mapErrorMessage(params.err_code) };
    }

    // Deliberately-cancelled booking that received a late capture: a refund was
    // queued above (CANCELLED_REFUND). Do NOT send "booking confirmed" / "new
    // booking" notifications — the booking stays cancelled. Tell the customer a
    // refund is coming instead of falsely confirming the booking.
    if (recoveryMode === 'CANCELLED_REFUND') {
      return {
        bookingId: savedBookingId ?? '',
        status: 'failed' as const,
        error: 'This booking was cancelled before payment completed. Your payment will be refunded.',
      };
    }

    // Notify customer about payment success + send booking confirmation email
    const bookingForNotify = await db.booking.findUnique({
      where: { id: payment.bookingId! },
      select: {
        id: true,
        customerId: true,
        ref: true,
        vendorId: true,
        guests: true,
        totalPrice: true,
        serviceFee: true,
        couponDiscount: true,
        currencyCode: true,
        startDatetime: true,
        endDatetime: true,
        bookingPhone: true,
        activity: {
          select: {
            titleEn: true,
            locationAddress: true,
            locationLat: true,
            locationLng: true,
            bookingType: true,
            checkInTime: true,
          },
        },
        customer: { select: { email: true, fullName: true } },
      },
    });
    if (bookingForNotify) {
      this.notificationService.send({
        userId: bookingForNotify.customerId,
        type: 'PAYMENT_SUCCESS',
        title: 'Payment Successful',
        message: `Your payment for booking ${bookingForNotify.ref} has been confirmed`,
        link: `/bookings/${payment.bookingId}`,
      });

      // Notify vendor + admins NOW (deferred from booking-create time so we
      // only announce real, paid bookings — abandoned PENDING checkouts never
      // reach here because the FAILED branch hard-deletes them).
      // Pull `slug` alongside `userId` — the vendor portal is namespaced by
      // slug (/vendor/[slug]/*). Linking to /vendor/<UUID>/bookings 404s.
      // Also pull the vendor user's email + name + preferred language so the
      // vendor email enqueue below can run from the same row.
      const vendorUser = await db.vendor.findUnique({
        where: { id: bookingForNotify.vendorId },
        select: {
          userId: true,
          slug: true,
          user: { select: { email: true, fullName: true, preferredLanguage: true } },
        },
      });
      if (vendorUser) {
        this.notificationService.send({
          userId: vendorUser.userId,
          type: 'BOOKING_NEW',
          title: 'New Booking',
          message: `New booking ${bookingForNotify.ref} — ${bookingForNotify.guests} guest(s)`,
          link: `/vendor/${vendorUser.slug}/bookings`,
        });
      }
      this.notificationService.notifyAdmins({
        type: 'BOOKING_NEW',
        title: 'New Booking',
        message: `Booking ${bookingForNotify.ref} placed`,
        link: '/admin/bookings',
      });

      // R4 — enqueue the booking-confirmation email into the outbox instead of
      // a fire-and-forget SES send. OutboxDrainService picks it up within ~1
      // min and retries with backoff. This runs immediately after the payment-
      // success commit (and after the §B2/§M6 recovery dispatch, so it sees
      // the final booking state) — not inside the Serializable tx itself; the
      // residual sub-second crash window is an accepted tradeoff against
      // restructuring a money-critical transaction. If even the enqueue fails,
      // we log and move on: the customer still has a CONFIRMED booking + the
      // in-app PAYMENT_SUCCESS notification above, and reconciliation can spot
      // a confirmed-but-never-emailed booking.
      //
      // The customer email "Total" is the amount PAY2M actually charged —
      // payment.amount, captured at booking-create time as
      // `payableAmount = totalPrice + serviceFee - pointsDiscount` (note:
      // booking.totalPrice is ALREADY post-coupon, see bookings.service.ts
      // line ~1318 where finalTotalPrice = afterCouponPrice). Reading
      // payment.amount directly is the ground truth and avoids the prior
      // off-by-coupon bug where a recomputed `totalPrice + serviceFee -
      // couponDiscount` double-subtracted the coupon.
      const total = Number(payment.amount);
      const startDate = new Date(bookingForNotify.startDatetime);
      const dateStr = startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const timeStr = bookingForNotify.activity?.bookingType === 'HOURLY'
        ? startDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
        : bookingForNotify.activity?.checkInTime ?? undefined;
      const mapsLink = bookingForNotify.activity?.locationLat && bookingForNotify.activity?.locationLng
        ? `https://maps.google.com/maps?q=${bookingForNotify.activity.locationLat},${bookingForNotify.activity.locationLng}`
        : undefined;

      // §B9 follow-up — don't enqueue for anonymised addresses. The booking row
      // may have been recreated by the §B2 path while the customer was being
      // soft-deleted in another tab; the customer email is then
      // `<id>@deleted.local`, a non-routable sentinel that would bounce at SES.
      const customerEmail = bookingForNotify.customer.email;
      if (!customerEmail.endsWith('@deleted.local')) {
        try {
          await db.emailOutbox.create({
            data: {
              emailType: 'BOOKING_CONFIRMATION',
              recipient: customerEmail,
              bookingId: payment.bookingId,
              payload: {
                customerName: bookingForNotify.customer.fullName,
                activityTitle: bookingForNotify.activity?.titleEn ?? 'Activity',
                date: dateStr,
                ...(timeStr ? { time: timeStr } : {}),
                guests: bookingForNotify.guests,
                totalAmount: total.toFixed(2),
                currency: bookingForNotify.currencyCode,
                bookingId: payment.bookingId!,
                ...(bookingForNotify.activity?.locationAddress ? { locationAddress: bookingForNotify.activity.locationAddress } : {}),
                ...(mapsLink ? { mapsLink } : {}),
              },
            },
          });
        } catch (err: unknown) {
          const kind = err instanceof Error ? err.name : 'UnknownError';
          this.logger.error({ event: 'EMAIL_OUTBOX_ENQUEUE_FAILED', bookingId: payment.bookingId, kind });
        }
      }

      // Vendor booking-notification email — sent to the owning vendor in
      // parallel with the customer's BOOKING_CONFIRMATION. Cross-vendor leak
      // proof: `bookingForNotify.vendorId` is a non-null FK and
      // `vendor.userId` is @unique, so exactly one User.email is reachable
      // per booking. The customer's email is deliberately omitted from the
      // payload (PII minimisation — name + phone only).
      const vendorEmail = vendorUser?.user.email;
      if (vendorUser && vendorEmail && !vendorEmail.endsWith('@deleted.local')) {
        // totalPrice is ALREADY post-coupon (stored as afterCouponPrice at
        // booking-create time). Vendor email shows the customer's gross
        // booking value = totalPrice + serviceFee — Wanasa redemption is
        // excluded because points don't reduce what the vendor earned, only
        // what the customer paid out-of-pocket. The customer-email `total`
        // variable above subtracts couponDiscount and is a separate display
        // contract; do NOT reuse it here.
        const vendorTotalForEmail = Number(bookingForNotify.totalPrice) + Number(bookingForNotify.serviceFee);
        try {
          await db.emailOutbox.create({
            data: {
              emailType: 'VENDOR_BOOKING_NOTIFICATION',
              recipient: vendorEmail,
              bookingId: payment.bookingId,
              payload: {
                vendorName: vendorUser.user.fullName,
                vendorSlug: vendorUser.slug,
                bookingRef: bookingForNotify.ref,
                bookingId: payment.bookingId!,
                activityTitle: bookingForNotify.activity?.titleEn ?? 'Activity',
                date: dateStr,
                ...(timeStr ? { time: timeStr } : {}),
                guests: bookingForNotify.guests,
                totalAmount: vendorTotalForEmail.toFixed(2),
                currency: bookingForNotify.currencyCode,
                customerName: bookingForNotify.customer.fullName,
                customerPhone: bookingForNotify.bookingPhone,
                ...(bookingForNotify.activity?.locationAddress ? { locationAddress: bookingForNotify.activity.locationAddress } : {}),
              },
            },
          });
        } catch (err: unknown) {
          const kind = err instanceof Error ? err.name : 'UnknownError';
          this.logger.error({ event: 'EMAIL_OUTBOX_ENQUEUE_FAILED', bookingId: payment.bookingId, kind, recipient: 'vendor' });
        }
      }
    }

    return { bookingId: savedBookingId!, status: 'success' as const };
  }

  // ─── §B2 / §M6 — booking-recovery helpers ────────────────────────────────

  /**
   * §B2 — orphan-recovery. The cleanup cron deleted the booking row before
   * PAY2M's success callback arrived. We hold a server-derived snapshot
   * (`payment.bookingSnapshot`, frozen at booking-creation time) so the
   * primary path is to re-insert the booking. Refund is the rare fallback
   * for cases where re-insertion isn't safe (slot taken, activity ended,
   * activity/vendor deleted, snapshot version unrecognised).
   *
   * Runs OUTSIDE the payment-status flip's transaction so a slot-conflict
   * during recreate can't roll back the SUCCESS update — the customer's
   * money is real, payment.status MUST stay SUCCESS regardless of
   * recovery outcome.
   *
   * Idempotency: `bookingRecreatedAt` is set inside the same Serializable
   * tx that inserts the booking row, with a count-checked updateMany so
   * a replayed callback (or a concurrent recovery attempt) cannot create
   * a second copy.
   */
  private async attemptB2OrphanRecovery(paymentId: string, basketId: string): Promise<void> {
    const db = this.prisma.client;

    // Re-fetch with the snapshot — idempotency check must read the latest
    // bookingRecreatedAt from inside the recovery tx, but we need the
    // snapshot (and a quick "already recovered" short-circuit) up front.
    const fresh = await db.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, amount: true, currency: true, bookingSnapshot: true, bookingRecreatedAt: true },
    });
    if (!fresh) return;
    if (fresh.bookingRecreatedAt) {
      // A prior callback already recreated the booking. The current
      // callback is a duplicate / replay. The payment-status flip in the
      // outer tx idempotently moved status to SUCCESS again; nothing
      // else to do.
      return;
    }
    if (!fresh.bookingSnapshot) {
      // Legacy payment created before §B2 schema landed — no snapshot to
      // recreate from. Fall back to refund + audit so admin can deal.
      await this.queueB2Refund(paymentId, fresh.amount, fresh.currency, basketId, 'NO_SNAPSHOT');
      return;
    }

    const snapshot = fresh.bookingSnapshot as any;
    if (snapshot.v !== 2) {
      // Unknown snapshot version — be conservative, refund.
      // v:2 was introduced when bookingPhone became required. Prod has
      // zero v:1 snapshots in the wild (no booking history) so refusing
      // them is safe. A future v:3 would also refund here until the
      // recreate path below knows the new shape.
      await this.queueB2Refund(paymentId, fresh.amount, fresh.currency, basketId, `UNKNOWN_SNAPSHOT_VERSION:${snapshot.v}`);
      return;
    }

    // Pre-flight checks (cheap reads, no locks). These determine whether
    // recreate is safe at all; if any fails, refund. The actual conflict
    // detection runs INSIDE the Serializable tx below.
    const startDt = new Date(snapshot.startDatetime);
    const endDt = new Date(snapshot.endDatetime);
    const now = new Date();

    if (endDt < now) {
      // Activity already ended — not deliverable. Refund.
      await this.queueB2Refund(paymentId, fresh.amount, fresh.currency, basketId, 'ACTIVITY_ALREADY_ENDED');
      return;
    }

    // §B9 follow-up — customer may have been soft-deleted between the
    // PENDING booking creation and PAY2M's success callback (the
    // cleanup-cron's hard-delete of the booking removes the count-based
    // guard in `deleteUser`, so the user CAN be soft-deleted in this
    // window). Recreating the booking now would point its customerId
    // at an anonymised user the customer can't access — a ghost booking.
    // Refund instead.
    const customer = await db.user.findUnique({
      where: { id: snapshot.customerId },
      select: { deletedAt: true },
    });
    if (!customer || customer.deletedAt) {
      await this.queueB2Refund(paymentId, fresh.amount, fresh.currency, basketId, 'CUSTOMER_DELETED');
      return;
    }

    const activity = await db.activity.findUnique({
      where: { id: snapshot.activityId },
      select: { id: true, status: true, vendor: { select: { id: true, status: true } } },
    });
    if (!activity) {
      await this.queueB2Refund(paymentId, fresh.amount, fresh.currency, basketId, 'ACTIVITY_DELETED');
      return;
    }
    // Vendor suspended/inactive: still recreate the booking (customer paid in
    // good faith), but the booking lands flagged for admin review via the
    // FINANCIAL audit row below. We do NOT short-circuit to refund here —
    // that would let a fraud-detection suspension cascade into involuntary
    // refunds for paid customers. Activity status, however: if the activity
    // was hard-deleted (above) or marked DRAFT/REJECTED, treat that as
    // "vendor took down the listing" → refund.
    // Activity not currently bookable (admin/vendor changed state during the
    // PAY2M handoff) — vendor "took down" the listing, refund is correct.
    if (activity.status !== 'ACTIVE') {
      await this.queueB2Refund(paymentId, fresh.amount, fresh.currency, basketId, `ACTIVITY_STATUS:${activity.status}`);
      return;
    }

    // Recreate inside Serializable tx with the same conflict-check pattern
    // createBooking uses. P2034 (serialization failure) is treated as a
    // slot-conflict → refund fallback.
    try {
      const result = await db.$transaction(async (tx: any) => {
        // Idempotency: only one recovery attempt may stamp bookingRecreatedAt.
        const stamp = await tx.payment.updateMany({
          where: { id: paymentId, bookingRecreatedAt: null },
          data: { bookingRecreatedAt: new Date() },
        });
        if (stamp.count === 0) return { kind: 'already-recovered' as const };

        // Slot-conflict detection — same shape as createBooking's
        // pre-insert aggregate. Counts only non-CANCELLED bookings that
        // overlap the same activity/unit/window.
        const overlap = await tx.booking.aggregate({
          where: {
            activityId: snapshot.activityId,
            unitNumber: snapshot.unitNumber ?? undefined,
            status: { notIn: ['CANCELLED'] },
            startDatetime: { lt: endDt },
            endDatetime: { gt: startDt },
          },
          _sum: { guests: true },
        });
        const taken = overlap._sum.guests ?? 0;
        const activityCapacity = await tx.activity.findUnique({
          where: { id: snapshot.activityId },
          select: { capacity: true },
        });
        const cap = activityCapacity?.capacity ?? 0;
        if (taken + snapshot.guests > cap) {
          return { kind: 'slot-conflict' as const };
        }

        const recreated = await tx.booking.create({
          data: {
            ref: snapshot.ref,
            activityId: snapshot.activityId,
            vendorId: snapshot.vendorId,
            customerId: snapshot.customerId,
            unitNumber: snapshot.unitNumber,
            startDatetime: startDt,
            endDatetime: endDt,
            guests: snapshot.guests,
            bookingPhone: snapshot.bookingPhone,
            guestBreakdown: snapshot.guestBreakdown ?? undefined,
            selectedExtras: snapshot.selectedExtras ?? undefined,
            totalPrice: snapshot.totalPrice,
            serviceFee: snapshot.serviceFee,
            commissionPct: snapshot.commissionPct,
            commissionAmount: snapshot.commissionAmount,
            couponCode: snapshot.couponCode ?? undefined,
            couponDiscount: snapshot.couponDiscount,
            pointsRedeemed: snapshot.pointsRedeemed,
            pointsDiscount: snapshot.pointsDiscount,
            currencyCode: snapshot.currencyCode,
            idempotencyKey: snapshot.idempotencyKey ?? undefined,
            status: 'CONFIRMED',
            paymentId,
            // Preserve the customer's original cancellation window —
            // createdAt anchors free-cancellation policies.
            createdAt: new Date(snapshot.originalCreatedAt),
          },
          select: { id: true, activityId: true },
        });
        await tx.payment.update({ where: { id: paymentId }, data: { bookingId: recreated.id } });

        // Coupon usage roll-forward — the cleanup cron's `refundCouponUsage`
        // ran when it deleted the original booking (decrementing
        // coupon.usedCount and clearing claimedCoupon.used). Now that we're
        // re-inserting the booking, the customer IS using the coupon
        // again, so the counter has to climb back up. Mirrors the bookkeeping
        // that bookings.service.createBooking does at original booking time.
        // (Loyalty points are re-debited separately below — see the redeem()
        // call after this coupon roll-forward block.)
        if (snapshot.couponCode) {
          const coupon = await tx.coupon.findUnique({
            where: { code: snapshot.couponCode },
            select: { id: true, usageLimit: true },
          });
          if (coupon) {
            // Conditional re-increment, mirroring the createBooking pattern
            // hardened in PR #306: bake the usage-limit ceiling into the
            // where so a recovery that fires after other users have already
            // exhausted the coupon can't push usedCount past usageLimit.
            // The recreated booking still survives — we just don't bump
            // the counter past the limit (the customer already claimed the
            // coupon originally; the recovery is a bookkeeping replay).
            if (coupon.usageLimit) {
              await tx.coupon.updateMany({
                where: { id: coupon.id, usedCount: { lt: coupon.usageLimit } },
                data: { usedCount: { increment: 1 } },
              });
            } else {
              await tx.coupon.update({
                where: { id: coupon.id },
                data: { usedCount: { increment: 1 } },
              });
            }
            // Re-mark the per-user claim used (was unset by refundCouponUsage)
            await tx.claimedCoupon.updateMany({
              where: { userId: snapshot.customerId, couponId: coupon.id, used: false },
              data: { used: true },
            });
          }
        }

        // Re-debit the Wanasa points the customer redeemed on this booking.
        // When the original booking was deleted (cleanup cron, or the callback
        // failure path), those redeemed points were refunded to the customer's
        // balance. This recovery re-creates the booking, which USED those points
        // (pointsDiscount reduced the captured amount), so we must take them
        // again — otherwise the customer keeps both the points AND the discount
        // (balance inflation). If the customer already spent the refunded points
        // meanwhile, redeem() throws Insufficient → this Serializable tx rolls
        // back → the catch falls through to queueB2Refund (refunding the whole
        // capture is correct when we can't honor the points-discounted price).
        const redeemedPts = Number(snapshot.pointsRedeemed) || 0;
        if (redeemedPts > 0) {
          await this.loyalty.redeem(tx, {
            userId: snapshot.customerId,
            amount: redeemedPts,
            bookingId: recreated.id,
            note: `§B2 recovery re-debit of redeemed points, booking ${snapshot.ref}`,
          });
        }

        return { kind: 'recreated' as const, bookingId: recreated.id, activityId: recreated.activityId };
      }, { isolationLevel: 'Serializable' });

      if (result.kind === 'recreated') {
        void this.availabilityCache.invalidate(result.activityId);
        const flagged = activity.vendor.status !== 'ACTIVE';
        await this.auditLogger.log({
          actorType: 'SYSTEM',
          actorId: 'pay2m-callback',
          actorName: 'PAY2M Gateway',
          action: 'PAYMENT_RECOVERED_VIA_RECREATE',
          entity: 'Payment',
          entityId: paymentId,
          details: `Booking ${snapshot.ref} re-inserted from snapshot. basket: ${basketId}${flagged ? ' | VENDOR_NOT_ACTIVE_FLAG_FOR_REVIEW' : ''}`,
          actionCategory: 'FINANCIAL',
        });
        return;
      }

      if (result.kind === 'already-recovered') {
        // Concurrent recovery won the race. Nothing to do.
        return;
      }

      // Slot-conflict path. Recovery tx already committed (with stamp set);
      // we can't undo the stamp without another tx, but a refund is now
      // the right outcome. The stamp prevents a future replay from
      // re-trying recreate, which is what we want.
      await this.queueB2Refund(paymentId, fresh.amount, fresh.currency, basketId, 'SLOT_CONFLICT');
    } catch (err: any) {
      if (err?.code === 'P2034') {
        await this.queueB2Refund(paymentId, fresh.amount, fresh.currency, basketId, 'SLOT_CONFLICT_P2034');
        return;
      }
      // Any other failure: log + queue refund. We never silently swallow.
      const kind = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error({ event: 'PAY2M_B2_RECOVERY_FAILED', paymentId, kind });
      await this.queueB2Refund(paymentId, fresh.amount, fresh.currency, basketId, `RECOVERY_ERROR:${kind}`);
    }
  }

  /**
   * §M6 — un-cancel a booking that the cleanup cron flipped to
   * CANCELLED-by-SYSTEM right before PAY2M's success callback arrived.
   * Same safety contract as B2: validate the slot is still free, the
   * activity is still ACTIVE, the activity hasn't already ended.
   * Otherwise queue a refund.
   */
  private async attemptM6UnCancel(paymentId: string, bookingId: string, basketId: string): Promise<void> {
    const db = this.prisma.client;

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true, activityId: true, unitNumber: true, guests: true,
        startDatetime: true, endDatetime: true, status: true, cancelledBy: true,
      },
    });
    if (!booking) {
      // Should never happen — the outer tx confirmed booking exists. Treat
      // as an orphan-recovery scenario and refund.
      const fresh = await db.payment.findUnique({
        where: { id: paymentId },
        select: { amount: true, currency: true },
      });
      if (fresh) await this.queueB2Refund(paymentId, fresh.amount, fresh.currency, basketId, 'BOOKING_DISAPPEARED_MID_FLIGHT');
      return;
    }
    if (booking.status !== 'CANCELLED' || booking.cancelledBy !== 'SYSTEM') {
      // Concurrent recovery already un-cancelled it. Nothing to do.
      return;
    }
    if (booking.endDatetime < new Date()) {
      const fresh = await db.payment.findUnique({
        where: { id: paymentId },
        select: { amount: true, currency: true },
      });
      if (fresh) await this.queueB2Refund(paymentId, fresh.amount, fresh.currency, basketId, 'ACTIVITY_ALREADY_ENDED');
      return;
    }

    try {
      const result = await db.$transaction(async (tx: any) => {
        // Re-check status inside tx (idempotency).
        const flip = await tx.booking.updateMany({
          where: { id: bookingId, status: 'CANCELLED', cancelledBy: 'SYSTEM' },
          data: { status: 'CONFIRMED', cancelledAt: null, cancelledBy: null },
        });
        if (flip.count === 0) return { kind: 'already-recovered' as const };

        // Slot-conflict re-check — another customer may have grabbed the
        // slot while this one was CANCELLED. We use the same overlap
        // aggregate as createBooking, EXCLUDING this booking itself.
        const overlap = await tx.booking.aggregate({
          where: {
            id: { not: bookingId },
            activityId: booking.activityId,
            unitNumber: booking.unitNumber ?? undefined,
            status: { notIn: ['CANCELLED'] },
            startDatetime: { lt: booking.endDatetime },
            endDatetime: { gt: booking.startDatetime },
          },
          _sum: { guests: true },
        });
        const taken = overlap._sum.guests ?? 0;
        const activityCapacity = await tx.activity.findUnique({
          where: { id: booking.activityId },
          select: { capacity: true, status: true },
        });
        const cap = activityCapacity?.capacity ?? 0;
        if (taken + booking.guests > cap || activityCapacity?.status === 'INACTIVE') {
          // Roll back the un-cancel by throwing — Serializable tx rollback
          // restores the CANCELLED row, preserving the slot for whoever
          // owns it now.
          throw new Error('SLOT_CONFLICT');
        }

        return { kind: 'reconfirmed' as const, activityId: booking.activityId };
      }, { isolationLevel: 'Serializable' });

      if (result.kind === 'reconfirmed') {
        void this.availabilityCache.invalidate(result.activityId);
        await this.auditLogger.log({
          actorType: 'SYSTEM',
          actorId: 'pay2m-callback',
          actorName: 'PAY2M Gateway',
          action: 'PAYMENT_RECOVERED_VIA_UNCANCEL',
          entity: 'Booking',
          entityId: bookingId,
          details: `Booking un-cancelled (was CANCELLED-by-SYSTEM). basket: ${basketId}`,
          actionCategory: 'FINANCIAL',
        });
        return;
      }
      // already-recovered: nothing to do
    } catch (err: any) {
      const reason =
        err?.message === 'SLOT_CONFLICT' ? 'SLOT_CONFLICT' :
        err?.code === 'P2034' ? 'SLOT_CONFLICT_P2034' :
        `RECOVERY_ERROR:${err?.name || 'Unknown'}`;
      const fresh = await db.payment.findUnique({
        where: { id: paymentId },
        select: { amount: true, currency: true },
      });
      if (fresh) await this.queueB2Refund(paymentId, fresh.amount, fresh.currency, basketId, reason);
    }
  }

  /**
   * Queue a full refund for a recovery-failure case. Marks the payment
   * REFUND_PENDING with refundAmount = amount, writes a FINANCIAL audit
   * row tagging the failure reason, notifies the customer, and pings
   * admin via the existing notification channel. The actual bank-side
   * refund happens when admin clicks Approve in the refund-decisions UI.
   */
  private async queueB2Refund(
    paymentId: string,
    amount: any,
    currency: string,
    basketId: string,
    reason: string,
  ): Promise<void> {
    const db = this.prisma.client;
    // updateMany so a duplicate recovery call doesn't double-mark.
    const flip = await db.payment.updateMany({
      where: { id: paymentId, status: 'SUCCESS' },
      data: { status: 'REFUND_PENDING', refundAmount: amount },
    });
    await this.auditLogger.log({
      actorType: 'SYSTEM',
      actorId: 'pay2m-callback',
      actorName: 'PAY2M Gateway',
      action: 'PAYMENT_RECOVERY_REFUND_QUEUED',
      entity: 'Payment',
      entityId: paymentId,
      details: `Recovery failed (${reason}); refund of ${amount} ${currency} queued for admin approval. basket: ${basketId} | flipped: ${flip.count}`,
      actionCategory: 'FINANCIAL',
    });
    void this.notificationService.notifyAdmins({
      type: 'SYSTEM',
      title: 'Payment recovery failed — refund queued',
      message: `Payment ${paymentId.slice(0, 8)} recovered but the booking could not be re-created (${reason}). Approve refund in /admin.`,
      link: '/admin',
    }).catch(() => undefined);
  }


  // ─── Get Payment Status ─────────────────────────────────────────────────

  async getPaymentStatus(bookingId: string, userId: string) {
    const db = this.prisma.client;
    // Ownership in the where clause — same 404 for "not yours" and
    // "doesn't exist", no enumeration oracle.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, customerId: userId },
      select: {
        id: true,
        status: true,
        paymentId: true,
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (!booking.paymentId) return { status: 'NO_PAYMENT' };

    const payment = await db.payment.findUnique({
      where: { id: booking.paymentId },
      select: { status: true, method: true, paidAt: true, gatewayErrCode: true },
    });

    return {
      status: payment?.status || 'UNKNOWN',
      method: payment?.method,
      paidAt: payment?.paidAt,
      errorMessage: payment?.gatewayErrCode ? this.mapErrorMessage(payment.gatewayErrCode) : undefined,
    };
  }

  // ─── Error Code Mapping ─────────────────────────────────────────────────

  private mapErrorMessage(code: string): string {
    const map: Record<string, string> = {
      // Timeout / connectivity
      '002': 'Transaction timed out. Please try again.',
      '423': 'Unable to process your request at the moment. Please try again later.',
      // Card / account issues
      '03': 'The account is inactive. Please contact your bank.',
      '04': 'The account is closed. Please use a different card.',
      '13': 'Invalid amount. Please try again.',
      '14': 'Your card is inactive. Please contact your bank.',
      '15': 'Your card is inactive. Please contact your bank.',
      '42': 'Verification failed. Please check your details and try again.',
      '41': 'Details do not match. Please check and try again.',
      '54': 'Your card has expired. Please use a different card.',
      '75': 'Maximum PIN attempts exceeded. Please try again later.',
      '97': 'Insufficient balance. Please use a different payment method.',
      '104': 'The details entered are incorrect. Please try again.',
      '106': 'Transaction limit exceeded. Please contact your bank.',
      '126': 'Invalid account details. Please check and try again.',
      '308': 'Invalid account details. Please check and try again.',
      '309': 'Invalid verification code length. Please try again.',
      '359': 'Your account is blocked. Please contact your bank.',
      '537': 'Your account is dormant. Please contact your bank.',
      '600': 'Verification code has expired. Please try again.',
      '853': 'Invalid account details. Please check and try again.',
      // OTP
      '55': 'Invalid OTP entered. Please try again.',
      // E-commerce activation
      '880': 'Please activate your e-commerce service with your bank.',
      '881': 'Insufficient funds. Please try a different card.',
      '882': 'Daily transaction limit reached. Please try again tomorrow.',
      '883': 'Please activate your local payment service with your bank.',
      // Fraud
      '9000': 'Transaction was declined for security reasons.',
      '9010': 'Transaction was declined for security reasons.',
    };
    return map[code] || 'Payment could not be processed. Please try again.';
  }
}
