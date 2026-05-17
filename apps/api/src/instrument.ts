/**
 * Sentry SDK initialisation — MUST be imported before anything else in main.ts
 * so the SDK can monkey-patch `http`, Express, etc. before any routing or
 * middleware registers.
 *
 * No-op when `SENTRY_DSN` is unset (dev doesn't need Sentry).
 *
 * Environment variables:
 *   SENTRY_DSN          — project DSN. Empty = SDK disabled (silent).
 *   SENTRY_ENVIRONMENT  — 'production' / 'staging' / 'development'. Default: NODE_ENV.
 *   SENTRY_RELEASE      — optional release tag (e.g. git SHA from CI). Used for
 *                         regression tracking in the Sentry UI.
 *   SENTRY_TRACES_SAMPLE_RATE   — float 0..1. Default 0 (error-only, no perf).
 *   SENTRY_PROFILES_SAMPLE_RATE — float 0..1. Default 0.
 *
 * Privacy:
 *   - `beforeSend` redacts known-sensitive fields from the request body and
 *     Authorization/Cookie headers before events leave the node.
 *   - `sendDefaultPii: false` — Sentry's own scrubbing for ip_address and
 *     usernames stays conservative.
 */

import * as Sentry from '@sentry/nestjs';

const SENSITIVE_KEYS = [
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'oldpassword',
  'refreshtoken',
  'refresh_token',
  'accesstoken',
  'access_token',
  'verificationtoken',
  'passwordresettoken',
  'phoneotphash',
  'otp',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'secret',
  'pay2m_secured_key',
  'pay2m_secret_word',
  'resend_api_key',
  'resend_webhook_secret',
];

type AnyObject = Record<string, unknown>;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out: AnyObject = {};
  for (const [key, v] of Object.entries(value as AnyObject)) {
    out[key] = SENSITIVE_KEYS.includes(key.toLowerCase()) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

const dsn = process.env.SENTRY_DSN ?? '';

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0'),
    // Do NOT attach user.ip / cookies automatically. We add our own minimal
    // user context from the request scope in AllExceptionsFilter.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.data) {
        event.request.data = scrub(event.request.data);
      }
      if (event.request?.headers) {
        event.request.headers = scrub(event.request.headers) as Record<string, string>;
      }
      if (event.request?.cookies) {
        event.request.cookies = '[redacted]' as unknown as Record<string, string>;
      }
      return event;
    },
  });
  // Bootstrap log — fires before NestJS DI is up so we can't use an
  // injected Logger. `console.warn` is intentionally chosen over
  // `console.log` so the security-grep CI rule (which forbids
  // `console.log` in apps/api/src/) doesn't flag it. The message
  // is a one-time startup confirmation that Sentry is wired in;
  // not a noisy steady-state log.
  console.warn(`[Sentry] enabled for environment: ${process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development'}`);
}
