/**
 * Centralized rate limit configuration — ALL values from env vars.
 * Controllers import these instead of hardcoding numbers in @Throttle() decorators.
 *
 * Usage: @Throttle(RATE_LIMIT.AUTH_STRICT)
 *
 * To adjust limits without code deploy, change the env var and restart.
 */

const ttl = () => Number(process.env.THROTTLE_SHORT_TTL || 60000);

// When THROTTLE_ENABLED=false (or unset to false), bypass per-route limits by
// returning an effectively-unlimited value. Per-endpoint @Throttle decorators
// would otherwise override the relaxed global throttler from app.module.ts and
// re-impose the production limit on this route. Production should set
// THROTTLE_ENABLED=true and the per-tier limits.
const disabled = process.env.THROTTLE_ENABLED === 'false';
const limit = (envValue: string | undefined, prodDefault: number) =>
  disabled ? 100000 : Number(envValue || prodDefault);

/** 1/min — extremely rare operations (admin cleanup cron) */
export const RATE_LIMIT_MINIMAL = { short: { ttl: ttl(), limit: limit(process.env.THROTTLE_MINIMAL_LIMIT, 1) } };

/** 3/min — high-risk mutations (resend verification, password change, bulk delete) */
export const RATE_LIMIT_STRICT = { short: { ttl: ttl(), limit: limit(process.env.THROTTLE_STRICT_LIMIT, 3) } };

/** 5/min — auth mutations, payment initiate, delete operations */
export const RATE_LIMIT_AUTH = { short: { ttl: ttl(), limit: limit(process.env.THROTTLE_AUTH_LIMIT, 5) } };

/** 10/min — standard CRUD write operations */
export const RATE_LIMIT_WRITE = { short: { ttl: ttl(), limit: limit(process.env.THROTTLE_WRITE_LIMIT, 10) } };

/** 15/min — frequent reads (session list, payment status) */
export const RATE_LIMIT_READ = { short: { ttl: ttl(), limit: limit(process.env.THROTTLE_READ_LIMIT, 15) } };

/** 20/min — callbacks, uploads, payout management */
export const RATE_LIMIT_CALLBACK = { short: { ttl: ttl(), limit: limit(process.env.THROTTLE_CALLBACK_LIMIT, 20) } };

/** 30/min — customer interactions (likes, reviews, /me) */
export const RATE_LIMIT_INTERACTION = { short: { ttl: ttl(), limit: limit(process.env.THROTTLE_INTERACTION_LIMIT, 30) } };

/** 60/min — vendor/catalog reads */
export const RATE_LIMIT_VENDOR = { short: { ttl: ttl(), limit: limit(process.env.THROTTLE_VENDOR_LIMIT, 60) } };

/** 120/min — admin reads (generous for dashboard) */
export const RATE_LIMIT_ADMIN = { short: { ttl: ttl(), limit: limit(process.env.THROTTLE_ADMIN_LIMIT, 120) } };

/**
 * 300/min — PAY2M server-to-server IPN ONLY.
 * EVERY IPN arrives from a SINGLE source IP (PAY2M's server), so on the shared
 * CALLBACK tier (20/min) they all key to ONE bucket platform-wide — above 20
 * confirmations/min legitimate IPNs get 429, and the IPN is the ONLY thing that
 * confirms a NAPS booking → charged-but-not-booked at volume. This route does not
 * need per-IP abuse protection from the throttler: it is gated by the source-IP
 * allow-list (isTrustedIpnSource, fail-closed), hash/idempotency in
 * handleCallback, and a body-size cap (NoFilesInterceptor). The generous ceiling
 * still bounds a compute-DoS while never throttling real PAY2M volume.
 */
export const RATE_LIMIT_IPN = { short: { ttl: ttl(), limit: limit(process.env.THROTTLE_IPN_LIMIT, 300) } };

/**
 * 120/min — the readiness probe (`/api/health/ready`), which does a real DB +
 * Redis check. It was `@SkipThrottle()`, so an unauthenticated flood could open
 * a Prisma connection per request and exhaust the pool (20/task vs ~112 RDS) →
 * self-inflicted outage. This caps a SINGLE-IP flood while leaving enormous
 * headroom over the ALB probe: with the hard ≤4-task ceiling and a 30 s probe
 * interval the ALB does ~8 checks/min (all keyed to the ALB's own IP), so it can
 * never trip 120/min. A DISTRIBUTED flood still needs the Cloudflare edge
 * rate-limit rule on `/api/health*` (infra) — this is the in-code half.
 */
export const RATE_LIMIT_HEALTH = { short: { ttl: ttl(), limit: limit(process.env.THROTTLE_HEALTH_LIMIT, 120) } };
