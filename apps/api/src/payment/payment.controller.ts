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
} from '@nestjs/common';
import { NoFilesInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_AUTH, RATE_LIMIT_CALLBACK, RATE_LIMIT_READ } from '../common/throttle-config';
import { ConfigService } from '@nestjs/config';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/request-user.interface';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { Pay2mCallbackDto } from './dto/pay2m-callback.dto';
import { buildIpnDiagnostics } from './ipn-diagnostics';

@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

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
  @UseGuards(JwtAuthGuard)
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
   */
  @Public()
  @Get('callback')
  @Throttle(RATE_LIMIT_CALLBACK)
  async handleCallback(
    @Query() query: Pay2mCallbackDto,
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

    try {
      const result = await this.paymentService.handleCallback(query);
      // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos
      // UUID_RE is a fixed-format hex/dash pattern with no nested quantifiers.
      const safeBookingId = result.bookingId && UUID_RE.test(result.bookingId) ? result.bookingId : '';

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
  @Throttle(RATE_LIMIT_CALLBACK)
  @UseInterceptors(
    NoFilesInterceptor({
      limits: { fields: 30, fieldSize: 8 * 1024, fieldNameSize: 100, parts: 30 },
    }),
  )
  async handleIpn(@Body() body: Pay2mCallbackDto, @Req() req: Request) {
    // Phase 1 diagnostic — capture PAY2M's server source IP + the IPN's field
    // structure so we can plan a source-IP allow-list (Phase 2: trust the IPN
    // on the NAPS rail, where the hash is unverifiable). buildIpnDiagnostics is
    // whitelist-only and NEVER logs the Response_Key or any secret. We read the
    // RAW multer-parsed body so the logged field NAMES reflect exactly what
    // PAY2M sent, independent of DTO whitelisting.
    const cfIp = req.headers['cf-connecting-ip'];
    const sourceIp = (typeof cfIp === 'string' && cfIp) || req.ip || 'unknown';
    const contentType = req.headers['content-type'] ?? 'unknown';
    this.logger.log(
      buildIpnDiagnostics((req.body ?? {}) as Record<string, unknown>, sourceIp, contentType),
    );

    await this.paymentService.handleCallback(body);
    return { received: true };
  }

}
