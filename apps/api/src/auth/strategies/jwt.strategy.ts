import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { TokenPayload } from '../interfaces/token-payload.interface';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
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

    return { id: payload.sub, email: payload.email, role: payload.role, fullName: user.fullName };
  }
}
