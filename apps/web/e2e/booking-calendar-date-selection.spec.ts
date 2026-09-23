/**
 * E2E — the booking calendar, driven in a real browser.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Two bugs reported 2026-09-18 lived in the date picker and had survived since
 * the initial commit. The suite was green throughout, because no Playwright
 * spec had ever clicked a calendar day: every booking spec either stopped at
 * the form or used a pre-seeded booking. Six more bugs surfaced while fixing
 * those two, and none was caught by a unit test.
 *
 * Unit and component tests pin the RULES; the integration suite pins the
 * SERVER. Only this layer proves a customer can actually complete the booking
 * — that the props are wired, the data arrives in the shape the rules expect,
 * and the cell responds to a real click.
 *
 * WHAT IT ASSERTS
 * ---------------
 * A stay occupies [check-in 14:00, check-out 11:00). The departure date's
 * night belongs to the next guest. So three days that look almost identical
 * behave differently:
 *
 *   a night a GUEST booked      valid CHECK-OUT (they arrive at 14:00)
 *   a day the VENDOR closed     not valid at all (the block runs from 00:00)
 *   a free day                  valid in both roles
 *
 * Fixture: `e2e-calendar-daily` from seed-e2e-data.ts — one unit, DAILY,
 * 14:00 -> 11:00, with a guest booking and a whole-day closure seeded on known
 * days. Single-unit matters: with spare capacity nothing would ever read as
 * full and these assertions would pass without testing anything.
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const SLUG = 'e2e-calendar-daily';
const API = process.env.E2E_API_URL ?? 'http://localhost:4000/api';

type CalDay = {
  date: string;
  isPast: boolean;
  isActiveDay: boolean;
  isFullyBooked: boolean;
  isBlocked?: boolean;
  isFullyBlocked?: boolean;
};

/**
 * The availability endpoints key on activity ID, not slug, so the slug has to
 * be resolved through the public catalog first. Verified against a running API
 * rather than inferred from the route files — my first attempt guessed
 * `/activities/:slug/availability/calendar`, which does not exist, and every
 * test skipped as a result.
 */
async function activityId(request: APIRequestContext): Promise<string | null> {
  const res = await request.get(`${API}/catalog/activities/${SLUG}`);
  if (!res.ok()) return null;
  const body = await res.json();
  return body?.id ?? null;
}

/**
 * Read the days straight from the availability API rather than recomputing the
 * seeded offsets here. The seed and the spec can run either side of midnight,
 * and a date the spec derived itself would drift from the one the fixture
 * actually created — a failure that looks like a bug in the calendar.
 */
async function calendarDays(request: APIRequestContext): Promise<CalDay[]> {
  const id = await activityId(request);
  if (!id) return [];
  const months: string[] = [];
  const now = new Date();
  for (const add of [0, 1]) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + add, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const all: CalDay[] = [];
  for (const month of months) {
    const res = await request.get(`${API}/availability/calendar/${id}?month=${month}`);
    if (!res.ok()) return [];
    const body = await res.json();
    if (Array.isArray(body?.days)) all.push(...body.days);
  }
  return all;
}

/** The seeded guest-booked night: full, but NOT a vendor closure. */
function guestBookedNight(days: CalDay[]): CalDay | undefined {
  return days.find((d) => !d.isPast && d.isActiveDay && d.isFullyBooked && !d.isBlocked);
}

/** The seeded whole-day vendor closure. */
function vendorClosedDay(days: CalDay[]): CalDay | undefined {
  return days.find((d) => !d.isPast && d.isActiveDay && d.isBlocked && d.isFullyBlocked !== false);
}

function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "October 2026" — how MonthGrid titles each half of the two-month view. */
function monthHeading(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00.000Z`).toLocaleString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/**
 * Cells render as bare day numbers and both months are on screen at once, so
 * the same number appears twice. Scope to the right half by walking up from
 * that month's <h3> to the MonthGrid root, which wraps the heading and its own
 * grid.
 *
 * Anchored on the heading rather than the month-navigation arrows: those
 * buttons carry no accessible name at all, only a bare icon, so the
 * getByLabel(/previous/) I first reached for matched nothing and every test sat
 * waiting for a control that cannot be found by name.
 */
async function cellFor(page: Page, isoDate: string) {
  const dayNum = String(Number(isoDate.slice(8, 10)));
  const monthRoot = page
    .getByRole('heading', { name: monthHeading(isoDate), exact: true })
    .locator('xpath=..');
  return monthRoot.getByRole('button', { name: new RegExp(`^${dayNum}(\\D|$)`) }).first();
}

async function openBookingPage(page: Page, anyDateInView: string) {
  await page.goto(`/activity/${SLUG}/book`, { waitUntil: 'domcontentloaded' });
  // The calendar mounts only once availability resolves, so wait for the month
  // heading rather than for the page shell.
  await expect(
    page.getByRole('heading', { name: monthHeading(anyDateInView), exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * Every test below skips when its fixture is absent, so that a developer
 * running the suite without a seeded DB gets a skip rather than a spurious
 * failure. That politeness has a cost: if the seed silently stops producing
 * the fixture, every one of them skips and the run is GREEN while testing
 * nothing at all.
 *
 * This test is the tripwire. It asserts the fixture exists and has the shape
 * the others rely on, and it FAILS rather than skips when the API is reachable
 * but the data is wrong. CI always seeds, so in CI this can only go red for a
 * real reason.
 */
test.describe('booking calendar — fixture integrity', () => {

  test('the seeded fixture has a guest-booked night AND a vendor-closed day', async ({ request }) => {
    const res = await request.get(`${API}/catalog/activities/${SLUG}`);
    test.skip(res.status() === 0 || res.status() >= 500, 'API unreachable — not a fixture problem');
    expect(
      res.ok(),
      `${SLUG} not found. Run: npx ts-node prisma/seed-e2e-data.ts`,
    ).toBeTruthy();

    const days = await calendarDays(request);
    expect(days.length, 'calendar returned no days').toBeGreaterThan(0);

    const booked = guestBookedNight(days);
    const closed = vendorClosedDay(days);

    expect(booked, 'no guest-booked night in view — the seeded booking is missing or in the past').toBeTruthy();
    expect(closed, 'no vendor-closed day in view — the seeded block is missing or in the past').toBeTruthy();

    // The distinction the calendar rules turn on. If the API ever stops
    // reporting these separately, the picker cannot tell a closure from a
    // taken night and the web-side rule must be revisited with it.
    expect(booked!.isFullyBooked).toBe(true);
    expect(booked!.isBlocked ?? false).toBe(false);
    expect(closed!.isFullyBlocked).toBe(true);
  });
});

test.describe('booking calendar — a booked night is a valid check-out', () => {

  test('the day after a guest booking can be selected as arrival, and the booked night as departure', async ({ page, request }) => {
    const days = await calendarDays(request);
    const booked = guestBookedNight(days);
    test.skip(!booked, 'calendar fixture not seeded — run prisma/seed-e2e-data.ts');

    const arrival = prevDay(booked!.date);
    const arrivalDay = days.find((d) => d.date === arrival);
    test.skip(!arrivalDay || arrivalDay.isFullyBooked || arrivalDay.isPast, 'night before the booking is not free');

    await openBookingPage(page, booked!.date);

    // Pick the free night before the occupied one.
    await (await cellFor(page, arrival)).click();

    // THE BUG: this cell used to render `disabled`, so a one-night stay ending
    // on the occupied night could not be completed at all. The server accepts
    // it — the guest checks out at 11:00, the next arrives at 14:00.
    const departure = await cellFor(page, booked!.date);
    await expect(departure).toBeEnabled();

    await departure.click();

    // Assert a NON-ZERO night count. Two vacuous versions preceded this one:
    //   /check.?out/i        also matched the static "Check in & Check out"
    //                        heading, on screen before anything is picked
    //   /\d+\s+nights?/i      also matched "500 x 0 night" in the price
    //                        breakdown, likewise rendered from the start
    // Both would have passed with nothing selected. The first was caught by
    // CodeRabbit, the second by deleting the click and watching the test pass
    // anyway. A non-zero count can only appear once check-out is set.
    await expect(page.getByText(/[1-9]\d*\s+nights?/i).first()).toBeVisible();
  });
});

test.describe('booking calendar — a stay may not span an unavailable night', () => {

  test('selecting across a booked night is refused with an explanation', async ({ page, request }) => {
    const days = await calendarDays(request);
    const booked = guestBookedNight(days);
    test.skip(!booked, 'calendar fixture not seeded');

    const arrival = prevDay(booked!.date);
    const beyond = nextDay(booked!.date);
    const arrivalDay = days.find((d) => d.date === arrival);
    const beyondDay = days.find((d) => d.date === beyond);
    test.skip(
      !arrivalDay || arrivalDay.isFullyBooked || !beyondDay || beyondDay.isFullyBooked,
      'neighbouring days are not both free',
    );

    await openBookingPage(page, booked!.date);
    await (await cellFor(page, arrival)).click();

    // [arrival, beyond) swallows the occupied night. Before the fix the picker
    // accepted this and the customer only found out at submission.
    const target = await cellFor(page, beyond);
    await target.click();

    // It stays clickable on purpose — an inert cell explains nothing. The tap
    // shakes and raises the warning instead of selecting.
    await expect(
      page.getByText(/isn't available|not available|off-days/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('booking calendar — a vendor-closed day is not selectable', () => {

  test('a whole-day closure is inert, unlike a guest-booked night', async ({ page, request }) => {
    const days = await calendarDays(request);
    const closed = vendorClosedDay(days);
    test.skip(!closed, 'vendor-closed fixture not seeded');

    const arrival = prevDay(closed!.date);
    const arrivalDay = days.find((d) => d.date === arrival);
    test.skip(!arrivalDay || arrivalDay.isFullyBooked || arrivalDay.isPast, 'day before the closure is not free');

    await openBookingPage(page, closed!.date);
    await (await cellFor(page, arrival)).click();

    // The asymmetry. A guest arrives at 14:00, so an 11:00 departure misses
    // them. A closure runs from 00:00, so the same departure lands inside it —
    // createBooking rejects the stay. Offering it would walk the customer
    // through the whole form to a failure.
    await expect(await cellFor(page, closed!.date)).toBeDisabled();
  });
});

test.describe('booking calendar — the ordinary path still works', () => {

  test('two free consecutive days select as a normal stay', async ({ page, request }) => {
    const days = await calendarDays(request);
    const free = days.filter(
      (d) => !d.isPast && d.isActiveDay && !d.isFullyBooked && !d.isBlocked,
    );
    const pair = free.find((d) => free.some((n) => n.date === nextDay(d.date)));
    test.skip(!pair, 'no two consecutive free days in view');

    await openBookingPage(page, pair!.date);
    await (await cellFor(page, pair!.date)).click();
    await (await cellFor(page, nextDay(pair!.date))).click();

    // The guard must not overreach: an ordinary one-night stay is unaffected
    // by any of the rules above. Night count again, for the same reason —
    // the check-out heading is static and proves nothing.
    await expect(page.getByText(/[1-9]\d*\s+nights?/i).first()).toBeVisible();
  });
});
