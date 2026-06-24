import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAcceptedCurrentTerms } from '../../common/terms';

/**
 * Server-side enforcement of Terms acceptance — the anti-bypass behind the
 * post-login consent gate. A frontend gate alone is bypassable (a user could
 * decline/close it and call the API directly), so the contract-forming /
 * money-moving actions verify consent here too: booking create, payment
 * initiate, and vendor listing create reject with 403 (`TERMS_NOT_ACCEPTED`)
 * until the user has accepted the current TERMS_VERSION.
 *
 * MUST be combined with JwtAuthGuard, which runs first and populates `req.user`
 * (controller-level JwtAuthGuard runs before this route-level guard). Read-only
 * browsing is intentionally NOT gated — it forms no contract and is public
 * regardless.
 */
@Injectable()
export class TermsAcceptedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.id;
    // JwtAuthGuard should have authenticated already; fail closed if not.
    if (!userId) throw new ForbiddenException('TERMS_NOT_ACCEPTED');

    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { termsAcceptedAt: true, termsAcceptedVersion: true },
    });
    if (!hasAcceptedCurrentTerms(user)) {
      throw new ForbiddenException('TERMS_NOT_ACCEPTED');
    }
    return true;
  }
}
