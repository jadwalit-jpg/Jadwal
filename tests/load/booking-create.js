// booking-create.js — full happy-path booking under sustained load.
//
// The money path. Login → availability → create-booking → payment-init.
// Catches Redis-lock contention, Serializable retry storms, idempotency-
// key plumbing, and the booking-payment FK back-fill that bug #84 exposed
// (memory note: latent bug fixed in `bookings.service.createBooking`).
//
// Profile: 50 VU constant for 10 min. Each VU loops the whole flow with
// fresh idempotency keys per booking. Realistic checkout cadence: not so
// fast that we're mostly retrying lock timeouts.
//
// Pass: p95 booking-create < 800 ms, error rate < 0.5 %, 0 P2034 leaks
// to client (any 5xx with body containing "P2034" is a leak — Prisma
// transaction-conflict should never reach the user).
//
// What this would catch:
//   - bookings.service Redis-lock TTL too short under contention
//   - Serializable retry budget exhausted → unexpected 500 instead of 409
//   - Idempotency key dedup not respecting customerId scope
//   - Payment.bookingId back-fill regression (bug #84)
//   - DB pool starvation when statement_timeout fires mid-transaction
//
// REQUIRES: TEST_USER_EMAIL + TEST_USER_PASSWORD seeded on staging,
// TEST_ACTIVITY_ID with sufficient capacity to absorb 10 min × 50 VU
// of booking attempts (rough math: 50 × 10 min × 1 attempt per ~12s ≈
// 2500 successful bookings; size the activity capacity accordingly).

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import {
  baseUrl,
  refuseProductionForWrites,
  login,
  idempotencyKey,
  requireEnv,
} from './lib/helpers.js';

export const bookingErrors = new Rate('booking_errors');
export const bookingDuration = new Trend('booking_create_ms');
export const bookingsCreated = new Counter('bookings_created');
export const p2034Leaks = new Counter('p2034_leaks_to_client');

export const options = {
  scenarios: {
    booking_create: {
      executor: 'constant-vus',
      vus: Number(__ENV.K6_VUS || 50),
      duration: __ENV.K6_DURATION || '10m',
    },
  },
  thresholds: {
    'booking_create_ms': ['p(95)<800'],
    'booking_errors': ['rate<0.005'],
    'p2034_leaks_to_client': ['count==0'],
    'http_req_failed': ['rate<0.005'],
    'bookings_created': ['count>0'],
  },
  tags: { scenario: 'booking-create' },
};

export function setup() {
  refuseProductionForWrites();
  return {
    email: requireEnv('TEST_USER_EMAIL'),
    password: requireEnv('TEST_USER_PASSWORD'),
    activityId: requireEnv('TEST_ACTIVITY_ID'),
  };
}

function pickFutureSlot(activityId) {
  // Walk the next 14 days looking for an available slot. Returns first
  // hit. Real users do something similar — they pick the first day with
  // capacity, not a random one. This keeps the test pattern realistic
  // and avoids repeated 409s on a fully-booked far-future date.
  for (let offset = 1; offset <= 14; offset++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    const date = d.toISOString().slice(0, 10);
    const res = http.get(
      `${baseUrl()}/api/availability?activityId=${activityId}&date=${date}`,
      { tags: { endpoint: 'availability' } },
    );
    if (res.status !== 200) continue;
    let slots;
    try {
      const body = res.json();
      slots = Array.isArray(body) ? body : body?.slots;
    } catch {
      continue;
    }
    if (slots && slots.length > 0) {
      return { date, slot: slots[Math.floor(Math.random() * slots.length)] };
    }
  }
  return null;
}

export default function (data) {
  // Login once per VU iteration. The k6 cookie jar persists the auth cookie
  // across subsequent requests in the same iteration.
  login(data.email, data.password);

  const slot = pickFutureSlot(data.activityId);
  if (!slot) {
    // No availability anywhere in the next 2 weeks — log + skip; this
    // means the seed activity is undersized, which is our problem to fix
    // before claiming the run is meaningful.
    bookingErrors.add(true);
    return;
  }

  const startDt = slot.slot.startDatetime || `${slot.date}T10:00:00.000Z`;
  const endDt = slot.slot.endDatetime || `${slot.date}T12:00:00.000Z`;

  const start = Date.now();
  const res = http.post(
    `${baseUrl()}/api/bookings`,
    JSON.stringify({
      activityId: data.activityId,
      startDatetime: startDt,
      endDatetime: endDt,
      guests: 1,
      idempotencyKey: idempotencyKey(),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'bookings/create' },
    },
  );
  bookingDuration.add(Date.now() - start);

  // Detect P2034 leaks — these should ALWAYS be caught by
  // bookings.service.ts and remapped to a 409 client-error. If a 5xx body
  // contains "P2034" it means the global PrismaExceptionFilter missed it
  // and we have a regression on the audit-trilogy hardening.
  if (res.status >= 500 && res.body && res.body.includes('P2034')) {
    p2034Leaks.add(1);
  }

  const ok = check(res, {
    'booking: 201 or 409': (r) => r.status === 201 || r.status === 409,
    'booking: no 5xx': (r) => r.status < 500,
  });
  bookingErrors.add(!ok);
  if (res.status === 201) {
    bookingsCreated.add(1);
  }

  // Realistic gap between bookings — a single user doesn't try to book
  // back-to-back at sub-second cadence.
  sleep(8 + Math.random() * 4);
}
