import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * JWT-based authentication guard.
 *
 * Registered globally via `APP_GUARD` in `app.module.ts` — every endpoint
 * runs through this guard by default. Endpoints that should remain
 * publicly accessible opt out by carrying `@Public()` on the handler or
 * the controller class.
 *
 * Existing per-controller `@UseGuards(JwtAuthGuard)` declarations are
 * preserved (belt-and-suspenders) so a future regression that
 * un-registers the global guard cannot silently make every authenticated
 * endpoint public.
 *
 * Underlying strategy: `jwt` (see `auth/strategies/jwt.strategy.ts`),
 * which validates the cookie-extracted token and re-checks the user still
 * exists, is not deactivated, and is not soft-deleted on every request.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    // `getAllAndOverride` lets a method-level `@Public()` win over a
    // class-level decorator if both are set, and a class-level `@Public()`
    // covers every method in the controller. Either form skips auth.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
