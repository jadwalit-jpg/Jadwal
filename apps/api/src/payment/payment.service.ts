import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisLockService } from '../redis/redis-lock.service';
import { AvailabilityCacheService } from '../redis/availability-cache.service';
import { AuditLoggerService } from '../common/services/audit-logger.service';
import { refundCouponUsage } from '../bookings/bookings.service';
import { NotificationService } from '../common/services/notification.service';
import { EmailService } from '../email/email.service';
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
  private readonly secretWord: string;
  private readonly apiUrl: string;
  private readonly returnUrl: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private redisLock: RedisLockService,
    private auditLogger: AuditLoggerService,
    private notificationService: NotificationService,
    private emailService: EmailService,
    private availabilityCache: AvailabilityCacheService,
  ) {
    this.enabled = this.config.get('PAYMENT_ENABLED', 'false') === 'true';
    this.merchantId = this.config.getOrThrow<string>('PAY2M_MERCHANT_ID');
    this.securedKey = this.config.getOrThrow<string>('PAY2M_SECURED_KEY');
    this.secretWord = this.config.getOrThrow<string>('PAY2M_SECRET_WORD');
    this.returnUrl = this.config.getOrThrow<string>('PAY2M_RETURN_URL');
    this.apiUrl = this.config.getOrThrow<string>('PAY2M_API_URL');
    this.merchantName = this.config.getOrThrow<string>('PAY2M_MERCHANT_NAME');
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

    // Hard 15s timeout — prevents an unreachable PAY2M server from hanging
    // the NestJS request thread indefinitely. Normalise timeout / DNS /
    // connection-refused errors to a generic gateway-unavailable response.
    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Jadwal-API/1.0',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err: unknown) {
      // Never leak raw error.message or cause.code to the client.
      const kind = (err as { name?: string })?.name === 'TimeoutError' ? 'timeout' : 'network';
      this.logger.error(`PAY2M token request ${kind} error`);
      throw new BadRequestException('Payment gateway is temporarily unavailable');
    }

    if (!response.ok) {
      this.logger.error(`PAY2M token request failed: HTTP ${response.status}`);
      throw new BadRequestException('Payment gateway is temporarily unavailable');
    }

    // Two-step size guard:
    //   1. If PAY2M sends Content-Length, reject before buffering the body.
    //   2. Read as text, length-check, then JSON.parse. Catches chunked
    //      transfers where Content-Length is absent.
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > PaymentService.PAY2M_MAX_RESPONSE_BYTES) {
      this.logger.error(`PAY2M response too large (${contentLength} bytes)`);
      throw new BadRequestException('Payment gateway is temporarily unavailable');
    }
    const responseText = await response.text();
    if (responseText.length > PaymentService.PAY2M_MAX_RESPONSE_BYTES) {
      this.logger.error(`PAY2M response body too large (${responseText.length} bytes after read)`);
      throw new BadRequestException('Payment gateway is temporarily unavailable');
    }

    let data: Pay2mTokenResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      this.logger.error('PAY2M returned non-JSON response');
      throw new BadRequestException('Payment gateway is temporarily unavailable');
    }

    if (!data.ACCESS_TOKEN) {
      this.logger.error('PAY2M returned empty access token');
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
      // "a random string value" — PAY2M does not validate its content. The
      // hash that actually authenticates the payment is Response_Key (sent
      // by PAY2M to us in the callback), computed as
      // SHA256(merchant_id + basket_id + secret_word + amount + err_code).
      // crypto.randomUUID() satisfies the "random string" requirement
      // without exposing any internal state.
      SIGNATURE: crypto.randomUUID(),
      VERSION: 'Jadwal-1.0',
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

  verifyCallbackHash(basketId: string, amount: string, errCode: string, responseKey: string): boolean {
    // Upfront format gate — rejects obvious garbage (wrong length, non-hex)
    // in O(1) before we spend O(n) on string normalisation + buffer
    // construction. Defence-in-depth against a flood of large-payload
    // `Response_Key` submissions; also makes the expected shape explicit.
    if (typeof responseKey !== 'string' || !/^[a-f0-9]{64}$/i.test(responseKey)) {
      return false;
    }
    const raw = `${this.merchantId}${basketId}${this.secretWord}${amount}${errCode}`;
    const expected = crypto.createHash('sha256').update(raw).digest('hex');
    // Compare the decoded 32-byte buffers, not ASCII hex. timingSafeEqual
    // is constant-time on equal-length inputs; the length check above means
    // these are always the same length by the time we get here.
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(responseKey.toLowerCase(), 'hex'),
    );
  }

  // ─── Initiate Payment ───────────────────────────────────────────────────

  async initiatePayment(bookingId: string, userId: string) {
    // 0. Check payment gateway is enabled before any DB work
    if (!this.enabled) {
      throw new BadRequestException('Payment service is not available');
    }

    const db = this.prisma.client;

    // 1. Load booking + payment
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        customerId: true,
        status: true,
        reservedUntil: true,
        paymentId: true,
        ref: true,
        activity: { select: { titleEn: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customerId !== userId) throw new ForbiddenException('Not your booking');
    if (booking.status !== 'PENDING') throw new BadRequestException('Booking is not in a payable state');

    // Check reservation hasn't expired (with 1-minute buffer)
    if (booking.reservedUntil && booking.reservedUntil < new Date(Date.now() + 60 * 1000)) {
      throw new BadRequestException('Reservation has expired. Please create a new booking.');
    }

    if (!booking.paymentId) throw new BadRequestException('No payment record for this booking');

    const payment = await db.payment.findUnique({
      where: { id: booking.paymentId },
      select: { id: true, amount: true, currency: true, status: true, gatewayBasketId: true },
    });
    if (!payment) throw new BadRequestException('Payment record not found');
    if (payment.status !== 'PENDING') throw new BadRequestException('Payment already processed');

    // 2. Redis lock to prevent double-pay from multiple tabs
    const lockKey = `payment_lock:${payment.id}`;
    const lockToken = await this.redisLock.acquire(lockKey, 30000);
    if (!lockToken) throw new BadRequestException('Payment is already being processed');

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

      // 6. Build form payload
      const formFields = this.buildFormPayload({
        token,
        basketId,
        amount,
        currency: payment.currency,
        customerEmail: customer?.email || '',
        customerPhone: customer?.phone || '',
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
      });

      return {
        formAction: `${this.apiUrl}/PostTransaction`,
        formFields,
      };
    } finally {
      await this.redisLock.release(lockKey, lockToken);
    }
  }

  // ─── Handle Callback from PAY2M ────────────────────────────────────────

  async handleCallback(params: {
    err_code: string;
    err_msg?: string;
    basket_id: string;
    transaction_id?: string;
    Response_Key: string;
    order_date?: string;
  }): Promise<{ bookingId: string; status: 'success' | 'failed'; error?: string }> {
    // 0. Reject callbacks when payment is disabled (maintenance, misconfiguration)
    if (!this.enabled) {
      this.logger.warn('Callback received while PAYMENT_ENABLED=false — rejecting');
      throw new BadRequestException('Payment service is not available');
    }

    const db = this.prisma.client;

    // 1. Find payment by basket ID
    const payment = await db.payment.findUnique({
      where: { gatewayBasketId: params.basket_id },
      select: { id: true, bookingId: true, amount: true, status: true },
    });

    if (!payment) {
      this.logger.warn('Callback received for unknown basket_id');
      throw new BadRequestException('Payment not found');
    }

    // 2. Idempotent — if already processed as SUCCESS, return early
    if (payment.status === 'SUCCESS') {
      return { bookingId: payment.bookingId!, status: 'success' };
    }

    // 3. Check if success (err_code 00 or 000)
    const isSuccess = params.err_code === '00' || params.err_code === '000';

    // 2b. CRITICAL: If payment was marked FAILED by cleanup cron but PAY2M now sends SUCCESS,
    // the customer WAS charged — we MUST recover the booking. This handles the race condition
    // where the reservation timer expires while the customer is entering card details on PAY2M.
    // Without this, the customer loses money with no booking.
    if (payment.status === 'FAILED' && !isSuccess) {
      return { bookingId: payment.bookingId!, status: 'failed', error: 'Payment was previously declined' };
    }
    // If payment.status === 'FAILED' && isSuccess → fall through to process as new SUCCESS
    // (the optimistic lock below handles the update safely)

    // 4. Verify SHA256 hash — required for successful payments, best-effort for failures
    const amount = Number(payment.amount).toFixed(2);
    const hashValid = this.verifyCallbackHash(
      params.basket_id,
      amount,
      params.err_code,
      params.Response_Key,
    );

    // Always require a valid hash — both for SUCCESS (an invalid hash on
    // success = tampering attempt to confirm an unpaid booking) and for
    // FAILURE (an invalid hash on failure = a forged callback by an
    // attacker who knows the basket_id, used to cancel a victim's PENDING
    // booking). Industry norm: webhook signatures are verified on every
    // event, regardless of outcome. PAY2M sends a valid Response_Key for
    // legitimate cancels and declines too — the previous "be lenient on
    // failures" was the only deviation, and it's now closed.
    if (!hashValid) {
      this.logger.warn(`Invalid Response_Key for payment ${payment.id} (err_code=${params.err_code})`);
      await this.auditLogger.log({
        actorType: 'SYSTEM',
        actorId: 'pay2m-callback',
        actorName: 'PAY2M Gateway',
        action: 'PAYMENT_HASH_MISMATCH',
        entity: 'Payment',
        entityId: payment.id,
        details: `err_code: ${params.err_code}, basket: ${params.basket_id}, isSuccess: ${isSuccess}`,
      });
      throw new BadRequestException('Payment verification failed');
    }

    // 5. Update payment + booking in transaction (optimistic lock)
    const savedBookingId = payment.bookingId;
    let deletedActivityId: string | null = null;
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
        const booking = await tx.booking.findUnique({ where: { id: payment.bookingId! }, select: { id: true, status: true } });
        if (booking) {
          // Booking exists — confirm it (could be PENDING or CANCELLED from cron)
          await tx.booking.update({
            where: { id: payment.bookingId },
            data: { status: 'CONFIRMED' },
          });
        } else {
          // Booking was deleted by cron — this means customer paid but booking is gone
          // Log as critical alert so admin can manually process the refund
          this.logger.error(`CRITICAL: Payment ${payment.id} succeeded but booking ${payment.bookingId} was already deleted. Customer was charged. Manual refund required.`);
          await this.auditLogger.log({
            actorType: 'SYSTEM',
            actorId: 'pay2m-callback',
            actorName: 'PAY2M Gateway',
            action: 'PAYMENT_ORPHANED',
            entity: 'Payment',
            entityId: payment.id,
            details: `Payment succeeded but booking was deleted by cleanup cron. Manual refund required. basket: ${params.basket_id}`,
          });
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
            select: { activityId: true, customerId: true, couponCode: true },
          });
          if (doomed) {
            deletedActivityId = doomed.activityId;
            // createBooking incremented coupon.usedCount at reservation time;
            // a failed payment means the booking never completed — return
            // that increment so the coupon stays accurate.
            await refundCouponUsage(tx, doomed.couponCode, doomed.customerId);
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

    // Notify customer about payment success + send booking confirmation email
    const bookingForNotify = await db.booking.findUnique({
      where: { id: payment.bookingId! },
      select: {
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
      const vendorUser = await db.vendor.findUnique({
        where: { id: bookingForNotify.vendorId },
        select: { userId: true, slug: true },
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

      // Send booking confirmation email with details + Google Maps link
      const total = Number(bookingForNotify.totalPrice) + Number(bookingForNotify.serviceFee) - Number(bookingForNotify.couponDiscount);
      const startDate = new Date(bookingForNotify.startDatetime);
      const dateStr = startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const timeStr = bookingForNotify.activity?.bookingType === 'HOURLY'
        ? startDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
        : bookingForNotify.activity?.checkInTime ?? undefined;
      const mapsLink = bookingForNotify.activity?.locationLat && bookingForNotify.activity?.locationLng
        ? `https://maps.google.com/maps?q=${bookingForNotify.activity.locationLat},${bookingForNotify.activity.locationLng}`
        : undefined;

      this.emailService.sendBookingConfirmation(bookingForNotify.customer.email, {
        customerName: bookingForNotify.customer.fullName,
        activityTitle: bookingForNotify.activity?.titleEn ?? 'Activity',
        date: dateStr,
        time: timeStr,
        guests: bookingForNotify.guests,
        totalAmount: total.toFixed(2),
        currency: bookingForNotify.currencyCode,
        bookingId: payment.bookingId!,
        locationAddress: bookingForNotify.activity?.locationAddress ?? undefined,
        mapsLink,
      }).catch((err: unknown) => {
        // Never embed raw err.message — SES / SMTP errors can contain
        // AWS request IDs, account numbers, hostnames, or the recipient
        // email verbatim. Log the error class only; the full object is
        // already logged by the EmailService's own catch for forensics.
        const kind = err instanceof Error ? err.name : 'UnknownError';
        this.logger.error(`Booking confirmation email failed (${kind}) for booking ${payment.bookingId}`);
      });
    }

    return { bookingId: savedBookingId!, status: 'success' as const };
  }


  // ─── Get Payment Status ─────────────────────────────────────────────────

  async getPaymentStatus(bookingId: string, userId: string) {
    const db = this.prisma.client;
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        customerId: true,
        status: true,
        paymentId: true,
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customerId !== userId) throw new ForbiddenException('Not your booking');
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
