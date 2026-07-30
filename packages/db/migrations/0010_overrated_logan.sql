-- Narrows payment_method to the four customer-facing rails plus the three internal
-- ones (Bashar, 2026-07-30): paypal and apple_pay removed, klarna added.
--
-- PostgreSQL cannot DROP a value from an enum, so the type is swapped out. The guard
-- below runs FIRST, deliberately: without it a row still holding 'paypal' fails at
-- the very last statement with `invalid input value for enum payment_method`, after
-- the old type has already been dropped. The transaction rolls back either way, but
-- the operator is left decoding a cast error instead of being told which rows to
-- remap — and a historic PayPal payment needs a deliberate target, which a migration
-- must not pick on its own.
DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(DISTINCT method::text, ', ')
    INTO offending
  FROM payments
  WHERE method::text IN ('paypal', 'apple_pay');

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot narrow payment_method: existing payments still use %. Remap those rows before migrating.',
      offending
      USING ERRCODE = 'check_violation';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "method" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."payment_method";--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('visa', 'mastercard', 'sham_cash', 'klarna', 'gift_card', 'wallet', 'bank_transfer');--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "method" SET DATA TYPE "public"."payment_method" USING "method"::"public"."payment_method";