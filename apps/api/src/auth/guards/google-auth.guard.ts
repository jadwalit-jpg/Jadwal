import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';

/** Validates a callbackUrl is a safe relative path — blocks open redirect attacks. */
function sanitizeCallbackUrl(raw: string | undefined): string {
  if (!raw) return '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return '/';
  }
  // Must be a pure relative path:
  //   - starts with exactly one '/'
  //   - not '//evil.com' (protocol-relative → cross-origin)
  //   - not '/\evil.com' (some browsers normalize '\' → '/', bypasses '//' check)
  //   - no protocol colon anywhere
  //   - no embedded backslash (defence in depth)
  if (
    !decoded.startsWith('/') ||
    decoded.startsWith('//') ||
    decoded.startsWith('/\\') ||
    decoded.includes(':') ||
    decoded.includes('\\')
  ) {
    return '/';
  }
  return decoded;
}

/**
 * Custom Google OAuth guard that embeds the post-login callbackUrl into
 * the OAuth `state` parameter so it survives the Google redirect round-trip.
 *
 * Usage on initiation:   @UseGuards(GoogleAuthGuard)
 * Usage on callback:     @UseGuards(GoogleAuthGuard)
 * Read state in callback: req.query.state → decode base64 JSON → { callbackUrl }
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  override getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const callbackUrl = sanitizeCallbackUrl(req.query.callbackUrl as string | undefined);
    const state = Buffer.from(JSON.stringify({ callbackUrl })).toString('base64url');
    return { scope: ['email', 'profile'], state };
  }
}
