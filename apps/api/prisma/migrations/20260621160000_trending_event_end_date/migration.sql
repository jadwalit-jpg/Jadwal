-- Bug B — multi-day Trending events.
--
-- Adds an optional END date to homepage "Trending Now" events. The form only
-- allowed a single date, so an event running e.g. 20-23 Jun could only show
-- "20 Jun". NULL = single-day (unchanged); when set, the UI shows a range.
--
-- Purely additive: one nullable column, no backfill (existing events get NULL =
-- single-day). Cannot fail on existing rows.
ALTER TABLE "trending_events" ADD COLUMN "eventEndDate" TIMESTAMP(3);
