import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  ParseUUIDPipe,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { NoFilesInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { RATE_LIMIT_AUTH, RATE_LIMIT_CALLBACK, RATE_LIMIT_READ, RATE_LIMIT_IPN } from '../common/throttle-config';
import { ConfigService } from '@nestjs/config';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TermsAcceptedGuard } from '../auth/guards/terms-accepted.guard';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/request-user.interface';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { Pay2mCallbackDto, Pay2mIpnDto } from './dto/pay2m-callback.dto';
import { buildIpnDiagnostics } from './ipn-diagnostics';

/**
 * Query fields PAY2M is known to send on the browser return. Anything else is
 * dropped by the lenient validator and logged BY NAME so a gateway-side change
 * is visible without ever logging a value (Response_Key is a secret-derived hash).
 */
const KNOWN_CALLBACK_FIELDS = new Set([
  'err_code', 'err_msg', 'basket_id', 'order_date', 'transaction_id',
  'Response_Key', 'PaymentName', 'Rdv_Message_Key',
]);

/** Same shape Pay2mCallbackDto enforces; used to decide whether a failed callback can still be looked up. */
const BASKET_ID_RE = /^JDWL-[a-f0-9-]{12}$/i;

/** A field NAME fit for a log line: ASCII identifier characters only, capped. */
function safeFieldName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9_.\-[\]]/g, '');
  return (clean || 'unnamed').slice(0, 40);
}

/** Thrown by the browser-callback validator: carries the failing field names only. */
class CallbackValidationError extends Error {
  constructor(readonly fields: string[]) {
    super('callback validation failed');
    this.name = 'CallbackValidationError';
  }
}

@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  // Lenient validator for PAY2M's IPN webhook. Unlike our own clients (where an
  // unexpected field signals a bug/attack and `forbidNonWhitelisted` rightly
  // rejects), a third-party gateway may add fields to its IPN at any time —
  // rejecting the whole money-critical notification over an unmodelled field is
  // brittle. So we STRIP unknown fields (`whitelist`) instead of REJECTING the
  // request, while still enforcing the type/format/length bounds on the fields
  // we actually use. handleCallback remains the secret-gated security check.
  private readonly ipnValidator = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
  });

  // Same leniency for PAY2M's browser return (GET /payment/callback): unknown
  // fields are stripped, the used fields keep their bounds, and a failure is
  // reported as field NAMES so the handler can log what changed without
  // echoing any value. The handler never lets this become an HTTP 400.
  private readonly callbackValidator = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
    exceptionFactory: (errors) =>
      new CallbackValidationError(errors.map((e) => safeFieldName(String(e.property)))),
  });

  constructor(
    private paymentService: PaymentService,
    private config: ConfigService,
  ) {}

  /**
   * Initiate payment — returns PAY2M form data for frontend auto-submit.
   * Amount comes from DB, never from request body.
   */
  @Post('initiate')
  @Throttle(RATE_LIMIT_AUTH)
  @UseGuards(JwtAuthGuard, TermsAcceptedGuard) // consent required to move money (anti-bypass)
  async initiatePayment(
    @CurrentUser() user: RequestUser,
    @Body() dto: InitiatePaymentDto,
  ) {
    return this.paymentService.initiatePayment(dto.bookingId, user.id, dto.idempotencyKey);
  }

  /**
   * PAY2M redirects the customer's browser here after payment.
   * No auth — customer may have lost session during redirect.
   * Verifies response, updates DB, then redirects to frontend.
   *
   * This route never answers with JSON. A customer landed on
   * `{"statusCode":400,"message":"Bad Request"}` on 24 Nov 2026 because the
   * global ValidationPipe (`forbidNonWhitelisted`) rejected PAY2M's return
   * query before the handler ran. So the query is taken untyped (the global
   * pipe skips a plain object) and validated here leniently, like the IPN:
   * unknown fields are stripped and logged BY NAME, the used fields keep their
   * type/length/format bounds. An incomplete or malformed callback is never
   * handed to handleCallback and confirms or fails nothing: the customer is
   * sent to the state the payment is really in (or to a neutral "checking"
   * page), and the trusted IPN remains the source of truth.
   */
  @Public()
  @Get('callback')
  @Throttle(RATE_LIMIT_CALLBACK)
  async handleCallback(
    @Query() rawQuery: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');

    // UUIDv4 allow-list for any bookingId echoed back into a redirect URL.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const buildRedirect = (params: Record<string, string>) => {
      const url = new URL('/payment/callback', frontendUrl);
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
      return url.toString();
    };
    const safeBookingIdOf = (id: string | null | undefined) => (id && UUID_RE.test(id) ? id : '');

    // ── 1. Lenient validation (names only in logs, never values) ──────────
    let query: Pay2mCallbackDto | null = null;
    try {
      const raw = rawQuery && typeof rawQuery === 'object' ? rawQuery : {};
      const unknown = Object.keys(raw)
        .filter((k) => !KNOWN_CALLBACK_FIELDS.has(k))
        .map(safeFieldName)
        .slice(0, 20);
      if (unknown.length > 0) {
        this.logger.warn({ event: 'PAY2M_CALLBACK_UNKNOWN_FIELDS', fields: unknown });
      }
      try {
        query = (await this.callbackValidator.transform(raw, {
          type: 'query',
          metatype: Pay2mCallbackDto,
        })) as Pay2mCallbackDto;
      } catch (err) {
        const fields = err instanceof CallbackValidationError ? err.fields : ['unknown'];
        this.logger.warn({ event: 'PAY2M_CALLBACK_INVALID', fields });
      }

      if (!query) {
        // ── 2. Incomplete callback: redirect by the STORED state, change nothing ──
        // handleCallback is not called, so nothing is confirmed or failed here;
        // the IPN (or a later valid callback) still decides. With a well-formed
        // basket id the customer sees the payment's real state; without one, a
        // neutral "we are checking your payment" page.
        const basketRaw = raw.basket_id;
        const basket = typeof basketRaw === 'string' && BASKET_ID_RE.test(basketRaw) ? basketRaw : null;
        if (!basket) return res.redirect(buildRedirect({ status: 'checking' }));
        const p = await this.paymentService.paymentStatusByBasket(basket);
        const bid = safeBookingIdOf(p?.bookingId);
        if (p?.status === 'SUCCESS') return res.redirect(buildRedirect({ status: 'success', bookingId: bid }));
        if (p?.status === 'PENDING') return res.redirect(buildRedirect({ status: 'pending', bookingId: bid }));
        return res.redirect(buildRedirect({ status: 'failed', bookingId: bid, error: 'Payment could not be verified' }));
      }
    } catch (err) {
      // Lookup or validation plumbing failed: still a page, never an error body.
      this.logger.error({ event: 'PAY2M_CALLBACK_PREFLIGHT_FAILED', kind: err instanceof Error ? err.name : 'UnknownError' });
      return res.redirect(buildRedirect({ status: 'checking' }));
    }

    // ── 3. Complete callback: the existing verified path, unchanged ───────
    try {
      const result = await this.paymentService.handleCallback(query);
      // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos
      // UUID_RE is a fixed-format hex/dash pattern with no nested quantifiers.
      const safeBookingId = safeBookingIdOf(result.bookingId);

      if (result.status === 'success') {
        return res.redirect(buildRedirect({ status: 'success', bookingId: safeBookingId }));
      }
      if (result.status === 'pending') {
        // Verified NAPS-rail success held awaiting capture confirmation —
        // neither a success nor a failure yet. The frontend shows a
        // "payment being verified" state instead of a false failure.
        return res.redirect(buildRedirect({ status: 'pending', bookingId: safeBookingId }));
      }
      return res.redirect(
        buildRedirect({
          status: 'failed',
          bookingId: safeBookingId,
          error: result.error || 'Payment failed',
        }),
      );
    } catch {
      // The browser callback's hash didn't verify. For a NAPS payment this is
      // EXPECTED (its callback hash is unverifiable) for BOTH success and failure
      // callbacks — so we must NOT blanket-show "processing", or a genuine NAPS
      // DECLINE would also read as "processing". We show "processing" ONLY when:
      //   (a) the payment is still PENDING (the IPN may still confirm it), AND
      //   (b) the callback's err_code looks like success/pending — NOT a failure.
      // The err_code here is DISPLAY-ONLY and untrusted (a client could forge it),
      // but that's safe: it only changes the message shown to the requester; the
      // actual booking is NEVER confirmed/failed from this unverified callback
      // (handleCallback already refused) — only the trusted server-to-server IPN
      // does that. A failure code, a non-PENDING payment, or a missing payment all
      // show "failed". PAY2M codes: 00/000/0000 = paid, 001 = pending; anything
      // else (002 timeout, 90/104/901… declines) is treated as a failure here.
      const PENDING_OR_PAID = new Set(['00', '000', '0000', '001']);
      try {
        const code = (query.err_code ?? '').trim();
        const p = query.basket_id ? await this.paymentService.paymentStatusByBasket(query.basket_id) : null;
        if (p?.status === 'PENDING' && PENDING_OR_PAID.has(code)) {
          const bid = safeBookingIdOf(p.bookingId);
          return res.redirect(buildRedirect({ status: 'pending', bookingId: bid }));
        }
      } catch {
        // Lookup failed — fall through to the failed screen.
      }
      return res.redirect(buildRedirect({ status: 'failed', error: 'Payment could not be verified' }));
    }
  }

  /**
   * Customer polls payment status for a booking.
   */
  @Get('status/:bookingId')
  @Throttle(RATE_LIMIT_READ)
  @UseGuards(JwtAuthGuard)
  async getPaymentStatus(
    @CurrentUser() user: RequestUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ) {
    return this.paymentService.getPaymentStatus(bookingId, user.id);
  }

  /**
   * IPN (Instant Payment Notification) — server-to-server push from PAY2M.
   * Backup verification in case the browser redirect callback fails.
   * Processes identically to the callback but returns 200 OK instead of redirecting.
   *
   * PAY2M sends the IPN as `multipart/form-data` (verified in production logs
   * 2026-06-19: user-agent `got`, contentType `multipart/form-data`). Express's
   * json + urlencoded body-parsers (main.ts) do NOT parse multipart, so without
   * this interceptor the body arrives EMPTY and the DTO validation 400s before
   * any payment logic runs — which is exactly why every real IPN was rejected.
   *
   * `NoFilesInterceptor` = multer().none(): it parses TEXT form fields only and
   * REJECTS any file part. Strict limits cap the field count/size so a malicious
   * multipart body (this endpoint is public) cannot exhaust memory. handleCallback
   * remains the single, idempotent, secret-gated verifier — this only fixes the
   * body-parsing layer in front of it; it does not change any trust decision.
   */
  @Public()
  @Post('callback/ipn')
  // Dedicated high tier, NOT the shared 20/min CALLBACK bucket: every IPN comes
  // from PAY2M's single source IP, so on a shared tier they'd all key to one
  // bucket and a burst would 429 real booking confirmations. Trust is the
  // source-IP allow-list + hash + idempotency, not the throttler. (M10)
  //
  // The global throttler applies ALL tiers unless skipped by name, so without
  // skipping long (100/10min) + availability (30/min) the real ceiling would be
  // min(300, 30, 100/10min) = 30/min — a near no-op that still 429s a legit IPN
  // burst. Skip them so only the 300/min short tier applies.
  @SkipThrottle({ long: true, availability: true })
  @Throttle(RATE_LIMIT_IPN)
  @UseInterceptors(
    NoFilesInterceptor({
      limits: { fields: 30, fieldSize: 8 * 1024, fieldNameSize: 100, parts: 30 },
    }),
  )
  async handleIpn(@Req() req: Request) {
    // Read the RAW multer-parsed body (not via @Body) so the global strict
    // ValidationPipe (forbidNonWhitelisted) can't reject PAY2M's payload before
    // we even see it. We validate it ourselves below, leniently.
    const raw = (req.body ?? {}) as Record<string, unknown>;

    // Diagnostic FIRST — capture PAY2M's server source IP + the IPN's field
    // structure (needed to plan the Phase 2 source-IP allow-list) even when the
    // payload would fail validation. buildIpnDiagnostics is whitelist-only and
    // NEVER logs the Response_Key or any secret.
    const cfIp = req.headers['cf-connecting-ip'];
    // TRUST anchor: ONLY the Cloudflare-set client IP. We never fall back to
    // req.ip for the trust decision — if the request did not traverse Cloudflare
    // (header absent), it is untrusted (fail-closed). The whole IPN trust model
    // rests on this header being CF-set + the ALB SG locked to Cloudflare ranges.
    const cfSourceIp = typeof cfIp === 'string' && cfIp ? cfIp : null;
    // For the diagnostic log only, a req.ip fallback is fine (observability).
    const sourceIp = cfSourceIp ?? req.ip ?? 'unknown';
    const contentType = req.headers['content-type'] ?? 'unknown';
    this.logger.log(buildIpnDiagnostics(raw, sourceIp, contentType));

    // Validate against the IPN's OWN shape (responseKey, no amount) — leniently
    // (strip unknown fields). The browser-callback DTO would reject the IPN.
    const dto = (await this.ipnValidator.transform(raw, {
      type: 'body',
      metatype: Pay2mIpnDto,
      data: '',
    })) as Pay2mIpnDto;

    // Only an allow-listed PAY2M source IP (+ the feature flag on) may confirm
    // or fail a booking from an IPN — fail-closed otherwise. handleCallback
    // makes the actual decision; we hand it the trust verdict + the 'ipn' tag.
    const trustedCapture = this.paymentService.isTrustedIpnSource(cfSourceIp);
    await this.paymentService.handleCallback(
      {
        err_code: dto.err_code,
        err_msg: dto.err_msg,
        basket_id: dto.basket_id,
        transaction_id: dto.transaction_id,
        // The IPN hash is NOT verified (no amount to hash) and is deliberately
        // NOT persisted: storing it would put a SHA-256(secret-word…) brute-force
        // oracle in the DB and blur it against the VERIFIED card-rail hash kept in
        // gatewayResponseKey. Trust is the source IP; reconciliation uses
        // transaction_id. Pass empty so the verified-hash field stays meaningful.
        Response_Key: '',
        order_date: dto.order_date,
      },
      { via: 'ipn', trustedCapture },
    );
    // 200 so PAY2M stops retrying once handled (confirm / fail / safe no-op all
    // resolve here). A genuinely unknown basket or disabled service still throws.
    return { received: true };
  }

}
