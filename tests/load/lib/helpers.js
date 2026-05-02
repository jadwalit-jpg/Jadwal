// Shared helpers for the k6 load suite.
//
// All scripts read config from environment so a misconfigured run can never
// accidentally hammer production. There is no fallback to localhost — a
// missing BASE_URL aborts the run before any HTTP call is made.

import http from 'k6/http';
import { check, fail } from 'k6';

export function requireEnv(name) {
  const v = __ENV[name];
  if (!v || v.trim() === '') {
    fail(`[FATAL] ${name} env var is required but missing — refusing to run.`);
  }
  return v;
}

export function baseUrl() {
  return requireEnv('BASE_URL').replace(/\/+$/, '');
}

// Production guard — k6 has no business creating bookings against jadwal.qa
// without an explicit opt-in. catalog-browse is read-only and safe; booking
// scripts default to refusing prod and require K6_ALLOW_PROD=true to override.
//
// The opt-in exists for the launch-QA window only: SES + PAY2M are still
// behind feature flags, so a test booking writes a Booking row without
// emailing or charging anything. A pre-launch DELETE on bookings owned by
// the test customer cleans up. See tests/load/README.md for the runbook.
export function refuseProductionForWrites() {
  const url = baseUrl();
  const looksProd = /jadwal\.qa(?!\.staging)/.test(url) && !/staging|dev/i.test(url);
  if (!looksProd) return;
  if (__ENV.K6_ALLOW_PROD === 'true') {
    console.warn(
      `[K6_ALLOW_PROD] Running write-path script against ${url}. ` +
        `This writes real DB rows owned by TEST_USER_EMAIL. Clean up after the run.`,
    );
    return;
  }
  fail(
    `[FATAL] write-path script pointed at production URL: ${url}. ` +
      `If this is the launch QA window, set K6_ALLOW_PROD=true and confirm ` +
      `SES + PAY2M are NOT yet live (so test bookings don't email or charge).`,
  );
}

// Login helper — exchanges email/password for the auth cookies the API
// issues (HttpOnly access + refresh). k6's CookieJar persists cookies across
// requests in the same VU iteration, so subsequent calls authenticate
// transparently.
export function login(email, password) {
  const url = `${baseUrl()}/api/auth/login`;
  const res = http.post(url, JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'auth/login' },
  });
  const ok = check(res, {
    'login: 200': (r) => r.status === 200,
    'login: sets cookie': (r) => Object.keys(r.cookies || {}).length > 0,
  });
  if (!ok) {
    fail(`Login failed (${res.status}). Body: ${res.body?.toString().slice(0, 200)}`);
  }
  return res;
}

// Idempotency-key generator. Booking endpoints scope the key by customerId
// server-side so we don't need uniqueness across users — only across retry
// attempts on the same key. Use a fresh UUID per booking attempt.
export function idempotencyKey() {
  // crypto.randomUUID isn't available in k6's runtime; emulate v4.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
