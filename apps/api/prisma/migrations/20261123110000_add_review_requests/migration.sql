-- Review asks: customers who completed an activity are asked to rate it, at
-- most twice per booking (the morning after it ends, then three days later).
--
-- ADDITIVE (no data changed): one ledger table, one nullable column on
-- platform_settings (the launch backlog floor, set once by the first cron
-- run) and two enum values.
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_REQUEST';
ALTER TYPE "EmailOutboxType" ADD VALUE 'REVIEW_REQUEST';

ALTER TABLE "platform_settings" ADD COLUMN "reviewAskFloor" TIMESTAMP(3);

CREATE TABLE "review_requests" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "firstAskedAt" TIMESTAMP(3),
    "secondAskedAt" TIMESTAMP(3),
    "snoozedAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "review_requests_bookingId_key" ON "review_requests"("bookingId");
CREATE INDEX "review_requests_customerId_optedOutAt_reviewedAt_idx" ON "review_requests"("customerId", "optedOutAt", "reviewedAt");
CREATE INDEX "review_requests_firstAskedAt_secondAskedAt_idx" ON "review_requests"("firstAskedAt", "secondAskedAt");

ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
