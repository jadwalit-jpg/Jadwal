import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import * as crypto from 'crypto';

// Short-lived cookie carrying the anti-CSRF nonce across the Google round-trip.
// MUST be SameSite=Lax (not Strict like the session cookies) so it survives
// Google's top-level redirect back to our callback. Scoped to the OAuth path.
export const OAUTH_STATE_COOKIE = 'g_oauth_state';
export const OAUTH_STATE_COOKIE_PATH = '/api/auth/google';

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

    // Callback leg (Google redirected back with ?code): Passport processes the
    // code and the controller verifies the nonce — don't mint a new one here.
    if (req.query.code) {
      return { scope: ['email', 'profile'] };
    }

    // Initiation leg: embed callbackUrl + a fresh anti-CSRF nonce in `state`,
    // and drop the nonce in a Lax cookie. The callback rejects the login unless
    // the returned state.nonce matches this cookie — binding the flow to the
    // browser that started it (defeats login-CSRF / forced-login).
    const callbackUrl = sanitizeCallbackUrl(req.query.callbackUrl as string | undefined);
    const nonce = crypto.randomBytes(16).toString('hex');
    context.switchToHttp().getResponse<Response>().cookie(OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: OAUTH_STATE_COOKIE_PATH,
      maxAge: 10 * 60 * 1000,
    });
    const state = Buffer.from(JSON.stringify({ callbackUrl, nonce })).toString('base64url');
    return { scope: ['email', 'profile'], state };
  }
}
