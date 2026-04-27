-- Add `sessionStartedAt` to refresh_tokens to support absolute session
-- lifetime cap (7 days by default, configurable via SESSION_MAX_DAYS).
-- Pre-existing rows get the default `now()` so live sessions get a fresh
-- 7-day window from the migration apply time — not 7 days from their
-- original login. Acceptable trade-off; alternative (backfilling from
-- createdAt) would require interpreting the rotation chain which we
-- don't track separately.
ALTER TABLE "refresh_tokens"
  ADD COLUMN "sessionStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
