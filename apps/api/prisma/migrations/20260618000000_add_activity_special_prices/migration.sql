-- ActivitySpecialPrice — vendor/admin-managed per-date price override.
--
-- On a given `date`, the activity's effective price becomes `price` instead of
-- `pricePerPerson` (DAILY → that night; HOURLY → that day's slots). The applied
-- value is frozen onto each Booking at booking time, so editing/removing an
-- override never changes an existing booking. Soft-deleted so history survives.
--
-- Purely additive: new table only — no change to existing tables, no data move.

-- CreateTable
CREATE TABLE "activity_special_prices" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "activity_special_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_special_prices_activityId_idx" ON "activity_special_prices"("activityId");

-- CreateIndex
CREATE INDEX "activity_special_prices_vendorId_idx" ON "activity_special_prices"("vendorId");

-- CreateIndex
CREATE INDEX "activity_special_prices_activityId_date_idx" ON "activity_special_prices"("activityId", "date");

-- One ACTIVE override per (activity, date). Partial (WHERE deletedAt IS NULL) so
-- a soft-deleted row never blocks re-creating an override for the same date.
CREATE UNIQUE INDEX "activity_special_prices_active_uq" ON "activity_special_prices"("activityId", "date") WHERE "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "activity_special_prices" ADD CONSTRAINT "activity_special_prices_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_special_prices" ADD CONSTRAINT "activity_special_prices_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
