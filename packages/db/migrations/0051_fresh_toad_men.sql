-- SAFRA — revenue given up to win a booking.
--
-- The capture group balances on `total = fee + commission + payable`. A coupon
-- makes the customer pay less while the partner is owed exactly the same, so the
-- difference needs an account or the group stops balancing. SAFRA bears the whole
-- discount out of its own two revenue lines; the partner never funds one.
--
-- Enum values cannot be removed in PostgreSQL, so this is one-way.

ALTER TYPE "public"."ledger_account" ADD VALUE 'coupon_discount';