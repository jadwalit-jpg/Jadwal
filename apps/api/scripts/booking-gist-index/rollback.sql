-- Booking GIST index — rollback.
--
-- Drops the index added by apply.sql. Run if the index turns out to:
--   - degrade write throughput more than the read win
--   - never get picked by the planner (Prisma queries weren't rewritten
--     to use `&&`, so the planner stays on the B-tree index)
--   - confuse vacuum / autovacuum scheduling
--
-- DOES NOT drop the btree_gist extension. Other future indexes may want
-- it, and dropping an extension cascades to every object depending on
-- it — too destructive for a rollback. Leave it; cost is negligible.
--
-- APPLY (outside transaction):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/scripts/booking-gist-index/rollback.sql
--
-- IF NOT EXISTS: re-running is a no-op.

DROP INDEX CONCURRENTLY IF EXISTS public.bookings_activity_range_gist;
