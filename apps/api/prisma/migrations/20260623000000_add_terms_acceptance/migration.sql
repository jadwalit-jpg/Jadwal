-- Terms & Privacy acceptance tracking on User.
-- Both columns are NULLABLE and additive: no backfill, no data mutation, no
-- default. Existing rows stay NULL (= "not yet accepted") and are caught by the
-- post-login consent gate. Safe to run online; zero downtime.
ALTER TABLE "users" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "termsAcceptedVersion" TEXT;
