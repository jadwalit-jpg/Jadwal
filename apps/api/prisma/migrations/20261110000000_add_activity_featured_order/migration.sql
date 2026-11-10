-- Admin-chosen order of the homepage "Featured" row.
--
-- ADDITIVE: one nullable integer, no default, no other schema change. NULL on
-- a featured listing means "featured but never ordered": the catalog shows
-- those after the numbered ones, newest first. Unfeaturing clears it.
ALTER TABLE "activities" ADD COLUMN "featuredOrder" INTEGER;

-- Backfill: number today's featured listings in the order the homepage shows
-- them now (newest first), so the homepage looks the same right after deploy.
-- Soft-deleted listings are skipped. One-shot: the column starts NULL
-- everywhere, so this only ever fires on rows it has not yet numbered.
UPDATE "activities" a
SET "featuredOrder" = sub.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt" DESC, "id" ASC) AS rn
  FROM "activities"
  WHERE "isFeatured" = true AND "deletedAt" IS NULL
) sub
WHERE a."id" = sub."id";
