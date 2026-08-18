import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { TokenPayload } from '../interfaces/token-payload.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionDenylistService } from '../../redis/session-denylist.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
    private sessionDenylist: SessionDenylistService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('FATAL: JWT_SECRET environment variable is not set.');
    }
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          return request?.cookies?.Authentication;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: TokenPayload) {
    // M5/M6 — session-family denylist. On logout / stolen-token-reuse /
    // password rotation, AuthService puts the session's family id on a short
    // Redis denylist (TTL = access-token lifetime + slack). Reject any still-
    // unexpired access token whose `sid` is denylisted — this is what makes
    // logout revoke the ACCESS token immediately, not just the refresh token.
    // FAIL-OPEN (handled inside the service): if Redis is unreachable we do NOT
    // lock everyone out — the ≤JWT_EXPIRATION natural expiry still bounds
    // exposure; availability wins over the short denylist window. Tokens minted
    // before this rollout have no `sid` and simply skip the check (backward-
    // compatible).
    if (payload.sid && (await this.sessionDenylist.isDenied(payload.sid))) {
      throw new UnauthorizedException('Session expired — please log in again');
    }

    // §B9 — soft-deleted users have `deletedAt` set + `isDeactivated=true`.
    // Either guard rejects a stale token from before the delete; checking
    // both is defence in depth so a future bug toggling isDeactivated
    // back to false on a soft-deleted row can't silently re-grant access.
    const user = await this.prisma.client.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isDeactivated: true, deletedAt: true, role: true, fullName: true },
    });

    if (!user || user.isDeactivated || user.deletedAt) {
      // Match the refresh-flow wording so an expired access token, a
      // deleted user, and a deactivated user all produce the same client
      // message. Server logs retain the actual reason.
      throw new UnauthorizedException('Session expired — please log in again');
    }

    // Use the DB role, NOT payload.role. The access token is stateless, so if an
    // admin demotes a user, the old role lives in every already-issued token until
    // it expires. We already fetched the current role above — trust it, so a
    // demotion takes effect on the very next request instead of ≤JWT_EXPIRATION
    // later. (admin.service.ts deletes refresh tokens on demotion, which stops
    // RENEWAL but cannot revoke a still-valid access token — this closes that gap.)
    return { id: payload.sub, email: payload.email, role: user.role, fullName: user.fullName };
  }
}
