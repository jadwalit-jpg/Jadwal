-- Booking overlap-detection GIST index — apply script.
--
-- WHAT
--   Adds a composite GIST index on (activityId, tstzrange(startDatetime,
--   endDatetime)) for the `bookings` table. Powers fast overlap detection
--   via Postgres's `&&` operator.
--
-- WHY
--   The current B-tree index `bookings(activityId, startDatetime)` can
--   only optimise equality + one range column. The overlap predicate
--   `startDatetime < end AND endDatetime > start` has range filters on
--   BOTH sides, so the endDatetime filter degenerates into a post-scan.
--   GIST + tstzrange handles two-sided ranges natively. See:
--   feedback_overlap_index_gist.md in project memory.
--
-- WHEN TO APPLY
--   Only after EXPLAIN ANALYZE on production-shaped data shows the
--   conflict-scan path as the actual bottleneck. Otherwise this is
--   "infrastructure for a problem we don't have yet" and the index
--   maintenance cost (every booking write updates the index) outweighs
--   the read benefit. The query rewrite to `&&` is required for the
--   planner to actually USE this index — adding the index alone does
--   nothing if Prisma keeps emitting `startDatetime < end AND
--   endDatetime > start`.
--
-- WHY THE PG `&&` OPERATOR
--   `tstzrange(a, b) && tstzrange(c, d)` is true iff the intervals
--   overlap. Postgres's planner picks the GIST index for this operator;
--   it cannot pick GIST for separate `<` / `>` predicates on the
--   component columns.
--
-- SAFETY
--   - CREATE INDEX CONCURRENTLY: no exclusive lock on the bookings
--     table during build. Reads + writes continue. Slower than non-
--     concurrent build, but safe to run on a live DB.
--   - IF NOT EXISTS: re-running is a no-op.
--   - CREATE EXTENSION btree_gist: enables btree_gist combined index
--     ops. Idempotent (IF NOT EXISTS).
--
-- TIMING ON PROD
--   Index build time on a `bookings` table of ~N rows scales with the
--   number of live (non-CANCELLED) rows. Rough estimate: ~10-30 sec per
--   100k rows. Run during a low-traffic window even though it's
--   non-blocking — the I/O does affect concurrent query latency.
--
-- ROLLBACK
--   See rollback.sql in this directory.
--
-- APPLY (must be run OUTSIDE any transaction):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/scripts/booking-gist-index/apply.sql
--
-- NOTE
--   `prisma migrate dev` cannot host CREATE INDEX CONCURRENTLY (Prisma
--   wraps migrations in a transaction; CONCURRENTLY forbids that). Hence
--   this is a script, not a `prisma/migrations/` directory. After
--   shipping + validating prod gains, write a follow-up Prisma migration
--   that captures the schema-level intent for fresh-DB consistency.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE INDEX CONCURRENTLY IF NOT EXISTS bookings_activity_range_gist
  ON public.bookings
  USING gist (
    "activityId",
    tstzrange("startDatetime", "endDatetime", '[)')
  );

-- Verify the index landed. CREATE INDEX CONCURRENTLY can leave an
-- INVALID index entry if it failed mid-build (e.g. unique violation,
-- but unique constraints aren't relevant here). Surface that loudly.
DO $$
DECLARE
  v_valid boolean;
BEGIN
  SELECT i.indisvalid INTO v_valid
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relname = 'bookings_activity_range_gist';

  IF v_valid IS NULL THEN
    RAISE EXCEPTION 'bookings_activity_range_gist was not created';
  ELSIF NOT v_valid THEN
    RAISE EXCEPTION 'bookings_activity_range_gist is INVALID — drop and recreate manually';
  END IF;
END$$;
