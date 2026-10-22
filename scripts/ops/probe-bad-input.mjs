#!/usr/bin/env node
/**
 * Bad-input probe: calls every public GET route with missing / garbage
 * parameters and fails if any answer is a 5xx.
 *
 * WHY: a client mistake (missing ?month=, a non-numeric page, an unknown slug)
 * must produce a 4xx. A 5xx means our code crashed on input it should have
 * rejected - it pollutes the error alarms and hides real outages. The
 * availability endpoints answered 500 to a missing ?month= for months before
 * this probe existed.
 *
 * READ-ONLY: GET requests only, nothing is created or changed. Safe to run
 * against production.
 *
 * USAGE
 *   node scripts/ops/probe-bad-input.mjs                       # https://jadwal.qa
 *   node scripts/ops/probe-bad-input.mjs http://localhost:3000 # local dev
 * Exit code 1 if any probe returns 5xx (or the setup lookup fails).
 */
const BASE = (process.argv[2] || 'https://jadwal.qa').replace(/\/$/, '');
const get = (path) =>
  fetch(BASE + path, { headers: { 'User-Agent': 'jadwal-probe/1' }, signal: AbortSignal.timeout(20000) });

const list = await get('/api/catalog/activities?limit=1');
if (!list.ok) {
  console.error(`setup failed: catalog answered ${list.status}`);
  process.exit(1);
}
const body = await list.json();
const first = (Array.isArray(body) ? body : body.data ?? body.items ?? [])[0];
if (!first?.id || !first?.slug) {
  console.error('setup failed: no activity found to probe with');
  process.exit(1);
}
const id = first.id;
const NOPE = '00000000-0000-0000-0000-000000000000';

const probes = [
  // availability: missing, garbage, repeated, impossible values
  `/api/availability/calendar/${id}`,
  `/api/availability/calendar/${id}?month=garbage`,
  `/api/availability/calendar/${id}?month=2026-13`,
  `/api/availability/calendar/${id}?month=2026-05&month=2026-06`,
  `/api/availability/calendar/${id}?month=2026-05&unitNumber=abc`,
  `/api/availability/calendar/${NOPE}?month=2026-05`,
  `/api/availability/hourly/${id}`,
  `/api/availability/hourly/${id}?date=2026-02-30`,
  `/api/availability/hourly/${id}?date=x&date=y`,
  `/api/availability/hourly/${NOPE}?date=2026-05-01`,
  `/api/availability/daily/${id}`,
  `/api/availability/daily/${id}?checkInDate=2026-05-01`,
  `/api/availability/daily/${id}?checkInDate=nope&checkOutDate=nope`,
  `/api/availability/daily/${id}?checkInDate=2026-05-05&checkOutDate=2026-05-01`,
  // catalog: unknown slug, bad paging, bad filters
  '/api/catalog/activities/does-not-exist',
  '/api/catalog/activities/does-not-exist/related',
  '/api/catalog/activities?limit=-5',
  '/api/catalog/activities?limit=999999',
  '/api/catalog/activities?page=abc',
  '/api/catalog/activities?page=0',
  '/api/catalog/activities?minPrice=abc&maxPrice=-1',
  '/api/catalog/cities/not-a-uuid',
  `/api/catalog/cities/${NOPE}`,
  '/api/offers?limit=abc',
  // protected routes must answer 401, not crash
  '/api/admin/users',
  '/api/vendor/bookings',
];

let bad = 0;
for (const p of probes) {
  let status;
  try {
    status = (await get(p)).status;
  } catch (e) {
    status = `ERR ${e.message}`;
  }
  const is5xx = typeof status !== 'number' || status >= 500;
  if (is5xx) bad++;
  console.log(`${is5xx ? 'FAIL' : 'ok  '} ${status}  ${p}`);
}
console.log(`\n${probes.length - bad}/${probes.length} probes ok against ${BASE}`);
process.exit(bad ? 1 : 0);
