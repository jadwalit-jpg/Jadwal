import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { RATE_LIMIT_ADMIN, RATE_LIMIT_STRICT } from '../common/throttle-config';
import { AdminService } from './admin.service';
import { PaymentService } from '../payment/payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/request-user.interface';
import { AdminAuditInterceptor } from './interceptors/audit.interceptor';
import { MarkPaymentPaidDto } from './dto/mark-payment-paid.dto';

/**
 * Gateway-payment rescue for admins: the PAY2M baskets the site could not
 * confirm on its own, and "Mark as paid" for one of them. Same guards, roles,
 * audit interceptor and throttle tiers as AdminController; kept in its own
 * controller so the PaymentService dependency stays out of the main one.
 */
@Controller('admin/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@UseInterceptors(AdminAuditInterceptor)
@SkipThrottle({ long: true, availability: true })
@Throttle(RATE_LIMIT_ADMIN)
export class AdminPaymentsController {
  constructor(
    private readonly adminService: AdminService,
    private readonly paymentService: PaymentService,
  ) {}

  /** PAY2M payments reported by the gateway but not confirmed by the site (last 60 days). */
  @Get('unconfirmed')
  getUnconfirmed() {
    return this.adminService.getUnconfirmedGatewayPayments();
  }

  /**
   * Confirm a PAY2M payment by hand. Financial, audited (MARK_PAYMENT_PAID by
   * the interceptor plus PAYMENT_MARKED_PAID_BY_ADMIN with the transaction id
   * and note from the service), idempotent: a second click gets 409.
   */
  @Post(':id/mark-paid')
  @Throttle(RATE_LIMIT_STRICT)
  markPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPaymentPaidDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.paymentService.confirmPaymentManually(
      id,
      { adminId: actor.id, adminName: actor.fullName },
      { transactionId: dto.transactionId, note: dto.note },
    );
  }
}
