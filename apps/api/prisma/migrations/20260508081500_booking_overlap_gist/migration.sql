-- ═════════════════════════════════════════════════════════════════════════
-- Booking overlap GIST index — speeds up conflict-detection queries
-- ═════════════════════════════════════════════════════════════════════════
--
-- Background:
--   bookings.service.ts conflict detection (line 484-490) runs the standard
--   two-sided range query:
--     WHERE startDatetime < $newEnd AND endDatetime > $newStart
--   Existing B-tree indexes (activityId, startDatetime / endDatetime) help
--   the planner find candidate rows but it still has to filter — Postgres
--   cannot use a B-tree to compute range overlap directly.
--
--   A GIST index over `tstzrange(startDatetime, endDatetime, '[)')` lets
--   the planner answer the overlap query in a single index lookup. This
--   matters as the table grows; today it's a sub-millisecond improvement.
--
-- Why a partial index (WHERE status IN ('PENDING','CONFIRMED')):
--   CANCELLED / COMPLETED / REFUND_PENDING bookings don't participate in
--   the conflict surface. activeBookingFilter() in the service excludes
--   them in the WHERE clause anyway. Filtering at index level keeps the
--   index small and keeps writes that update status to terminal states
--   from churning the index.
--
-- Why btree_gist:
--   GIST indexes can natively index range columns. To ALSO index
--   `activityId` (a text equality column) inside the same index entry,
--   Postgres needs the btree_gist contrib extension. This lets the
--   planner do an index lookup on (activityId, range) in one shot.
--
-- Why an IMMUTABLE wrapper for tstzrange() in plpgsql (not sql):
--   Postgres marks the standard tstzrange(timestamptz, timestamptz, text)
--   constructor as STABLE (not IMMUTABLE) because of how the bounds
--   string is parsed. Postgres rejects STABLE-volatility functions in
--   index expressions — they could theoretically vary between calls,
--   which would corrupt the index.
--
--   A naive `LANGUAGE sql` wrapper marked IMMUTABLE doesn't work:
--   Postgres aggressively INLINES simple SQL functions during planning,
--   substituting the body directly into the calling expression. Once
--   inlined, the volatility check happens on the inlined expression
--   (which still contains the STABLE tstzrange call), and the index
--   creation fails with "functions in index expression must be marked
--   IMMUTABLE". This is exactly what happened on PR #167 commit aed5cb3.
--
--   `LANGUAGE plpgsql` functions are NOT inlined, so the IMMUTABLE
--   marker on the wrapper is taken at face value — Postgres trusts the
--   developer assertion. The wrapper IS deterministic given two
--   timestamptz inputs (timestamptz is stored UTC, no session
--   dependency), so the IMMUTABLE marker is honest, not a lie.
--
-- Why partial index `WHERE status != 'CANCELLED'`:
--   Conflict detection only cares about non-cancelled bookings. The
--   filter matches `activeBookingFilter()` in bookings.service.ts. The
--   reservedUntil-based PENDING-expired check is time-dependent so it
--   can't go in the partial-index predicate (must be IMMUTABLE) — the
--   query layer applies it at runtime. Excluding CANCELLED keeps the
--   index small and avoids re-indexing on cancellation churn.
--
-- Why plain CREATE INDEX (not CONCURRENTLY):
--   Production bookings table is empty (verified 2026-05-08 — early
--   prod, no real customers yet). Index build is literally instant on
--   zero rows. CONCURRENTLY would force this migration to run outside
--   Prisma's transactional migrate runner, which adds operational
--   complexity for no benefit. Re-evaluate when bookings exceeds ~100K
--   rows; until then, plain CREATE INDEX inside a normal migration is
--   simpler and rolls back cleanly via Prisma's standard mechanism.
--
-- Pre-flight checklist (verified 2026-05-08 08:11 UTC before this PR):
--   ✓ Manual snapshot pre-gist-2026-05-08 created (status=available)
--   ✓ Multi-AZ active, deletion protection on
--   ✓ Last automated snapshot 6 hours fresh
--   ✓ ECS services stable (api 3/3, web 2/2, no in-flight deploys)
--   ✓ Bookings table empty — zero data corruption risk
--
-- Rollback (if anything looks wrong post-deploy):
--   DROP INDEX IF EXISTS booking_active_overlap_gist;
--   DROP FUNCTION IF EXISTS booking_active_range(timestamptz, timestamptz);
--   DROP EXTENSION IF EXISTS btree_gist;  -- only if no other index uses it
--   No data is touched. Pure schema-additive structures only.
-- ═════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Immutable wrapper for tstzrange — see comment block above for rationale.
-- LANGUAGE plpgsql (not sql) prevents Postgres from inlining the function
-- body, which would otherwise cause the IMMUTABLE marker to be discarded.
CREATE OR REPLACE FUNCTION booking_active_range(start_ts timestamptz, end_ts timestamptz)
RETURNS tstzrange
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  RETURN tstzrange(start_ts, end_ts, '[)');
END;
$$;

CREATE INDEX IF NOT EXISTS booking_active_overlap_gist
  ON bookings USING GIST (
    "activityId",
    booking_active_range("startDatetime", "endDatetime")
  )
  WHERE status != 'CANCELLED';
