// mixed-realistic.js — the actual Tuesday-2pm shape.
//
// 80 % browse / 15 % availability / 5 % booking. This is the load profile
// production actually sees, not the artificial single-endpoint hammer.
// It's the only scenario whose pass/fail genuinely answers "can this thing
// hold N users."
//
// Profile: ramp 0 → 1000 VU over 5 min, hold 15 min, ramp down 2 min.
// Pass: weighted p95 < 500 ms, error rate < 0.1 %, RDS connection count
// < 80 % of `max_connections` (verify in CloudWatch — k6 doesn't see this).
//
// What this would catch:
//   - The cross-endpoint contention that single-scenario tests miss
//     (e.g. catalog browse contributing buffer-pool eviction that slows
//     availability queries that slow bookings)
//   - DB pool size sized for one scenario but not for the combined shape
//   - Throttler tier defaults that turned out to be too tight for
//     legitimate realistic traffic

import http from 'k6/http';
import { sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';
import {
  baseUrl,
  refuseProductionForWrites,
  login,
  idempotencyKey,
  requireEnv,
} from './lib/helpers.js';

export const errorRate = new Rate('mixed_errors');
export const browseCount = new Counter('mixed_browse');
export const availCount = new Counter('mixed_availability');
export const bookCount = new Counter('mixed_booking_attempts');

export const options = {
  scenarios: {
    realistic: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m', target: Number(__ENV.K6_VUS || 1000) },
        { duration: __ENV.K6_DURATION || '15m', target: Number(__ENV.K6_VUS || 1000) },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<500'],
    'mixed_errors': ['rate<0.001'],
    'http_req_failed': ['rate<0.001'],
  },
  tags: { scenario: 'mixed-realistic' },
};

const CATALOG_PATHS = [
  '/api/catalog/cities',
  '/api/catalog/categories',
  '/api/catalog/featured',
  '/api/catalog/vendors?city=doha',
];

export function setup() {
  refuseProductionForWrites();
  return {
    email: requireEnv('TEST_USER_EMAIL'),
    password: requireEnv('TEST_USER_PASSWORD'),
    activityId: requireEnv('TEST_ACTIVITY_ID'),
  };
}

function browse() {
  const root = baseUrl();
  const path = CATALOG_PATHS[Math.floor(Math.random() * CATALOG_PATHS.length)];
  const res = http.get(`${root}${path}`, { tags: { endpoint: path.split('?')[0] } });
  errorRate.add(res.status >= 400);
  browseCount.add(1);
}

function checkAvailability(activityId) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1 + Math.floor(Math.random() * 60));
  const date = d.toISOString().slice(0, 10);
  const res = http.get(
    `${baseUrl()}/api/availability?activityId=${activityId}&date=${date}`,
    { tags: { endpoint: 'availability' } },
  );
  errorRate.add(res.status >= 400);
  availCount.add(1);
}

function attemptBooking(data) {
  // Login — k6's CookieJar is per-VU-iteration; need to login on every
  // attempt path. Real users would already have a session, so this slightly
  // over-counts auth load. Acceptable distortion (≤ 5 % of total traffic).
  login(data.email, data.password);

  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1 + Math.floor(Math.random() * 60));
  d.setUTCHours(10 + Math.floor(Math.random() * 8), 0, 0, 0);
  const start = d.toISOString();
  const end = new Date(d.getTime() + 2 * 60 * 60 * 1000).toISOString();

  const res = http.post(
    `${baseUrl()}/api/bookings`,
    JSON.stringify({
      activityId: data.activityId,
      startDatetime: start,
      endDatetime: end,
      guests: 1,
      idempotencyKey: idempotencyKey(),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'bookings/create' },
    },
  );
  // 409 (slot conflict) is fine — it's an expected outcome of random slot
  // selection at scale, not an error.
  errorRate.add(res.status >= 500);
  bookCount.add(1);
}

export default function (data) {
  // Weighted random: 80 % browse, 15 % availability, 5 % booking.
  const r = Math.random();
  if (r < 0.80) {
    browse();
  } else if (r < 0.95) {
    checkAvailability(data.activityId);
  } else {
    attemptBooking(data);
  }
  sleep(0.5 + Math.random() * 2);
}
