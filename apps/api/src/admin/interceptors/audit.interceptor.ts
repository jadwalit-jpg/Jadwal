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
 * Automatically logs every admin mutation (POST, PATCH, DELETE) to the audit_logs table.
 * Applied at the controller level — no need to add logging to each method individually.
 *
 * Maps route patterns to human-readable action names.
 * Strips sensitive fields (password, token) from logged details.
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method: string = req.method;

    // Only log mutations — skip reads
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          // Log after successful execution (fire-and-forget)
          this.logAction(req, method, null).catch(() => {});
        },
        error: (err) => {
          // Also log failed mutations (helps detect abuse)
          this.logAction(req, method, err?.message || 'Unknown error').catch(() => {});
        },
      }),
    );
  }

  private async logAction(req: any, method: string, error: string | null) {
    const user = req.user;
    if (!user) return; // Guard didn't pass — nothing to log

    const route = req.route?.path || req.url;
    const entityId = req.params?.id;
    const action = this.resolveAction(method, route);
    const entity = this.resolveEntity(route);

    // Sanitize request body — never log passwords, tokens, or secrets
    const safeBody = this.sanitizeBody(req.body);
    const details = error
      ? `FAILED: ${error} | ${JSON.stringify(safeBody)}`
      : JSON.stringify(safeBody);

    await this.prisma.client.auditLog.create({
      data: {
        actorType: 'ADMIN',
        actorId: user.id,
        actorName: user.fullName || `user:${user.id.slice(0, 8)}`,
        action,
        entity,
        entityId: entityId || undefined,
        details: details.slice(0, 1000),
      },
    });
  }

  /** Map HTTP method + route to a human-readable action */
  private resolveAction(method: string, route: string): string {
    const routeMap: Record<string, string> = {
      // Vendors
      'PATCH:/admin/vendors/:id/status': 'UPDATE_VENDOR_STATUS',
      'PATCH:/admin/vendors/:id/trust': 'UPDATE_VENDOR_TRUST',
      'PATCH:/admin/vendors/:id/commission': 'UPDATE_VENDOR_COMMISSION',
      'DELETE:/admin/vendors/:id': 'DELETE_VENDOR',
      // Activities
      'PATCH:/admin/activities/:id/status': 'UPDATE_ACTIVITY_STATUS',
      'PATCH:/admin/activities/:id/feature': 'TOGGLE_ACTIVITY_FEATURED',
      'PATCH:/admin/activities/:id': 'UPDATE_ACTIVITY',
      // Users
      'PATCH:/admin/users/:id/role': 'UPDATE_USER_ROLE',
      'PATCH:/admin/users/:id/deactivate': 'TOGGLE_USER_ACTIVE',
      'DELETE:/admin/users/:id': 'DELETE_USER',
      // Bookings
      'PATCH:/admin/bookings/:id/status': 'UPDATE_BOOKING_STATUS',
      // Countries, Cities, Categories
      'POST:/admin/settings/countries': 'CREATE_COUNTRY',
      'PATCH:/admin/settings/countries/:id': 'UPDATE_COUNTRY',
      'DELETE:/admin/settings/countries/:id': 'DELETE_COUNTRY',
      'POST:/admin/settings/cities': 'CREATE_CITY',
      'PATCH:/admin/settings/cities/:id': 'UPDATE_CITY',
      'DELETE:/admin/settings/cities/:id': 'DELETE_CITY',
      'POST:/admin/settings/categories': 'CREATE_CATEGORY',
      'PATCH:/admin/settings/categories/:id': 'UPDATE_CATEGORY',
      'DELETE:/admin/settings/categories/:id': 'DELETE_CATEGORY',
      // Coupons
      'POST:/admin/coupons': 'CREATE_COUPON',
      'PATCH:/admin/coupons/:id/status': 'UPDATE_COUPON_STATUS',
      'DELETE:/admin/coupons/:id': 'DELETE_COUPON',
      // Settings
      'PATCH:/admin/settings/commission': 'UPDATE_COMMISSION',
      'PATCH:/admin/settings/platform': 'UPDATE_PLATFORM_SETTINGS',
      // Trending
      'POST:/admin/settings/trending': 'CREATE_TRENDING',
      'PATCH:/admin/settings/trending/:id': 'UPDATE_TRENDING',
      'DELETE:/admin/settings/trending/:id': 'DELETE_TRENDING',
      // Reviews
      'DELETE:/admin/reviews/:id': 'DELETE_REVIEW',
      // Payouts
      'POST:/admin/payouts/mark-paid': 'MARK_PAYOUT_PAID',
      'POST:/admin/payouts/mark-unpaid': 'REVERT_PAYOUT_TO_UNPAID',
      'PATCH:/admin/payout-requests/:id': 'PROCESS_PAYOUT_REQUEST',
      'POST:/admin/payout-requests/:id/revert': 'REVERT_PAYOUT_REQUEST',
      // Bulk
      'POST:/admin/bulk/vendors/status': 'BULK_UPDATE_VENDOR_STATUS',
      'POST:/admin/bulk/activities/status': 'BULK_UPDATE_ACTIVITY_STATUS',
      'POST:/admin/bulk/users/delete': 'BULK_DELETE_USERS',
      // Profile
      'PATCH:/admin/profile': 'UPDATE_ADMIN_PROFILE',
      'PATCH:/admin/profile/password': 'CHANGE_ADMIN_PASSWORD',
      // Loyalty (WANASA)
      'PATCH:/admin/loyalty/config': 'UPDATE_LOYALTY_CONFIG',
      'PATCH:/admin/loyalty/users/:id/points': 'ADJUST_USER_POINTS',
      // System
      'POST:/admin/system/cleanup': 'MANUAL_CLEANUP',
      // Upload
      'POST:/admin/upload-category-image': 'UPLOAD_CATEGORY_IMAGE',
    };

    // Strip global prefix (/api) before lookup
    const cleanRoute = route.replace(/^\/api/, '');
    const key = `${method}:${cleanRoute}`;
    return routeMap[key] || `${method}_${cleanRoute.replace(/\//g, '_').toUpperCase()}`;
  }

  /** Extract entity name from route */
  private resolveEntity(route: string): string {
    if (route.includes('/vendors')) return 'Vendor';
    if (route.includes('/activities')) return 'Activity';
    if (route.includes('/users')) return 'User';
    if (route.includes('/bookings')) return 'Booking';
    if (route.includes('/countries')) return 'Country';
    if (route.includes('/cities')) return 'City';
    if (route.includes('/categories')) return 'Category';
    if (route.includes('/coupons')) return 'Coupon';
    if (route.includes('/trending')) return 'TrendingEvent';
    if (route.includes('/reviews')) return 'Review';
    if (route.includes('/payout-requests')) return 'PayoutRequest';
    if (route.includes('/payouts')) return 'Payout';
    if (route.includes('/commission')) return 'Commission';
    if (route.includes('/platform')) return 'PlatformSettings';
    if (route.includes('/loyalty')) return 'Loyalty';
    if (route.includes('/profile')) return 'AdminProfile';
    if (route.includes('/cleanup')) return 'System';
    return 'Unknown';
  }

  /** Remove sensitive fields from request body before logging */
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
