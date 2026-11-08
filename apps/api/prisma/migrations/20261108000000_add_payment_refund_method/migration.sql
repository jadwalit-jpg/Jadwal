-- Refunds made outside the website (bank transfer, cash, card refund in
-- PAY2M, other) are recorded on the payment with the method used, so the
-- booking can be cancelled and marked REFUNDED without crediting Wanasa
-- points a second time.
--
-- ADDITIVE (no data changed): a new enum type and one nullable column.
-- Existing refunds (credited as points) keep NULL here.
CREATE TYPE "RefundMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CARD_PAY2M', 'OTHER');

ALTER TABLE "payments" ADD COLUMN "refundMethod" "RefundMethod";
