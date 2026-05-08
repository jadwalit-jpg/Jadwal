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
-- Why plain CREATE INDEX (not CONCURRENTLY):
--   Production bookings table is small (early prod, db.t3.micro, 20GB
--   total instance storage). A plain CREATE INDEX on a small table is
--   sub-second and the brief lock is negligible. CONCURRENTLY would
--   force this migration to run outside Prisma's transactional migrate
--   runner, which adds operational complexity for no benefit on this
--   table size. Re-evaluate when bookings exceeds ~100K rows.
--
-- Pre-flight checklist (verified 2026-05-08 08:11 UTC before this PR):
--   ✓ Manual snapshot pre-gist-2026-05-08 created
--   ✓ Multi-AZ active, deletion protection on
--   ✓ Last automated snapshot 6 hours fresh
--   ✓ ECS services stable (api 3/3, web 2/2, no in-flight deploys)
--
-- Rollback (if anything looks wrong post-deploy):
--   DROP INDEX IF EXISTS booking_active_overlap_gist;
--   DROP EXTENSION IF EXISTS btree_gist;  -- only if no other index uses it
--   No data is touched. Pure index removal.
-- ═════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE INDEX IF NOT EXISTS booking_active_overlap_gist
  ON bookings USING GIST (
    "activityId",
    tstzrange("startDatetime", "endDatetime", '[)')
  )
  WHERE status IN ('PENDING', 'CONFIRMED');
