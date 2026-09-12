import { Logger } from '@nestjs/common';
import { activeBookingFilter, maxConcurrentInWindow, rentsWholeUnit } from './bookings.service';

/**
 * Backfill `Booking.unitNumber` for bookings that predate an activity's units.
 *
 * WHY THIS EXISTS
 * ---------------
 * `createBooking` only assigns a unit when `hasUnits && unitCount > 0` AT THE
 * MOMENT OF BOOKING. The schema defaults are `hasUnits = false` /
 * `unitCount = 0`, so every booking taken before the unit option was switched
 * on is stored with `unitNumber = null`.
 *
 * That is harmless while the option stays off — such activities count GUESTS
 * against `capacity` and never look at unit numbers. The damage happens the
 * instant someone switches units ON: `rentsWholeUnit()` flips to true, all
 * availability maths switches to counting UNITS, and every unit-counting path
 * ignores null rows:
 *
 *   getCalendarAvailability   if (b.unitNumber != null && overlaps) ...
 *   getDailyAvailability      if (g.unitNumber == null) continue;
 *   createBooking             windowBookings.filter(b => b.unitNumber === unitNum)
 *
 * `null === 1` is false, so those bookings become invisible: they do not show
 * on the calendar AND they do not block a new booking of the same dates. On
 * 2026-09-12 a confirmed two-night stay at a one-unit resort was found in
 * exactly this state — the calendar reported `booked: 0` on nights that were
 * occupied, and staff had closed the dates by hand to stop a double sale.
 *
 * So: whenever the unit configuration changes, hand a unit to the bookings
 * that do not have one. Flipping the switch and backfilling must happen
 * together — flipping alone is what causes the damage.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It never MOVES a booking that already has a unit. Those assignments are what
 * the calendar and the conflict checks have been built on; reshuffling them
 * could silently relocate a guest the vendor has already planned around.
 * Existing assignments are treated as fixed obstacles to pack around.
 *
 * It only touches bookings that are still live (`endDatetime > now`). A stay
 * that already ended cannot be double-sold and does not affect any availability
 * window a customer can reach, so rewriting historical rows would be churn
 * without benefit.
 */

const logger = new Logger('assignMissingUnits');

export interface AssignMissingUnitsResult {
  /** Activity does not use units — nothing to do. */
  skipped: boolean;
  /** Bookings that were given a unit. */
  assigned: number;
  /**
   * Bookings that could NOT be placed because every unit was already taken for
   * their window. This means the activity is genuinely oversold for those dates
   * — pre-existing data, not something this function caused. Surfaced rather
   * than hidden: a silent skip here is how the original bug stayed invisible.
   */
  unassignable: string[];
}

/** A booking as this routine needs to see it. */
interface Slot {
  id: string;
  startDatetime: Date;
  endDatetime: Date;
  guests: number;
  unitNumber: number | null;
}

function overlaps(a: Slot, b: Slot): boolean {
  // The same strict predicate used by createBooking and every availability
  // path: end-touching-start is NOT an overlap (a stay that checks out at
  // 12:00 frees the unit for a 15:00 check-in the same day).
  return a.startDatetime < b.endDatetime && a.endDatetime > b.startDatetime;
}

/**
 * Assign a unit to every live booking of `activityId` that lacks one.
 *
 * Pass the transaction client so the backfill commits or rolls back together
 * with the activity update that triggered it. A half-applied flip is the exact
 * state this function exists to prevent.
 */
export async function assignMissingUnits(
  tx: {
    activity: { findUnique: (args: any) => Promise<any> };
    booking: {
      findMany: (args: any) => Promise<any[]>;
      updateMany: (args: any) => Promise<{ count: number }>;
    };
  },
  activityId: string,
  now: Date = new Date(),
): Promise<AssignMissingUnitsResult> {
  const activity = await tx.activity.findUnique({
    where: { id: activityId },
    select: {
      hasUnits: true, unitCount: true, unitCapacity: true,
      bookingType: true, pricingModel: true,
    },
  });

  // No activity, or units not in play → the null unit numbers are correct as
  // they stand. Activities without units count guests against `capacity` and
  // never read unitNumber at all.
  if (!activity || !activity.hasUnits || !activity.unitCount || activity.unitCount < 1) {
    return { skipped: true, assigned: 0, unassignable: [] };
  }

  const live = {
    activityId,
    ...activeBookingFilter(now),
    endDatetime: { gt: now },
  };

  // Ordered oldest-stay-first, then by creation, so the result is deterministic
  // and the earliest booking gets the lowest unit — re-running the backfill
  // produces the same layout instead of reshuffling on every call.
  const unassigned: Slot[] = (await tx.booking.findMany({
    where: { ...live, unitNumber: null },
    select: { id: true, startDatetime: true, endDatetime: true, guests: true, unitNumber: true },
    orderBy: [{ startDatetime: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  })) as Slot[];

  if (unassigned.length === 0) {
    return { skipped: false, assigned: 0, unassignable: [] };
  }

  // Bookings that already hold a unit. These are immovable obstacles.
  const placed: Slot[] = (await tx.booking.findMany({
    where: { ...live, unitNumber: { not: null } },
    select: { id: true, startDatetime: true, endDatetime: true, guests: true, unitNumber: true },
  })) as Slot[];

  // Bookings sitting on a unit index that no longer exists — e.g. unitCount was
  // reduced from 3 to 1 and someone is still on unit 3. Not caused here, but
  // this is the one place that looks at the whole picture, so surface it: the
  // availability maths counts those as occupied units and can pin the activity
  // at zero availability forever. Deliberately NOT auto-moved — relocating a
  // guest the vendor has already planned around needs a human decision.
  const outOfRange = placed.filter((p) => p.unitNumber != null && p.unitNumber > activity.unitCount);
  if (outOfRange.length > 0) {
    logger.error(
      `Activity ${activityId}: ${outOfRange.length} live booking(s) reference a unit above ` +
        `unitCount=${activity.unitCount} — unit numbers ` +
        `${[...new Set(outOfRange.map((p) => p.unitNumber))].join(', ')}. ` +
        `These were valid before the unit count shrank. Availability will treat them as ` +
        `occupied units. Booking ids: ${outOfRange.map((p) => p.id).join(', ')}`,
    );
  }

  const wholeUnit = rentsWholeUnit(activity);
  const unassignable: string[] = [];
  // Collected then written in one statement per unit rather than one per
  // booking. An activity can legitimately have hundreds of future bookings, and
  // a write-per-booking inside an interactive transaction will blow its timeout
  // — which would roll back the ACTIVITY UPDATE too, leaving a vendor unable to
  // save their own activity. Bounded at `unitCount` statements instead.
  const byUnit = new Map<number, string[]>();

  for (const booking of unassigned) {
    let chosen: number | null = null;

    for (let unit = 1; unit <= activity.unitCount; unit++) {
      const inUnit = placed.filter((p) => p.unitNumber === unit && overlaps(p, booking));

      if (wholeUnit) {
        // Rooms / chalets / yachts: one booking owns the whole unit for its
        // window, no matter the guest count. Any overlap disqualifies the unit.
        if (inUnit.length === 0) { chosen = unit; break; }
      } else {
        // Per-person units: guests share a unit up to its capacity. Use the
        // same peak-concurrency sweep as createBooking so the two agree —
        // a flat SUM would reject staggered, non-concurrent stays.
        const peak = maxConcurrentInWindow(inUnit, booking.startDatetime, booking.endDatetime);
        if (peak + booking.guests <= activity.unitCapacity) { chosen = unit; break; }
      }
    }

    if (chosen == null) {
      // Every unit is taken for this window. The activity is already oversold
      // for these dates — leave the booking as-is rather than forcing it into
      // an occupied unit, and report it so a human can resolve the clash.
      unassignable.push(booking.id);
      continue;
    }

    const ids = byUnit.get(chosen);
    if (ids) ids.push(booking.id); else byUnit.set(chosen, [booking.id]);
    // Record it so the next booking in this loop packs around it too.
    placed.push({ ...booking, unitNumber: chosen });
  }

  let assigned = 0;
  for (const [unit, ids] of byUnit) {
    const res = await tx.booking.updateMany({ where: { id: { in: ids } }, data: { unitNumber: unit } });
    assigned += res.count;
  }

  if (assigned > 0) {
    logger.log(
      `Activity ${activityId}: assigned units to ${assigned} booking(s) that predated its unit configuration.`,
    );
  }
  if (unassignable.length > 0) {
    // error level on purpose — this is real overselling in the existing data
    // and needs a person, not a log line nobody reads.
    logger.error(
      `Activity ${activityId}: ${unassignable.length} booking(s) could NOT be placed — ` +
        `every one of its ${activity.unitCount} unit(s) is already taken for their dates. ` +
        `These remain invisible to availability until resolved. Booking ids: ${unassignable.join(', ')}`,
    );
  }

  return { skipped: false, assigned, unassignable };
}
