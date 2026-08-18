-- Prevent overlapping ACTIVE availability blocks on the same activity at the
-- DB layer. This closes the check-then-insert (TOCTOU) race in
-- activity-blocks.logic.ts: two concurrent requests could both pass the in-JS
-- overlap check and then both insert, leaving two blocks that should have been
-- mutually exclusive. The constraint makes that physically impossible.
--
-- Notes:
--   * btree_gist provides the `=` operator class for the text "activityId"
--     inside the GIST index (alongside the range && "overlaps" operator).
--   * tsrange (NOT tstzrange): "blockStart"/"blockEnd" are TIMESTAMP(3) WITHOUT
--     time zone (they store UTC values).
--   * '[)' = inclusive start / exclusive end — matches the code's semantics, so
--     back-to-back blocks that merely TOUCH (e.g. [10:00,11:00) and
--     [11:00,12:00)) do NOT count as overlapping.
--   * The partial WHERE excludes soft-deleted rows, so a deleted block never
--     blocks a re-create of the same window.
--
-- The CREATE EXTENSION is wrapped so that a migrate role which lacks the
-- privilege does NOT fail the deploy WHEN btree_gist was pre-installed by a DBA
-- (the recommended path on managed Postgres / RDS). If the extension is
-- genuinely absent AND not creatable, the ALTER below fails — which is correct,
-- and fail-closed (the deploy stops; prod stays on the prior version).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'btree_gist not creatable by this role; relying on a pre-installed extension';
END
$$;

ALTER TABLE "activity_blocks"
  ADD CONSTRAINT "activity_blocks_no_overlap"
  EXCLUDE USING gist (
    "activityId" WITH =,
    tsrange("blockStart", "blockEnd", '[)') WITH &&
  )
  WHERE ("deletedAt" IS NULL);
