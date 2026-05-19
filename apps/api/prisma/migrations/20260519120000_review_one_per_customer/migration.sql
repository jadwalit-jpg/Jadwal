-- Enforce one review per (activity, customer).
--
-- The createReview path used a findFirst -> if-exists -> create check with no
-- transaction and no DB constraint, so two near-simultaneous submits from the
-- same customer could both pass the check and insert two review rows. This
-- migration closes that race at the database level.

-- Step 1 — dedup any rows that already slipped through. Keep the EARLIEST
-- review per (activityId, customerId); delete the rest. createdAt is the
-- tiebreaker, id breaks an exact-timestamp tie deterministically. Reviews are
-- aggregated on the fly (no denormalised rating/count column on Activity), so
-- removing the extra rows is sufficient — no recompute needed.
DELETE FROM "reviews" r
USING (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "activityId", "customerId"
           ORDER BY "createdAt" ASC, "id" ASC
         ) AS rn
  FROM "reviews"
) dup
WHERE r."id" = dup."id" AND dup.rn > 1;

-- Step 2 — the unique constraint. Any future duplicate insert now fails with
-- P2002, which createReview maps back to the existing "already reviewed" error.
CREATE UNIQUE INDEX "reviews_activityId_customerId_key"
  ON "reviews"("activityId", "customerId");
