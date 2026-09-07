/*
  What a partner owes back when a refund lands after their money has already gone.

  Bashar's decision, 2026-09-07: "If a payout has already been paid and a refund later creates an
  overpayment, I want the difference recorded as a recoverable balance that is deducted from future
  payouts. Do not automatically create negative transfers or attempt to claw money back outside the
  normal payout process. The outstanding recovery amount should be visible to finance, operations
  and the partner."

  ## The case

  A stay completes, accrual attaches it to a transfer, the transfer is released and PAID. Then the
  guest is refunded. `reverseForRefund` reduces what the partner is owed — but that booking's share
  has already left the company, and `partner_payouts` is immutable once paid (by trigger, because a
  transfer is evidence of what happened rather than a figure to restate).

  So the difference is a real overpayment with nowhere to live. Until now the ledger reversed the
  payable and the cash was simply gone.

  ## Why a balance rather than a correction

  The three tempting alternatives are all worse. Restating the paid payout rewrites history and the
  trigger rightly refuses it. A negative payout invents a transfer that never happened and would
  have to be explained to a bank. And taking it from the next payout silently gives the partner a
  smaller number with no account of why — which is the class of defect this platform keeps finding.

  A balance is a fact somebody can read: this much arose, this much has been recovered, this much
  is outstanding, and here is the booking it came from.

  ## Two tables, because the question is asked in both directions

  «What does this partner still owe back» is the balance. «Which transfers settled it» is the
  deductions. One table with a running total answers the first and loses the second, and a
  reconciliation that cannot be walked is not a reconciliation.
*/
CREATE TABLE IF NOT EXISTS "partner_recoveries" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "partner_id"  uuid NOT NULL REFERENCES "partners"("id"),
  /*
    The booking whose refund caused it. NOT NULL: a recovery with no cause is a debt nobody can
    dispute, and a partner is entitled to be told which stay it came from.
  */
  "booking_id"  uuid NOT NULL REFERENCES "bookings"("id"),
  "currency_id" uuid NOT NULL REFERENCES "currencies"("id"),
  /* What arose. Immutable — the amount recovered is tracked separately. */
  "amount"      numeric(14, 3) NOT NULL,
  /* How much of it has been taken off a later transfer. Rises to `amount` and stops. */
  "recovered_amount" numeric(14, 3) NOT NULL DEFAULT 0,
  /* The payout that had already been paid, so the record says what went wrong where. */
  "paid_payout_id" uuid REFERENCES "partner_payouts"("id"),
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  "settled_at"  timestamptz,
  /* One recovery per booking: a second refund on the same stay raises the same balance. */
  CONSTRAINT "partner_recoveries_booking_unique" UNIQUE ("booking_id")
);
--> statement-breakpoint
/*
  Outstanding, per partner and currency — the only question the accrual path asks.

  Partial so it indexes the rows that still matter: a settled recovery is history, and on a
  platform that settles most of them the index would otherwise grow without bound in the direction
  of the answers nobody needs.
*/
CREATE INDEX IF NOT EXISTS "partner_recoveries_outstanding_idx"
  ON "partner_recoveries" ("partner_id", "currency_id")
  WHERE "settled_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_recovery_deductions" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recovery_id" uuid NOT NULL REFERENCES "partner_recoveries"("id"),
  "payout_id"   uuid NOT NULL REFERENCES "partner_payouts"("id"),
  "amount"      numeric(14, 3) NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  /* A recovery is taken off a given transfer once. A second bite is a bug, not a top-up. */
  CONSTRAINT "partner_recovery_deductions_once" UNIQUE ("recovery_id", "payout_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_recovery_deductions_payout_idx"
  ON "partner_recovery_deductions" ("payout_id");
--> statement-breakpoint
/*
  Where a recovery lands on a transfer.

  `net_amount = gross_amount - fine_amount` has been the identity since payouts existed, enforced
  by a CHECK. A recovery is a third subtraction and needs its own column rather than being folded
  into `fine_amount`: a fine is a penalty the partner can appeal and reads as «الغرامات», and
  labelling money the platform is taking back as a fine would be telling them something untrue on
  the screen where they check what they were paid.
*/
ALTER TABLE "partner_payouts"
  ADD COLUMN IF NOT EXISTS "recovery_amount" numeric(14, 3) NOT NULL DEFAULT 0;
