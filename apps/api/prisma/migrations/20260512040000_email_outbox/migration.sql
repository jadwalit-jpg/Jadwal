-- R4 — transactional-ish outbox for booking-confirmation emails.
--
-- Standalone table + two enums. No foreign key to bookings: a deleted booking
-- (e.g. cleanup-cron hard-delete of an abandoned PENDING checkout) must never
-- block draining or pruning the outbox. The (status, nextAttemptAt) index is
-- exactly the drain query's predicate. createdAt feeds the daily prune of old
-- SENT/FAILED rows. All columns have defaults — the table starts empty so
-- there's nothing to backfill.

-- CreateEnum
CREATE TYPE "EmailOutboxType" AS ENUM ('BOOKING_CONFIRMATION');

-- CreateEnum
CREATE TYPE "EmailOutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" TEXT NOT NULL,
    "emailType" "EmailOutboxType" NOT NULL,
    "recipient" VARCHAR(320) NOT NULL,
    "payload" JSONB NOT NULL,
    "bookingId" TEXT,
    "status" "EmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" VARCHAR(300),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_outbox_status_nextAttemptAt_idx" ON "email_outbox"("status", "nextAttemptAt");
