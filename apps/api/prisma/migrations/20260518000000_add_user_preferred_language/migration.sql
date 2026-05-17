-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'AR');

-- AlterTable
-- Additive: every existing row gets the default 'EN'. No backfill, no data loss.
ALTER TABLE "users" ADD COLUMN "preferredLanguage" "Language" NOT NULL DEFAULT 'EN';
