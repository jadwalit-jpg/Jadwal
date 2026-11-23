-- Admin date change: one ledger row per change, plus a stamp on the booking.
-- Additive only: no existing column or row is modified.

-- CreateEnum
CREATE TYPE "PriceDifferenceSettlement" AS ENUM ('PAID_OUTSIDE', 'REFUNDED_OUTSIDE', 'WAIVED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_RESCHEDULED';

-- AlterEnum
ALTER TYPE "EmailOutboxType" ADD VALUE 'BOOKING_RESCHEDULED';
ALTER TYPE "EmailOutboxType" ADD VALUE 'VENDOR_BOOKING_RESCHEDULED';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "rescheduledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "booking_reschedules" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fromStartDatetime" TIMESTAMP(3) NOT NULL,
    "fromEndDatetime" TIMESTAMP(3) NOT NULL,
    "toStartDatetime" TIMESTAMP(3) NOT NULL,
    "toEndDatetime" TIMESTAMP(3) NOT NULL,
    "fromUnitNumber" INTEGER,
    "toUnitNumber" INTEGER,
    "priceBefore" DECIMAL(10,2) NOT NULL,
    "priceAfter" DECIMAL(10,2) NOT NULL,
    "priceDifference" DECIMAL(10,2) NOT NULL,
    "settlement" "PriceDifferenceSettlement",
    "settlementRef" VARCHAR(200),
    "reason" VARCHAR(500) NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_reschedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_reschedules_bookingId_createdAt_idx" ON "booking_reschedules"("bookingId", "createdAt");

-- AddForeignKey
ALTER TABLE "booking_reschedules" ADD CONSTRAINT "booking_reschedules_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
