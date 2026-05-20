-- Bilingual description for TrendingEvent.
--
-- Mirrors the existing bilingual title pair (titleEn + titleAr) by adding an
-- Arabic counterpart to the description. The existing `description` column is
-- preserved verbatim (it's the de-facto English copy). Customer-facing
-- rendering uses the `localized()` helper which falls back to `description`
-- when `descriptionAr` is missing — so every existing row keeps working.
--
-- Additive nullable column. Zero data loss: no rows are touched, no defaults
-- backfilled, no existing column renamed. Pre-bilingual rows simply have
-- NULL in the new column until the admin edits them.

ALTER TABLE "trending_events" ADD COLUMN "descriptionAr" TEXT;
