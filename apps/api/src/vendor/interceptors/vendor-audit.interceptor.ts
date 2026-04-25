import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Automatically logs every vendor mutation (POST, PATCH, DELETE) to the audit_logs table.
 * Same pattern as AdminAuditInterceptor but with actorType = VENDOR.
 */
@Injectable()
export class VendorAuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method: string = req.method;

    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          this.logAction(req, method, null).catch(() => {});
        },
        error: (err) => {
          this.logAction(req, method, err?.message || 'Unknown error').catch(() => {});
        },
      }),
    );
  }

  private async logAction(req: any, method: string, error: string | null) {
    const user = req.user;
    if (!user) return;

    const route = req.route?.path || req.url;
    const entityId = req.params?.id || req.params?.activitySlug;
    const action = this.resolveAction(method, route);
    const entity = this.resolveEntity(route);

    const safeBody = this.sanitizeBody(req.body);
    const details = error
      ? `FAILED: ${error} | ${JSON.stringify(safeBody)}`
      : JSON.stringify(safeBody);

    await this.prisma.client.auditLog.create({
      data: {
        actorType: 'VENDOR',
        actorId: user.id,
        actorName: user.vendor?.businessNameEn || user.fullName || `user:${user.id.slice(0, 8)}`,
        action,
        entity,
        entityId: entityId || undefined,
        details: details.slice(0, 1000),
      },
    });
  }

  private resolveAction(method: string, route: string): string {
    const routeMap: Record<string, string> = {
      'POST:/vendor/activities': 'CREATE_ACTIVITY',
      'PATCH:/vendor/activities/:id': 'UPDATE_ACTIVITY',
      'DELETE:/vendor/activities/:id': 'DELETE_ACTIVITY',
      'PATCH:/vendor/activities/:id/toggle': 'TOGGLE_ACTIVITY_STATUS',
      'PATCH:/vendor/bookings/:id/status': 'UPDATE_BOOKING_STATUS',
      'PATCH:/vendor/reviews/:id/reply': 'REPLY_TO_REVIEW',
      'PATCH:/vendor/settings': 'UPDATE_VENDOR_SETTINGS',
      'PATCH:/vendor/settings/password': 'CHANGE_VENDOR_PASSWORD',
      'POST:/vendor/coupons': 'CREATE_COUPON',
      'POST:/vendor/upload-image': 'UPLOAD_IMAGE',
      'POST:/vendor/payout-requests': 'REQUEST_PAYOUT',
      'DELETE:/vendor/payout-requests/:id': 'CLEAR_REJECTED_PAYOUT_REQUEST',
    };

    const cleanRoute = route.replace(/^\/api/, '');
    const key = `${method}:${cleanRoute}`;
    return routeMap[key] || `${method}_${cleanRoute.replace(/\//g, '_').toUpperCase()}`;
  }

  private resolveEntity(route: string): string {
    if (route.includes('/activities')) return 'Activity';
    if (route.includes('/bookings')) return 'Booking';
    if (route.includes('/reviews')) return 'Review';
    if (route.includes('/coupons')) return 'Coupon';
    if (route.includes('/settings')) return 'VendorSettings';
    if (route.includes('/upload')) return 'Upload';
    if (route.includes('/payout-requests')) return 'PayoutRequest';
    return 'Unknown';
  }

  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') return body;

    const redactKeys = [
      'password', 'currentPassword', 'newPassword', 'confirmPassword',
      'token', 'refreshToken', 'accessToken', 'secret', 'apiKey',
      'email', 'phone', 'fullName', 'cardNumber', 'bankAccount', 'bankDetails', 'iban', 'otp', 'code',
    ];
    const imageKeys = ['image', 'coverImage', 'gallery', 'profilePicture'];

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(body)) {
      if (redactKeys.includes(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (imageKeys.includes(key)) {
        sanitized[key] = Array.isArray(value) ? `[${value.length} images]` : '[image]';
      } else if (typeof value === 'string' && value.startsWith('data:image')) {
        sanitized[key] = '[base64 image]';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
