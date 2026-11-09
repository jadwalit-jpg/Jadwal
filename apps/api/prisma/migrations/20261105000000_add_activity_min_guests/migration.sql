-- Minimum guests charged on a per-person listing.
--
-- ADDITIVE (no data changed). Every existing activity gets minGuests = 1, which
-- means "no minimum", so all existing listings price exactly as before.
--
-- LOCKING NOTE: a NOT NULL column with a constant DEFAULT is a metadata-only
-- change on PostgreSQL 11+ (no table rewrite), so this is safe on a live table.
ALTER TABLE "activities" ADD COLUMN "minGuests" INTEGER NOT NULL DEFAULT 1;
