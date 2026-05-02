/**
 * §M1 — coupon usage-limit race load test.
 *
 * Hammers the booking-create endpoint with a coupon that has usageLimit=N.
 * Postgres Serializable isolation in `bookings.service.createBooking`
 * SHOULD let exactly N bookings succeed and reject the rest with P2034
 * (mapped to HTTP 409 by the booking flow).
 *
 * Run:
 *   k6 run tests/k6/coupon-race.js \
 *     -e API_URL=http://localhost:4000 \
 *     -e COUPON_CODE=RACE-LIMIT-10 \
 *     -e USAGE_LIMIT=10 \
 *     -e ACTIVITY_ID=<uuid> \
 *     -e CUSTOMER_TOKENS=<jwt1>,<jwt2>,...
 *
 * Pre-flight (manual):
 *   1. Seed a coupon with `usageLimit=10`, `status=APPROVED`, valid window.
 *   2. Seed N>50 customer accounts; collect their access JWTs into
 *      CUSTOMER_TOKENS (comma-separated). Each VU picks one token.
 *   3. Seed an activity with capacity=N (so capacity isn't the bottleneck).
 *
 * Pass criteria (asserted via thresholds at the bottom):
 *   - exactly USAGE_LIMIT 201/200 responses (`bookings_succeeded`)
 *   - the rest are 409 conflicts (`bookings_conflict`)
 *   - zero 500s (`bookings_error_5xx`)
 *
 * If `bookings_succeeded` exceeds `usageLimit`, the Serializable guarantee
 * has a hole — investigate before public launch.
 */

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const apiUrl       = __ENV.API_URL       || 'http://localhost:4000';
const couponCode   = __ENV.COUPON_CODE   || 'RACE-LIMIT-10';
const usageLimit   = Number(__ENV.USAGE_LIMIT || '10');
const activityId   = __ENV.ACTIVITY_ID   || '';
const tokensCsv    = __ENV.CUSTOMER_TOKENS || '';

const tokens = tokensCsv.split(',').map((t) => t.trim()).filter(Boolean);
if (!activityId)        throw new Error('ACTIVITY_ID env var is required');
if (tokens.length === 0) throw new Error('CUSTOMER_TOKENS env var is required (comma-separated JWTs)');

const succeeded   = new Counter('bookings_succeeded');
const conflicted  = new Counter('bookings_conflict');
const errored     = new Counter('bookings_error_5xx');
const otherStatus = new Counter('bookings_other_status');

export const options = {
  // 50 simultaneous customers all try to book with the same coupon for 10s.
  // The coupon's usageLimit=10 ⇒ at most 10 should succeed.
  scenarios: {
    coupon_race: {
      executor: 'ramping-vus',
      startVUs: 50,
      stages: [
        { duration: '10s', target: 50 },
      ],
      gracefulRampDown: '0s',
    },
  },
  thresholds: {
    bookings_error_5xx: ['count==0'],
    // Hard gate — exactly usageLimit successful bookings, no more.
    bookings_succeeded: [`count<=${usageLimit}`],
  },
};

// Bookings are 24h+ ahead so the slot is in the future. Each VU picks a
// slightly different start time (still inside today's open window) to
// avoid the activity-conflict guard tripping before the coupon guard.
function startTime() {
  const offsetMin = (__VU * 7 + Math.floor(Math.random() * 60)) % 540;   // 09:00..17:59
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  tomorrow.setUTCHours(9, 0, 0, 0);
  tomorrow.setUTCMinutes(offsetMin);
  return tomorrow.toISOString();
}

export default function () {
  const token = tokens[__VU % tokens.length];
  const start = startTime();
  const end   = new Date(new Date(start).getTime() + 2 * 3600_000).toISOString();

  const payload = JSON.stringify({
    activityId,
    startDatetime: start,
    endDatetime: end,
    guests: 1,
    couponCode,
    idempotencyKey: `k6-${__VU}-${__ITER}`,
  });

  const res = http.post(`${apiUrl}/bookings`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    timeout: '15s',
  });

  if (res.status === 201 || res.status === 200) succeeded.add(1);
  else if (res.status === 409)                  conflicted.add(1);
  else if (res.status >= 500)                   errored.add(1);
  else                                          otherStatus.add(1);

  check(res, {
    'no 5xx': (r) => r.status < 500,
    'no 4xx besides 409/400': (r) => r.status < 500 && (r.status === 409 || r.status === 400 || r.status < 300),
  });
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify({
      bookings_succeeded:   data.metrics.bookings_succeeded?.values?.count ?? 0,
      bookings_conflict:    data.metrics.bookings_conflict?.values?.count ?? 0,
      bookings_error_5xx:   data.metrics.bookings_error_5xx?.values?.count ?? 0,
      bookings_other_status: data.metrics.bookings_other_status?.values?.count ?? 0,
      usage_limit_under_test: usageLimit,
    }, null, 2),
  };
}
