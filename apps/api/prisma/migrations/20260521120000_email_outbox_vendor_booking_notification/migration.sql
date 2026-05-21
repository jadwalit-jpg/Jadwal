-- Vendor booking-notification email type.
--
-- Adds a new value to the EmailOutboxType enum so the booking flow can enqueue
-- a "vendor receives notification when their activity is booked" email
-- alongside the existing customer BOOKING_CONFIRMATION row.
--
-- Forward-compatible additive change: no existing rows are touched, no
-- defaults are backfilled, no columns are renamed. Postgres ADD VALUE on an
-- enum runs in milliseconds and is online-safe.

ALTER TYPE "EmailOutboxType" ADD VALUE 'VENDOR_BOOKING_NOTIFICATION';
