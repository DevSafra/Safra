/*
  Collecting a fine, which until now nothing did.

  Bashar's decision, 2026-09-07: "Partner fines should be collected automatically through the payout
  process. The fine amount should be deducted from future partner payouts in the same way
  recoverable balances are handled. If a payout is smaller than the outstanding fine balance, deduct
  what is available and carry the remaining amount forward. Do not create negative payouts. Keep
  fines and recoveries as separate concepts and separate balances. Finance, operations and the
  partner should be able to see the outstanding fine balance and how deductions are applied over
  time."

  ## What was wrong

  `partner_payouts.fine_amount` has been in the money identity since payouts existed and had NO
  WRITER. The enforcement ladder imposed a fine on `partner_violations`, the ledger posted
  `partner_fine` DEBIT / `wallet_credit` CREDIT — SAFRA paying the guest's compensation and
  recording that the partner owed it — and no transfer ever took it back. Measured on this database
  before this ran: 6,643 imposed and unwaived fines totalling $66,430 across 423 partners, and
  payouts that had ever carried a fine: zero. Both applications displayed a fine line that was
  structurally always zero.

  ## Separate from recoveries, deliberately

  Bashar asked for that explicitly and the reason holds on screen as well as in the schema: a fine
  is a PENALTY the partner can appeal and has its own ladder, waiver and reason; a recovery is a
  CORRECTION of money that was never owed. Folding them into one balance would put one word on two
  different things in front of the person paying them.

  So the fine's balance stays where the fine already lives — on the violation — and only the
  collection is new.

  ## The balance is on the violation, not in a new table

  `partner_violations` already carries `fine_amount`, `fine_currency_id`, `waived_at` and the
  ladder. A second table holding "the fine's balance" would be a second answer to "how much is
  this fine", and the two would drift. What was missing is only how much has been COLLECTED.
*/
ALTER TABLE "partner_violations"
  ADD COLUMN IF NOT EXISTS "fine_collected_amount" numeric(14, 3) NOT NULL DEFAULT 0;
--> statement-breakpoint
/*
  `collected_at` already existed and had NO WRITER.

  It is read by the partner's مخالفات screen and by the console's enforcement view, and nothing in
  the codebase ever set it — so a partner has always been shown a «collected» date that was
  permanently empty. It is exactly the field this work needs, so it gets a writer rather than a
  second column beside it claiming the same thing.
*/
/*
  Outstanding fines per partner and currency — the only question the payout path asks.

  Partial on the stage as well as the balance: a fine is only collectible once it has actually been
  IMPOSED. 9,369 violations on this database sit at stage `recorded` carrying a `fine_amount`, which
  the console's own note says cannot happen — collecting those would charge partners for fines
  nobody levied, so the stage is part of the index and part of every query.
*/
CREATE INDEX IF NOT EXISTS "partner_violations_collectible_idx"
  ON "partner_violations" ("partner_id", "fine_currency_id")
  WHERE "collected_at" IS NULL
    AND "waived_at" IS NULL
    AND "stage" IN ('fined', 'suspension');
--> statement-breakpoint
/*
  Which transfer collected which fine, and how much of it.

  The mirror of `partner_recovery_deductions`, and separate for the same reason the balances are:
  «how has this fine been paid down» and «how has this overpayment been recovered» are two
  questions a partner asks about two different things.
*/
CREATE TABLE IF NOT EXISTS "partner_fine_deductions" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "violation_id" uuid NOT NULL REFERENCES "partner_violations"("id"),
  "payout_id"    uuid NOT NULL REFERENCES "partner_payouts"("id"),
  "amount"       numeric(14, 3) NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  /* A fine is taken off a given transfer once. A second bite is a bug, not a top-up. */
  CONSTRAINT "partner_fine_deductions_once" UNIQUE ("violation_id", "payout_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_fine_deductions_payout_idx"
  ON "partner_fine_deductions" ("payout_id");
