-- ActivityBlock — vendor-managed availability locks.
--
-- A block makes the UTC interval [blockStart, blockEnd) unbookable on an
-- activity (maintenance, private event, a midday break on an hourly activity).
-- The availability endpoints + createBooking treat any slot/day overlapping an
-- active (deletedAt IS NULL) block as unavailable. Recurring weekday closures
-- remain Activity.activeDays — this is for one-off dates / time windows.
-- Purely additive: new table only, no change to existing tables, no data move.

-- CreateTable
CREATE TABLE "activity_blocks" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "blockStart" TIMESTAMP(3) NOT NULL,
    "blockEnd" TIMESTAMP(3) NOT NULL,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "activity_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_blocks_activityId_idx" ON "activity_blocks"("activityId");

-- CreateIndex
CREATE INDEX "activity_blocks_vendorId_idx" ON "activity_blocks"("vendorId");

-- CreateIndex
CREATE INDEX "activity_blocks_activityId_blockStart_idx" ON "activity_blocks"("activityId", "blockStart");

-- AddForeignKey
ALTER TABLE "activity_blocks" ADD CONSTRAINT "activity_blocks_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_blocks" ADD CONSTRAINT "activity_blocks_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
