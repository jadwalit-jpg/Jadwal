-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "bounceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_emailHash_key" ON "email_suppressions"("emailHash");

-- CreateIndex
CREATE INDEX "email_suppressions_reason_idx" ON "email_suppressions"("reason");

-- CreateIndex
CREATE INDEX "email_suppressions_createdAt_idx" ON "email_suppressions"("createdAt");
