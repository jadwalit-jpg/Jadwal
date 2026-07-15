-- Session-family tracking on refresh_tokens.
--   familyId  — stable session identity carried across every rotation. Lets us
--               revoke a whole session on logout (M5, via a Redis denylist keyed
--               on it) and on stolen-token reuse (M6).
--   rotatedAt — set when a refresh token is rotated (single-use consumed); a token
--               presented again after this is a REUSE → revoke the family (M6).
--
-- SAFE / ADDITIVE. The `refresh_tokens` table has live rows (active sessions), so
-- familyId is added WITH a DB default (gen_random_uuid(), a core pg13+ builtin) to
-- backfill every existing row — each current session becomes its own family, which
-- is correct (no cross-session revocation of pre-migration sessions). The default
-- is then dropped so new rows use Prisma's application-side @default(uuid()).
-- rotatedAt is nullable (no backfill needed). No data is deleted or rewritten.

ALTER TABLE "refresh_tokens" ADD COLUMN "familyId" TEXT NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "refresh_tokens" ALTER COLUMN "familyId" DROP DEFAULT;
ALTER TABLE "refresh_tokens" ADD COLUMN "rotatedAt" TIMESTAMP(3);

CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");
