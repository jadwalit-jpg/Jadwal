// availability-check.js — RDS-CPU-bound steady-state load.
//
// The availability endpoint is the most likely candidate for slow-query
// pile-up at scale. Every booking flow hits it, every calendar view hits
// it, and the underlying query is range-based (date filtering on bookings).
// If anything's missing an index, this is where we'll see it first.
//
// Profile: 200 VU constant for 5 min — no ramp. Steady state catches index
// scans that work fine for a single request but degrade when the buffer
// pool is fighting many concurrent date scans.
//
// Pass: p95 < 300 ms, 0 % 5xx, RDS CPU < 70 % during the run (verify in
// CloudWatch — k6 doesn't measure this directly).
//
// What this would catch:
//   - Missing indexes on Booking.activityId + Booking.startDatetime
//   - Booking GIST index parked-task biting at scale (memory note
//     `feedback_overlap_index_gist`)
//   - Per-connection statement_timeout firing on a runaway query (visible
//     as 500s clustering at the 15 s mark)

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { baseUrl, requireEnv } from './lib/helpers.js';

export const errorRate = new Rate('availability_errors');
export const responseTime = new Trend('availability_response_ms');

export const options = {
  scenarios: {
    availability: {
      executor: 'constant-vus',
      vus: Number(__ENV.K6_VUS || 200),
      duration: __ENV.K6_DURATION || '5m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<300'],
    availability_errors: ['rate<0.001'],
    http_req_failed: ['rate<0.001'],
  },
  tags: { scenario: 'availability-check' },
};

// Generate a date 1–60 days into the future. Spreading the date range
// across the test run prevents the buffer pool from caching the same
// (activityId, date) tuple — we want the endpoint to actually query, not
// hit the same hot row over and over.
function futureIso(daysOffset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

export function setup() {
  // Verify the activity exists before starting — a 404 here would produce a
  // uniform-fast 404 response that looks healthy but tests nothing.
  // The catalog endpoint takes a slug, but availability takes an activity ID
  // (UUID). Caller passes TEST_ACTIVITY_ID as the UUID. We probe the
  // hourly-availability endpoint itself with a near-future date — if that
  // 200s, we know the activity exists AND the controller path is correct.
  const activityId = requireEnv('TEST_ACTIVITY_ID');
  const probeDate = futureIso(1);
  const probe = http.get(
    `${baseUrl()}/api/availability/hourly/${activityId}?date=${probeDate}`,
  );
  if (probe.status !== 200) {
    throw new Error(
      `[FATAL] hourly availability probe for ${activityId} on ${probeDate} ` +
        `returned ${probe.status}. Body: ${probe.body?.toString().slice(0, 200)}`,
    );
  }
  return { activityId };
}

export default function (data) {
  const date = futureIso(Math.floor(Math.random() * 60) + 1);
  const url = `${baseUrl()}/api/availability/hourly/${data.activityId}?date=${date}`;
  const res = http.get(url, { tags: { endpoint: 'availability/hourly' } });
  responseTime.add(res.timings.duration);
  errorRate.add(res.status >= 400);
  check(res, {
    'availability: 200': (r) => r.status === 200,
    'availability: parsable JSON': (r) => {
      try {
        r.json();
        return true;
      } catch {
        return false;
      }
    },
  });
}
