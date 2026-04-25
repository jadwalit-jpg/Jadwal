import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  Res,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_AUTH, RATE_LIMIT_CALLBACK, RATE_LIMIT_READ } from '../common/throttle-config';
import { ConfigService } from '@nestjs/config';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/request-user.interface';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { Pay2mCallbackDto } from './dto/pay2m-callback.dto';

@Controller('payment')
export class PaymentController {
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
    return this.paymentService.initiatePayment(dto.bookingId, user.id);
  }

  /**
   * PAY2M redirects the customer's browser here after payment.
   * No auth — customer may have lost session during redirect.
   * Verifies response, updates DB, then redirects to frontend.
   */
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
      const safeBookingId = result.bookingId && UUID_RE.test(result.bookingId) ? result.bookingId : '';

      if (result.status === 'success') {
        return res.redirect(buildRedirect({ status: 'success', bookingId: safeBookingId }));
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
   */
  @Post('callback/ipn')
  @Throttle(RATE_LIMIT_CALLBACK)
  async handleIpn(@Body() body: Pay2mCallbackDto) {
    await this.paymentService.handleCallback(body);
    return { received: true };
  }

}
