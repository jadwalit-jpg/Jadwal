// booking-collision.js — single-shot stampede on a single slot.
//
// This is the integrity gate. Booking conflict prevention rests on three
// layers: Redis lock + Serializable isolation + P2034 catch
// (bookings.service.ts:804-832, :1327-1332). If any of those break, two
// users can book the same slot. This test makes them race in-process and
// asserts exactly one wins.
//
// Profile: 20 VU, single iteration each, all attempting the SAME
// (activityId, checkInDate, slotTime) tuple. No ramp, no think time —
// they all start within milliseconds of each other.
//
// IMPORTANT: each VU books `guests = TEST_ACTIVITY_CAPACITY` (default 20)
// so the *first* successful booking eats the entire slot's capacity. The
// remaining 19 VUs MUST then 409 on capacity-exceeded. With guests=1 and
// a 20-capacity fixture, all 20 would succeed and the test would prove
// nothing — capacity must be saturated by the first hit to expose any
// race.
//
// Pass:
//   - bookings_succeeded: exactly 1
//   - bookings_409:       exactly 19
//   - bookings_5xx:       0  (any 5xx is the bug — the 409 path must work)
//   - duplicates_in_db:   0  (post-run check; query in teardown logs)
//
// What this would catch:
//   - Redis lock TTL race (lock acquired but DB transaction hasn't committed
//     by the time the lock auto-expires)
//   - Missing FOR UPDATE on the conflict-detection SELECT
//   - Wrong isolation level on the booking transaction
//   - createBooking dropping the customerId scope on idempotency key check
//
// Run on staging or — during the launch QA window with K6_ALLOW_PROD=true
// and SES + PAY2M still off — against prod. After each run, run the
// post-check query in tests/load/README.md to confirm DB state matches.

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import {
  baseUrl,
  refuseProductionForWrites,
  login,
  idempotencyKey,
  requireEnv,
} from './lib/helpers.js';

export const succeeded = new Counter('bookings_succeeded');
export const conflicts = new Counter('bookings_409');
export const fivexx = new Counter('bookings_5xx');
export const otherStatus = new Counter('bookings_other');

export const options = {
  scenarios: {
    collision: {
      executor: 'per-vu-iterations',
      vus: 20,
      iterations: 1,
      // All 20 VUs start at iteration 0 simultaneously. Tight maxDuration
      // to surface any deadlock or transaction-stuck scenario.
      maxDuration: '2m',
    },
  },
  thresholds: {
    'bookings_succeeded': ['count==1'],
    'bookings_5xx': ['count==0'],
    // 19 conflicts is the strict expectation; allow slack of ±1 ONLY for
    // the case where the seeded activity has slightly more than 1 capacity
    // (real-world test fixtures sometimes have capacity=2 to support
    // other parallel tests). Tighten this when the test fixture is fixed.
    'bookings_409': ['count>=18', 'count<=19'],
  },
  tags: { scenario: 'booking-collision' },
};

export function setup() {
  refuseProductionForWrites();
  // Pick a deterministic future date+slot every VU will fight over.
  // 7 days out, 10:00 slotTime. Single specific tuple ensures collision.
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return {
    email: requireEnv('TEST_USER_EMAIL'),
    password: requireEnv('TEST_USER_PASSWORD'),
    activityId: requireEnv('TEST_ACTIVITY_ID'),
    // Each VU books this many guests. Set to the activity's capacity so
    // the first successful booking saturates the slot and the remaining
    // 19 must 409. Default 20 matches the e2e seed activity.
    // Strict-validate the env override: `Number('abc')` is NaN and
    // `JSON.stringify({guests: NaN})` emits `guests: null`, which would
    // turn this integrity test into a payload-validation failure.
    guestsPerVu: (() => {
      const raw = __ENV.TEST_ACTIVITY_CAPACITY;
      if (raw === undefined || raw === '') return 20;
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(
          `[FATAL] TEST_ACTIVITY_CAPACITY must be a positive integer, got: ${raw}`,
        );
      }
      return n;
    })(),
    targetCheckInDate: d.toISOString().slice(0, 10),
    targetSlotTime: '10:00',
  };
}

export default function (data) {
  login(data.email, data.password);

  const res = http.post(
    `${baseUrl()}/api/bookings`,
    JSON.stringify({
      activityId: data.activityId,
      checkInDate: data.targetCheckInDate,
      slotTime: data.targetSlotTime,
      guests: data.guestsPerVu,
      idempotencyKey: idempotencyKey(),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'bookings/create' },
    },
  );

  if (res.status === 201) succeeded.add(1);
  else if (res.status === 409) conflicts.add(1);
  else if (res.status >= 500) fivexx.add(1);
  else otherStatus.add(1);

  check(res, {
    'collision: response is 201 or 409': (r) => r.status === 201 || r.status === 409,
  });
}

export function teardown(data) {
  console.log(
    `\nCollision test summary — verify in DB (psql against prod/staging):\n  ` +
      `SELECT count(*) FROM "Booking"\n  ` +
      `WHERE "activityId" = '${data.activityId}'\n  ` +
      `  AND DATE("startDatetime") = '${data.targetCheckInDate}'\n  ` +
      `  AND EXTRACT(HOUR FROM "startDatetime") = ` +
      `${parseInt(data.targetSlotTime.split(':')[0], 10)}\n  ` +
      `  AND status IN ('CONFIRMED','PENDING');\n` +
      `Expected: exactly 1 row. More than 1 = integrity bug.\n`,
  );
}
