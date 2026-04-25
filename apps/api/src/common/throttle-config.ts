/**
 * Centralized rate limit configuration — ALL values from env vars.
 * Controllers import these instead of hardcoding numbers in @Throttle() decorators.
 *
 * Usage: @Throttle(RATE_LIMIT.AUTH_STRICT)
 *
 * To adjust limits without code deploy, change the env var and restart.
 */

const ttl = () => Number(process.env.THROTTLE_SHORT_TTL || 60000);

/** 1/min — extremely rare operations (admin cleanup cron) */
export const RATE_LIMIT_MINIMAL = { short: { ttl: ttl(), limit: Number(process.env.THROTTLE_MINIMAL_LIMIT || 1) } };

/** 3/min — high-risk mutations (resend verification, password change, bulk delete) */
export const RATE_LIMIT_STRICT = { short: { ttl: ttl(), limit: Number(process.env.THROTTLE_STRICT_LIMIT || 3) } };

/** 5/min — auth mutations, payment initiate, delete operations */
export const RATE_LIMIT_AUTH = { short: { ttl: ttl(), limit: Number(process.env.THROTTLE_AUTH_LIMIT || 5) } };

/** 10/min — standard CRUD write operations */
export const RATE_LIMIT_WRITE = { short: { ttl: ttl(), limit: Number(process.env.THROTTLE_WRITE_LIMIT || 10) } };

/** 15/min — frequent reads (session list, payment status) */
export const RATE_LIMIT_READ = { short: { ttl: ttl(), limit: Number(process.env.THROTTLE_READ_LIMIT || 15) } };

/** 20/min — callbacks, uploads, payout management */
export const RATE_LIMIT_CALLBACK = { short: { ttl: ttl(), limit: Number(process.env.THROTTLE_CALLBACK_LIMIT || 20) } };

/** 30/min — customer interactions (likes, reviews, /me) */
export const RATE_LIMIT_INTERACTION = { short: { ttl: ttl(), limit: Number(process.env.THROTTLE_INTERACTION_LIMIT || 30) } };

/** 60/min — vendor/catalog reads */
export const RATE_LIMIT_VENDOR = { short: { ttl: ttl(), limit: Number(process.env.THROTTLE_VENDOR_LIMIT || 60) } };

/** 120/min — admin reads (generous for dashboard) */
export const RATE_LIMIT_ADMIN = { short: { ttl: ttl(), limit: Number(process.env.THROTTLE_ADMIN_LIMIT || 120) } };
